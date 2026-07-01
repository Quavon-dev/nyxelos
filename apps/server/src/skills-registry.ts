import { mkdirSync } from "node:fs";
import {
  createWebFetchSkill,
  createWriteNoteSkill,
  getCurrentTimeSkill,
  SkillRegistry,
} from "@nyxel/skills-sdk";

/**
 * The server-wide skill registry. Phase 1/2 ship three illustrative skills;
 * a real skill marketplace (ARCHITECTURE.md section 8) would populate this
 * per-workspace instead of as a single hardcoded process-wide instance.
 */
export const skillRegistry = new SkillRegistry();

const notesDir = process.env.NYXEL_NOTES_DIR ?? "/tmp/nyxel-notes";
mkdirSync(notesDir, { recursive: true });

skillRegistry.register(getCurrentTimeSkill);
skillRegistry.register(createWebFetchSkill(["api.github.com", "raw.githubusercontent.com"]));
// sensitive:true — see ADR-0009. This is the reference skill for exercising
// the approval workflow end to end.
skillRegistry.register(createWriteNoteSkill(notesDir));
