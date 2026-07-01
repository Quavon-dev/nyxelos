export interface MultiSelectPromptOption {
  id: string;
  label: string;
}

export interface MultiSelectPrompt {
  kind: "multi_select";
  question: string;
  options: MultiSelectPromptOption[];
  customLabel?: string;
}

export interface ParsedAssistantContent {
  prompt: MultiSelectPrompt | null;
  body: string;
}

const MULTI_SELECT_BLOCK = /```nyxel-multiselect\s*\n([\s\S]*?)```/i;
const MULTI_SELECT_ITEM = /^\s*(?:\d+\.|[-*•])\s+(.*\S)\s*$/;

function stripMarkdown(text: string) {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function isMultiSelectPrompt(value: unknown): value is MultiSelectPrompt {
  if (!value || typeof value !== "object") return false;
  const prompt = value as Record<string, unknown>;
  if (prompt.kind !== "multi_select") return false;
  if (typeof prompt.question !== "string" || !prompt.question.trim()) return false;
  if (!Array.isArray(prompt.options) || prompt.options.length === 0) return false;
  if (
    prompt.customLabel !== undefined &&
    (typeof prompt.customLabel !== "string" || !prompt.customLabel.trim())
  )
    return false;

  return prompt.options.every((option) => {
    if (!option || typeof option !== "object") return false;
    const candidate = option as Record<string, unknown>;
    return (
      typeof candidate.id === "string" &&
      candidate.id.trim().length > 0 &&
      typeof candidate.label === "string" &&
      candidate.label.trim().length > 0
    );
  });
}

export function parseAssistantContent(content: string): ParsedAssistantContent {
  const match = content.match(MULTI_SELECT_BLOCK);
  if (!match) {
    const fallback = parsePlainMultiSelectPrompt(content);
    return fallback ?? { prompt: null, body: content.trim() };
  }

  try {
    const parsed = JSON.parse(match[1] ?? "");
    if (!isMultiSelectPrompt(parsed)) {
      return { prompt: null, body: content.trim() };
    }

    return {
      prompt: parsed,
      body: content.replace(match[0], "").trim(),
    };
  } catch {
    return { prompt: null, body: content.trim() };
  }
}

function parsePlainMultiSelectPrompt(content: string): ParsedAssistantContent | null {
  const lines = content.split(/\r?\n/);
  const itemIndices: number[] = [];
  const options: MultiSelectPromptOption[] = [];

  lines.forEach((line, index) => {
    const match = line.match(MULTI_SELECT_ITEM);
    if (!match) return;
    itemIndices.push(index);
    options.push({
      id: `option-${options.length + 1}`,
      label: stripMarkdown(match[1] ?? ""),
    });
  });

  if (options.length < 2 || itemIndices.length === 0) return null;

  const firstItemIndex = itemIndices.at(0);
  const lastItemIndex = itemIndices.at(-1);
  if (firstItemIndex === undefined || lastItemIndex === undefined) return null;
  const trailingLines = lines
    .slice(lastItemIndex + 1)
    .map((line) => line.trim())
    .filter(Boolean);
  const question =
    trailingLines.find((line) => /\?\s*$/.test(line)) ??
    trailingLines[0] ??
    stripMarkdown(lines[firstItemIndex - 1] ?? "");

  if (!question || !/\?/.test(question)) return null;

  const body = lines
    .slice(0, firstItemIndex)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();

  return {
    prompt: {
      kind: "multi_select",
      question: stripMarkdown(question),
      options,
    },
    body,
  };
}
