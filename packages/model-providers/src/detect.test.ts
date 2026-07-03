import { afterEach, describe, expect, it } from "bun:test";
import {
  detectLmStudioModels,
  detectLocalModels,
  detectOllamaModels,
  detectOpenAiCompatibleModels,
} from "./detect";

/** All tests here stub `globalThis.fetch` so the local-runtime probes never
 * hit a real port (Ollama :11434, LM Studio :1234, vLLM :8000, LocalAI :8080,
 * llama.cpp :8081, text-generation-webui :5000, Jan :1337) — see the
 * `safeFetchJson` helper in ./detect.ts that these functions funnel through. */

type FetchHandler = (url: string, init?: RequestInit) => Response | null;

function installFetchMock(handler: FetchHandler): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const response = handler(url, init);
    if (!response) throw new TypeError(`fetch failed: connection refused (${url})`);
    return response;
  }) as typeof fetch;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const originalFetch = globalThis.fetch;
const originalLmStudioBaseUrl = process.env.LMSTUDIO_BASE_URL;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalLmStudioBaseUrl === undefined) {
    delete process.env.LMSTUDIO_BASE_URL;
  } else {
    process.env.LMSTUDIO_BASE_URL = originalLmStudioBaseUrl;
  }
});

describe("detectOllamaModels", () => {
  it("returns parsed models with capabilities on a successful probe", async () => {
    globalThis.fetch = installFetchMock((url, init) => {
      if (url === "http://localhost:11434/api/tags") {
        return json({ models: [{ name: "llama3.1:8b" }] });
      }
      if (url === "http://localhost:11434/api/show" && init?.method === "POST") {
        return json({ capabilities: ["completion", "tools", "vision"] });
      }
      return null;
    });

    const models = await detectOllamaModels();

    expect(models).toEqual([
      {
        id: "ollama/llama3.1:8b",
        label: "llama3.1:8b",
        provider: "ollama",
        providerLabel: "Ollama",
        baseUrl: "http://localhost:11434/v1",
        capabilities: {
          visionInput: true,
          toolCalling: true,
          reasoning: false,
          imageOutput: false,
        },
      },
    ]);
  });

  it("returns an empty array instead of throwing when Ollama isn't running", async () => {
    globalThis.fetch = installFetchMock(() => null);

    const models = await detectOllamaModels();

    expect(models).toEqual([]);
  });
});

describe("detectLmStudioModels", () => {
  it("returns chat-capable models enriched from LM Studio's native endpoint", async () => {
    process.env.LMSTUDIO_BASE_URL = "http://localhost:19234";
    globalThis.fetch = installFetchMock((url) => {
      if (url === "http://localhost:19234/v1/models") {
        return json({ data: [{ id: "llama-3-8b-instruct" }] });
      }
      if (url === "http://localhost:19234/api/v0/models") {
        return json({
          data: [
            {
              id: "llama-3-8b-instruct",
              type: "llm",
              capabilities: { trained_for_tool_use: true },
            },
          ],
        });
      }
      return null;
    });

    const models = await detectLmStudioModels();

    expect(models).toEqual([
      {
        id: "lmstudio/llama-3-8b-instruct",
        label: "llama-3-8b-instruct",
        provider: "lmstudio",
        providerLabel: "LM Studio",
        baseUrl: "http://localhost:19234/v1",
        capabilities: {
          visionInput: false,
          toolCalling: true,
          reasoning: false,
          imageOutput: false,
        },
      },
    ]);
  });

  it("returns an empty array instead of throwing when LM Studio isn't running", async () => {
    process.env.LMSTUDIO_BASE_URL = "http://localhost:19235";
    globalThis.fetch = installFetchMock(() => null);

    const models = await detectLmStudioModels();

    expect(models).toEqual([]);
  });
});

describe("detectOpenAiCompatibleModels", () => {
  it("detects a runtime on one of the known ports while the rest are unreachable", async () => {
    globalThis.fetch = installFetchMock((url) => {
      if (url === "http://localhost:8080/v1/models") {
        return json({ data: [{ id: "mistral-7b-instruct" }] });
      }
      // LocalAI has no native LM Studio-style or Ollama-style capability
      // endpoint, so both enrichment probes against it are expected to
      // fail — the function must still return the bare model list.
      return null;
    });

    const models = await detectOpenAiCompatibleModels();

    expect(models).toEqual([
      {
        id: "localai/mistral-7b-instruct",
        label: "mistral-7b-instruct",
        provider: "localai",
        providerLabel: "LocalAI",
        baseUrl: "http://localhost:8080/v1",
        capabilities: undefined,
      },
    ]);
  });

  it("returns an empty array when none of the known local ports respond", async () => {
    globalThis.fetch = installFetchMock(() => null);

    const models = await detectOpenAiCompatibleModels();

    expect(models).toEqual([]);
  });
});

describe("detectLocalModels", () => {
  it("merges Ollama and OpenAI-compatible detections", async () => {
    globalThis.fetch = installFetchMock((url, init) => {
      if (url === "http://localhost:11434/api/tags") {
        return json({ models: [{ name: "llama3.1:8b" }] });
      }
      if (url === "http://localhost:11434/api/show" && init?.method === "POST") {
        return json({ capabilities: [] });
      }
      if (url === "http://localhost:8080/v1/models") {
        return json({ data: [{ id: "mistral-7b-instruct" }] });
      }
      return null;
    });

    const models = await detectLocalModels();

    expect(models.map((m) => m.id).sort()).toEqual([
      "localai/mistral-7b-instruct",
      "ollama/llama3.1:8b",
    ]);
  });

  it("returns an empty array when nothing is reachable", async () => {
    globalThis.fetch = installFetchMock(() => null);

    const models = await detectLocalModels();

    expect(models).toEqual([]);
  });
});
