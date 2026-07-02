import { createOpenAI } from "@ai-sdk/openai";
import type { ImageModel } from "ai";
import type { InstalledModelProvider } from "./providers";

export interface ImageModelDefinition {
  id: string;
  label: string;
}

const GPT_IMAGE_1: ImageModelDefinition = { id: "gpt-image-1", label: "GPT Image 1" };
const DALL_E_3: ImageModelDefinition = { id: "dall-e-3", label: "DALL·E 3" };

/** OpenAI is currently the only installed-provider kind with an AI SDK image
 * model factory (`openai.image(...)`) — Anthropic has no image-generation
 * API, and OpenRouter/local openai_compatible runtimes don't standardize an
 * image endpoint the SDK understands. */
export const OPENAI_IMAGE_MODELS: ImageModelDefinition[] = [GPT_IMAGE_1, DALL_E_3];

export const DEFAULT_IMAGE_MODEL_ID = GPT_IMAGE_1.id;

export interface ResolvedImageModel {
  model: ImageModel;
  modelId: string;
  providerLabel: string;
}

/**
 * Resolves an AI SDK image model for `generateImage()`. Prefers a workspace's
 * installed OpenAI provider (so its own API key/billing applies), falling
 * back to a bare `OPENAI_API_KEY` env var — the same fallback shape
 * `resolveModel()` uses for Anthropic's CLOUD_MODELS. Throws a message meant
 * to be surfaced directly to the user/model calling the generate-image tool,
 * not just logged.
 */
export function resolveImageModel(
  installedProviders: InstalledModelProvider[] = [],
  preferredModelId?: string,
): ResolvedImageModel {
  const openaiProvider = installedProviders.find(
    (provider) => provider.enabled && provider.providerKind === "openai",
  );
  const apiKey = openaiProvider?.apiKey ?? process.env.OPENAI_API_KEY ?? undefined;
  if (!apiKey) {
    throw new Error(
      "Image generation needs an OpenAI provider with an API key installed for this workspace. Add one under Settings → Model Providers.",
    );
  }

  const modelId =
    preferredModelId && OPENAI_IMAGE_MODELS.some((model) => model.id === preferredModelId)
      ? preferredModelId
      : DEFAULT_IMAGE_MODEL_ID;

  const openai = createOpenAI({ apiKey });
  return {
    model: openai.image(modelId),
    modelId,
    providerLabel: openaiProvider?.label ?? "OpenAI",
  };
}
