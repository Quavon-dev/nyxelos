import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { detectLocalModels } from "./detect";

export interface CloudModelDefinition {
  /** e.g. "anthropic/claude-sonnet-5" */
  id: string;
  label: string;
  provider: "anthropic";
  /** The provider-native model identifier. */
  modelName: string;
}

// Cloud models only show up once the matching API key is configured
// (see ARCHITECTURE.md section 7 — API keys live encrypted at rest;
// for this Phase 0 slice they're read from the environment).
const CLOUD_MODELS: CloudModelDefinition[] = [
  {
    id: "anthropic/claude-sonnet-5",
    label: "Claude Sonnet 5",
    provider: "anthropic",
    modelName: "claude-sonnet-5",
  },
  {
    id: "anthropic/claude-opus-4-8",
    label: "Claude Opus 4.8",
    provider: "anthropic",
    modelName: "claude-opus-4-8",
  },
];

export interface ModelSummary {
  id: string;
  label: string;
  kind: "local" | "cloud";
}

export async function listAvailableModels(): Promise<ModelSummary[]> {
  const local = await detectLocalModels();
  const cloud: ModelSummary[] = process.env.ANTHROPIC_API_KEY
    ? CLOUD_MODELS.map((m) => ({ id: m.id, label: m.label, kind: "cloud" as const }))
    : [];

  return [...local.map((m) => ({ id: m.id, label: m.label, kind: "local" as const })), ...cloud];
}

const LOCAL_BASE_URLS: Record<string, string> = {
  ollama: "http://localhost:11434/v1",
  lmstudio: "http://localhost:1234/v1",
};

/** Resolves a model id (e.g. "ollama/llama3.1:8b" or "anthropic/claude-sonnet-5")
 * to a Vercel AI SDK LanguageModel instance. */
export function resolveModel(modelId: string): LanguageModel {
  const [prefix, ...rest] = modelId.split("/");
  const nativeId = rest.join("/");

  if (prefix === "anthropic") {
    const def = CLOUD_MODELS.find((m) => m.id === modelId);
    if (!def) throw new Error(`Unknown cloud model: ${modelId}`);
    const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    return anthropic(def.modelName);
  }

  const baseURL = prefix ? LOCAL_BASE_URLS[prefix] : undefined;
  if (!baseURL) throw new Error(`Unknown model id: ${modelId}`);

  const compatible = createOpenAICompatible({ name: prefix, baseURL });
  return compatible(nativeId);
}
