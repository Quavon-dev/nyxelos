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

/** LM Studio's native `/api/v0/models` (not the OpenAI-compatible `/v1/models`)
 * reports `type` ("llm"/"vlm"/"embeddings") and, on newer builds, a richer
 * `capabilities` object/array with vision, tool-use, and reasoning flags —
 * one request covers every loaded/downloaded model. */
async function fetchLmStudioNativeModels(
  baseUrl: string,
  apiKey?: string | null,
): Promise<Map<string, DetectedModelCapabilities>> {
  const base = normalizeOpenAiCompatibleBaseUrl(baseUrl);
  const result = await safeFetchJson<{
    data?: Array<{
      id: string;
      type?: string;
      capabilities?: string[] | { vision?: boolean; trained_for_tool_use?: boolean; reasoning?: unknown };
    }>;
  }>(
    `${base}/api/v0/models`,
    apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : undefined,
    3000,
  );
  if (!result.ok || !result.data?.data) return new Map();

  const map = new Map<string, DetectedModelCapabilities>();
  for (const model of result.data.data) {
    const caps = model.capabilities;
    const visionFromCaps = Array.isArray(caps)
      ? caps.includes("vision")
      : Boolean(caps?.vision);
    const toolCalling = Array.isArray(caps)
      ? caps.includes("tool_use")
      : Boolean(caps?.trained_for_tool_use);
    const reasoning = Array.isArray(caps) ? caps.includes("reasoning") : Boolean(caps?.reasoning);
    map.set(model.id, {
      visionInput: model.type === "vlm" || visionFromCaps,
      toolCalling,
      reasoning,
      imageOutput: false,
    });
  }
  return map;
}

const OPENAI_COMPATIBLE_CAPABILITY_CACHE_TTL_MS = 15_000;
const openAiCompatibleCapabilityCache = new Map<
  string,
  { expires: number; value: Map<string, DetectedModelCapabilities> }
>();

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
  const cacheKey = normalizeOpenAiCompatibleBaseUrl(baseUrl);
  const cached = openAiCompatibleCapabilityCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.value;

  let value = await fetchLmStudioNativeModels(baseUrl, apiKey);
  if (value.size === 0 && modelIds.length > 0) {
    const entries = await Promise.all(
      modelIds.map(async (modelId) => {
        const caps = await fetchOllamaModelCapabilities(baseUrl, modelId).catch(() => null);
        return caps ? ([modelId, caps] as const) : null;
      }),
    );
    value = new Map(entries.filter((e): e is [string, DetectedModelCapabilities] => e !== null));
  }

  openAiCompatibleCapabilityCache.set(cacheKey, {
    expires: Date.now() + OPENAI_COMPATIBLE_CAPABILITY_CACHE_TTL_MS,
    value,
  });
  return value;
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

  const capsMap = await fetchOpenAiCompatibleCapabilities(
    detected.baseUrl,
    getLmStudioApiKey(),
    detected.modelIds,
  ).catch(() => new Map<string, DetectedModelCapabilities>());

  return detected.modelIds.map((modelId) => ({
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

    const capsMap = await fetchOpenAiCompatibleCapabilities(
      result.baseUrl,
      probe.apiKey,
      result.modelIds,
    ).catch(() => new Map<string, DetectedModelCapabilities>());

    detected.push(
      ...result.modelIds.map((modelId) => ({
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
