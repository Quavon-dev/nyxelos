import { getDb } from "@nyxel/db";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Recent-activity tool usage table gets noisy past this many distinct
 * tools — the long tail folds into "Other" in the caller's chart. */
const TOP_TOOL_COUNT = 8;

export interface DailyStatPoint {
	date: string;
	messages: number;
	tokens: number;
	costUsd: number;
	thinkingSeconds: number;
	linesGenerated: number;
}

export interface ModelUsageStat {
	modelId: string;
	label: string;
	messages: number;
	tokens: number;
	costUsd: number;
}

export interface ToolUsageStat {
	toolLabel: string;
	count: number;
	successCount: number;
	errorCount: number;
}

export interface GenerationKindStat {
	kind: "code_blocks" | "images" | "documents" | "other_files";
	label: string;
	count: number;
}

export interface AgentRunStatusStat {
	status: string;
	count: number;
}

export interface WorkspaceStatsOverview {
	windowDays: number;
	totals: {
		assistantMessages: number;
		/** Of `assistantMessages`, how many carry real usage numbers — older
		 * messages (pre-dating this tracking) and claude_cli/codex_cli replies
		 * don't, so token/cost totals below are a floor, not exact. */
		messagesWithUsage: number;
		userMessages: number;
		inputTokens: number;
		outputTokens: number;
		reasoningTokens: number;
		cacheReadTokens: number;
		totalTokens: number;
		costUsd: number;
		/** Assistant messages with usage data but no known price for their
		 * model — excluded from costUsd, called out separately in the UI. */
		costUnknownMessages: number;
		thinkingSeconds: number;
		avgResponseSeconds: number;
		linesGenerated: number;
		codeLinesGenerated: number;
		codeBlocksGenerated: number;
		imagesGenerated: number;
		documentsGenerated: number;
		otherFilesGenerated: number;
		toolCalls: number;
		toolCallSuccessRate: number;
		agentRuns: number;
		agentRunSuccessRate: number;
	};
	dailySeries: DailyStatPoint[];
	modelUsage: ModelUsageStat[];
	toolUsage: ToolUsageStat[];
	generationBreakdown: GenerationKindStat[];
	agentRunStatus: AgentRunStatusStat[];
}

function dayKey(date: Date): string {
	return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const MODEL_LABEL_WORDS: Record<string, string> = { gpt: "GPT" };

function titleizeModelWord(word: string): string {
	const lower = word.toLowerCase();
	if (MODEL_LABEL_WORDS[lower]) return MODEL_LABEL_WORDS[lower];
	if (/^\d/.test(word)) return word;
	return word.length ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}

/** Turns a raw model id ("anthropic/claude-sonnet-5", "custom:abc123/llama3")
 * into a short display label ("Claude Sonnet 5", "Llama3") for chart legends.
 * Consecutive numeric segments ("4", "8") are joined with a dot ("4.8")
 * instead of a space, since that's how ids like "claude-opus-4-8" encode a
 * version number. */
function friendlyModelLabel(modelId: string): string {
	const bare = modelId.split("/").pop() || modelId;
	const words = bare.split(/[-_]/).map(titleizeModelWord);
	const parts: string[] = [];
	for (const word of words) {
		const prev = parts[parts.length - 1];
		if (prev && /^\d+$/.test(prev) && /^\d+$/.test(word)) {
			parts[parts.length - 1] = `${prev}.${word}`;
		} else {
			parts.push(word);
		}
	}
	return parts.join(" ");
}

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

export async function getWorkspaceStatsOverview(
	workspaceId: string,
	days = 30,
): Promise<WorkspaceStatsOverview> {
	const db = getDb();
	const since = new Date(Date.now() - days * MS_PER_DAY);

	const [messages, auditEntriesRaw, libraryFiles, agentRuns] = await Promise.all([
		db.listMessagesByWorkspace(workspaceId, { since }),
		db.listAuditLogByWorkspace(workspaceId, 2000),
		db.listLibraryFilesByWorkspace(workspaceId),
		db.listAgentRunsByWorkspace(workspaceId, { since }),
	]);
	const auditEntries = auditEntriesRaw.filter((e) => new Date(e.createdAt) >= since);

	const assistantMessages = messages.filter((m) => m.role === "assistant");
	const userMessages = messages.filter((m) => m.role === "user");
	const messagesWithUsage = assistantMessages.filter((m) => m.totalTokens != null);

	const dayBuckets = new Map<
		string,
		{ messages: number; tokens: number; costMicros: number; thinkingMs: number; lines: number }
	>();
	for (let i = days - 1; i >= 0; i--) {
		const d = new Date();
		d.setDate(d.getDate() - i);
		dayBuckets.set(dayKey(d), { messages: 0, tokens: 0, costMicros: 0, thinkingMs: 0, lines: 0 });
	}
	for (const m of assistantMessages) {
		const bucket = dayBuckets.get(dayKey(new Date(m.createdAt)));
		if (!bucket) continue;
		bucket.messages += 1;
		bucket.tokens += m.totalTokens ?? 0;
		bucket.costMicros += m.costMicros ?? 0;
		bucket.thinkingMs += m.thinkingMs ?? 0;
		bucket.lines += m.lineCount ?? 0;
	}
	const dailySeries: DailyStatPoint[] = [...dayBuckets.entries()].map(([date, b]) => ({
		date,
		messages: b.messages,
		tokens: b.tokens,
		costUsd: b.costMicros / 1_000_000,
		thinkingSeconds: Math.round(b.thinkingMs / 1000),
		linesGenerated: b.lines,
	}));

	const modelMap = new Map<string, { messages: number; tokens: number; costMicros: number }>();
	for (const m of assistantMessages) {
		const key = m.modelId ?? "unknown";
		const entry = modelMap.get(key) ?? { messages: 0, tokens: 0, costMicros: 0 };
		entry.messages += 1;
		entry.tokens += m.totalTokens ?? 0;
		entry.costMicros += m.costMicros ?? 0;
		modelMap.set(key, entry);
	}
	const modelUsage: ModelUsageStat[] = [...modelMap.entries()]
		.map(([modelId, v]) => ({
			modelId,
			label: modelId === "unknown" ? "Unknown model" : friendlyModelLabel(modelId),
			messages: v.messages,
			tokens: v.tokens,
			costUsd: v.costMicros / 1_000_000,
		}))
		.sort((a, b) => b.messages - a.messages);

	const toolMap = new Map<string, { count: number; success: number; error: number }>();
	for (const e of auditEntries) {
		const entry = toolMap.get(e.toolLabel) ?? { count: 0, success: 0, error: 0 };
		entry.count += 1;
		if (e.status === "success") entry.success += 1;
		else if (e.status === "error") entry.error += 1;
		toolMap.set(e.toolLabel, entry);
	}
	const toolUsage: ToolUsageStat[] = [...toolMap.entries()]
		.map(([toolLabel, v]) => ({
			toolLabel,
			count: v.count,
			successCount: v.success,
			errorCount: v.error,
		}))
		.sort((a, b) => b.count - a.count)
		.slice(0, TOP_TOOL_COUNT);

	const codeBlocksGenerated = assistantMessages.reduce((s, m) => s + (m.codeBlockCount ?? 0), 0);
	const codeLinesGenerated = assistantMessages.reduce((s, m) => s + (m.codeLineCount ?? 0), 0);
	const imagesGenerated = libraryFiles.filter((f) => f.kind === "image").length;
	const documentsGenerated = libraryFiles.filter((f) => f.kind === "document").length;
	const otherFilesGenerated = libraryFiles.filter((f) => f.kind === "other").length;
	const generationBreakdown: GenerationKindStat[] = [
		{ kind: "code_blocks", label: "Code blocks", count: codeBlocksGenerated },
		{ kind: "images", label: "Images", count: imagesGenerated },
		{ kind: "documents", label: "Documents", count: documentsGenerated },
		{ kind: "other_files", label: "Other", count: otherFilesGenerated },
	];

	const statusMap = new Map<string, number>();
	for (const r of agentRuns) statusMap.set(r.status, (statusMap.get(r.status) ?? 0) + 1);
	const agentRunStatus: AgentRunStatusStat[] = [...statusMap.entries()].map(([status, count]) => ({
		status,
		count,
	}));

	const totalCostMicros = assistantMessages.reduce((s, m) => s + (m.costMicros ?? 0), 0);
	const costUnknownMessages = messagesWithUsage.filter((m) => m.costMicros == null).length;
	const totalDurationMs = assistantMessages.reduce((s, m) => s + (m.durationMs ?? 0), 0);
	const totalThinkingMs = assistantMessages.reduce((s, m) => s + (m.thinkingMs ?? 0), 0);
	const toolSuccessCount = auditEntries.filter((e) => e.status === "success").length;
	const agentRunSuccessCount = agentRuns.filter((r) => r.status === "completed").length;

	return {
		windowDays: days,
		totals: {
			assistantMessages: assistantMessages.length,
			messagesWithUsage: messagesWithUsage.length,
			userMessages: userMessages.length,
			inputTokens: assistantMessages.reduce((s, m) => s + (m.inputTokens ?? 0), 0),
			outputTokens: assistantMessages.reduce((s, m) => s + (m.outputTokens ?? 0), 0),
			reasoningTokens: assistantMessages.reduce((s, m) => s + (m.reasoningTokens ?? 0), 0),
			cacheReadTokens: assistantMessages.reduce((s, m) => s + (m.cacheReadTokens ?? 0), 0),
			totalTokens: assistantMessages.reduce((s, m) => s + (m.totalTokens ?? 0), 0),
			costUsd: totalCostMicros / 1_000_000,
			costUnknownMessages,
			thinkingSeconds: Math.round(totalThinkingMs / 1000),
			avgResponseSeconds: assistantMessages.length
				? round1(totalDurationMs / assistantMessages.length / 1000)
				: 0,
			linesGenerated: assistantMessages.reduce((s, m) => s + (m.lineCount ?? 0), 0),
			codeLinesGenerated,
			codeBlocksGenerated,
			imagesGenerated,
			documentsGenerated,
			otherFilesGenerated,
			toolCalls: auditEntries.length,
			toolCallSuccessRate: auditEntries.length
				? round1((toolSuccessCount / auditEntries.length) * 100)
				: 0,
			agentRuns: agentRuns.length,
			agentRunSuccessRate: agentRuns.length
				? round1((agentRunSuccessCount / agentRuns.length) * 100)
				: 0,
		},
		dailySeries,
		modelUsage,
		toolUsage,
		generationBreakdown,
		agentRunStatus,
	};
}
