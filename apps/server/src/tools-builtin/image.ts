import type { ToolRecord } from "@nyxel/db";
import {
  DEFAULT_IMAGE_MODEL_ID,
  OPENAI_IMAGE_MODELS,
  resolveImageModel,
} from "@nyxel/model-providers";
import type { SkillDefinition } from "@nyxel/skills-sdk";
import { generateImage, NoImageGeneratedError } from "ai";
import { z } from "zod";
import { saveLibraryUpload } from "../library";
import { getInstalledProvidersForWorkspace } from "../models";
import { baseFields } from "./shared";

const DEFAULT_SIZE = "1024x1024";

const IMAGE_EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/**
 * Generates an image from a text prompt via the AI SDK's `generateImage()`,
 * resolved against the workspace's installed OpenAI provider (see
 * resolveImageModel in @nyxel/model-providers — gpt-image-1/dall-e-3 are
 * the only image-capable models available today). Saved straight into the
 * workspace library (same pattern as generate_video) rather than returned as
 * inline base64 — a single 1024x1024 PNG is 1-2MB, which blew the *chat
 * model's own* context window on its next turn once that base64 got fed
 * back into the tool-call history (AI_APICallError: context_length_exceeded),
 * silently killing the whole response with no error surfaced to the user.
 * Returns a `libraryFileId` the frontend resolves through libraryFileUrl()
 * — see agent-activity.tsx's generatedMediaFromOutput.
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
        const mimeType = result.image.mediaType || "image/png";
        const extension = IMAGE_EXTENSION_BY_MIME[mimeType] ?? "png";
        const file = await saveLibraryUpload({
          workspaceId: record.workspaceId,
          folderId: null,
          fileName: `generated-image-${Date.now()}.${extension}`,
          mimeType,
          bytes: Buffer.from(result.image.base64, "base64"),
        });
        return {
          prompt,
          model: resolved.modelId,
          provider: resolved.providerLabel,
          mimeType,
          libraryFileId: file.id,
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
