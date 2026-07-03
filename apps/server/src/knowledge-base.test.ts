import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb } from "@nyxel/db";
import { createTestUser, installTestDb } from "@nyxel/db/test-utils";
import { getKnowledgeBaseContextForPrompt } from "./knowledge-base";

let ctx: Awaited<ReturnType<typeof installTestDb>>;
let vaultDir: string;

beforeEach(async () => {
  ctx = await installTestDb();
  vaultDir = await mkdtemp(join(tmpdir(), "nyxel-kb-test-"));
});

afterEach(async () => {
  await ctx.cleanup();
  await rm(vaultDir, { recursive: true, force: true });
  delete process.env.NYXEL_KB_PROMPT_SECTION_MAX_CHARS;
  delete process.env.NYXEL_KB_PROMPT_CONTEXT_MAX_CHARS;
});

async function seedWorkspaceWithVault(noteContent: string) {
  const db = getDb();
  const user = createTestUser(ctx.path);
  const workspace = await db.createWorkspace({ userId: user.id, name: "Test workspace" });
  await db.upsertKnowledgeBaseConfig({
    workspaceId: workspace.id,
    vaultPath: vaultDir,
    injectIntoPrompts: true,
  });
  await writeFile(join(vaultDir, "00-Meta-overview.md"), noteContent, "utf8");
  return workspace;
}

describe("getKnowledgeBaseContextForPrompt budget env vars", () => {
  it("falls back to the existing hardcoded caps when env vars are unset", async () => {
    const longNote = "x".repeat(3000);
    const workspace = await seedWorkspaceWithVault(longNote);

    const block = await getKnowledgeBaseContextForPrompt(workspace.id);

    expect(block).not.toBeNull();
    // Default per-note cap (1500) truncates the 3000-char note.
    expect(block).toContain("x".repeat(1500));
    expect(block).not.toContain("x".repeat(1501));
    // Whole block stays under the default context cap (6000), so no
    // context-level truncation marker is appended.
    expect(block?.endsWith("…(truncated)")).toBe(false);
  });

  it("truncates per-note content when NYXEL_KB_PROMPT_SECTION_MAX_CHARS is set", async () => {
    process.env.NYXEL_KB_PROMPT_SECTION_MAX_CHARS = "50";
    const longNote = "y".repeat(3000);
    const workspace = await seedWorkspaceWithVault(longNote);

    const block = await getKnowledgeBaseContextForPrompt(workspace.id);

    expect(block).not.toBeNull();
    expect(block).toContain("y".repeat(50));
    expect(block).not.toContain("y".repeat(51));
  });

  it("truncates the whole assembled block when NYXEL_KB_PROMPT_CONTEXT_MAX_CHARS is set low", async () => {
    process.env.NYXEL_KB_PROMPT_CONTEXT_MAX_CHARS = "200";
    const workspace = await seedWorkspaceWithVault("z".repeat(3000));

    const block = await getKnowledgeBaseContextForPrompt(workspace.id);

    expect(block).not.toBeNull();
    expect(block?.endsWith("…(truncated)")).toBe(true);
    expect(block?.length).toBeLessThanOrEqual(200 + "\n…(truncated)".length);
  });

  it("falls back silently to the default when an env var is invalid", async () => {
    process.env.NYXEL_KB_PROMPT_SECTION_MAX_CHARS = "not-a-number";
    const longNote = "w".repeat(3000);
    const workspace = await seedWorkspaceWithVault(longNote);

    const block = await getKnowledgeBaseContextForPrompt(workspace.id);

    expect(block).not.toBeNull();
    expect(block).toContain("w".repeat(1500));
    expect(block).not.toContain("w".repeat(1501));
  });
});
