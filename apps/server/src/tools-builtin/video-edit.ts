import type { ToolRecord } from "@nyxel/db";
import type { SkillDefinition } from "@nyxel/skills-sdk";
import { z } from "zod";
import { editVideo } from "../video-edit";
import { baseFields } from "./shared";

/**
 * ffmpeg-backed editing for videos already saved in the workspace library —
 * trim, concatenate, mute, adjust volume, change speed, grab a still frame,
 * or render a GIF preview. One tool with an `operation` discriminator
 * (mirrors file_patch's search/replace-vs-line-range shape) rather than
 * seven near-identical tools. Edits are non-destructive: the result is
 * always written back as a *new* library file, never overwriting the
 * source. See ../video-edit.ts for the ffmpeg invocations themselves.
 */
export function buildEditVideoTool(record: ToolRecord): SkillDefinition {
	return {
		...baseFields(record),
		inputSchema: z.object({
			operation: z
				.enum(["trim", "concat", "mute", "volume", "speed", "extractFrame", "toGif"])
				.describe(
					"trim: cut to [startSeconds, endSeconds]. concat: join libraryFileIds in order. mute: strip audio. volume: scale audio by `volume`. speed: change playback rate by `speed`. extractFrame: save a still at timestampSeconds. toGif: render an animated GIF (optionally clipped to [startSeconds, endSeconds]) at `fps`.",
				),
			libraryFileId: z
				.string()
				.optional()
				.describe("Source video's library file id — required for every operation except concat."),
			libraryFileIds: z
				.array(z.string())
				.optional()
				.describe("Ordered library file ids to join — required for operation: concat (at least two)."),
			startSeconds: z.number().optional(),
			endSeconds: z.number().optional(),
			volume: z.number().optional().describe("Volume multiplier for operation: volume (e.g. 0.5, 2)."),
			speed: z.number().optional().describe("Playback speed multiplier for operation: speed (e.g. 0.5, 2)."),
			timestampSeconds: z.number().optional().describe("Frame timestamp for operation: extractFrame."),
			fps: z.number().optional().describe("Sampling rate for operation: toGif (default 10)."),
		}),
		permissions: { network: [], filesystem: [] },
		async run(input) {
			const result = await editVideo({ workspaceId: record.workspaceId, folderId: null, ...input });
			return {
				operation: input.operation,
				libraryFileId: result.file.id,
				name: result.file.name,
				mimeType: result.file.mimeType,
			};
		},
	};
}
