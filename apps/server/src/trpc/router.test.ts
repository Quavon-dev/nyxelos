import { describe, expect, test } from "bun:test";
import type {
  KnowledgeBaseConfigRecord,
  McpServerRecord,
  ModelInstallationRecord,
} from "@nyxel/db";
import {
  toClientSafeInstallation,
  toClientSafeKnowledgeBaseConfig,
  toClientSafeMcpServer,
} from "./router";

function makeInstallation(
  overrides: Partial<ModelInstallationRecord> = {},
): ModelInstallationRecord {
  return {
    id: "inst-1",
    workspaceId: "ws-1",
    label: "OpenAI",
    providerKind: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-live-super-secret",
    modelIds: ["gpt-5"],
    disabledModelIds: [],
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("toClientSafeInstallation (SECURITY_AUDIT.md SEC-02)", () => {
  test("never includes the raw apiKey field", () => {
    const safe = toClientSafeInstallation(makeInstallation());
    expect("apiKey" in safe).toBe(false);
    expect(JSON.stringify(safe)).not.toContain("sk-live-super-secret");
  });

  test("reports hasApiKey: true when a key is configured", () => {
    const safe = toClientSafeInstallation(makeInstallation({ apiKey: "sk-live-abc" }));
    expect(safe.hasApiKey).toBe(true);
  });

  test("reports hasApiKey: false when no key is configured", () => {
    const safe = toClientSafeInstallation(makeInstallation({ apiKey: null }));
    expect(safe.hasApiKey).toBe(false);
  });

  test("reports hasApiKey: false for an empty-string key", () => {
    const safe = toClientSafeInstallation(makeInstallation({ apiKey: "" }));
    expect(safe.hasApiKey).toBe(false);
  });

  test("preserves every other field unchanged", () => {
    const installation = makeInstallation();
    const safe = toClientSafeInstallation(installation);
    expect(safe.id).toBe(installation.id);
    expect(safe.workspaceId).toBe(installation.workspaceId);
    expect(safe.label).toBe(installation.label);
    expect(safe.baseUrl).toBe(installation.baseUrl);
    expect(safe.modelIds).toEqual(installation.modelIds);
  });
});

function makeMcpServer(overrides: Partial<McpServerRecord> = {}): McpServerRecord {
  return {
    id: "mcp-1",
    workspaceId: "ws-1",
    name: "GitHub",
    transport: "http",
    command: null,
    args: null,
    url: "https://api.githubcopilot.com/mcp",
    env: { GITHUB_TOKEN: "ghp_live_secret" },
    oauthState: { accessToken: "at-live-secret", refreshToken: "rt-live-secret" },
    enabled: true,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("toClientSafeMcpServer (SECURITY_AUDIT.md SEC-01)", () => {
  test("never includes the raw env or oauthState fields", () => {
    const safe = toClientSafeMcpServer(makeMcpServer());
    expect("env" in safe).toBe(false);
    expect("oauthState" in safe).toBe(false);
    expect(JSON.stringify(safe)).not.toContain("secret");
  });

  test("reports hasEnv/hasOAuthState: true when configured", () => {
    const safe = toClientSafeMcpServer(makeMcpServer());
    expect(safe.hasEnv).toBe(true);
    expect(safe.hasOAuthState).toBe(true);
  });

  test("reports hasEnv/hasOAuthState: false when null or empty", () => {
    const safe = toClientSafeMcpServer(makeMcpServer({ env: null, oauthState: {} }));
    expect(safe.hasEnv).toBe(false);
    expect(safe.hasOAuthState).toBe(false);
  });

  test("preserves every other field unchanged", () => {
    const server = makeMcpServer();
    const safe = toClientSafeMcpServer(server);
    expect(safe.id).toBe(server.id);
    expect(safe.name).toBe(server.name);
    expect(safe.transport).toBe(server.transport);
    expect(safe.enabled).toBe(server.enabled);
  });
});

function makeKnowledgeBaseConfig(
  overrides: Partial<KnowledgeBaseConfigRecord> = {},
): KnowledgeBaseConfigRecord {
  return {
    workspaceId: "ws-1",
    vaultPath: "knowledge-base",
    obsidianRestUrl: "http://127.0.0.1:27124/",
    obsidianApiKey: "obsidian-live-secret",
    docsAgentEnabled: true,
    injectIntoPrompts: true,
    lastDocsSyncAt: null,
    lastDocsSyncError: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("toClientSafeKnowledgeBaseConfig (SECURITY_AUDIT.md SEC-01/SEC-02)", () => {
  test("never includes the raw obsidianApiKey field", () => {
    const safe = toClientSafeKnowledgeBaseConfig(makeKnowledgeBaseConfig());
    expect("obsidianApiKey" in safe).toBe(false);
    expect(JSON.stringify(safe)).not.toContain("obsidian-live-secret");
  });

  test("reports obsidianApiKeySet: true when a key is configured", () => {
    const safe = toClientSafeKnowledgeBaseConfig(makeKnowledgeBaseConfig());
    expect(safe.obsidianApiKeySet).toBe(true);
  });

  test("reports obsidianApiKeySet: false when no key is configured", () => {
    const safe = toClientSafeKnowledgeBaseConfig(makeKnowledgeBaseConfig({ obsidianApiKey: null }));
    expect(safe.obsidianApiKeySet).toBe(false);
  });
});
