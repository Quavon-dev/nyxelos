import type { z } from "zod";

/**
 * A skill's declared rights, checked by the runtime before it's allowed to
 * touch the network or filesystem. See ARCHITECTURE.md section 8 and
 * ADR-0007 for the scope/limits of what's enforced today.
 */
export interface SkillPermissions {
  /** Allowed outbound hosts (exact match or subdomain), e.g. ["api.github.com"]. Empty = no network access. */
  network: string[];
  /** Allowed absolute directory paths the skill may read/write under. Empty = no filesystem access. */
  filesystem: string[];
}

export interface SkillContext {
  /** `fetch`, but restricted to `permissions.network`. Throws SkillPermissionError otherwise. */
  fetch: typeof fetch;
  /** Restricted to `permissions.filesystem`. */
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
}

// biome-ignore lint/suspicious/noExplicitAny: skill input/output shapes are necessarily varied; call sites get full type safety back through SkillRegistry.run's generic overloads.
export interface SkillDefinition<TInput = any, TOutput = any> {
  /** Stable identifier used to reference this skill from agent config. */
  id: string;
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  permissions: SkillPermissions;
  run: (input: TInput, ctx: SkillContext) => Promise<TOutput>;
}
