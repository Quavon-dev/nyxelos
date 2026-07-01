import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { CLI_DEFAULT_MODEL_SENTINEL } from "./cli";
import { detectLocalModels, getLmStudioApiKey, normalizeOpenAiCompatibleBaseUrl } from "./detect";

export interface CloudModelDefinition {
  id: string;
  label: string;
  provider: "anthropic";
  modelName: string;
}

export type ModelProviderKind =
  | "anthropic"
  | "openai"
  | "openai_compatible"
  | "claude_cli"
  | "codex_cli";

export interface InstalledModelProvider {
  id: string;
  label: string;
  providerKind: ModelProviderKind;
  baseUrl: string;
  apiKey: string | null;
  modelIds: string[];
  /** Subset of modelIds hidden from the model picker without removing them. */
  disabledModelIds: string[];
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
  {
    id: "anthropic/claude-fable-5",
    label: "Claude Fable 5",
    provider: "anthropic",
    modelName: "claude-fable-5",
  },
  {
    id: "anthropic/claude-opus-4-7",
    label: "Claude Opus 4.7",
    provider: "anthropic",
    modelName: "claude-opus-4-7",
  },
  {
    id: "anthropic/claude-opus-4-6",
    label: "Claude Opus 4.6",
    provider: "anthropic",
    modelName: "claude-opus-4-6",
  },
  {
    id: "anthropic/claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    provider: "anthropic",
    modelName: "claude-sonnet-4-6",
  },
  {
    id: "anthropic/claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    provider: "anthropic",
    modelName: "claude-haiku-4-5",
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

export interface ModelCapabilities {
  nativeImageInput: boolean;
  nativeDocumentInput: boolean;
}

export function toInstalledModelProvider(installation: {
  id: string;
  label: string;
  providerKind: ModelProviderKind;
  baseUrl: string;
  apiKey: string | null;
  modelIds: string[];
  disabledModelIds: string[];
  enabled: boolean;
}): InstalledModelProvider {
  return {
    id: installation.id,
    label: installation.label,
    providerKind: installation.providerKind,
    baseUrl: installation.baseUrl,
    apiKey: installation.apiKey,
    modelIds: installation.modelIds,
    disabledModelIds: installation.disabledModelIds,
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
      provider.modelIds
        .filter((modelId) => !provider.disabledModelIds.includes(modelId))
        .map((modelId) => ({
          id: `custom:${provider.id}/${modelId}`,
          label: `${modelId} (${provider.label})`,
          kind:
            provider.providerKind === "claude_cli" || provider.providerKind === "codex_cli"
              ? ("local" as const)
              : provider.providerKind === "openai_compatible"
                ? ("custom" as const)
                : ("cloud" as const),
          provider: provider.providerKind,
          providerLabel: provider.label,
        })),
    );

  const merged = [
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

  // Auto-detected local models (env/port probing) and a manually installed
  // openai_compatible provider pointed at that same local server end up as
  // two entries with an identical label but different ids (`lmstudio/...`
  // vs `custom:{installationId}/...`) — same underlying model, shown twice.
  // First occurrence wins.
  const seenLabels = new Set<string>();
  return merged.filter((m) => {
    if (seenLabels.has(m.label)) return false;
    seenLabels.add(m.label);
    return true;
  });
}

/** Parses the `custom:{installationId}/{nativeModelId}` model id scheme
 * shared by every installed-provider kind (remote HTTP providers and local
 * CLI providers alike) and looks up the matching installation. Exported so
 * `stream.ts` doesn't need its own copy of this parsing to decide whether a
 * model id should be routed to a CLI adapter instead of `resolveModel()`. */
export function parseInstalledModelId(
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
  const installed = parseInstalledModelId(modelId, installedProviders);
  if (installed) {
    if (!installed.provider.enabled) {
      throw new Error(`Installed model provider "${installed.provider.label}" is disabled.`);
    }

    if (!installed.provider.modelIds.includes(installed.nativeModelId)) {
      throw new Error(`Unknown installed model "${installed.nativeModelId}" for ${modelId}.`);
    }

    if (
      installed.provider.providerKind === "claude_cli" ||
      installed.provider.providerKind === "codex_cli"
    ) {
      // CLI-based providers don't produce an AI SDK LanguageModel — stream.ts
      // dispatches these to streamClaudeCli/streamCodexCli before ever
      // calling resolveModel(). Reaching here means that dispatch was
      // skipped somewhere.
      throw new Error(
        `${installed.provider.providerKind} models must be streamed via the CLI adapter, not resolveModel().`,
      );
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
      baseURL: `${normalizeOpenAiCompatibleBaseUrl(installed.provider.baseUrl)}/v1`,
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
  return `${normalizeOpenAiCompatibleBaseUrl(baseUrl)}/v1`;
}

function inferOpenAiCompatibleApiKey(prefix: string): string | undefined {
  if (prefix === "lmstudio") return getLmStudioApiKey();
  return undefined;
}

/** Best-effort presets shown as checkboxes in the CLI provider install form —
 * both CLIs accept any model string via `--model`, so these aren't
 * exhaustive, just sane starting points. `CLI_DEFAULT_MODEL_SENTINEL` always
 * comes first: cli.ts treats it as "omit --model entirely", which is the
 * only choice guaranteed to work regardless of auth method. Codex in
 * particular rejects specific model names depending on whether the CLI is
 * logged in via API key or a ChatGPT account (e.g. "gpt-5-codex"/"o4-mini"
 * 400 with "not supported when using Codex with a ChatGPT account"), so no
 * specific codex model name is safe to hardcode as a default here — only
 * offer the sentinel and let the free-text field cover API-key accounts. */
const CLAUDE_CLI_DEFAULT_MODELS = [
  CLI_DEFAULT_MODEL_SENTINEL,
  "claude-fable-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-5",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
];
const CODEX_CLI_DEFAULT_MODELS = [CLI_DEFAULT_MODEL_SENTINEL];

export function getDefaultModelIdsForProviderKind(
  providerKind: InstalledModelProvider["providerKind"],
): string[] {
  if (providerKind === "anthropic") return CLOUD_MODELS.map((model) => model.modelName);
  if (providerKind === "openai") return OPENAI_DEFAULT_MODELS.map((model) => model.id);
  if (providerKind === "claude_cli") return CLAUDE_CLI_DEFAULT_MODELS;
  if (providerKind === "codex_cli") return CODEX_CLI_DEFAULT_MODELS;
  return [];
}

export function getModelCapabilities(
  modelId: string,
  installedProviders: InstalledModelProvider[] = [],
): ModelCapabilities {
  const installed = parseInstalledModelId(modelId, installedProviders);
  if (installed) {
    if (installed.provider.providerKind === "anthropic") {
      return { nativeImageInput: true, nativeDocumentInput: true };
    }
    if (installed.provider.providerKind === "openai") {
      return { nativeImageInput: true, nativeDocumentInput: true };
    }
    // claude_cli/codex_cli: MVP is text-only passthrough over stdin — no
    // native image/document upload to the CLI process, so these fall through
    // to the default { false, false } below (attachments still work via the
    // existing text-extraction fallback in attachment-processing.ts).
    return { nativeImageInput: false, nativeDocumentInput: false };
  }

  if (modelId.startsWith("anthropic/")) {
    return { nativeImageInput: true, nativeDocumentInput: true };
  }

  return { nativeImageInput: false, nativeDocumentInput: false };
}
