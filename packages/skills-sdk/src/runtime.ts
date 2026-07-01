import {
  readdir as fsReadDir,
  readFile as fsReadFile,
  writeFile as fsWriteFile,
} from "node:fs/promises";
import path from "node:path";
import type { SkillContext, SkillDefinition, SkillPermissions } from "./types";

export class SkillPermissionError extends Error {}

function hostAllowed(hostname: string, allowed: string[]): boolean {
  return allowed.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

function createScopedFetch(permissions: SkillPermissions): typeof fetch {
  const scopedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? new URL(input)
        : input instanceof URL
          ? input
          : new URL(input.url);
    if (!hostAllowed(url.hostname, permissions.network)) {
      throw new SkillPermissionError(
        `Skill tried to reach "${url.hostname}", which isn't in its declared network permissions (${
          permissions.network.join(", ") || "none"
        }).`,
      );
    }
    return fetch(input, init);
  };
  return scopedFetch as typeof fetch;
}

function assertPathAllowed(permissions: SkillPermissions, target: string): string {
  const resolved = path.resolve(target);
  const allowed = permissions.filesystem.some(
    (dir) => resolved === dir || resolved.startsWith(`${dir}/`),
  );
  if (!allowed) {
    throw new SkillPermissionError(
      `Skill tried to access "${resolved}", which isn't in its declared filesystem permissions (${
        permissions.filesystem.join(", ") || "none"
      }).`,
    );
  }
  return resolved;
}

function createContext(permissions: SkillPermissions): SkillContext {
  return {
    fetch: createScopedFetch(permissions),
    readFile: async (filePath) => fsReadFile(assertPathAllowed(permissions, filePath), "utf-8"),
    writeFile: async (filePath, content) => {
      await fsWriteFile(assertPathAllowed(permissions, filePath), content, "utf-8");
    },
    readDir: async (dirPath) => {
      const entries = await fsReadDir(assertPathAllowed(permissions, dirPath), {
        withFileTypes: true,
      });
      return entries.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }));
    },
  };
}

/** Exported so callers that build skills dynamically (e.g. the DB-backed
 * skills in apps/server/src/skills-dynamic.ts) get the same permission-
 * checked fetch/file context as statically-defined skills, instead of
 * re-implementing the host/path allow-list checks. */
export function createSkillContext(permissions: SkillPermissions): SkillContext {
  return createContext(permissions);
}

/**
 * Runs skills behind an in-process, permission-checked context (scoped
 * `fetch` and filesystem access). This stops a skill from *accidentally*
 * reaching an undeclared host or path — it is not a security boundary
 * against a deliberately malicious skill, which could still reach other
 * Node/Bun APIs directly. Process- or container-level isolation is tracked
 * as a follow-up; see ADR-0007.
 */
export class SkillRegistry {
  private skills = new Map<string, SkillDefinition>();

  register(skill: SkillDefinition): void {
    if (this.skills.has(skill.id)) {
      throw new Error(`Skill "${skill.id}" is already registered.`);
    }
    this.skills.set(skill.id, skill);
  }

  list(): SkillDefinition[] {
    return [...this.skills.values()];
  }

  get(id: string): SkillDefinition | undefined {
    return this.skills.get(id);
  }

  async run(id: string, rawInput: unknown): Promise<unknown> {
    const skill = this.skills.get(id);
    if (!skill) throw new Error(`Unknown skill: ${id}`);
    const input = skill.inputSchema.parse(rawInput);
    const ctx = createContext(skill.permissions);
    return skill.run(input, ctx);
  }
}
