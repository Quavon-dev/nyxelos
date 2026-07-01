import { createWebFetchSkill, getCurrentTimeSkill, SkillRegistry } from "@nyxel/skills-sdk";

/**
 * The server-wide skill registry. Phase 1 ships two illustrative skills;
 * a real skill marketplace (ARCHITECTURE.md section 8) would populate this
 * per-workspace instead of as a single hardcoded process-wide instance.
 */
export const skillRegistry = new SkillRegistry();

skillRegistry.register(getCurrentTimeSkill);
skillRegistry.register(createWebFetchSkill(["api.github.com", "raw.githubusercontent.com"]));
