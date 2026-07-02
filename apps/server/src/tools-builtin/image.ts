import type { ToolRecord } from "@nyxel/db";
import {
  DEFAULT_IMAGE_MODEL_ID,
  OPENAI_IMAGE_MODELS,
  resolveImageModel,
} from "@nyxel/model-providers";
import type { SkillDefinition } from "@nyxel/skills-sdk";
import { generateImage, NoImageGeneratedError } from "ai";
import { z } from "zod";
import { getInstalledProvidersForWorkspace } from "../models";
import { baseFields } from "./shared";

const DEFAULT_SIZE = "1024x1024";

/**
 * Generates an image from a text prompt via the AI SDK's `generateImage()`,
 * resolved against the workspace's installed OpenAI provider (see
 * resolveImageModel in @nyxel/model-providers — gpt-image-1/dall-e-3 are
 * the only image-capable models available today). Returns the image as
 * base64 the same way buildFileViewImageTool/buildBrowserScreenshotTool do,
 * so the frontend's existing base64-image rendering applies here too.
 */
export function buildGenerateImageTool(record: ToolRecord): SkillDefinition {
  return {
    ...baseFields(record),
    inputSchema: z.object({
      prompt: z.string().min(1).describe("A detailed description of the image to generate."),
      size: z
        .string()
        .optional()
        .describe(
          `Image dimensions as "WIDTHxHEIGHT", e.g. "1024x1024", "1792x1024", or "1024x1792". Defaults to ${DEFAULT_SIZE}. Not every size is valid for every model — an invalid one is rejected by the provider.`,
        ),
      model: z
        .string()
        .optional()
        .describe(
          `Which image model to use (${OPENAI_IMAGE_MODELS.map((m) => m.id).join(", ")}). Defaults to ${DEFAULT_IMAGE_MODEL_ID}.`,
        ),
    }),
    // generateImage() calls the provider's own API directly rather than
    // going through SkillContext's scoped fetch, so there's no allow-listed
    // host to declare here — same reasoning as the browser tools.
    permissions: { network: [], filesystem: [] },
    async run({ prompt, size, model }) {
      const installedProviders = await getInstalledProvidersForWorkspace(record.workspaceId);
      const resolved = resolveImageModel(installedProviders, model);
      try {
        const result = await generateImage({
          model: resolved.model,
          prompt,
          size: size ?? DEFAULT_SIZE,
        });
        return {
          prompt,
          model: resolved.modelId,
          provider: resolved.providerLabel,
          mimeType: result.image.mediaType || "image/png",
          base64: result.image.base64,
        };
      } catch (err) {
        if (NoImageGeneratedError.isInstance(err)) {
          const cause =
            err.cause instanceof Error ? err.cause.message : String(err.cause ?? "unknown error");
          throw new Error(`Image generation failed: ${cause}`);
        }
        throw err;
      }
    },
  };
}
