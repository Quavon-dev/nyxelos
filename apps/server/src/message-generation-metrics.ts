/** Fenced code blocks (```lang\n...\n```) — deliberately matches the same
 * markdown convention the chat UI renders as a code block. */
const CODE_FENCE_RE = /```[^\n]*\n([\s\S]*?)```/g;

export interface MessageGenerationMetrics {
	lineCount: number;
	codeLineCount: number;
	codeBlockCount: number;
}

/** Derives "lines generated" / "code generated" stats straight from the
 * final assistant text — no model cooperation needed, unlike token usage. */
export function computeMessageGenerationMetrics(text: string): MessageGenerationMetrics {
	if (!text) return { lineCount: 0, codeLineCount: 0, codeBlockCount: 0 };

	const lineCount = text.split("\n").length;
	let codeLineCount = 0;
	let codeBlockCount = 0;

	for (const match of text.matchAll(CODE_FENCE_RE)) {
		codeBlockCount += 1;
		const body = match[1] ?? "";
		codeLineCount += body.length === 0 ? 0 : body.split("\n").length;
	}

	return { lineCount, codeLineCount, codeBlockCount };
}
