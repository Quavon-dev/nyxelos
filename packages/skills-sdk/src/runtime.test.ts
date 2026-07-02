import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSkillContext, SkillPermissionError } from "./runtime";

/**
 * Coverage for the filesystem/network containment checks in runtime.ts
 * (assertPathAllowed, hostAllowed) — the actual enforcement point behind
 * every skill's declared `permissions`. See ARCHITECTURE.md section 12 and
 * ADR-0007: this is an in-process guard against accidental scope creep, not
 * a sandbox against a deliberately malicious skill, but it must still reject
 * the traversal/prefix tricks a careless or buggy skill could trigger.
 */
describe("createSkillContext filesystem permissions", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    dirs.length = 0;
  });

  async function makeRoot() {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nyxel-skill-perm-"));
    dirs.push(dir);
    return dir;
  }

  it("allows reading a file inside the permitted directory", async () => {
    const root = await makeRoot();
    const filePath = path.join(root, "note.txt");
    await writeFile(filePath, "hello", "utf8");

    const ctx = createSkillContext({ network: [], filesystem: [root] });
    await expect(ctx.readFile(filePath)).resolves.toBe("hello");
  });

  it("rejects an absolute path outside every permitted directory", async () => {
    const root = await makeRoot();
    const outside = await makeRoot();
    const filePath = path.join(outside, "secret.txt");
    await writeFile(filePath, "top secret", "utf8");

    const ctx = createSkillContext({ network: [], filesystem: [root] });
    await expect(ctx.readFile(filePath)).rejects.toThrow(SkillPermissionError);
  });

  it("rejects a relative traversal that resolves outside the permitted directory", async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, "sub"), { recursive: true });
    const escaped = path.join(root, "sub", "..", "..", "etc", "passwd");

    const ctx = createSkillContext({ network: [], filesystem: [root] });
    await expect(ctx.readFile(escaped)).rejects.toThrow(SkillPermissionError);
  });

  it("does not treat a sibling directory sharing the root as a name prefix as allowed", async () => {
    const root = await makeRoot();
    // e.g. permitted "/tmp/nyxel-skill-perm-abc" must not also allow
    // "/tmp/nyxel-skill-perm-abc-evil" just because the strings share a prefix.
    const sibling = `${root}-evil`;
    await mkdir(sibling, { recursive: true });
    const filePath = path.join(sibling, "file.txt");
    await writeFile(filePath, "data", "utf8");
    dirs.push(sibling);

    const ctx = createSkillContext({ network: [], filesystem: [root] });
    await expect(ctx.readFile(filePath)).rejects.toThrow(SkillPermissionError);
  });

  it("rejects writes outside the permitted directory", async () => {
    const root = await makeRoot();
    const outside = await makeRoot();
    const filePath = path.join(outside, "new-file.txt");

    const ctx = createSkillContext({ network: [], filesystem: [root] });
    await expect(ctx.writeFile(filePath, "data")).rejects.toThrow(SkillPermissionError);
  });

  it("allows access to a file exactly at the permitted directory root", async () => {
    const root = await makeRoot();
    const ctx = createSkillContext({ network: [], filesystem: [root] });
    const stats = await ctx.statPath(root);
    expect(stats.isDirectory).toBe(true);
  });
});

describe("createSkillContext network permissions", () => {
  it("throws SkillPermissionError for a host outside the allowlist", async () => {
    const ctx = createSkillContext({ network: ["api.github.com"], filesystem: [] });
    await expect(ctx.fetch("https://evil.example.com/")).rejects.toThrow(SkillPermissionError);
  });

  it("does not allow an unrelated domain that merely ends with the allowed host as a substring", async () => {
    // e.g. allowing "github.com" must not also allow "notgithub.com".
    const ctx = createSkillContext({ network: ["github.com"], filesystem: [] });
    await expect(ctx.fetch("https://notgithub.com/")).rejects.toThrow(SkillPermissionError);
  });
});
