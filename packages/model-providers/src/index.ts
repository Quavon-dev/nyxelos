export type {
  ResolvedSpeechModel,
  ResolvedTranscriptionModel,
  SpeechModelDefinition,
  SpeechToTextModelDefinition,
} from "./audio";
export {
  DEFAULT_SPEECH_MODEL_ID,
  DEFAULT_SPEECH_VOICE,
  DEFAULT_TRANSCRIPTION_MODEL_ID,
  OPENAI_SPEECH_MODELS,
  OPENAI_SPEECH_VOICES,
  OPENAI_TRANSCRIPTION_MODELS,
  resolveSpeechModel,
  resolveTranscriptionModel,
  supportsSpeechInstructions,
} from "./audio";
export type { ChatStreamPart, ChatStreamResult, CliPermissionMode } from "./cli";
export type {
  DetectedLocalModel,
  DetectedModelCapabilities,
  KnownProviderModel,
  OpenAiCompatibleProbeFailure,
  OpenAiCompatibleProbeResult,
  OpenRouterModel,
} from "./detect";
export {
  detectLmStudioModels,
  detectLocalModels,
  detectOllamaModels,
  detectOpenAiCompatibleModels,
  fetchAnthropicModels,
  fetchOllamaModelCapabilities,
  fetchOpenAiCompatibleCapabilities,
  fetchOpenAiModels,
  fetchOpenRouterModels,
  isOpenAiChatModelId,
  OPENROUTER_BASE_URL,
  probeOpenAiCompatibleEndpoint,
  probeOpenAiCompatibleEndpointDetailed,
} from "./detect";
export type { ImageModelDefinition, ResolvedImageModel } from "./image";
export { DEFAULT_IMAGE_MODEL_ID, OPENAI_IMAGE_MODELS, resolveImageModel } from "./image";
export type { ProviderImportSource } from "./import-sources";
export { scanProviderImportSources } from "./import-sources";
export type { ModelPricing } from "./pricing";
export { estimateCostMicros } from "./pricing";
export type {
  CloudModelDefinition,
  InstalledModelProvider,
  ModelCapabilities,
  ModelProviderKind,
  ModelSummary,
} from "./providers";
export {
  fetchLiveModelIdsForProviderKind,
  getDefaultModelIdsForProviderKind,
  getModelCapabilities,
  listAvailableModels,
  parseInstalledModelId,
  resolveModel,
  toInstalledModelProvider,
} from "./providers";
export type {
  ChatMessageContentPart,
  ChatMessageInput,
  ChatStreamUsage,
  ReasoningEffort,
  StreamChatInput,
} from "./stream";
export { DEFAULT_MAX_OUTPUT_TOKENS, streamChat } from "./stream";
export type { ResolvedVideoProvider, VideoGenerationPlan, VideoModelDefinition } from "./video";
export {
  DEFAULT_VIDEO_MODEL_ID,
  DEFAULT_VIDEO_SECONDS,
  DEFAULT_VIDEO_SIZE,
  getVideoModel,
  OPENAI_VIDEO_MODELS,
  resolveVideoProvider,
  selectVideoModelForPrompt,
} from "./video";
