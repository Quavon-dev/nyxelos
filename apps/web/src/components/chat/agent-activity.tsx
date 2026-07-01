"use client";

import {
	ChevronDown,
	FilePlus,
	FileSearch,
	FileText,
	FolderOpen,
	Lightbulb,
	Loader2,
	Move,
	Pencil,
	Trash2,
	Users,
	Wrench,
} from "lucide-react";
import { useState } from "react";
import type { AgentActivityStep } from "@/lib/chat-agent-activity";

const STEP_META: Record<string, { verb: string; icon: typeof FileText }> = {
	workspace_file_read: { verb: "Gelesen", icon: FileText },
	workspace_file_read_range: { verb: "Gelesen", icon: FileText },
	workspace_file_stat: { verb: "Geprüft", icon: FileSearch },
	workspace_file_list: { verb: "Durchsucht", icon: FolderOpen },
	workspace_file_write: { verb: "Geschrieben", icon: FilePlus },
	workspace_file_append: { verb: "Ergänzt", icon: FilePlus },
	workspace_file_patch: { verb: "Bearbeitet", icon: Pencil },
	workspace_file_move: { verb: "Verschoben", icon: Move },
	workspace_file_delete: { verb: "Gelöscht", icon: Trash2 },
	write_note: { verb: "Notiz erstellt", icon: FilePlus },
	delegate_to_agent: { verb: "Delegiert", icon: Users },
};

function stepMeta(name: string) {
	return STEP_META[name] ?? { verb: "Verwendet", icon: Wrench };
}

function stepTarget(step: AgentActivityStep): string {
	const input = step.input;
	if (input && typeof input === "object") {
		const record = input as Record<string, unknown>;
		if (typeof record.path === "string") return record.path;
		if (typeof record.toPath === "string") return record.toPath;
	}
	return step.name;
}

/** Only workspace_file_patch results carry a unified-diff-style preview
 * (see buildUnifiedDiffPreview in packages/skills-sdk) — everything else has
 * nothing to count, so this quietly returns null rather than a fake 0/0. */
function diffStats(output: unknown): { added: number; removed: number } | null {
	if (!output || typeof output !== "object") return null;
	const diffPreview = (output as Record<string, unknown>).diffPreview;
	if (typeof diffPreview !== "string") return null;

	let added = 0;
	let removed = 0;
	for (const line of diffPreview.split("\n")) {
		if (line.startsWith("+++") || line.startsWith("---")) continue;
		if (line.startsWith("+")) added++;
		else if (line.startsWith("-")) removed++;
	}
	return added || removed ? { added, removed } : null;
}

function ToolStepRow({ step }: { step: AgentActivityStep }) {
	const [open, setOpen] = useState(false);
	const { verb, icon: Icon } = stepMeta(step.name);
	const target = stepTarget(step);
	const stats = diffStats(step.output);
	const running = step.output === undefined && !step.error;
	const detail = step.error
		? step.error
		: step.output !== undefined
			? JSON.stringify(step.output, null, 2)
			: null;

	return (
		<div className="rounded-lg border border-border/60 bg-muted/30">
			<button
				type="button"
				onClick={() => detail && setOpen((v) => !v)}
				className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs"
			>
				{running ? (
					<Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
				) : (
					<Icon className="size-3.5 shrink-0 text-muted-foreground" />
				)}
				<span className={step.error ? "text-destructive" : "text-foreground"}>
					{verb}
				</span>
				<code className="truncate rounded bg-background/80 px-1 py-0.5 font-mono text-[11px] text-muted-foreground">
					{target}
				</code>
				{stats && (
					<span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-[11px]">
						<span className="text-emerald-600 dark:text-emerald-400">
							+{stats.added}
						</span>
						<span className="text-red-600 dark:text-red-400">-{stats.removed}</span>
					</span>
				)}
				{detail && (
					<ChevronDown
						className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${stats ? "" : "ml-auto"} ${open ? "rotate-180" : ""}`}
					/>
				)}
			</button>
			{open && detail && (
				<pre className="max-h-56 overflow-auto whitespace-pre-wrap border-t border-border/60 px-2.5 py-2 font-mono text-[11px] text-muted-foreground">
					{detail}
				</pre>
			)}
		</div>
	);
}

/**
 * Renders a model turn's "thinking" trail — reasoning text (what Gemini
 * labels "Gedanken") and the tool calls it made, in call order. Shown live
 * while streaming and, once persisted, replayed from the trailing
 * ```nyxel-activity block on history reload — see chat-agent-activity.ts.
 */
export function AgentActivity({
	reasoning,
	steps,
}: {
	reasoning?: string;
	steps: AgentActivityStep[];
}) {
	const [reasoningOpen, setReasoningOpen] = useState(false);
	if (!reasoning && steps.length === 0) return null;

	return (
		<div className="space-y-1.5">
			{reasoning && (
				<div className="rounded-lg border border-border/60 bg-muted/30">
					<button
						type="button"
						onClick={() => setReasoningOpen((v) => !v)}
						className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs font-medium text-muted-foreground"
					>
						<Lightbulb className="size-3.5 shrink-0" />
						Gedanken
						<ChevronDown
							className={`ml-auto size-3.5 shrink-0 transition-transform ${reasoningOpen ? "rotate-180" : ""}`}
						/>
					</button>
					{reasoningOpen && (
						<p className="whitespace-pre-wrap border-t border-border/60 px-2.5 py-2 text-xs italic text-muted-foreground">
							{reasoning}
						</p>
					)}
				</div>
			)}
			{steps.map((step) => (
				<ToolStepRow key={step.id} step={step} />
			))}
		</div>
	);
}
