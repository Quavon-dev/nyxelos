#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { getDb } from "../packages/db/src/index";
import {
  getDefaultModelIdsForProviderKind,
  type OpenAiCompatibleProbeFailure,
  type ProviderImportSource,
  probeOpenAiCompatibleEndpointDetailed,
  scanProviderImportSources,
} from "../packages/model-providers/src/index";

const COLOR = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  bold: "\u001b[1m",
  blue: "\u001b[34m",
  cyan: "\u001b[36m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  red: "\u001b[31m",
  magenta: "\u001b[35m",
};

function printUsage() {
  console.log(`${COLOR.bold}${COLOR.cyan}Usage${COLOR.reset}`);
  console.log("  bun run nyxel setup");
  console.log("  bun run nyxel setup --all");
  console.log("  bun run nyxel setup providers");
}

function resolveCliDatabaseUrl(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (existsSync("./apps/server/nyxel.sqlite")) return "./apps/server/nyxel.sqlite";
  if (existsSync("./nyxel.sqlite")) return "./nyxel.sqlite";
  return undefined;
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function promptWithDefault(question: string, defaultValue: string): Promise<string> {
  const value = await prompt(`${question} [${defaultValue}]: `);
  return value === "" ? defaultValue : value;
}

async function promptSecret(question: string): Promise<string> {
  return prompt(question);
}

function colorStatus(status: ProviderImportSource["status"]): string {
  if (status === "importable") return `${COLOR.green}${status}${COLOR.reset}`;
  if (status === "auto") return `${COLOR.cyan}${status}${COLOR.reset}`;
  return `${COLOR.yellow}${status}${COLOR.reset}`;
}

function note(message: string) {
  console.log(`${COLOR.dim}${message}${COLOR.reset}`);
}

function success(message: string) {
  console.log(`${COLOR.green}${message}${COLOR.reset}`);
}

function warn(message: string) {
  console.log(`${COLOR.yellow}${message}${COLOR.reset}`);
}

function errorText(message: string) {
  console.log(`${COLOR.red}${message}${COLOR.reset}`);
}

async function openInBrowser(url: string): Promise<boolean> {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(command, [url], { stdio: "ignore", detached: true }).unref();
    return true;
  } catch {
    return false;
  }
}

async function maybeOpenBrowser(url: string, label: string) {
  const answer = await prompt(`Open ${label} in your browser now? [Y/n]: `);
  if (answer.toLowerCase() === "n") return;
  const opened = await openInBrowser(url);
  if (opened) {
    note(`Opened ${url}`);
  } else {
    warn(`Could not open a browser automatically. Visit: ${url}`);
  }
}

async function runSetup(args: string[]) {
  const databaseUrl = resolveCliDatabaseUrl();
  if (databaseUrl) process.env.DATABASE_URL = databaseUrl;

  const db = getDb();
  const installation = await db.getInstallation();
  if (!installation) {
    throw new Error("Nyxel is not installed yet. Complete the web setup first.");
  }

  const workspace = await db.getWorkspace(installation.primaryWorkspaceId);
  const workspaceLabel = workspace?.name ?? installation.primaryWorkspaceId;
  const sources = await scanProviderImportSources();

  console.log(`${COLOR.bold}${COLOR.blue}Workspace${COLOR.reset}: ${workspaceLabel}`);
  console.log("");

  if (sources.length === 0) {
    console.log("No provider sources detected.");
    return;
  }

  console.log(`${COLOR.bold}${COLOR.magenta}Detected provider sources${COLOR.reset}:`);
  sources.forEach((source, index) => {
    console.log(
      `${COLOR.bold}${index + 1}.${COLOR.reset} [${colorStatus(source.status)}] ${source.label}`,
    );
    note(`   ${source.details}`);
  });

  const importable = sources.filter((source) => source.importableProvider);
  let selected: ProviderImportSource[] = importable;
  if (!args.includes("--all")) {
    console.log("");
    const selection = await prompt(
      "Select providers to set up/import (comma-separated numbers, Enter for all importable): ",
    );
    if (selection === "" && importable.length === 0) {
      warn("Nothing importable was found automatically.");
      note("Pick a detected source number to finish setup interactively, or Ctrl+C to cancel.");
      const guidedSelection = await prompt("Source number: ");
      const indexes = new Set(
        guidedSelection
          .split(",")
          .map((item) => Number(item.trim()))
          .filter((value) => Number.isInteger(value) && value > 0),
      );
      selected = sources.filter((_, index) => indexes.has(index + 1));
    } else if (selection !== "") {
      const indexes = new Set(
        selection
          .split(",")
          .map((item) => Number(item.trim()))
          .filter((value) => Number.isInteger(value) && value > 0),
      );
      selected = sources.filter((source, index) =>
        indexes.has(index + 1) ? source.importableProvider || supportsGuidedSetup(source) : false,
      );
      if (selected.length === 0) {
        warn("No valid setup sources selected.");
        return;
      }
    }
  } else if (importable.length === 0) {
    selected = sources.filter((source) => supportsGuidedSetup(source));
  }

  if (selected.length === 0) {
    console.log("");
    warn("Nothing importable was found.");
    return;
  }

  console.log("");
  for (const source of selected) {
    const resolvedSource = source.importableProvider ? source : await completeGuidedSetup(source);
    if (!resolvedSource?.importableProvider) {
      warn(`Skipped ${source.label}.`);
      continue;
    }
    const installationRecord = await importProviderSourceToWorkspace(
      db,
      installation.primaryWorkspaceId,
      resolvedSource,
    );
    success(
      `Imported ${resolvedSource.label} -> ${installationRecord.label} (${installationRecord.modelIds.join(", ")})`,
    );
  }
}

function supportsGuidedSetup(source: ProviderImportSource): boolean {
  return new Set([
    "lmstudio-installed",
    "lmstudio-local",
    "codex-cli-session",
    "codex-desktop",
    "chatgpt-auth",
    "claude-desktop",
  ]).has(source.id);
}

async function completeGuidedSetup(
  source: ProviderImportSource,
): Promise<ProviderImportSource | null> {
  if (source.id === "lmstudio-installed" || source.id === "lmstudio-local") {
    return completeLmStudioSetup(source);
  }

  if (
    source.id === "codex-cli-session" ||
    source.id === "codex-desktop" ||
    source.id === "chatgpt-auth"
  ) {
    return completeOpenAiSetup(source);
  }

  if (source.id === "claude-desktop") {
    return completeAnthropicSetup(source);
  }

  return null;
}

async function completeLmStudioSetup(
  source: ProviderImportSource,
): Promise<ProviderImportSource | null> {
  console.log(`${COLOR.bold}${COLOR.cyan}Configuring ${source.label}${COLOR.reset}...`);
  note("LM Studio can expose every currently loaded model through its local API.");
  const baseUrl = await promptWithDefault("LM Studio base URL", "http://localhost:1234");
  const apiKey = await promptSecret("LM Studio API token (leave empty if auth is disabled): ");
  const detected = await probeOpenAiCompatibleEndpointDetailed({
    baseUrl,
    apiKey: apiKey.trim() || undefined,
    providerKey: "lmstudio",
    providerLabel: "LM Studio",
  });
  if (!("modelIds" in detected)) {
    printProbeFailure(detected);
    if (detected.status === 401 || detected.code === "invalid_api_key") {
      note("LM Studio is reachable, but this server requires an API token.");
      await maybeOpenBrowser(
        "https://lmstudio.ai/docs/developer/core/authentication",
        "LM Studio auth docs",
      );
    }
    return null;
  }

  return {
    id: "lmstudio-guided",
    label: "LM Studio",
    details: `Configured interactively for ${detected.baseUrl}.`,
    kind: "local_runtime",
    status: "importable",
    importableProvider: {
      label: "LM Studio",
      providerKind: "openai_compatible",
      baseUrl: detected.baseUrl,
      apiKey: apiKey.trim() || null,
      modelIds: detected.modelIds,
    },
  };
}

async function completeOpenAiSetup(
  source: ProviderImportSource,
): Promise<ProviderImportSource | null> {
  console.log(`${COLOR.bold}${COLOR.cyan}Configuring ${source.label}${COLOR.reset}...`);
  note(
    "Desktop/session login is detectable, but there is no supported session-to-API-key conversion.",
  );
  await maybeOpenBrowser("https://platform.openai.com/api-keys", "OpenAI API keys");
  const apiKey = await promptSecret("OpenAI API key: ");
  if (apiKey.trim() === "") return null;
  return {
    id: `${source.id}-guided`,
    label: source.label,
    details: `Configured interactively from ${source.label}.`,
    kind: "api_key",
    status: "importable",
    importableProvider: {
      label: "OpenAI API",
      providerKind: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: apiKey.trim(),
      modelIds: getDefaultModelIdsForProviderKind("openai"),
    },
  };
}

async function completeAnthropicSetup(
  source: ProviderImportSource,
): Promise<ProviderImportSource | null> {
  console.log(`${COLOR.bold}${COLOR.cyan}Configuring ${source.label}${COLOR.reset}...`);
  note("Desktop sign-in is not the same credential as API access.");
  await maybeOpenBrowser("https://console.anthropic.com/settings/keys", "Anthropic API keys");
  const apiKey = await promptSecret("Anthropic API key: ");
  if (apiKey.trim() === "") return null;
  return {
    id: `${source.id}-guided`,
    label: source.label,
    details: `Configured interactively from ${source.label}.`,
    kind: "api_key",
    status: "importable",
    importableProvider: {
      label: "Anthropic API",
      providerKind: "anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKey: apiKey.trim(),
      modelIds: getDefaultModelIdsForProviderKind("anthropic"),
    },
  };
}

function printProbeFailure(failure: OpenAiCompatibleProbeFailure) {
  if (failure.status === null) {
    errorText("Could not reach the endpoint. Check whether the local server is running.");
    return;
  }
  const summary = failure.message ?? failure.code ?? `HTTP ${failure.status}`;
  errorText(`Probe failed (${failure.status}): ${summary}`);
}

async function importProviderSourceToWorkspace(
  db: ReturnType<typeof getDb>,
  workspaceId: string,
  source: ProviderImportSource,
) {
  if (!source.importableProvider) {
    throw new Error(`Provider source "${source.label}" is detectable but not importable.`);
  }

  const existing = await db.listModelInstallationsByWorkspace(workspaceId);
  const duplicate = existing.find(
    (candidate) =>
      candidate.providerKind === source.importableProvider?.providerKind &&
      candidate.baseUrl === source.importableProvider?.baseUrl &&
      candidate.apiKey === source.importableProvider?.apiKey,
  );
  if (duplicate) return duplicate;

  return db.createModelInstallation({
    workspaceId,
    label: source.importableProvider.label,
    providerKind: source.importableProvider.providerKind,
    baseUrl: source.importableProvider.baseUrl,
    apiKey: source.importableProvider.apiKey,
    modelIds: source.importableProvider.modelIds,
    enabled: true,
  });
}

async function main() {
  const [, , command, ...args] = Bun.argv;
  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  if (command === "setup") {
    await runSetup(args);
    return;
  }

  printUsage();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
