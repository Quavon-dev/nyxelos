import type { SkillDefinition } from "./types";

/** Identity helper that gives `run`/`inputSchema` proper type inference when authoring a skill. */
export function defineSkill<TInput, TOutput>(
  definition: SkillDefinition<TInput, TOutput>,
): SkillDefinition<TInput, TOutput> {
  return definition;
}
