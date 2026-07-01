import path from "node:path";
import type { SkillRecord } from "@nyxel/db";
import { createSkillContext, type SkillDefinition } from "@nyxel/skills-sdk";
import { z } from "zod";
import { listKnowledgeBaseDocuments } from "./knowledge-base";

/**
 * Turns a DB-backed SkillRecord (created through the "Skills" tab) into the
 * same SkillDefinition shape as the hand-written skills in
 * packages/skills-sdk/src/skills — so apps/server/src/tools.ts can run both
 * kinds through one code path. See ADR-0013.
 *
 * Config shape per kind (validated loosely — a malformed config degrades to
 * "no permissions" rather than throwing, so one bad skill can't break tool
 * building for the whole agent):
 *   http_fetch:  { allowedHosts: string[] }
 *   file_read:   { allowedDirs: string[] }
 *   file_list:   { allowedDirs: string[] }
 *   file_write:  { allowedDirs: string[] }
 *   kb_search:   {} (reads the workspace's configured knowledge-base vault)
 *   custom_code: { allowedHosts: string[], allowedDirs: string[], code: string }
 *                `code` is the body of an async function `(input, ctx) => { ... }`.
 */
export function buildDynamicSkillDefinition(record: SkillRecord): SkillDefinition {
  const config = record.config ?? {};
  const stringArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

  const allowedHosts = stringArray(config.allowedHosts);
  const allowedDirs = stringArray(config.allowedDirs).map((dir) => path.resolve(dir));

  const base = {
    id: record.id,
    name: record.name,
    description: record.description,
    sensitive: record.sensitive,
  };

  switch (record.kind) {
    case "http_fetch":
      return {
        ...base,
        inputSchema: z.object({ url: z.string().url() }),
        permissions: { network: allowedHosts, filesystem: [] },
        async run({ url }) {
          const ctx = createSkillContext({ network: allowedHosts, filesystem: [] });
          const res = await ctx.fetch(url);
          const text = await res.text();
          return { status: res.status, body: text.slice(0, 4000) };
        },
      };

    case "file_read":
      return {
        ...base,
        inputSchema: z.object({ path: z.string().describe("Absolute path to read.") }),
        permissions: { network: [], filesystem: allowedDirs },
        async run({ path: filePath }) {
          const ctx = createSkillContext({ network: [], filesystem: allowedDirs });
          const content = await ctx.readFile(filePath);
          return { path: filePath, content: content.slice(0, 20_000) };
        },
      };

    case "file_list":
      return {
        ...base,
        inputSchema: z.object({
          path: z.string().describe("Absolute directory path to list."),
        }),
        permissions: { network: [], filesystem: allowedDirs },
        async run({ path: dirPath }) {
          const ctx = createSkillContext({ network: [], filesystem: allowedDirs });
          const entries = await ctx.readDir(dirPath);
          return { path: dirPath, entries };
        },
      };

    case "file_write":
      return {
        ...base,
        inputSchema: z.object({
          path: z.string().describe("Absolute path to write."),
          content: z.string(),
        }),
        permissions: { network: [], filesystem: allowedDirs },
        async run({ path: filePath, content }) {
          const ctx = createSkillContext({ network: [], filesystem: allowedDirs });
          await ctx.writeFile(filePath, content);
          return { path: filePath, bytesWritten: content.length };
        },
      };

    case "kb_search":
      return {
        ...base,
        inputSchema: z.object({ query: z.string().min(1) }),
        permissions: { network: [], filesystem: [] },
        async run({ query }) {
          const documents = await listKnowledgeBaseDocuments(record.workspaceId);
          const needle = query.toLowerCase();
          const matches = documents
            .filter(
              (doc) =>
                doc.title.toLowerCase().includes(needle) || doc.path.toLowerCase().includes(needle),
            )
            .slice(0, 10)
            .map((doc) => ({ path: doc.path, title: doc.title }));
          return { query, matches };
        },
      };

    case "custom_code": {
      const code = typeof config.code === "string" ? config.code : "";
      return {
        ...base,
        inputSchema: z.record(z.string(), z.unknown()).default({}),
        permissions: { network: allowedHosts, filesystem: allowedDirs },
        async run(input) {
          const ctx = createSkillContext({ network: allowedHosts, filesystem: allowedDirs });
          // Deliberately in-process, not sandboxed beyond the scoped fetch/fs
          // context above — same trust model as every other skill (ADR-0007).
          // A custom-code skill can still reach arbitrary Node/Bun APIs; the
          // approval workflow (sensitive: true by default) is the actual
          // safety net for what it's allowed to *do*, not what it can *see*.
          // biome-ignore lint/security/noGlobalEval: intentional — this is the whole point of a user-authored "custom code" skill kind.
          const fn = new Function(
            "input",
            "ctx",
            `return (async () => { ${code} })();`,
          ) as (input: unknown, ctx: ReturnType<typeof createSkillContext>) => Promise<unknown>;
          return fn(input, ctx);
        },
      };
    }

    default:
      // Exhaustiveness guard — a future SkillKind added to the DB schema
      // without a case here degrades to a no-op rather than crashing tool
      // building for the whole agent.
      return {
        ...base,
        inputSchema: z.record(z.string(), z.unknown()).default({}),
        permissions: { network: [], filesystem: [] },
        async run() {
          throw new Error(`Unsupported skill kind: ${record.kind}`);
        },
      };
  }
}
