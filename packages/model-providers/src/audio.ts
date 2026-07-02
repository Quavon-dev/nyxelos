import { createOpenAI } from "@ai-sdk/openai";
import type { SpeechModel, TranscriptionModel } from "ai";
import type { InstalledModelProvider } from "./providers";

export interface SpeechModelDefinition {
  id: string;
  label: string;
}

const TTS_1: SpeechModelDefinition = { id: "tts-1", label: "TTS 1" };
const TTS_1_HD: SpeechModelDefinition = { id: "tts-1-hd", label: "TTS 1 HD" };
const GPT_4O_MINI_TTS: SpeechModelDefinition = { id: "gpt-4o-mini-tts", label: "GPT-4o Mini TTS" };

/** OpenAI is the only installed-provider kind with an AI SDK speech model
 * factory (`openai.speech(...)`) — same single-provider situation as
 * image.ts/video.ts. */
export const OPENAI_SPEECH_MODELS: SpeechModelDefinition[] = [GPT_4O_MINI_TTS, TTS_1_HD, TTS_1];
export const DEFAULT_SPEECH_MODEL_ID = GPT_4O_MINI_TTS.id;

/** Built-in voices from OpenAI's `/v1/audio/speech` docs — a custom voice
 * object id is also accepted by the API but isn't enumerable ahead of time,
 * so it's not offered as a preset here. */
export const OPENAI_SPEECH_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "onyx",
  "nova",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
] as const;
export const DEFAULT_SPEECH_VOICE = "alloy";

/** `instructions` (tone/style control) only works on gpt-4o-mini-tts, not
 * the older tts-1/tts-1-hd — see OpenAI's audio/speech API docs. */
export function supportsSpeechInstructions(modelId: string): boolean {
  return modelId.startsWith("gpt-4o-mini-tts");
}

const WHISPER_1: SpeechToTextModelDefinition = { id: "whisper-1", label: "Whisper 1" };
const GPT_4O_TRANSCRIBE: SpeechToTextModelDefinition = {
  id: "gpt-4o-transcribe",
  label: "GPT-4o Transcribe",
};
const GPT_4O_MINI_TRANSCRIBE: SpeechToTextModelDefinition = {
  id: "gpt-4o-mini-transcribe",
  label: "GPT-4o Mini Transcribe",
};

export interface SpeechToTextModelDefinition {
  id: string;
  label: string;
}

export const OPENAI_TRANSCRIPTION_MODELS: SpeechToTextModelDefinition[] = [
  GPT_4O_MINI_TRANSCRIBE,
  GPT_4O_TRANSCRIBE,
  WHISPER_1,
];
export const DEFAULT_TRANSCRIPTION_MODEL_ID = GPT_4O_MINI_TRANSCRIBE.id;

function resolveOpenAiApiKey(installedProviders: InstalledModelProvider[]): {
  apiKey: string;
  providerLabel: string;
} {
  const openaiProvider = installedProviders.find(
    (provider) => provider.enabled && provider.providerKind === "openai",
  );
  const apiKey = openaiProvider?.apiKey ?? process.env.OPENAI_API_KEY ?? undefined;
  if (!apiKey) {
    throw new Error(
      "Audio generation/transcription needs an OpenAI provider with an API key installed for this workspace. Add one under Settings → Model Providers.",
    );
  }
  return { apiKey, providerLabel: openaiProvider?.label ?? "OpenAI" };
}

export interface ResolvedSpeechModel {
  model: SpeechModel;
  modelId: string;
  providerLabel: string;
}

/** Mirrors resolveImageModel: prefers a workspace's installed OpenAI
 * provider (its own key/billing), falls back to a bare `OPENAI_API_KEY`. */
export function resolveSpeechModel(
  installedProviders: InstalledModelProvider[] = [],
  preferredModelId?: string,
): ResolvedSpeechModel {
  const { apiKey, providerLabel } = resolveOpenAiApiKey(installedProviders);
  const modelId = preferredModelId?.trim() || DEFAULT_SPEECH_MODEL_ID;
  const openai = createOpenAI({ apiKey });
  return { model: openai.speech(modelId), modelId, providerLabel };
}

export interface ResolvedTranscriptionModel {
  model: TranscriptionModel;
  modelId: string;
  providerLabel: string;
}

export function resolveTranscriptionModel(
  installedProviders: InstalledModelProvider[] = [],
  preferredModelId?: string,
): ResolvedTranscriptionModel {
  const { apiKey, providerLabel } = resolveOpenAiApiKey(installedProviders);
  const modelId = preferredModelId?.trim() || DEFAULT_TRANSCRIPTION_MODEL_ID;
  const openai = createOpenAI({ apiKey });
  return { model: openai.transcription(modelId), modelId, providerLabel };
}
