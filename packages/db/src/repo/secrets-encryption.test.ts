import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createTestSqliteRepository, createTestUser } from "../test-utils";
import type { DbRepository } from "./types";

function writeRawColumn(
  path: string,
  table: string,
  column: string,
  value: string,
  where: { column: string; value: string },
): void {
  const sqlite = new Database(path);
  try {
    sqlite
      .query(`UPDATE ${table} SET ${column} = ? WHERE ${where.column} = ?`)
      .run(value, where.value);
  } finally {
    sqlite.close();
  }
}

let ctx: Awaited<ReturnType<typeof createTestSqliteRepository>>;
let db: DbRepository;

beforeEach(async () => {
  ctx = await createTestSqliteRepository();
  db = ctx.db;
});

afterEach(async () => {
  await ctx.cleanup();
});

function readRawColumn(
  path: string,
  table: string,
  column: string,
  where: { column: string; value: string },
): unknown {
  const sqlite = new Database(path);
  try {
    const row = sqlite
      .query(`SELECT ${column} FROM ${table} WHERE ${where.column} = ?`)
      .get(where.value) as Record<string, unknown> | undefined;
    return row?.[column];
  } finally {
    sqlite.close();
  }
}

describe("secrets are encrypted at rest (SECURITY_AUDIT.md SEC-01)", () => {
  test("modelInstallation.apiKey is stored encrypted, decrypted on read", async () => {
    const user = createTestUser(ctx.path);
    const workspace = await db.createWorkspace({ userId: user.id, name: "Test workspace" });
    const installation = await db.createModelInstallation({
      workspaceId: workspace.id,
      label: "OpenAI",
      providerKind: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-live-super-secret",
      modelIds: ["gpt-5"],
    });

    const raw = readRawColumn(ctx.path, "model_installation", "api_key", {
      column: "id",
      value: installation.id,
    });
    expect(raw).not.toBe("sk-live-super-secret");
    expect(String(raw)).toStartWith("v1:");

    const fetched = await db.getModelInstallation(installation.id);
    expect(fetched?.apiKey).toBe("sk-live-super-secret");
  });

  test("knowledgeBaseConfig.obsidianApiKey is stored encrypted, decrypted on read", async () => {
    const user = createTestUser(ctx.path);
    const workspace = await db.createWorkspace({ userId: user.id, name: "Test workspace" });
    await db.upsertKnowledgeBaseConfig({
      workspaceId: workspace.id,
      vaultPath: "knowledge-base",
      obsidianApiKey: "obsidian-live-secret",
    });

    const raw = readRawColumn(ctx.path, "knowledge_base_config", "obsidian_api_key", {
      column: "workspace_id",
      value: workspace.id,
    });
    expect(raw).not.toBe("obsidian-live-secret");
    expect(String(raw)).toStartWith("v1:");

    const fetched = await db.getKnowledgeBaseConfig(workspace.id);
    expect(fetched?.obsidianApiKey).toBe("obsidian-live-secret");
  });

  test("mcpServer.env is stored encrypted, decrypted on read", async () => {
    const user = createTestUser(ctx.path);
    const workspace = await db.createWorkspace({ userId: user.id, name: "Test workspace" });
    const server = await db.createMcpServer({
      workspaceId: workspace.id,
      name: "Local stdio server",
      transport: "stdio",
      command: "npx",
      args: ["some-mcp-server"],
      env: { API_TOKEN: "env-live-secret" },
    });

    const raw = readRawColumn(ctx.path, "mcp_server", "env", {
      column: "id",
      value: server.id,
    });
    expect(String(raw)).not.toContain("env-live-secret");
    expect(String(raw)).toStartWith("v1:");

    const fetched = await db.getMcpServer(server.id);
    expect(fetched?.env).toEqual({ API_TOKEN: "env-live-secret" });
  });

  test("mcpServer.oauthState is stored encrypted, decrypted on read", async () => {
    const user = createTestUser(ctx.path);
    const workspace = await db.createWorkspace({ userId: user.id, name: "Test workspace" });
    const server = await db.createMcpServer({
      workspaceId: workspace.id,
      name: "Remote http server",
      transport: "http",
      url: "https://example.test/mcp",
    });
    await db.updateMcpServerOAuthState(server.id, {
      accessToken: "at-live-secret",
      refreshToken: "rt-live-secret",
    });

    const raw = readRawColumn(ctx.path, "mcp_server", "oauth_state", {
      column: "id",
      value: server.id,
    });
    expect(String(raw)).not.toContain("at-live-secret");
    expect(String(raw)).not.toContain("rt-live-secret");
    expect(String(raw)).toStartWith("v1:");

    const fetched = await db.getMcpServer(server.id);
    expect(fetched?.oauthState).toEqual({
      accessToken: "at-live-secret",
      refreshToken: "rt-live-secret",
    });
  });

  test("mcpServer.env round-trips null (stdio servers with no extra env)", async () => {
    const user = createTestUser(ctx.path);
    const workspace = await db.createWorkspace({ userId: user.id, name: "Test workspace" });
    const server = await db.createMcpServer({
      workspaceId: workspace.id,
      name: "No-env server",
      transport: "http",
      url: "https://example.test/mcp",
    });

    const fetched = await db.getMcpServer(server.id);
    expect(fetched?.env).toBeNull();
    expect(fetched?.oauthState).toBeNull();
  });

  test("leadScoutSourceConfig.apiKey is stored encrypted, decrypted on read", async () => {
    const user = createTestUser(ctx.path);
    const workspace = await db.createWorkspace({ userId: user.id, name: "Test workspace" });
    const config = await db.upsertLeadScoutSourceConfig({
      workspaceId: workspace.id,
      provider: "google_places_api",
      apiKey: "places-live-secret",
    });

    const raw = readRawColumn(ctx.path, "lead_scout_source_config", "api_key", {
      column: "id",
      value: config.id,
    });
    expect(raw).not.toBe("places-live-secret");
    expect(String(raw)).toStartWith("v1:");

    const fetched = await db.getLeadScoutSourceConfig(workspace.id, "google_places_api");
    expect(fetched?.apiKey).toBe("places-live-secret");
  });

  test("leadScoutEmailSettings.credentials is stored encrypted, decrypted on read", async () => {
    const user = createTestUser(ctx.path);
    const workspace = await db.createWorkspace({ userId: user.id, name: "Test workspace" });
    const settings = await db.upsertLeadScoutEmailSettings({
      workspaceId: workspace.id,
      fromName: "Acme",
      fromEmail: "acme@example.com",
      credentials: { host: "smtp.example.com", password: "smtp-live-secret" },
    });

    const raw = readRawColumn(ctx.path, "lead_scout_email_settings", "credentials", {
      column: "id",
      value: settings.id,
    });
    expect(String(raw)).not.toContain("smtp-live-secret");
    expect(String(raw)).toStartWith("v1:");

    const fetched = await db.getLeadScoutEmailSettings(workspace.id);
    expect(fetched?.credentials).toEqual({
      host: "smtp.example.com",
      password: "smtp-live-secret",
    });
  });

  test("a corrupted oauth_state column value fails closed instead of returning garbage", async () => {
    const user = createTestUser(ctx.path);
    const workspace = await db.createWorkspace({ userId: user.id, name: "Test workspace" });
    const server = await db.createMcpServer({
      workspaceId: workspace.id,
      name: "Remote http server",
      transport: "http",
      url: "https://example.test/mcp",
    });
    await db.updateMcpServerOAuthState(server.id, { accessToken: "at-live-secret" });

    // Simulate bit-rot/truncation/a hand-edited row — not a value encrypt()
    // ever produced.
    writeRawColumn(ctx.path, "mcp_server", "oauth_state", "v1:corrupted:not:valid", {
      column: "id",
      value: server.id,
    });

    await expect(db.getMcpServer(server.id)).rejects.toThrow();
  });
});
