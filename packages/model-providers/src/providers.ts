import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { CLI_DEFAULT_MODEL_SENTINEL } from "./cli";
import {
  detectLocalModels,
  type DetectedModelCapabilities,
  fetchAnthropicModels,
  fetchOllamaModelCapabilities,
  fetchOpenAiCompatibleCapabilities,
  fetchOpenAiModels,
  fetchOpenRouterModels,
  getLmStudioApiKey,
  getOllamaBaseUrl,
  isOpenAiChatModelId,
  normalizeOpenAiCompatibleBaseUrl,
  OPENROUTER_BASE_URL,
  probeOpenAiCompatibleEndpoint,
} from "./detect";

export interface CloudModelDefinition {
  id: string;
  label: string;
  provider: "anthropic";
  modelName: string;
}

export type ModelProviderKind =
  | "anthropic"
  | "openai"
  | "openrouter"
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
  { id: "gpt-5.5", label: "GPT-5.5" },
  { id: "gpt-5.4", label: "GPT-5.4" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
  { id: "gpt-5.4-nano", label: "GPT-5.4 Nano" },
  { id: "gpt-5", label: "GPT-5" },
  { id: "gpt-5-mini", label: "GPT-5 Mini" },
  { id: "o4-mini", label: "o4-mini" },
  { id: "o3", label: "o3" },
  { id: "gpt-4.1", label: "GPT-4.1" },
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "gpt-4o-mini", label: "GPT-4o Mini" },
];

export interface ModelSummary {
  id: string;
  label: string;
  kind: "local" | "cloud" | "custom";
  provider: string;
  providerLabel: string;
  /** Live-probed where the provider reports it (LM Studio, Ollama,
   * OpenRouter); omitted when the runtime has no capability endpoint. */
  capabilities?: ModelCapabilities;
}

export interface ModelCapabilities {
  nativeImageInput: boolean;
  nativeDocumentInput: boolean;
  toolCalling: boolean;
  imageOutput: boolean;
  reasoning: boolean;
}

const DEFAULT_CAPABILITIES: ModelCapabilities = {
  nativeImageInput: false,
  nativeDocumentInput: false,
  toolCalling: false,
  imageOutput: false,
  reasoning: false,
};

const FULL_CLOUD_CAPABILITIES: ModelCapabilities = {
  nativeImageInput: true,
  nativeDocumentInput: true,
  toolCalling: true,
  imageOutput: false,
  reasoning: true,
};

function fromDetectedCapabilities(detected: DetectedModelCapabilities): ModelCapabilities {
  return {
    nativeImageInput: detected.visionInput,
    nativeDocumentInput: false,
    toolCalling: detected.toolCalling,
    imageOutput: detected.imageOutput,
    reasoning: detected.reasoning,
  };
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

/** Per-provider capability lookup used when building the model list — one
 * network round trip (cached, see detect.ts) per installed provider, not
 * per model. */
async function capabilitiesForInstalledProvider(
  provider: InstalledModelProvider,
): Promise<Map<string, ModelCapabilities>> {
  if (provider.providerKind === "anthropic" || provider.providerKind === "openai") {
    return new Map(provider.modelIds.map((id) => [id, FULL_CLOUD_CAPABILITIES]));
  }
  if (provider.providerKind === "claude_cli" || provider.providerKind === "codex_cli") {
    // Badge display, not a transport check: these CLIs always run a real
    // Claude/GPT model under the hood, so the *model* genuinely has
    // vision/tools/reasoning even though the stdin-passthrough transport
    // can't forward raw image bytes to it. getModelCapabilities() below
    // (used to gate attachment forwarding) intentionally stays false/false
    // for these two — don't reuse this map for that decision.
    return new Map(provider.modelIds.map((id) => [id, FULL_CLOUD_CAPABILITIES]));
  }
  if (provider.providerKind === "openrouter") {
    const models = await fetchOpenRouterModels(provider.apiKey);
    const byId = new Map(models.map((m) => [m.id, m]));
    return new Map(
      provider.modelIds.map((id) => {
        const match = byId.get(id);
        return [id, match ? fromDetectedCapabilities(match.capabilities) : DEFAULT_CAPABILITIES];
      }),
    );
  }
  const detected = await fetchOpenAiCompatibleCapabilities(
    provider.baseUrl,
    provider.apiKey,
    provider.modelIds,
  ).catch(() => new Map<string, DetectedModelCapabilities>());
  return new Map(
    provider.modelIds.map((id) => {
      const match = detected.get(id);
      return [id, match ? fromDetectedCapabilities(match) : DEFAULT_CAPABILITIES];
    }),
  );
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
        capabilities: FULL_CLOUD_CAPABILITIES,
      }))
    : [];
  const enabledProviders = installedProviders.filter((provider) => provider.enabled);
  const capabilitiesByProvider = new Map(
    await Promise.all(
      enabledProviders.map(
        async (provider) => [provider.id, await capabilitiesForInstalledProvider(provider)] as const,
      ),
    ),
  );
  const custom: ModelSummary[] = enabledProviders.flatMap((provider) =>
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
        capabilities: capabilitiesByProvider.get(provider.id)?.get(modelId),
      })),
  );

  const merged = [
    ...local.map((m) => ({
      id: m.id,
      label: `${m.label} (${m.providerLabel})`,
      kind: "local" as const,
      provider: m.provider,
      providerLabel: m.providerLabel,
      capabilities: m.capabilities ? fromDetectedCapabilities(m.capabilities) : undefined,
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

    if (installed.provider.providerKind === "openrouter") {
      const openrouter = createOpenAICompatible({
        name: installed.provider.label,
        baseURL: OPENROUTER_BASE_URL,
        apiKey: installed.provider.apiKey ?? undefined,
        // Recommended (not required) by OpenRouter to attribute traffic —
        // see https://openrouter.ai/docs#headers.
        headers: {
          "HTTP-Referer":
            process.env.WEB_ORIGIN ?? process.env.PUBLIC_APP_URL ?? "http://localhost:3000",
          "X-Title": "Nyxel",
        },
      });
      return openrouter(installed.nativeModelId);
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

/**
 * Live model-id catalog for a provider kind, straight from the provider's
 * own API rather than the hardcoded CLOUD_MODELS/OPENAI_DEFAULT_MODELS
 * fallback lists above. Used two ways: (1) "auto model compilation" — fill
 * an install's modelIds with whatever the account can actually see instead
 * of a stale hand-maintained guess, and (2) existence validation — reject a
 * manually-typed model id that isn't in this list.
 *
 * Returns `null` when the provider kind has no catalog endpoint to check
 * against (claude_cli/codex_cli — any `--model` string is accepted, see the
 * CLI defaults' doc comment) or when the live fetch didn't return anything
 * usable (missing key, network error, empty account catalog). `null` means
 * "couldn't verify," not "no models exist" — callers should treat that as
 * permissive, not a rejection.
 */
export async function fetchLiveModelIdsForProviderKind(
  providerKind: InstalledModelProvider["providerKind"],
  apiKey: string | null | undefined,
  baseUrl?: string | null,
): Promise<string[] | null> {
  if (providerKind === "openai") {
    if (!apiKey) return null;
    const models = await fetchOpenAiModels(apiKey).catch(() => []);
    const chatModels = models.map((m) => m.id).filter(isOpenAiChatModelId);
    return chatModels.length > 0 ? chatModels : null;
  }
  if (providerKind === "anthropic") {
    if (!apiKey) return null;
    const models = await fetchAnthropicModels(apiKey).catch(() => []);
    return models.length > 0 ? models.map((m) => m.id) : null;
  }
  if (providerKind === "openrouter") {
    const models = await fetchOpenRouterModels(apiKey).catch(() => []);
    return models.length > 0 ? models.map((m) => m.id) : null;
  }
  if (providerKind === "openai_compatible") {
    if (!baseUrl) return null;
    const detected = await probeOpenAiCompatibleEndpoint({ baseUrl, apiKey }).catch(() => null);
    return detected && detected.modelIds.length > 0 ? detected.modelIds : null;
  }
  return null;
}

/** Resolves live capabilities for a model id. Anthropic/OpenAI are trusted
 * hardcoded (their SDKs are always native-multimodal, no capability
 * endpoint to probe). Everything else — installed OpenRouter/openai_compatible
 * providers and bare auto-detected local ids (`lmstudio/…`, `ollama/…`,
 * `vllm/…`, …) — is probed live against the actual provider, see detect.ts. */
export async function getModelCapabilities(
  modelId: string,
  installedProviders: InstalledModelProvider[] = [],
): Promise<ModelCapabilities> {
  const installed = parseInstalledModelId(modelId, installedProviders);
  if (installed) {
    if (installed.provider.providerKind === "anthropic" || installed.provider.providerKind === "openai") {
      return FULL_CLOUD_CAPABILITIES;
    }
    // claude_cli/codex_cli: MVP is text-only passthrough over stdin — no
    // native image/document upload to the CLI process (attachments still
    // work via the existing text-extraction fallback in
    // attachment-processing.ts).
    if (installed.provider.providerKind === "claude_cli" || installed.provider.providerKind === "codex_cli") {
      return DEFAULT_CAPABILITIES;
    }
    if (installed.provider.providerKind === "openrouter") {
      const models = await fetchOpenRouterModels(installed.provider.apiKey);
      const match = models.find((m) => m.id === installed.nativeModelId);
      return match ? fromDetectedCapabilities(match.capabilities) : DEFAULT_CAPABILITIES;
    }
    const detected = await fetchOpenAiCompatibleCapabilities(
      installed.provider.baseUrl,
      installed.provider.apiKey,
      [installed.nativeModelId],
    ).catch(() => new Map<string, DetectedModelCapabilities>());
    const match = detected.get(installed.nativeModelId);
    return match ? fromDetectedCapabilities(match) : DEFAULT_CAPABILITIES;
  }

  if (modelId.startsWith("anthropic/")) {
    return FULL_CLOUD_CAPABILITIES;
  }

  const [prefix, ...rest] = modelId.split("/");
  const nativeModelId = rest.join("/");
  if (prefix === "ollama" && nativeModelId) {
    const caps = await fetchOllamaModelCapabilities(getOllamaBaseUrl(), nativeModelId).catch(() => null);
    return caps ? fromDetectedCapabilities(caps) : DEFAULT_CAPABILITIES;
  }
  if (prefix && nativeModelId && prefix !== "ollama") {
    try {
      const baseUrl = inferOpenAiCompatibleBaseUrl(prefix);
      const detected = await fetchOpenAiCompatibleCapabilities(
        baseUrl,
        inferOpenAiCompatibleApiKey(prefix),
        [nativeModelId],
      ).catch(() => new Map<string, DetectedModelCapabilities>());
      const match = detected.get(nativeModelId);
      return match ? fromDetectedCapabilities(match) : DEFAULT_CAPABILITIES;
    } catch {
      return DEFAULT_CAPABILITIES;
    }
  }

  return DEFAULT_CAPABILITIES;
}
