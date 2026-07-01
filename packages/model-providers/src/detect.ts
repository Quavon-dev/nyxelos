/**
 * Auto-detection for local model runtimes. See ARCHITECTURE.md section 7:
 * on startup Nyxel probes the well-known local ports for Ollama and
 * OpenAI-compatible servers (LM Studio, llama.cpp server, vLLM, ...) so
 * detected models show up in the model picker with zero configuration.
 */

export interface DetectedLocalModel {
  /** e.g. "ollama/llama3.1:8b" */
  id: string;
  label: string;
  provider: "ollama" | "lmstudio";
  /** OpenAI-compatible base URL used to actually talk to this model. */
  baseUrl: string;
}

const OLLAMA_TAGS_URL = "http://localhost:11434/api/tags";
const LMSTUDIO_MODELS_URL = "http://localhost:1234/v1/models";

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
  const data = await safeFetchJson<{ models?: Array<{ name: string }> }>(OLLAMA_TAGS_URL);
  if (!data?.models) return [];
  return data.models.map((m) => ({
    id: `ollama/${m.name}`,
    label: m.name,
    provider: "ollama" as const,
    baseUrl: "http://localhost:11434/v1",
  }));
}

export async function detectLmStudioModels(): Promise<DetectedLocalModel[]> {
  const data = await safeFetchJson<{ data?: Array<{ id: string }> }>(LMSTUDIO_MODELS_URL);
  if (!data?.data) return [];
  return data.data.map((m) => ({
    id: `lmstudio/${m.id}`,
    label: m.id,
    provider: "lmstudio" as const,
    baseUrl: "http://localhost:1234/v1",
  }));
}

export async function detectLocalModels(): Promise<DetectedLocalModel[]> {
  const [ollama, lmstudio] = await Promise.all([detectOllamaModels(), detectLmStudioModels()]);
  return [...ollama, ...lmstudio];
}
