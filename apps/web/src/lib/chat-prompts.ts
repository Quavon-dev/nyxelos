export interface MultiSelectPromptOption {
  id: string;
  label: string;
}

export interface MultiSelectPrompt {
  kind: "multi_select";
  question: string;
  options: MultiSelectPromptOption[];
}

export interface ParsedAssistantContent {
  prompt: MultiSelectPrompt | null;
  body: string;
}

const MULTI_SELECT_BLOCK = /```nyxel-multiselect\s*\n([\s\S]*?)```/i;

function isMultiSelectPrompt(value: unknown): value is MultiSelectPrompt {
  if (!value || typeof value !== "object") return false;
  const prompt = value as Record<string, unknown>;
  if (prompt.kind !== "multi_select") return false;
  if (typeof prompt.question !== "string" || !prompt.question.trim()) return false;
  if (!Array.isArray(prompt.options) || prompt.options.length === 0) return false;

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
    return { prompt: null, body: content.trim() };
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

