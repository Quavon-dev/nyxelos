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

type OpenAiRuntimeProbe = {
  providerKey: string;
  providerLabel: string;
  baseUrl: string;
};

const LOCAL_OPENAI_COMPATIBLE_PROBES: OpenAiRuntimeProbe[] = [
  {
    providerKey: "lmstudio",
    providerLabel: "LM Studio",
    baseUrl: process.env.LMSTUDIO_BASE_URL ?? "http://localhost:1234",
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

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

async function safeFetchJson<T>(
  url: string,
  init?: RequestInit,
  timeoutMs = 800,
): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function detectOllamaModels(): Promise<DetectedLocalModel[]> {
  const base = normalizeBaseUrl(getOllamaBaseUrl());
  const data = await safeFetchJson<{ models?: Array<{ name: string }> }>(`${base}/api/tags`);
  if (!data?.models) return [];

  return data.models.map((m) => ({
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
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const data = await safeFetchJson<{ data?: Array<{ id: string }> }>(
    `${baseUrl}/v1/models`,
    input.apiKey
      ? {
          headers: {
            Authorization: `Bearer ${input.apiKey}`,
          },
        }
      : undefined,
  );

  const modelIds = data?.data?.map((model) => model.id).filter(Boolean) ?? [];
  if (modelIds.length === 0) return null;

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
