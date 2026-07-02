import type { InstalledModelProvider } from "./providers";

export interface VideoModelDefinition {
  id: string;
  label: string;
  /** Valid "WIDTHxHEIGHT" sizes this model accepts — the first entry is the
   * fallback used when a requested size isn't supported. */
  sizes: string[];
  /** Valid clip durations (seconds) this model accepts. */
  durations: number[];
  tier: "standard" | "pro";
}

const SORA_2: VideoModelDefinition = {
  id: "sora-2",
  label: "Sora 2",
  sizes: ["1280x720", "720x1280"],
  durations: [4, 8, 12],
  tier: "standard",
};

const SORA_2_PRO: VideoModelDefinition = {
  id: "sora-2-pro",
  label: "Sora 2 Pro",
  sizes: ["1280x720", "720x1280", "1792x1024", "1024x1792"],
  durations: [4, 8, 12],
  tier: "pro",
};

/** OpenAI is the only installed-provider kind with a video generation API
 * reachable from a workspace's own key today (the Videos REST API behind
 * Sora 2) — same single-provider situation image.ts documents, and for the
 * same reason: Anthropic has no video API, and OpenRouter/openai_compatible
 * don't standardize one. There's no AI SDK `generateVideo()` helper yet
 * either, so the tool that uses this (tools-builtin/video.ts) calls the
 * REST API directly instead of going through `ai`. */
export const OPENAI_VIDEO_MODELS: VideoModelDefinition[] = [SORA_2, SORA_2_PRO];

export const DEFAULT_VIDEO_MODEL_ID = SORA_2.id;
export const DEFAULT_VIDEO_SIZE = "1280x720";
export const DEFAULT_VIDEO_SECONDS = 8;

export function getVideoModel(modelId: string): VideoModelDefinition {
  return OPENAI_VIDEO_MODELS.find((model) => model.id === modelId) ?? SORA_2;
}

export interface ResolvedVideoProvider {
  apiKey: string;
  providerLabel: string;
}

/**
 * Resolves which OpenAI API key video generation bills against. Mirrors
 * resolveImageModel's installed-provider-then-env-var fallback in image.ts
 * (prefers a workspace's installed OpenAI provider, falls back to a bare
 * `OPENAI_API_KEY`), returning just the credentials rather than an AI SDK
 * model object since there's no SDK video model type to hand back.
 */
export function resolveVideoProvider(
  installedProviders: InstalledModelProvider[] = [],
): ResolvedVideoProvider {
  const openaiProvider = installedProviders.find(
    (provider) => provider.enabled && provider.providerKind === "openai",
  );
  const apiKey = openaiProvider?.apiKey ?? process.env.OPENAI_API_KEY ?? undefined;
  if (!apiKey) {
    throw new Error(
      "Video generation needs an OpenAI provider with an API key installed for this workspace. Add one under Settings → Model Providers.",
    );
  }
  return { apiKey, providerLabel: openaiProvider?.label ?? "OpenAI" };
}

export interface VideoGenerationPlan {
  modelId: string;
  size: string;
  seconds: number;
  /** True if any of model/size/seconds was inferred from the prompt rather
   * than passed explicitly by the caller — "auto mode" for the UI/tool
   * output to label as such. */
  auto: boolean;
}

const PRO_HINTS =
  /\b(cinematic|4k|8k|film[- ]grade|high[- ]fidelity|photoreal(?:istic)?|pro quality|premium quality)\b/;
const PORTRAIT_HINTS = /\b(vertical|portrait|tiktok|reel(?:s)?|shorts?|story|stories|9:16)\b/;
const LANDSCAPE_HINTS = /\b(landscape|widescreen|cinematic|16:9|horizontal)\b/;
const SHORT_HINTS = /\b(short|quick|brief|snappy)\b/;
const LONG_HINTS = /\b(long|extended|full scene|lengthy)\b/;

/**
 * "Auto mode" — the model, aspect ratio, and clip length a user gets when
 * they just type a video prompt in chat and don't pick anything themselves.
 * Everything here is a plain keyword heuristic (no extra model call), same
 * spirit as resolveImageModel's fixed default: cheap, deterministic, good
 * enough to be right most of the time, and always overridable by passing an
 * explicit `model`/`size`/`seconds` through the tool's input schema — this
 * function only fills in what the caller left unset.
 */
export function selectVideoModelForPrompt(
  prompt: string,
  overrides: { model?: string; size?: string; seconds?: number } = {},
): VideoGenerationPlan {
  const text = prompt.toLowerCase();
  let auto = false;

  let modelId = overrides.model;
  if (!modelId || !OPENAI_VIDEO_MODELS.some((m) => m.id === modelId)) {
    auto = auto || !overrides.model;
    modelId = PRO_HINTS.test(text) ? SORA_2_PRO.id : DEFAULT_VIDEO_MODEL_ID;
  }
  const model = getVideoModel(modelId);

  let size = overrides.size;
  if (!size) {
    auto = true;
    if (PORTRAIT_HINTS.test(text)) size = "720x1280";
    else if (LANDSCAPE_HINTS.test(text)) size = DEFAULT_VIDEO_SIZE;
    else size = DEFAULT_VIDEO_SIZE;
  }
  if (!model.sizes.includes(size)) size = model.sizes[0] ?? DEFAULT_VIDEO_SIZE;

  let seconds = overrides.seconds;
  if (!seconds) {
    auto = true;
    seconds = SHORT_HINTS.test(text) ? 4 : LONG_HINTS.test(text) ? 12 : DEFAULT_VIDEO_SECONDS;
  }
  if (!model.durations.includes(seconds)) {
    seconds = model.durations.reduce((closest, candidate) =>
      Math.abs(candidate - (seconds as number)) < Math.abs(closest - (seconds as number))
        ? candidate
        : closest,
    );
  }

  return { modelId: model.id, size, seconds, auto };
}
