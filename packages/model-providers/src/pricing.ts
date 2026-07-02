/** Local/self-hosted providers never bill per token — used to short-circuit
 * cost estimation to $0 instead of "unknown" for these. Mirrors the prefix
 * set stream.ts already keys off of for inline-system-prompt handling. */
const FREE_MODEL_PREFIXES = [
	"jan",
	"llamacpp",
	"lmstudio",
	"localai",
	"ollama",
	"textgen",
	"vllm",
];

export interface ModelPricing {
	/** USD per 1,000,000 input tokens. */
	inputPerMillion: number;
	/** USD per 1,000,000 output tokens (usually higher — generation is more
	 * expensive than reading). */
	outputPerMillion: number;
	/** USD per 1,000,000 cached-read input tokens, when the provider
	 * discounts prompt-cache hits. Defaults to inputPerMillion. */
	cacheReadPerMillion?: number;
}

/** Keyed by the bare model name (the part after the last "/") so it matches
 * regardless of which provider prefix wraps it (`anthropic/…`,
 * `custom:{id}/…`, `openrouter/…`). Prices are approximate list prices in
 * USD, current as of this writing — good enough for a dashboard estimate,
 * not an invoice. */
const MODEL_PRICING: Record<string, ModelPricing> = {
	"claude-opus-4-8": { inputPerMillion: 15, outputPerMillion: 75, cacheReadPerMillion: 1.5 },
	"claude-opus-4-7": { inputPerMillion: 15, outputPerMillion: 75, cacheReadPerMillion: 1.5 },
	"claude-opus-4-6": { inputPerMillion: 15, outputPerMillion: 75, cacheReadPerMillion: 1.5 },
	"claude-sonnet-5": { inputPerMillion: 3, outputPerMillion: 15, cacheReadPerMillion: 0.3 },
	"claude-sonnet-4-6": { inputPerMillion: 3, outputPerMillion: 15, cacheReadPerMillion: 0.3 },
	"claude-fable-5": { inputPerMillion: 3, outputPerMillion: 15, cacheReadPerMillion: 0.3 },
	"claude-haiku-4-5": { inputPerMillion: 1, outputPerMillion: 5, cacheReadPerMillion: 0.1 },
	"gpt-5": { inputPerMillion: 1.25, outputPerMillion: 10, cacheReadPerMillion: 0.125 },
	"gpt-5-mini": { inputPerMillion: 0.25, outputPerMillion: 2, cacheReadPerMillion: 0.025 },
	"gpt-4.1": { inputPerMillion: 2, outputPerMillion: 8, cacheReadPerMillion: 0.5 },
};

function bareModelName(modelId: string): string {
	const parts = modelId.split("/");
	return parts[parts.length - 1] ?? modelId;
}

function isFreeModel(modelId: string): boolean {
	const prefix = modelId.split("/")[0]?.replace(/^custom:[^/]*$/, "") ?? "";
	return FREE_MODEL_PREFIXES.some((free) => prefix === free || prefix.startsWith(`${free}:`));
}

/** Estimates USD cost (in millionths, i.e. `costUsd * 1_000_000`, matching
 * message.costMicros) for one generation. Returns `0` for known-local model
 * ids, and `null` when the model's price isn't in `MODEL_PRICING` — callers
 * should treat `null` as "unknown", not "free". */
export function estimateCostMicros(
	modelId: string,
	usage: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number },
): number | null {
	if (isFreeModel(modelId)) return 0;

	const pricing = MODEL_PRICING[bareModelName(modelId)];
	if (!pricing) return null;

	const cacheReadTokens = usage.cacheReadTokens ?? 0;
	const nonCachedInputTokens = Math.max(0, (usage.inputTokens ?? 0) - cacheReadTokens);
	const outputTokens = usage.outputTokens ?? 0;
	const cacheReadPerMillion = pricing.cacheReadPerMillion ?? pricing.inputPerMillion;

	const costUsd =
		(nonCachedInputTokens * pricing.inputPerMillion) / 1_000_000 +
		(cacheReadTokens * cacheReadPerMillion) / 1_000_000 +
		(outputTokens * pricing.outputPerMillion) / 1_000_000;

	return Math.round(costUsd * 1_000_000);
}
