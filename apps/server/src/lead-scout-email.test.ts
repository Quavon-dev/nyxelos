import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getDb } from "@nyxel/db";
import { installTestDb } from "@nyxel/db/test-utils";
import {
  sendLeadScoutEmail,
  toClientSafeLeadScoutEmailSettings,
  upsertLeadScoutEmailSettings,
} from "./lead-scout-email";

let ctx: Awaited<ReturnType<typeof installTestDb>>;

beforeEach(async () => {
  ctx = await installTestDb();
});
afterEach(async () => {
  await ctx.cleanup();
});

async function withWorkspace(): Promise<string> {
  const user = await getDb().getOrCreateDemoUser();
  const workspace = await getDb().createWorkspace({ userId: user.id, name: "email-test" });
  return workspace.id;
}

describe("toClientSafeLeadScoutEmailSettings", () => {
  test("strips credentials, exposes hasCredentials boolean", async () => {
    const workspaceId = await withWorkspace();
    const settings = await upsertLeadScoutEmailSettings(workspaceId, {
      fromName: "Acme",
      fromEmail: "acme@example.com",
      credentials: { host: "smtp.example.com", username: "u", password: "s3cret-password" },
    });

    const safe = toClientSafeLeadScoutEmailSettings(settings);
    expect((safe as Record<string, unknown>).credentials).toBeUndefined();
    expect(safe.hasCredentials).toBe(true);
    expect(JSON.stringify(safe)).not.toContain("s3cret-password");
  });

  test("hasCredentials is false when none are configured", async () => {
    const workspaceId = await withWorkspace();
    const settings = await upsertLeadScoutEmailSettings(workspaceId, {
      fromName: "Acme",
      fromEmail: "acme@example.com",
    });
    expect(toClientSafeLeadScoutEmailSettings(settings).hasCredentials).toBe(false);
  });
});

describe("sendLeadScoutEmail dry-run gating", () => {
  test("dry run mode never dispatches, even with no credentials configured", async () => {
    const workspaceId = await withWorkspace();
    await upsertLeadScoutEmailSettings(workspaceId, {
      fromName: "Acme",
      fromEmail: "acme@example.com",
      dryRunMode: true,
    });

    const result = await sendLeadScoutEmail(workspaceId, {
      to: "lead@business.com",
      subject: "Hi",
      text: "body",
    });
    expect(result).toEqual({ sent: false, dryRun: true });
  });

  test("live mode without credentials throws instead of silently succeeding", async () => {
    const workspaceId = await withWorkspace();
    await upsertLeadScoutEmailSettings(workspaceId, {
      fromName: "Acme",
      fromEmail: "acme@example.com",
      dryRunMode: false,
    });

    await expect(
      sendLeadScoutEmail(workspaceId, { to: "lead@business.com", subject: "Hi", text: "body" }),
    ).rejects.toThrow(/configured/);
  });

  test("throws when email settings were never configured", async () => {
    const workspaceId = await withWorkspace();
    await expect(
      sendLeadScoutEmail(workspaceId, { to: "lead@business.com", subject: "Hi", text: "body" }),
    ).rejects.toThrow(/configured/);
  });
});
