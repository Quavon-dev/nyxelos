/**
 * Auto-detection for local model runtimes. See ARCHITECTURE.md section 7:
 * on startup Nyxel probes the well-known local ports for Ollama and
 * OpenAI-compatible servers (LM Studio, llama.cpp server, vLLM, ...) so
 * detected models show up in the model picker with zero configuration.
 *
 * Base URLs are overridable via env vars because "localhost" means
 * something different once the server runs inside a Docker container (PC
 * mode's docker-compose.pc.yml points these at `host.docker.internal` so
 * the container can still reach a model runtime installed on the host).
 */

export function getOllamaBaseUrl(): string {
  return process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
}

export function getLmStudioBaseUrl(): string {
  return process.env.LMSTUDIO_BASE_URL ?? "http://localhost:1234";
}

export interface DetectedLocalModel {
  /** e.g. "ollama/llama3.1:8b" */
  id: string;
  label: string;
  provider: "ollama" | "lmstudio";
  /** OpenAI-compatible base URL used to actually talk to this model. */
  baseUrl: string;
}

async function safeFetchJson<T>(url: string, timeoutMs = 800): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function detectOllamaModels(): Promise<DetectedLocalModel[]> {
  const base = getOllamaBaseUrl();
  const data = await safeFetchJson<{ models?: Array<{ name: string }> }>(`${base}/api/tags`);
  if (!data?.models) return [];
  return data.models.map((m) => ({
    id: `ollama/${m.name}`,
    label: m.name,
    provider: "ollama" as const,
    baseUrl: `${base}/v1`,
  }));
}

export async function detectLmStudioModels(): Promise<DetectedLocalModel[]> {
  const base = getLmStudioBaseUrl();
  const data = await safeFetchJson<{ data?: Array<{ id: string }> }>(`${base}/v1/models`);
  if (!data?.data) return [];
  return data.data.map((m) => ({
    id: `lmstudio/${m.id}`,
    label: m.id,
    provider: "lmstudio" as const,
    baseUrl: `${base}/v1`,
  }));
}

export async function detectLocalModels(): Promise<DetectedLocalModel[]> {
  const [ollama, lmstudio] = await Promise.all([detectOllamaModels(), detectLmStudioModels()]);
  return [...ollama, ...lmstudio];
}
