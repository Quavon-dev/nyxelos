import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  detectOllamaModels,
  getLmStudioApiKey,
  getLmStudioBaseUrl,
  probeOpenAiCompatibleEndpoint,
} from "./detect";
import { getDefaultModelIdsForProviderKind, type InstalledModelProvider } from "./providers";

export interface ProviderImportSource {
  id: string;
  label: string;
  details: string;
  kind: "api_key" | "desktop_auth" | "local_runtime";
  status: "importable" | "detected" | "auto";
  importableProvider?: Omit<InstalledModelProvider, "id" | "enabled">;
}

const HOME = homedir();

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function normalizeApiKey(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function buildProviderSource(
  id: string,
  label: string,
  details: string,
  importableProvider?: Omit<InstalledModelProvider, "id" | "enabled">,
): ProviderImportSource {
  return {
    id,
    label,
    details,
    kind: importableProvider ? "api_key" : "desktop_auth",
    status: importableProvider ? "importable" : "detected",
    importableProvider,
  };
}

export async function scanProviderImportSources(): Promise<ProviderImportSource[]> {
  const sources: ProviderImportSource[] = [];

  const anthropicKey = normalizeApiKey(process.env.ANTHROPIC_API_KEY);
  if (anthropicKey) {
    sources.push(
      buildProviderSource("anthropic-env", "Claude API (env)", "Imported from ANTHROPIC_API_KEY.", {
        label: "Claude API",
        providerKind: "anthropic",
        baseUrl: "https://api.anthropic.com",
        apiKey: anthropicKey,
        modelIds: getDefaultModelIdsForProviderKind("anthropic"),
      }),
    );
  }

  const openaiKey = normalizeApiKey(process.env.OPENAI_API_KEY);
  if (openaiKey) {
    sources.push(
      buildProviderSource("openai-env", "OpenAI API (env)", "Imported from OPENAI_API_KEY.", {
        label: "OpenAI API",
        providerKind: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: openaiKey,
        modelIds: getDefaultModelIdsForProviderKind("openai"),
      }),
    );
  }

  const codexAuthPath = join(HOME, ".codex", "auth.json");
  const codexAuth = await readJsonFile<{
    OPENAI_API_KEY?: string | null;
    tokens?: { id_token?: string | null };
  }>(codexAuthPath);
  if (codexAuth) {
    const codexOpenAiKey = normalizeApiKey(codexAuth.OPENAI_API_KEY);
    if (codexOpenAiKey) {
      sources.push(
        buildProviderSource("codex-cli-api-key", "Codex CLI", `Imported from ${codexAuthPath}.`, {
          label: "OpenAI API (Codex CLI)",
          providerKind: "openai",
          baseUrl: "https://api.openai.com/v1",
          apiKey: codexOpenAiKey,
          modelIds: getDefaultModelIdsForProviderKind("openai"),
        }),
      );
    } else if (codexAuth.tokens?.id_token) {
      sources.push({
        id: "codex-cli-session",
        label: "Codex CLI session",
        details:
          "Detected local OpenAI account sign-in, but account/session tokens are not imported as API keys.",
        kind: "desktop_auth",
        status: "detected",
      });
    }
  }

  const claudeDesktopPath = join(HOME, "Library", "Application Support", "Claude");
  if (await exists(claudeDesktopPath)) {
    sources.push({
      id: "claude-desktop",
      label: "Claude Desktop",
      details:
        "Detected installed app. Claude Desktop sign-in is not equivalent to an Anthropic API key, so it is not auto-imported.",
      kind: "desktop_auth",
      status: "detected",
    });
  }

  const codexDesktopPath = join(HOME, "Library", "Application Support", "Codex");
  if (await exists(codexDesktopPath)) {
    sources.push({
      id: "codex-desktop",
      label: "Codex Desktop",
      details: "Detected installed app. Desktop session auth is not imported as an OpenAI API key.",
      kind: "desktop_auth",
      status: "detected",
    });
  }

  const chatgptAppPath = join(HOME, "Library", "Application Support", "com.openai.chat");
  if (await exists(chatgptAppPath)) {
    sources.push({
      id: "chatgpt-auth",
      label: "ChatGPT app auth",
      details:
        "Detected local ChatGPT app data. ChatGPT session auth is not treated as an API key and is not auto-imported.",
      kind: "desktop_auth",
      status: "detected",
    });
  }

  const lmStudioDetected = await probeOpenAiCompatibleEndpoint({
    baseUrl: getLmStudioBaseUrl(),
    apiKey: getLmStudioApiKey(),
    providerKey: "lmstudio",
    providerLabel: "LM Studio",
  });
  if (lmStudioDetected) {
    sources.push({
      id: "lmstudio-local",
      label: "LM Studio",
      details: `Detected local runtime with ${lmStudioDetected.modelIds.length} model(s).`,
      kind: "local_runtime",
      status: "importable",
      importableProvider: {
        label: "LM Studio",
        providerKind: "openai_compatible",
        baseUrl: lmStudioDetected.baseUrl,
        apiKey: getLmStudioApiKey() ?? null,
        modelIds: lmStudioDetected.modelIds,
      },
    });
  } else if (await exists(join(HOME, ".lmstudio"))) {
    sources.push({
      id: "lmstudio-installed",
      label: "LM Studio",
      details:
        "Detected installed LM Studio, but its local server is not probeable yet. If auth is enabled, set LM_API_TOKEN before running setup.",
      kind: "local_runtime",
      status: "detected",
    });
  }

  const ollamaModels = await detectOllamaModels();
  if (ollamaModels.length > 0) {
    sources.push({
      id: "ollama-auto",
      label: "Ollama",
      details: `Detected ${ollamaModels.length} local model(s). Ollama already auto-detects at runtime and does not need importing.`,
      kind: "local_runtime",
      status: "auto",
    });
  }

  return sources;
}
