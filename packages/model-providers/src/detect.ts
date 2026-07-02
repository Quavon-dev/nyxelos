/**
 * Local model runtime auto-detection. Nyxel probes well-known local ports for
 * common runtimes and treats any OpenAI-compatible `/v1/models` response as a
 * usable local provider.
 */

export interface DetectedLocalModel {
  /** e.g. "ollama/llama3.1:8b" or "localai/mistral" */
  id: string;
  label: string;
  provider: string;
  providerLabel: string;
  /** OpenAI-compatible base URL used to actually talk to this model. */
  baseUrl: string;
  /** Live-probed capabilities, when the runtime exposes them. Undefined
   * means the runtime has no capability-reporting endpoint we know about. */
  capabilities?: DetectedModelCapabilities;
}

/** Capability flags sourced directly from a provider's own API — no
 * hardcoded per-providerKind guesswork. */
export interface DetectedModelCapabilities {
  visionInput: boolean;
  toolCalling: boolean;
  reasoning: boolean;
  imageOutput: boolean;
}

export interface OpenAiCompatibleProbeResult {
  providerKey: string;
  providerLabel: string;
  baseUrl: string;
  modelIds: string[];
}

export interface OpenAiCompatibleProbeFailure {
  baseUrl: string;
  status: number | null;
  code: string | null;
  message: string | null;
}

type OpenAiRuntimeProbe = {
  providerKey: string;
  providerLabel: string;
  baseUrl: string;
  apiKey?: string | null;
};

const LOCAL_OPENAI_COMPATIBLE_PROBES: OpenAiRuntimeProbe[] = [
  {
    providerKey: "lmstudio",
    providerLabel: "LM Studio",
    baseUrl: process.env.LMSTUDIO_BASE_URL ?? "http://localhost:1234",
    apiKey: getLmStudioApiKey(),
  },
  {
    providerKey: "vllm",
    providerLabel: "vLLM",
    baseUrl: process.env.VLLM_BASE_URL ?? "http://localhost:8000",
  },
  {
    providerKey: "localai",
    providerLabel: "LocalAI",
    baseUrl: process.env.LOCALAI_BASE_URL ?? "http://localhost:8080",
  },
  {
    providerKey: "llamacpp",
    providerLabel: "llama.cpp Server",
    baseUrl: process.env.LLAMACPP_BASE_URL ?? "http://localhost:8081",
  },
  {
    providerKey: "textgen",
    providerLabel: "Text Generation Web UI",
    baseUrl: process.env.TEXTGEN_BASE_URL ?? "http://localhost:5000",
  },
  {
    providerKey: "jan",
    providerLabel: "Jan",
    baseUrl: process.env.JAN_BASE_URL ?? "http://localhost:1337",
  },
];

export function getOllamaBaseUrl(): string {
  return process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
}

export function getLmStudioBaseUrl(): string {
  return process.env.LMSTUDIO_BASE_URL ?? "http://localhost:1234";
}

export function getLmStudioApiKey(): string | undefined {
  return (
    process.env.LM_API_TOKEN ??
    process.env.LMSTUDIO_API_KEY ??
    process.env.LMSTUDIO_API_TOKEN ??
    undefined
  );
}

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export interface OpenRouterModel {
  id: string;
  label: string;
  contextLength: number | null;
  capabilities: DetectedModelCapabilities;
}

const OPENROUTER_CACHE_TTL_MS = 60_000;
const openRouterModelsCache = new Map<string, { expires: number; value: OpenRouterModel[] }>();

/** OpenRouter's `/models` catalog is public (no key required to list), so
 * this is used both for the settings-panel "fetch models" step (which may
 * run before the user has pasted a key) and for env-based auto-import.
 * The catalog already reports per-model modalities and supported request
 * parameters, so capabilities come straight from OpenRouter — no guessing
 * from the model id. Cached briefly since this same catalog is re-fetched
 * on every capability lookup for an installed OpenRouter model. */
export async function fetchOpenRouterModels(apiKey?: string | null): Promise<OpenRouterModel[]> {
  const cacheKey = apiKey ?? "";
  const cached = openRouterModelsCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.value;

  const result = await safeFetchJson<{
    data?: Array<{
      id: string;
      name?: string;
      context_length?: number;
      architecture?: { input_modalities?: string[]; output_modalities?: string[] };
      supported_parameters?: string[];
    }>;
  }>(
    `${OPENROUTER_BASE_URL}/models`,
    apiKey
      ? {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        }
      : undefined,
    5000,
  );
  if (!result.ok || !result.data?.data) return [];

  const models = result.data.data.map((model) => ({
    id: model.id,
    label: model.name?.trim() || model.id,
    contextLength: model.context_length ?? null,
    capabilities: {
      visionInput: model.architecture?.input_modalities?.includes("image") ?? false,
      imageOutput: model.architecture?.output_modalities?.includes("image") ?? false,
      toolCalling: model.supported_parameters?.includes("tools") ?? false,
      reasoning: model.supported_parameters?.includes("reasoning") ?? false,
    },
  }));

  if (models.length > 0) {
    openRouterModelsCache.set(cacheKey, { expires: Date.now() + OPENROUTER_CACHE_TTL_MS, value: models });
  }
  return models;
}

export interface KnownProviderModel {
  id: string;
  label: string;
}

const KNOWN_PROVIDER_CATALOG_CACHE_TTL_MS = 60_000;
const openAiModelsCache = new Map<string, { expires: number; value: KnownProviderModel[] }>();
const anthropicModelsCache = new Map<string, { expires: number; value: KnownProviderModel[] }>();

/** OpenAI's `/v1/models` reports the full catalog available to a key,
 * including non-chat model families (embeddings, tts, whisper, dall-e,
 * gpt-image, sora, ...) mixed in with chat-capable ones — see
 * isOpenAiChatModelId for the filter callers apply on top. */
export async function fetchOpenAiModels(apiKey: string): Promise<KnownProviderModel[]> {
  const cached = openAiModelsCache.get(apiKey);
  if (cached && cached.expires > Date.now()) return cached.value;

  const result = await safeFetchJson<{ data?: Array<{ id: string }> }>(
    "https://api.openai.com/v1/models",
    { headers: { Authorization: `Bearer ${apiKey}` } },
    8000,
  );
  if (!result.ok || !result.data?.data) return [];

  const models = result.data.data
    .map((model) => ({ id: model.id, label: model.id }))
    .sort((a, b) => a.id.localeCompare(b.id));
  openAiModelsCache.set(apiKey, {
    expires: Date.now() + KNOWN_PROVIDER_CATALOG_CACHE_TTL_MS,
    value: models,
  });
  return models;
}

/** Chat-completions-capable subset of fetchOpenAiModels' catalog — the only
 * models usable as a LanguageModel via resolveModel()'s `openai(id)` path.
 * Everything else (embeddings/tts/whisper/dall-e/gpt-image/sora/realtime)
 * has its own API shape and would 400 if resolved as a chat model. */
export function isOpenAiChatModelId(id: string): boolean {
  return (
    /^(gpt-|o[1-9]|chatgpt-)/i.test(id) &&
    !/(embedding|whisper|tts|moderation|dall-e|gpt-image|sora|davinci|babbage|realtime|transcribe|image)/i.test(
      id,
    )
  );
}

/** Anthropic's `/v1/models` — same role as fetchOpenAiModels but every
 * entry is already a chat model, so callers don't need a filter. */
export async function fetchAnthropicModels(apiKey: string): Promise<KnownProviderModel[]> {
  const cached = anthropicModelsCache.get(apiKey);
  if (cached && cached.expires > Date.now()) return cached.value;

  const result = await safeFetchJson<{
    data?: Array<{ id: string; display_name?: string }>;
  }>(
    "https://api.anthropic.com/v1/models?limit=1000",
    { headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" } },
    8000,
  );
  if (!result.ok || !result.data?.data) return [];

  const models = result.data.data
    .map((model) => ({ id: model.id, label: model.display_name?.trim() || model.id }))
    .sort((a, b) => a.id.localeCompare(b.id));
  anthropicModelsCache.set(apiKey, {
    expires: Date.now() + KNOWN_PROVIDER_CATALOG_CACHE_TTL_MS,
    value: models,
  });
  return models;
}

export function normalizeOpenAiCompatibleBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed.slice(0, -3) : trimmed;
}

async function safeFetchJson<T>(
  url: string,
  init?: RequestInit,
  timeoutMs = 800,
): Promise<{ ok: true; data: T } | { ok: false; status: number | null; body: unknown | null }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timer);
    const json = (await res.json().catch(() => null)) as T | null;
    if (!res.ok) return { ok: false, status: res.status, body: json };
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, status: null, body: null };
  }
}

/** Ollama's `/api/show` reports a `capabilities` array per model (e.g.
 * `["completion", "vision", "tools"]`) — no key required, one call per
 * model since Ollama has no bulk capability endpoint. */
export async function fetchOllamaModelCapabilities(
  baseUrl: string,
  modelName: string,
): Promise<DetectedModelCapabilities | null> {
  const base = normalizeOpenAiCompatibleBaseUrl(baseUrl);
  const result = await safeFetchJson<{ capabilities?: string[] }>(
    `${base}/api/show`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelName }),
    },
    3000,
  );
  if (!result.ok || !result.data?.capabilities) return null;

  const caps = result.data.capabilities;
  return {
    visionInput: caps.includes("vision"),
    toolCalling: caps.includes("tools"),
    reasoning: caps.includes("thinking") || caps.includes("reasoning"),
    imageOutput: false,
  };
}

interface LmStudioNativeModels {
  capabilities: Map<string, DetectedModelCapabilities>;
  /** ids whose `type` is "llm"/"vlm" and whose `arch` (when reported) isn't
   * a known image-diffusion architecture. `null` means the native endpoint
   * wasn't reachable at all (older LM Studio build, or this isn't actually
   * LM Studio) — callers should treat that as "unknown, don't filter"
   * rather than "nothing is chat-capable". A concrete Set excludes ids like
   * "embeddings" models. Note this can't be fully reliable: LM Studio's own
   * `type` field is wrong for some GGUF-packaged diffusion checkpoints (it
   * reports "llm" for e.g. a RealVisXL SDXL checkpoint with no `arch` at
   * all) — those still 400 with "Failed to load model" the instant a chat
   * request reaches them, and no metadata field distinguishes them from a
   * real text LLM ahead of time. */
  chatCapableIds: Set<string> | null;
}

/** `arch` values LM Studio itself reports for known non-text-generation
 * (image diffusion) model families — these still show up with `type: "llm"`
 * since they're loadable GGUF files, but can never serve chat completions. */
const NON_CHAT_ARCHES = new Set(["flux", "sdxl", "sd", "sd3", "stable-diffusion"]);

/** LM Studio's native `/api/v0/models` (not the OpenAI-compatible `/v1/models`)
 * reports `type` ("llm"/"vlm"/"embeddings", and other non-chat types) and, on
 * newer builds, a richer `capabilities` object/array with vision, tool-use,
 * and reasoning flags — one request covers every loaded/downloaded model. */
async function fetchLmStudioNativeModels(
  baseUrl: string,
  apiKey?: string | null,
): Promise<LmStudioNativeModels> {
  const base = normalizeOpenAiCompatibleBaseUrl(baseUrl);
  const result = await safeFetchJson<{
    data?: Array<{
      id: string;
      type?: string;
      arch?: string;
      capabilities?: string[] | { vision?: boolean; trained_for_tool_use?: boolean; reasoning?: unknown };
    }>;
  }>(
    `${base}/api/v0/models`,
    apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : undefined,
    3000,
  );
  if (!result.ok || !result.data?.data) return { capabilities: new Map(), chatCapableIds: null };

  const capabilities = new Map<string, DetectedModelCapabilities>();
  const chatCapableIds = new Set<string>();
  for (const model of result.data.data) {
    const caps = model.capabilities;
    const visionFromCaps = Array.isArray(caps)
      ? caps.includes("vision")
      : Boolean(caps?.vision);
    const toolCalling = Array.isArray(caps)
      ? caps.includes("tool_use")
      : Boolean(caps?.trained_for_tool_use);
    const reasoning = Array.isArray(caps) ? caps.includes("reasoning") : Boolean(caps?.reasoning);
    capabilities.set(model.id, {
      visionInput: model.type === "vlm" || visionFromCaps,
      toolCalling,
      reasoning,
      imageOutput: false,
    });
    const isChatType = !model.type || model.type === "llm" || model.type === "vlm";
    const isKnownDiffusionArch = model.arch
      ? NON_CHAT_ARCHES.has(model.arch.toLowerCase())
      : false;
    if (isChatType && !isKnownDiffusionArch) {
      chatCapableIds.add(model.id);
    }
  }
  return { capabilities, chatCapableIds };
}

const OPENAI_COMPATIBLE_CAPABILITY_CACHE_TTL_MS = 15_000;
const openAiCompatibleCapabilityCache = new Map<
  string,
  { expires: number; value: LmStudioNativeModels }
>();

/** Single cached fetch of LM Studio's native `/api/v0/models` per base URL,
 * shared by fetchOpenAiCompatibleCapabilities and fetchChatCapableModelIds
 * below so both don't each issue their own request. */
async function fetchLmStudioNativeModelsCached(
  baseUrl: string,
  apiKey: string | null | undefined,
): Promise<LmStudioNativeModels> {
  const cacheKey = normalizeOpenAiCompatibleBaseUrl(baseUrl);
  const cached = openAiCompatibleCapabilityCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.value;

  const value = await fetchLmStudioNativeModels(baseUrl, apiKey);
  openAiCompatibleCapabilityCache.set(cacheKey, {
    expires: Date.now() + OPENAI_COMPATIBLE_CAPABILITY_CACHE_TTL_MS,
    value,
  });
  return value;
}

/** Best-effort capability lookup for an OpenAI-compatible local runtime:
 * tries LM Studio's native endpoint first (single bulk request), then
 * falls back to Ollama's per-model `/api/show`. Runtimes with neither
 * (vLLM, LocalAI, llama.cpp server, text-generation-webui, Jan) resolve to
 * an empty map, and callers fall back to the previous hardcoded defaults.
 * Cached per base URL since this runs on every attachment/message send. */
export async function fetchOpenAiCompatibleCapabilities(
  baseUrl: string,
  apiKey: string | null | undefined,
  modelIds: string[],
): Promise<Map<string, DetectedModelCapabilities>> {
  const native = await fetchLmStudioNativeModelsCached(baseUrl, apiKey);
  if (native.capabilities.size > 0 || modelIds.length === 0) return native.capabilities;

  const entries = await Promise.all(
    modelIds.map(async (modelId) => {
      const caps = await fetchOllamaModelCapabilities(baseUrl, modelId).catch(() => null);
      return caps ? ([modelId, caps] as const) : null;
    }),
  );
  return new Map(entries.filter((e): e is [string, DetectedModelCapabilities] => e !== null));
}

/** Filters a local OpenAI-compatible runtime's model ids down to ones that
 * can actually serve `/v1/chat/completions` — see the `chatCapableIds` doc
 * on LmStudioNativeModels. Returns `modelIds` unfiltered when the runtime
 * doesn't expose LM Studio's native endpoint (nothing to filter against, so
 * don't silently drop every model for e.g. vLLM/LocalAI/Ollama). */
async function filterChatCapableModelIds(
  baseUrl: string,
  apiKey: string | null | undefined,
  modelIds: string[],
): Promise<string[]> {
  const native = await fetchLmStudioNativeModelsCached(baseUrl, apiKey).catch(
    () => ({ capabilities: new Map(), chatCapableIds: null }) as LmStudioNativeModels,
  );
  if (!native.chatCapableIds) return modelIds;
  return modelIds.filter((id) => native.chatCapableIds?.has(id));
}

export async function detectOllamaModels(): Promise<DetectedLocalModel[]> {
  const base = normalizeOpenAiCompatibleBaseUrl(getOllamaBaseUrl());
  const result = await safeFetchJson<{ models?: Array<{ name: string }> }>(`${base}/api/tags`);
  if (!result.ok || !result.data?.models) return [];

  const models = result.data.models;
  const capabilities = await Promise.all(
    models.map((m) => fetchOllamaModelCapabilities(base, m.name).catch(() => null)),
  );

  return models.map((m, i) => ({
    id: `ollama/${m.name}`,
    label: m.name,
    provider: "ollama",
    providerLabel: "Ollama",
    baseUrl: `${base}/v1`,
    capabilities: capabilities[i] ?? undefined,
  }));
}

export async function probeOpenAiCompatibleEndpoint(input: {
  baseUrl: string;
  apiKey?: string | null;
  providerKey?: string;
  providerLabel?: string;
}): Promise<OpenAiCompatibleProbeResult | null> {
  const detailed = await probeOpenAiCompatibleEndpointDetailed(input);
  return "modelIds" in detailed ? detailed : null;
}

export async function probeOpenAiCompatibleEndpointDetailed(input: {
  baseUrl: string;
  apiKey?: string | null;
  providerKey?: string;
  providerLabel?: string;
}): Promise<OpenAiCompatibleProbeResult | OpenAiCompatibleProbeFailure> {
  const baseUrl = normalizeOpenAiCompatibleBaseUrl(input.baseUrl);
  const result = await safeFetchJson<{
    data?: Array<{ id: string }>;
    error?: { code?: string; message?: string };
  }>(
    `${baseUrl}/v1/models`,
    input.apiKey
      ? {
          headers: {
            Authorization: `Bearer ${input.apiKey}`,
          },
        }
      : undefined,
  );

  if (!result.ok) {
    const body =
      result.body && typeof result.body === "object"
        ? (result.body as { error?: { code?: string; message?: string } })
        : null;
    return {
      baseUrl,
      status: result.status,
      code: body?.error?.code ?? null,
      message: body?.error?.message ?? null,
    };
  }

  const modelIds = result.data?.data?.map((model) => model.id).filter(Boolean) ?? [];
  if (modelIds.length === 0) {
    return {
      baseUrl,
      status: 200,
      code: "no_models",
      message: "The endpoint responded successfully but returned no models.",
    };
  }

  return {
    providerKey: input.providerKey ?? "openai-compatible",
    providerLabel: input.providerLabel ?? "OpenAI-compatible",
    baseUrl,
    modelIds,
  };
}

export async function detectLmStudioModels(): Promise<DetectedLocalModel[]> {
  const detected = await probeOpenAiCompatibleEndpoint({
    baseUrl: getLmStudioBaseUrl(),
    apiKey: getLmStudioApiKey(),
    providerKey: "lmstudio",
    providerLabel: "LM Studio",
  });
  if (!detected) return [];

  const [capsMap, chatCapableModelIds] = await Promise.all([
    fetchOpenAiCompatibleCapabilities(
      detected.baseUrl,
      getLmStudioApiKey(),
      detected.modelIds,
    ).catch(() => new Map<string, DetectedModelCapabilities>()),
    filterChatCapableModelIds(detected.baseUrl, getLmStudioApiKey(), detected.modelIds),
  ]);

  return chatCapableModelIds.map((modelId) => ({
    id: `${detected.providerKey}/${modelId}`,
    label: modelId,
    provider: detected.providerKey,
    providerLabel: detected.providerLabel,
    baseUrl: `${detected.baseUrl}/v1`,
    capabilities: capsMap.get(modelId),
  }));
}

export async function detectOpenAiCompatibleModels(): Promise<DetectedLocalModel[]> {
  const seenBaseUrls = new Set<string>();
  const detected: DetectedLocalModel[] = [];

  for (const probe of LOCAL_OPENAI_COMPATIBLE_PROBES) {
    const result = await probeOpenAiCompatibleEndpoint(probe);
    if (!result) continue;
    if (seenBaseUrls.has(result.baseUrl)) continue;
    seenBaseUrls.add(result.baseUrl);

    const [capsMap, chatCapableModelIds] = await Promise.all([
      fetchOpenAiCompatibleCapabilities(result.baseUrl, probe.apiKey, result.modelIds).catch(
        () => new Map<string, DetectedModelCapabilities>(),
      ),
      filterChatCapableModelIds(result.baseUrl, probe.apiKey, result.modelIds),
    ]);

    detected.push(
      ...chatCapableModelIds.map((modelId) => ({
        id: `${result.providerKey}/${modelId}`,
        label: modelId,
        provider: result.providerKey,
        providerLabel: result.providerLabel,
        baseUrl: `${result.baseUrl}/v1`,
        capabilities: capsMap.get(modelId),
      })),
    );
  }

  return detected;
}

export async function detectLocalModels(): Promise<DetectedLocalModel[]> {
  const [ollama, compatible] = await Promise.all([
    detectOllamaModels(),
    detectOpenAiCompatibleModels(),
  ]);
  return [...ollama, ...compatible];
}
