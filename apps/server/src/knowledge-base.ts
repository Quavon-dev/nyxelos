import { promises as fs } from "node:fs";
import path from "node:path";
import type { AuditLogRecord } from "@nyxel/db";
import { getDb } from "@nyxel/db";
import { logAudit } from "./audit";

const KNOWLEDGE_BASE_POLL_INTERVAL_MS = 60_000;
const REPO_ROOT = path.resolve(new URL("../../..", import.meta.url).pathname);
const ADR_PATH = "01-Decisions/ADR-0012-Obsidian-Knowledge-Base-And-Docs-Agent.md";

export interface KnowledgeBaseDocument {
  path: string;
  title: string;
  modifiedAt: Date;
  links: string[];
}

export interface KnowledgeBaseGraphNode {
  id: string;
  label: string;
  group: string;
}

export interface KnowledgeBaseGraphEdge {
  source: string;
  target: string;
}

function resolveVaultPath(vaultPath: string): string {
  return path.isAbsolute(vaultPath) ? vaultPath : path.resolve(REPO_ROOT, vaultPath);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function listMarkdownFiles(rootDir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(currentDir: string) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const absolute = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".md")) results.push(absolute);
    }
  }

  if (await pathExists(rootDir)) {
    await walk(rootDir);
  }

  return results.sort();
}

function extractTitle(markdown: string, fallbackPath: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  return path.basename(fallbackPath, ".md").replace(/-/g, " ");
}

function normalizeLinkTarget(raw: string): string {
  const withoutAlias = raw.split("|")[0]?.trim() ?? raw.trim();
  const withoutHash = withoutAlias.split("#")[0]?.trim() ?? withoutAlias;
  const normalized = withoutHash.endsWith(".md") ? withoutHash : `${withoutHash}.md`;
  return normalized.replace(/\\/g, "/");
}

function extractLinks(markdown: string): string[] {
  const links = new Set<string>();

  for (const match of markdown.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const target = normalizeLinkTarget(match[1] ?? "");
    if (target) links.add(target);
  }

  for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)]+\.md(?:#[^)]+)?)\)/g)) {
    const target = normalizeLinkTarget(match[1] ?? "");
    if (target) links.add(target);
  }

  return [...links];
}

function noteGroupFromPath(relativePath: string): string {
  return relativePath.split("/")[0] ?? "Other";
}

async function loadVaultDocuments(vaultPath: string): Promise<KnowledgeBaseDocument[]> {
  const root = resolveVaultPath(vaultPath);
  const files = await listMarkdownFiles(root);

  return Promise.all(
    files.map(async (absolutePath) => {
      const relativePath = path.relative(root, absolutePath).replace(/\\/g, "/");
      const markdown = await fs.readFile(absolutePath, "utf8");
      const stats = await fs.stat(absolutePath);
      return {
        path: relativePath,
        title: extractTitle(markdown, relativePath),
        modifiedAt: stats.mtime,
        links: extractLinks(markdown),
      };
    }),
  );
}

async function pingObsidianRestApi(
  url: string,
  apiKey: string | null,
): Promise<{
  reachable: boolean;
  error: string | null;
}> {
  try {
    const response = await fetch(url.replace(/\/$/, ""), {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    });
    if (!response.ok) {
      return { reachable: false, error: `HTTP ${response.status}` };
    }
    return { reachable: true, error: null };
  } catch (error) {
    return {
      reachable: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function ensureAdr(vaultPath: string): Promise<void> {
  const absoluteVaultPath = resolveVaultPath(vaultPath);
  const absoluteAdrPath = path.join(absoluteVaultPath, ADR_PATH);
  if (await pathExists(absoluteAdrPath)) return;

  const markdown = `# ADR-0012: Obsidian Knowledge Base and Automatic Docs Agent

Date: 2026-07-01
Status: accepted

## Context

Phase 3 of the roadmap introduces Obsidian as the living knowledge base and requires an automatic docs agent that keeps the vault current as development continues.

## Decision

NyxelOS keeps the canonical project knowledge base in the repository's \`knowledge-base/\` vault and treats Obsidian as a file-first system. The server indexes markdown files directly from disk for browsing and graph rendering, optionally checks the local Obsidian REST API for reachability, and runs a background docs-agent sync loop that appends development notes based on recent audit-log activity and recently modified code files.

## Consequences

- The vault remains readable and editable even without Obsidian running.
- The UI can render a graph view without depending on the Obsidian app.
- The docs agent has a durable cursor (\`lastDocsSyncAt\`) and can resume after restarts.
`;

  await fs.mkdir(path.dirname(absoluteAdrPath), { recursive: true });
  await fs.writeFile(absoluteAdrPath, markdown, "utf8");
}

async function listRecentlyChangedFiles(since: Date | null): Promise<string[]> {
  const roots = ["apps", "packages", "docs"].map((segment) => path.join(REPO_ROOT, segment));
  const changed = new Set<string>();

  async function walk(currentDir: string) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const absolute = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const stats = await fs.stat(absolute);
      if (!since || stats.mtime > since) {
        changed.add(path.relative(REPO_ROOT, absolute).replace(/\\/g, "/"));
      }
    }
  }

  for (const root of roots) {
    if (await pathExists(root)) await walk(root);
  }

  return [...changed].sort().slice(0, 20);
}

function summarizeAuditEntry(entry: AuditLogRecord) {
  const output =
    typeof entry.output === "string"
      ? entry.output
      : entry.output == null
        ? ""
        : JSON.stringify(entry.output);
  const clipped = output.length > 140 ? `${output.slice(0, 140)}…` : output;
  return `- ${entry.actor} · ${entry.toolLabel} · ${entry.status}${clipped ? ` · ${clipped}` : ""}`;
}

export async function getKnowledgeBaseOverview(workspaceId: string) {
  const db = getDb();
  const config = (await db.getKnowledgeBaseConfig(workspaceId)) ?? {
    workspaceId,
    vaultPath: "knowledge-base",
    obsidianRestUrl: "http://127.0.0.1:27124/",
    obsidianApiKey: null,
    docsAgentEnabled: true,
    lastDocsSyncAt: null,
    lastDocsSyncError: null,
    updatedAt: new Date(0),
  };

  const absoluteVaultPath = resolveVaultPath(config.vaultPath);
  const documents = await loadVaultDocuments(config.vaultPath);
  const graph = buildKnowledgeBaseGraph(documents);
  const obsidian =
    config.obsidianRestUrl != null
      ? await pingObsidianRestApi(config.obsidianRestUrl, config.obsidianApiKey)
      : { reachable: false, error: "Not configured" };

  return {
    config: {
      ...config,
      obsidianApiKeySet: Boolean(config.obsidianApiKey),
      absoluteVaultPath,
    },
    stats: {
      noteCount: documents.length,
      edgeCount: graph.edges.length,
    },
    recentDocuments: documents
      .slice()
      .sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime())
      .slice(0, 8),
    obsidian,
  };
}

export async function listKnowledgeBaseDocuments(
  workspaceId: string,
): Promise<KnowledgeBaseDocument[]> {
  const config = await getDb().getKnowledgeBaseConfig(workspaceId);
  return loadVaultDocuments(config?.vaultPath ?? "knowledge-base");
}

export function buildKnowledgeBaseGraph(documents: KnowledgeBaseDocument[]) {
  const byPath = new Map(documents.map((doc) => [doc.path, doc]));
  const byBasename = new Map(documents.map((doc) => [path.basename(doc.path), doc]));

  const resolveDocumentPath = (target: string) => {
    if (byPath.has(target)) return target;
    const normalized = target.replace(/^\.\//, "");
    if (byPath.has(normalized)) return normalized;
    return byBasename.get(path.basename(normalized))?.path ?? null;
  };

  const nodes: KnowledgeBaseGraphNode[] = documents.map((doc) => ({
    id: doc.path,
    label: doc.title,
    group: noteGroupFromPath(doc.path),
  }));
  const edges: KnowledgeBaseGraphEdge[] = [];

  for (const doc of documents) {
    for (const link of doc.links) {
      const target = resolveDocumentPath(link);
      if (!target) continue;
      edges.push({ source: doc.path, target });
    }
  }

  return { nodes, edges };
}

const inFlightSyncs = new Set<string>();

export async function runDocsAgentForWorkspace(
  workspaceId: string,
  trigger: "manual" | "background" = "manual",
) {
  if (inFlightSyncs.has(workspaceId)) {
    return { ok: true, skipped: true };
  }

  inFlightSyncs.add(workspaceId);
  const db = getDb();

  try {
    const workspace = await db.getWorkspace(workspaceId);
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);

    const config =
      (await db.getKnowledgeBaseConfig(workspaceId)) ??
      (await db.upsertKnowledgeBaseConfig({
        workspaceId,
        vaultPath: "knowledge-base",
        obsidianRestUrl: "http://127.0.0.1:27124/",
        docsAgentEnabled: true,
      }));

    const auditEntries = (await db.listAuditLogByWorkspace(workspaceId, 200))
      .filter(
        (entry) =>
          entry.toolLabel !== "docs_agent_sync" &&
          (!config.lastDocsSyncAt || entry.createdAt > config.lastDocsSyncAt),
      )
      .reverse();
    const changedFiles = await listRecentlyChangedFiles(config.lastDocsSyncAt);

    if (auditEntries.length === 0 && changedFiles.length === 0 && trigger === "background") {
      return { ok: true, skipped: true };
    }

    await ensureAdr(config.vaultPath);

    const absoluteVaultPath = resolveVaultPath(config.vaultPath);
    const noteDate = new Date().toISOString().slice(0, 10);
    const notePath = path.join(
      absoluteVaultPath,
      "02-Dev-Log",
      `${noteDate}-phase-3-implementation.md`,
    );
    const timestamp = new Date().toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Europe/Berlin",
    });

    const sections = [
      `## Docs Agent Sync — ${timestamp}`,
      "",
      `Workspace: **${workspace.name}**`,
      "",
      auditEntries.length > 0 ? "### Audit highlights" : "### Audit highlights",
      ...(auditEntries.length > 0
        ? auditEntries.map((entry) => summarizeAuditEntry(entry))
        : ["- No new audit-log activity since the last sync."]),
      "",
      "### Changed files",
      ...(changedFiles.length > 0
        ? changedFiles.map((file) => `- \`${file}\``)
        : ["- No code or docs files changed since the last sync."]),
      "",
    ];

    await fs.mkdir(path.dirname(notePath), { recursive: true });
    const existing = (await pathExists(notePath)) ? await fs.readFile(notePath, "utf8") : "";
    const prefix = existing.trim().length > 0 ? "\n\n" : "# Phase 3 Implementation Log\n\n";
    await fs.writeFile(notePath, `${existing}${prefix}${sections.join("\n")}`, "utf8");

    const completedAt = new Date();
    await db.updateKnowledgeBaseSyncStatus({
      workspaceId,
      lastDocsSyncAt: completedAt,
      lastDocsSyncError: null,
    });
    await logAudit({
      workspaceId,
      actor: "automation",
      toolLabel: "docs_agent_sync",
      input: { trigger, auditEntries: auditEntries.length, changedFiles: changedFiles.length },
      output: { notePath: path.relative(REPO_ROOT, notePath).replace(/\\/g, "/") },
      status: "success",
    });

    return { ok: true, skipped: false, notePath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const config = await db.getKnowledgeBaseConfig(workspaceId);
    if (config) {
      await db.updateKnowledgeBaseSyncStatus({
        workspaceId,
        lastDocsSyncError: message,
      });
    }
    await logAudit({
      workspaceId,
      actor: "automation",
      toolLabel: "docs_agent_sync",
      input: { trigger },
      output: message,
      status: "error",
    });
    throw error;
  } finally {
    inFlightSyncs.delete(workspaceId);
  }
}

export function startKnowledgeBaseSyncLoop(): () => void {
  const timer = setInterval(async () => {
    const configs = await getDb().listKnowledgeBaseConfigs();
    for (const config of configs) {
      if (!config.docsAgentEnabled) continue;
      try {
        await runDocsAgentForWorkspace(config.workspaceId, "background");
      } catch (error) {
        console.error(`Knowledge-base sync failed for workspace ${config.workspaceId}:`, error);
      }
    }
  }, KNOWLEDGE_BASE_POLL_INTERVAL_MS);

  if (typeof timer.unref === "function") timer.unref();
  return () => clearInterval(timer);
}
