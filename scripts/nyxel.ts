#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { getDb } from "../packages/db/src/index";
import {
  type ProviderImportSource,
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
  if (importable.length === 0) {
    console.log("");
    console.log("Nothing importable was found.");
    return;
  }

  let selected = importable;
  if (!args.includes("--all")) {
    console.log("");
    const selection = await prompt(
      "Select providers to import (comma-separated numbers, Enter for all importable): ",
    );
    if (selection !== "") {
      const indexes = new Set(
        selection
          .split(",")
          .map((item) => Number(item.trim()))
          .filter((value) => Number.isInteger(value) && value > 0),
      );
      selected = sources.filter(
        (source, index) => indexes.has(index + 1) && source.importableProvider,
      );
      if (selected.length === 0) {
        console.log("No valid importable sources selected.");
        return;
      }
    }
  }

  console.log("");
  for (const source of selected) {
    const installationRecord = await importProviderSourceToWorkspace(
      db,
      installation.primaryWorkspaceId,
      source,
    );
    console.log(
      `Imported ${source.label} -> ${installationRecord.label} (${installationRecord.modelIds.join(", ")})`,
    );
  }
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
