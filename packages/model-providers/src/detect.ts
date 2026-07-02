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
}

/** OpenRouter's `/models` catalog is public (no key required to list), so
 * this is used both for the settings-panel "fetch models" step (which may
 * run before the user has pasted a key) and for env-based auto-import. */
export async function fetchOpenRouterModels(apiKey?: string | null): Promise<OpenRouterModel[]> {
  const result = await safeFetchJson<{
    data?: Array<{ id: string; name?: string; context_length?: number }>;
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

  return result.data.data.map((model) => ({
    id: model.id,
    label: model.name?.trim() || model.id,
    contextLength: model.context_length ?? null,
  }));
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

export async function detectOllamaModels(): Promise<DetectedLocalModel[]> {
  const base = normalizeOpenAiCompatibleBaseUrl(getOllamaBaseUrl());
  const result = await safeFetchJson<{ models?: Array<{ name: string }> }>(`${base}/api/tags`);
  if (!result.ok || !result.data?.models) return [];

  return result.data.models.map((m) => ({
    id: `ollama/${m.name}`,
    label: m.name,
    provider: "ollama",
    providerLabel: "Ollama",
    baseUrl: `${base}/v1`,
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

  return detected.modelIds.map((modelId) => ({
    id: `${detected.providerKey}/${modelId}`,
    label: modelId,
    provider: detected.providerKey,
    providerLabel: detected.providerLabel,
    baseUrl: `${detected.baseUrl}/v1`,
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

    detected.push(
      ...result.modelIds.map((modelId) => ({
        id: `${result.providerKey}/${modelId}`,
        label: modelId,
        provider: result.providerKey,
        providerLabel: result.providerLabel,
        baseUrl: `${result.baseUrl}/v1`,
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
