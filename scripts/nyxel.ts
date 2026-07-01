#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { getDb } from "../packages/db/src/index";
import {
  getDefaultModelIdsForProviderKind,
  type ProviderImportSource,
  probeOpenAiCompatibleEndpoint,
  scanProviderImportSources,
} from "../packages/model-providers/src/index";

function printUsage() {
  console.log("Usage:");
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

  console.log(`Workspace: ${workspaceLabel}`);
  console.log("");

  if (sources.length === 0) {
    console.log("No provider sources detected.");
    return;
  }

  console.log("Detected provider sources:");
  sources.forEach((source, index) => {
    console.log(`${index + 1}. [${source.status}] ${source.label}`);
    console.log(`   ${source.details}`);
  });

  const importable = sources.filter((source) => source.importableProvider);
  let selected: ProviderImportSource[] = importable;
  if (!args.includes("--all")) {
    console.log("");
    const selection = await prompt(
      "Select providers to set up/import (comma-separated numbers, Enter for all importable): ",
    );
    if (selection === "" && importable.length === 0) {
      console.log("Nothing importable was found automatically.");
      console.log(
        "Pick a detected source number to finish setup interactively, or Ctrl+C to cancel.",
      );
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
        console.log("No valid setup sources selected.");
        return;
      }
    }
  } else if (importable.length === 0) {
    selected = sources.filter((source) => supportsGuidedSetup(source));
  }

  if (selected.length === 0) {
    console.log("");
    console.log("Nothing importable was found.");
    return;
  }

  console.log("");
  for (const source of selected) {
    const resolvedSource = source.importableProvider ? source : await completeGuidedSetup(source);
    if (!resolvedSource?.importableProvider) {
      console.log(`Skipped ${source.label}.`);
      continue;
    }
    const installationRecord = await importProviderSourceToWorkspace(
      db,
      installation.primaryWorkspaceId,
      resolvedSource,
    );
    console.log(
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
  console.log(`Configuring ${source.label}...`);
  const baseUrl = await promptWithDefault("LM Studio base URL", "http://localhost:1234");
  const apiKey = await promptSecret("LM Studio API token (leave empty if auth is disabled): ");
  const detected = await probeOpenAiCompatibleEndpoint({
    baseUrl,
    apiKey: apiKey.trim() || undefined,
    providerKey: "lmstudio",
    providerLabel: "LM Studio",
  });
  if (!detected) {
    console.log("Could not probe LM Studio. Check the base URL, loaded models, and token.");
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
  console.log(`Configuring ${source.label}...`);
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
  console.log(`Configuring ${source.label}...`);
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
