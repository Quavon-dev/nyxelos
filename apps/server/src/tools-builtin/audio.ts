import path from "node:path";
import type { ToolRecord } from "@nyxel/db";
import {
	DEFAULT_SPEECH_MODEL_ID,
	DEFAULT_SPEECH_VOICE,
	DEFAULT_TRANSCRIPTION_MODEL_ID,
	OPENAI_SPEECH_MODELS,
	OPENAI_SPEECH_VOICES,
	OPENAI_TRANSCRIPTION_MODELS,
	resolveSpeechModel,
	resolveTranscriptionModel,
	supportsSpeechInstructions,
} from "@nyxel/model-providers";
import type { SkillDefinition } from "@nyxel/skills-sdk";
import { generateSpeech, NoSpeechGeneratedError, NoTranscriptGeneratedError, transcribe } from "ai";
import { z } from "zod";
import { saveLibraryUpload } from "../library";
import { getInstalledProvidersForWorkspace } from "../models";
import { allowedDirsFromConfig, baseFields } from "./shared";

const AUDIO_EXTENSION_BY_FORMAT: Record<string, string> = {
	mp3: "mp3",
	opus: "opus",
	aac: "aac",
	flac: "flac",
	wav: "wav",
	pcm: "pcm",
};

/**
 * Text-to-speech via the AI SDK's `generateSpeech()`, resolved against the
 * workspace's installed OpenAI provider the same way generate_image resolves
 * resolveImageModel — see resolveSpeechModel in @nyxel/model-providers.
 * Saved into the workspace library rather than returned as inline base64 —
 * same reasoning as generate_image: even a clip from OpenAI's 4096-char
 * input cap can be several hundred KB to low-MB depending on format/length,
 * enough to blow the chat model's own context window once fed back as the
 * tool result on the next turn. Returns a `libraryFileId` the frontend
 * resolves through libraryFileUrl() — see agent-activity.tsx's
 * generatedMediaFromOutput.
 */
export function buildGenerateSpeechTool(record: ToolRecord): SkillDefinition {
	return {
		...baseFields(record),
		inputSchema: z.object({
			text: z
				.string()
				.min(1)
				.max(4096)
				.describe("The text to convert to speech. Maximum 4096 characters."),
			voice: z
				.enum(OPENAI_SPEECH_VOICES)
				.optional()
				.describe(`Which voice to use. Defaults to "${DEFAULT_SPEECH_VOICE}".`),
			model: z
				.string()
				.optional()
				.describe(
					`Which speech model to use (${OPENAI_SPEECH_MODELS.map((m) => m.id).join(", ")}). Defaults to ${DEFAULT_SPEECH_MODEL_ID}.`,
				),
			instructions: z
				.string()
				.optional()
				.describe(
					'Tone/style control, e.g. "Speak in a slow and steady tone." Only honored by gpt-4o-mini-tts — ignored by tts-1/tts-1-hd.',
				),
			speed: z
				.number()
				.min(0.25)
				.max(4.0)
				.optional()
				.describe("Playback speed multiplier, 0.25 to 4.0. Defaults to 1.0."),
			format: z
				.enum(["mp3", "opus", "aac", "flac", "wav", "pcm"])
				.optional()
				.describe('Output audio format. Defaults to "mp3".'),
		}),
		// generateSpeech() calls the provider's own API directly rather than
		// going through SkillContext's scoped fetch — same reasoning as
		// generate_image/generate_video.
		permissions: { network: [], filesystem: [] },
		async run({ text, voice, model, instructions, speed, format }) {
			const installedProviders = await getInstalledProvidersForWorkspace(record.workspaceId);
			const resolved = resolveSpeechModel(installedProviders, model);
			try {
				const result = await generateSpeech({
					model: resolved.model,
					text,
					voice: voice ?? DEFAULT_SPEECH_VOICE,
					outputFormat: format ?? "mp3",
					instructions:
						instructions && supportsSpeechInstructions(resolved.modelId) ? instructions : undefined,
					speed,
				});
				const mimeType = result.audio.mediaType || "audio/mpeg";
				const extension = AUDIO_EXTENSION_BY_FORMAT[format ?? "mp3"] ?? "mp3";
				const file = await saveLibraryUpload({
					workspaceId: record.workspaceId,
					folderId: null,
					fileName: `generated-speech-${Date.now()}.${extension}`,
					mimeType,
					bytes: Buffer.from(result.audio.base64, "base64"),
				});
				return {
					text,
					model: resolved.modelId,
					voice: voice ?? DEFAULT_SPEECH_VOICE,
					provider: resolved.providerLabel,
					mimeType,
					libraryFileId: file.id,
				};
			} catch (err) {
				if (NoSpeechGeneratedError.isInstance(err)) {
					const cause =
						err.cause instanceof Error ? err.cause.message : String(err.cause ?? "unknown error");
					throw new Error(`Speech generation failed: ${cause}`);
				}
				throw err;
			}
		},
	};
}

const AUDIO_MIME_BY_EXT: Record<string, string> = {
	".mp3": "audio/mpeg",
	".mp4": "audio/mp4",
	".m4a": "audio/mp4",
	".mpeg": "audio/mpeg",
	".mpga": "audio/mpeg",
	".wav": "audio/wav",
	".webm": "audio/webm",
	".ogg": "audio/ogg",
	".flac": "audio/flac",
};

/**
 * Speech-to-text via the AI SDK's `transcribe()`, resolved the same way
 * generate_speech resolves resolveSpeechModel. Reads an existing audio file
 * from the workspace filesystem (same allow-listed-directory pattern as
 * file_view_image, since skills-sdk's readFile only exposes utf-8 text) and
 * returns the transcript as plain text.
 */
export function buildTranscribeAudioTool(record: ToolRecord): SkillDefinition {
	const allowedDirs = allowedDirsFromConfig(record.config ?? {});
	return {
		...baseFields(record),
		inputSchema: z.object({
			path: z.string().describe("Path to an audio file (mp3, wav, m4a, webm, ogg, flac, ...)."),
			model: z
				.string()
				.optional()
				.describe(
					`Which transcription model to use (${OPENAI_TRANSCRIPTION_MODELS.map((m) => m.id).join(", ")}). Defaults to ${DEFAULT_TRANSCRIPTION_MODEL_ID}.`,
				),
			language: z
				.string()
				.optional()
				.describe('ISO-639-1 language code of the audio (e.g. "en", "de"). Improves accuracy/latency.'),
		}),
		permissions: { network: [], filesystem: allowedDirs },
		async run({ path: filePath, model, language }) {
			const resolved = path.resolve(filePath);
			const allowed = allowedDirs.some(
				(dir) => resolved === dir || resolved.startsWith(`${dir}/`),
			);
			if (!allowed) {
				throw new Error(`"${resolved}" isn't in this tool's declared filesystem permissions.`);
			}

			const { readFile } = await import("node:fs/promises");
			const buffer = await readFile(resolved);
			const mimeType =
				AUDIO_MIME_BY_EXT[path.extname(resolved).toLowerCase()] ?? "application/octet-stream";

			const installedProviders = await getInstalledProvidersForWorkspace(record.workspaceId);
			const resolvedModel = resolveTranscriptionModel(installedProviders, model);
			try {
				const result = await transcribe({
					model: resolvedModel.model,
					audio: buffer,
					providerOptions: language ? { openai: { language } } : undefined,
				});
				return {
					path: resolved,
					mimeType,
					model: resolvedModel.modelId,
					provider: resolvedModel.providerLabel,
					text: result.text,
					language: result.language ?? language ?? null,
					durationInSeconds: result.durationInSeconds ?? null,
				};
			} catch (err) {
				if (NoTranscriptGeneratedError.isInstance(err)) {
					const cause =
						err.cause instanceof Error ? err.cause.message : String(err.cause ?? "unknown error");
					throw new Error(`Transcription failed: ${cause}`);
				}
				throw err;
			}
		},
	};
}
