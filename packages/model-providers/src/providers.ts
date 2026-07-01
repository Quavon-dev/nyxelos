import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { detectLocalModels, getLmStudioApiKey } from "./detect";

export interface CloudModelDefinition {
  id: string;
  label: string;
  provider: "anthropic";
  modelName: string;
}

export interface InstalledModelProvider {
  id: string;
  label: string;
  providerKind: "anthropic" | "openai" | "openai_compatible";
  baseUrl: string;
  apiKey: string | null;
  modelIds: string[];
  enabled: boolean;
}

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

const OPENAI_DEFAULT_MODELS = [
  { id: "gpt-5", label: "GPT-5" },
  { id: "gpt-5-mini", label: "GPT-5 Mini" },
  { id: "gpt-4.1", label: "GPT-4.1" },
];

export interface ModelSummary {
  id: string;
  label: string;
  kind: "local" | "cloud" | "custom";
  provider: string;
  providerLabel: string;
}

export function toInstalledModelProvider(installation: {
  id: string;
  label: string;
  providerKind: "anthropic" | "openai" | "openai_compatible";
  baseUrl: string;
  apiKey: string | null;
  modelIds: string[];
  enabled: boolean;
}): InstalledModelProvider {
  return {
    id: installation.id,
    label: installation.label,
    providerKind: installation.providerKind,
    baseUrl: installation.baseUrl,
    apiKey: installation.apiKey,
    modelIds: installation.modelIds,
    enabled: installation.enabled,
  };
}

export async function listAvailableModels(
  installedProviders: InstalledModelProvider[] = [],
): Promise<ModelSummary[]> {
  const local = await detectLocalModels();
  const cloud: ModelSummary[] = process.env.ANTHROPIC_API_KEY
    ? CLOUD_MODELS.map((m) => ({
        id: m.id,
        label: m.label,
        kind: "cloud" as const,
        provider: m.provider,
        providerLabel: "Anthropic",
      }))
    : [];
  const custom: ModelSummary[] = installedProviders
    .filter((provider) => provider.enabled)
    .flatMap((provider) =>
      provider.modelIds.map((modelId) => ({
        id: `custom:${provider.id}/${modelId}`,
        label: `${modelId} (${provider.label})`,
        kind:
          provider.providerKind === "openai_compatible" ? ("custom" as const) : ("cloud" as const),
        provider: provider.providerKind,
        providerLabel: provider.label,
      })),
    );

  return [
    ...local.map((m) => ({
      id: m.id,
      label: `${m.label} (${m.providerLabel})`,
      kind: "local" as const,
      provider: m.provider,
      providerLabel: m.providerLabel,
    })),
    ...custom,
    ...cloud,
  ];
}

function resolveInstalledProvider(
  modelId: string,
  installedProviders: InstalledModelProvider[],
): { provider: InstalledModelProvider; nativeModelId: string } | null {
  if (!modelId.startsWith("custom:")) return null;

  const remainder = modelId.slice("custom:".length);
  const slashIndex = remainder.indexOf("/");
  if (slashIndex === -1) return null;

  const providerId = remainder.slice(0, slashIndex);
  const nativeModelId = remainder.slice(slashIndex + 1);
  if (!providerId || !nativeModelId) return null;

  const provider = installedProviders.find((candidate) => candidate.id === providerId);
  if (!provider) return null;

  return { provider, nativeModelId };
}

export function resolveModel(
  modelId: string,
  installedProviders: InstalledModelProvider[] = [],
): LanguageModel {
  const installed = resolveInstalledProvider(modelId, installedProviders);
  if (installed) {
    if (!installed.provider.enabled) {
      throw new Error(`Installed model provider "${installed.provider.label}" is disabled.`);
    }

    if (!installed.provider.modelIds.includes(installed.nativeModelId)) {
      throw new Error(`Unknown installed model "${installed.nativeModelId}" for ${modelId}.`);
    }

    if (installed.provider.providerKind === "anthropic") {
      const anthropic = createAnthropic({ apiKey: installed.provider.apiKey ?? undefined });
      return anthropic(installed.nativeModelId);
    }

    if (installed.provider.providerKind === "openai") {
      const openai = createOpenAI({ apiKey: installed.provider.apiKey ?? undefined });
      return openai(installed.nativeModelId);
    }

    const compatible = createOpenAICompatible({
      name: installed.provider.label,
      baseURL: `${installed.provider.baseUrl.replace(/\/+$/, "")}/v1`,
      apiKey: installed.provider.apiKey ?? undefined,
    });
    return compatible(installed.nativeModelId);
  }

  const [prefix, ...rest] = modelId.split("/");
  const nativeId = rest.join("/");
  if (!prefix) throw new Error(`Unknown model id: ${modelId}`);

  if (prefix === "anthropic") {
    const def = CLOUD_MODELS.find((m) => m.id === modelId);
    if (!def) throw new Error(`Unknown cloud model: ${modelId}`);
    const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    return anthropic(def.modelName);
  }

  if (prefix === "ollama") {
    const compatible = createOpenAICompatible({
      name: "ollama",
      baseURL: `${process.env.OLLAMA_BASE_URL?.replace(/\/+$/, "") ?? "http://localhost:11434"}/v1`,
    });
    return compatible(nativeId);
  }

  const compatible = createOpenAICompatible({
    name: prefix,
    baseURL: inferOpenAiCompatibleBaseUrl(prefix),
    apiKey: inferOpenAiCompatibleApiKey(prefix),
  });
  return compatible(nativeId);
}

function inferOpenAiCompatibleBaseUrl(prefix: string): string {
  const envByPrefix: Record<string, string | undefined> = {
    lmstudio: process.env.LMSTUDIO_BASE_URL,
    vllm: process.env.VLLM_BASE_URL,
    localai: process.env.LOCALAI_BASE_URL,
    llamacpp: process.env.LLAMACPP_BASE_URL,
    textgen: process.env.TEXTGEN_BASE_URL,
    jan: process.env.JAN_BASE_URL,
  };
  const defaultByPrefix: Record<string, string> = {
    lmstudio: "http://localhost:1234",
    vllm: "http://localhost:8000",
    localai: "http://localhost:8080",
    llamacpp: "http://localhost:8081",
    textgen: "http://localhost:5000",
    jan: "http://localhost:1337",
  };
  const baseUrl = envByPrefix[prefix] ?? defaultByPrefix[prefix];
  if (!baseUrl) throw new Error(`Unknown model id: ${prefix}`);
  return `${baseUrl.replace(/\/+$/, "")}/v1`;
}

function inferOpenAiCompatibleApiKey(prefix: string): string | undefined {
  if (prefix === "lmstudio") return getLmStudioApiKey();
  return undefined;
}

export function getDefaultModelIdsForProviderKind(
  providerKind: InstalledModelProvider["providerKind"],
): string[] {
  if (providerKind === "anthropic") return CLOUD_MODELS.map((model) => model.modelName);
  if (providerKind === "openai") return OPENAI_DEFAULT_MODELS.map((model) => model.id);
  return [];
}
