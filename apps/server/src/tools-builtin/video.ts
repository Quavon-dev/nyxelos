import type { ToolRecord } from "@nyxel/db";
import { OPENAI_VIDEO_MODELS } from "@nyxel/model-providers";
import type { SkillDefinition } from "@nyxel/skills-sdk";
import { z } from "zod";
import { generateVideo } from "../video";
import { baseFields } from "./shared";

/**
 * Generates a short video from a text prompt via the OpenAI Videos API
 * (Sora 2 / Sora 2 Pro — see generateVideo in ../video.ts, which resolves
 * the workspace's installed OpenAI provider the same way buildGenerateImageTool
 * does). "auto" (the default) picks the model, aspect ratio, and clip length
 * from the prompt's own wording — see selectVideoModelForPrompt in
 * @nyxel/model-providers — so a plain chat prompt gets a sensible video with
 * no extra choices required; every field can still be pinned explicitly.
 *
 * Unlike generate_image, the result is NOT returned as inline base64 — a
 * multi-second clip is megabytes, far too large to embed in every persisted
 * chat message. Instead the finished clip (and a best-effort poster frame)
 * are saved straight into the workspace library, and this tool returns a
 * `libraryFileId` the frontend resolves through libraryFileUrl() for
 * playback — see agent-activity.tsx's generatedVideoFromOutput.
 */
export function buildGenerateVideoTool(record: ToolRecord): SkillDefinition {
	return {
		...baseFields(record),
		inputSchema: z.object({
			prompt: z.string().min(1).describe("A detailed description of the video to generate."),
			model: z
				.enum(["auto", ...OPENAI_VIDEO_MODELS.map((m) => m.id)] as [string, ...string[]])
				.optional()
				.describe(
					`Which video model to use, or "auto" (default) to pick one from the prompt's wording — cinematic/4k/photoreal language selects ${OPENAI_VIDEO_MODELS.find((m) => m.tier === "pro")?.id}, everything else uses the faster ${OPENAI_VIDEO_MODELS.find((m) => m.tier === "standard")?.id}.`,
				),
			size: z
				.string()
				.optional()
				.describe(
					'Video dimensions as "WIDTHxHEIGHT" (e.g. "1280x720" landscape, "720x1280" portrait). Omit to infer from the prompt (mentions of "vertical"/"tiktok"/"shorts" pick portrait, otherwise landscape).',
				),
			seconds: z
				.number()
				.int()
				.optional()
				.describe(
					'Clip length in seconds (4, 8, or 12). Omit to infer from the prompt ("short"/"quick" → 4, "long"/"extended" → 12, otherwise 8).',
				),
			sourceImageBase64: z
				.string()
				.optional()
				.describe("Optional base64-encoded reference image to animate (image-to-video)."),
			sourceImageMimeType: z
				.string()
				.optional()
				.describe('Mime type of sourceImageBase64, e.g. "image/png". Required if it is set.'),
		}),
		// generateVideo() calls the OpenAI Videos API directly rather than
		// through SkillContext's scoped fetch — same reasoning as generate_image.
		permissions: { network: [], filesystem: [] },
		async run({ prompt, model, size, seconds, sourceImageBase64, sourceImageMimeType }) {
			const result = await generateVideo({
				workspaceId: record.workspaceId,
				folderId: null,
				prompt,
				model,
				size,
				seconds,
				sourceImage:
					sourceImageBase64 && sourceImageMimeType
						? { base64: sourceImageBase64, mimeType: sourceImageMimeType }
						: null,
			});
			return {
				prompt,
				model: result.job.model,
				provider: result.job.provider,
				size: result.job.size,
				seconds: result.job.seconds,
				auto: result.job.auto,
				mimeType: result.file.mimeType,
				libraryFileId: result.file.id,
				posterLibraryFileId: result.poster?.id ?? null,
			};
		},
	};
}
