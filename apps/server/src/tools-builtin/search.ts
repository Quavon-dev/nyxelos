import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ToolRecord } from "@nyxel/db";
import type { SkillDefinition } from "@nyxel/skills-sdk";
import { z } from "zod";
import { allowedDirsFromConfig, baseFields } from "./shared";
import { runCommandToCompletion } from "./terminal";

const IGNORED_DIR_NAMES = new Set(["node_modules", ".git", "dist", "build", ".next", ".turbo"]);
const MAX_FILE_BYTES = 1_000_000;
const MAX_WALK_ENTRIES = 20_000;
const MAX_TOTAL_OUTPUT_BYTES = 50_000;

/** Recursively walks `roots`, yielding file paths — skips the usual
 * dependency/build noise. Deliberately hand-rolled (no glob/ripgrep
 * dependency, see the plan) rather than pulling in fast-glob/ripgrep. */
async function* walkFiles(roots: string[]): AsyncGenerator<string> {
  let visited = 0;
  async function* walk(dir: string): AsyncGenerator<string> {
    if (visited > MAX_WALK_ENTRIES) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (visited > MAX_WALK_ENTRIES) return;
      visited++;
      if (entry.isDirectory()) {
        if (IGNORED_DIR_NAMES.has(entry.name) || entry.name.startsWith(".")) continue;
        yield* walk(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        yield path.join(dir, entry.name);
      }
    }
  }
  for (const root of roots) yield* walk(root);
}

function assertRootsAllowed(roots: string[], allowedDirs: string[]) {
  for (const root of roots) {
    const resolved = path.resolve(root);
    const allowed = allowedDirs.some((dir) => resolved === dir || resolved.startsWith(`${dir}/`));
    if (!allowed) {
      throw new Error(`"${resolved}" isn't in this tool's declared filesystem permissions.`);
    }
  }
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const withWildcards = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${withWildcards}$`, "i");
}

export function buildFileSearchTool(record: ToolRecord): SkillDefinition {
  const allowedDirs = allowedDirsFromConfig(record.config ?? {});
  return {
    ...baseFields(record),
    inputSchema: z.object({
      pattern: z.string().describe('Filename glob, e.g. "*.test.ts" — only "*" and "?" wildcards.'),
      roots: z.array(z.string()).optional(),
      maxResults: z.number().int().min(1).max(500).default(100),
    }),
    permissions: { network: [], filesystem: allowedDirs },
    async run({ pattern, roots, maxResults }) {
      const searchRoots = roots ?? allowedDirs;
      assertRootsAllowed(searchRoots, allowedDirs);
      const regex = wildcardToRegExp(pattern);
      const matches: string[] = [];
      for await (const file of walkFiles(searchRoots)) {
        if (regex.test(path.basename(file))) matches.push(file);
        if (matches.length >= maxResults) break;
      }
      return { pattern, matches };
    },
  };
}

async function grepFiles(
  roots: string[],
  needle: RegExp,
  maxResults: number,
): Promise<{ matches: { path: string; line: number; text: string }[]; truncated: boolean }> {
  const results: { path: string; line: number; text: string }[] = [];
  let outputBytes = 0;
  let truncated = false;
  files: for await (const file of walkFiles(roots)) {
    if (results.length >= maxResults) break;
    let stats: Awaited<ReturnType<typeof stat>>;
    try {
      stats = await stat(file);
    } catch {
      continue;
    }
    if (stats.size > MAX_FILE_BYTES) continue;
    let content: string;
    try {
      content = await readFile(file, "utf-8");
    } catch {
      continue; // binary/unreadable — skip rather than fail the whole search
    }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line !== undefined && needle.test(line)) {
        const match = { path: file, line: i + 1, text: line.trim().slice(0, 300) };
        const matchBytes = JSON.stringify(match).length;
        if (outputBytes + matchBytes > MAX_TOTAL_OUTPUT_BYTES) {
          truncated = true;
          break files;
        }
        outputBytes += matchBytes;
        results.push(match);
        if (results.length >= maxResults) break;
      }
      needle.lastIndex = 0;
    }
  }
  return { matches: results, truncated };
}

/** text_search, usages, and codebase_search all funnel through this — see
 * the plan's explicit callout that "usages"/"codebase_search" are heuristic
 * regex search over the allowed directory tree, not LSP-based symbol
 * resolution or embeddings-based semantic search. */
function buildGrepTool(record: ToolRecord, toRegExp: (query: string) => RegExp): SkillDefinition {
  const allowedDirs = allowedDirsFromConfig(record.config ?? {});
  return {
    ...baseFields(record),
    inputSchema: z.object({
      query: z.string().min(1),
      roots: z.array(z.string()).optional(),
      maxResults: z.number().int().min(1).max(500).default(100),
    }),
    permissions: { network: [], filesystem: allowedDirs },
    async run({ query, roots, maxResults }) {
      const searchRoots = roots ?? allowedDirs;
      assertRootsAllowed(searchRoots, allowedDirs);
      const { matches, truncated } = await grepFiles(searchRoots, toRegExp(query), maxResults);
      return { query, matches, truncated };
    },
  };
}

export function buildTextSearchTool(record: ToolRecord): SkillDefinition {
  return buildGrepTool(record, (query) => new RegExp(query, "gi"));
}

export function buildUsagesTool(record: ToolRecord): SkillDefinition {
  return buildGrepTool(
    record,
    (identifier) => new RegExp(`\\b${identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"),
  );
}

export function buildCodebaseSearchTool(record: ToolRecord): SkillDefinition {
  return buildGrepTool(record, (query) => new RegExp(query, "gi"));
}

export function buildChangesTool(record: ToolRecord): SkillDefinition {
  const allowedDirs = allowedDirsFromConfig(record.config ?? {});
  const root = allowedDirs[0];
  return {
    ...baseFields(record),
    inputSchema: z.object({ staged: z.boolean().default(false) }),
    permissions: { network: [], filesystem: allowedDirs },
    async run({ staged }) {
      if (!root) throw new Error(`"${record.name}" has no configured directory.`);
      const { output } = await runCommandToCompletion(
        staged ? "git diff --cached" : "git diff",
        root,
        10_000,
      );
      const { output: statusOutput } = await runCommandToCompletion(
        "git status --porcelain",
        root,
        10_000,
      );
      return { diff: output.slice(-8000), status: statusOutput.slice(-4000) };
    },
  };
}
