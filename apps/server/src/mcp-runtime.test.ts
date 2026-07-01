import assert from "node:assert/strict";
import { afterEach, test } from "bun:test";
import type { McpServerRecord } from "@nyxel/db";
import { completeMcpServerAuthorization, mcpManager } from "./mcp-runtime";

const originalRememberConfig = mcpManager.rememberConfig.bind(mcpManager);
const originalConnect = mcpManager.connect.bind(mcpManager);
const originalCompleteAuthorization = mcpManager.completeAuthorization.bind(mcpManager);

afterEach(() => {
  mcpManager.rememberConfig = originalRememberConfig;
  mcpManager.connect = originalConnect;
  mcpManager.completeAuthorization = originalCompleteAuthorization;
});

test("completeMcpServerAuthorization reuses the pending OAuth session instead of reconnecting", async () => {
  const calls: string[] = [];
  const server: McpServerRecord = {
    id: "server-1",
    workspaceId: "workspace-1",
    name: "Notion",
    transport: "http",
    command: null,
    args: null,
    url: "https://mcp.notion.com/mcp",
    enabled: true,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
  };

  mcpManager.rememberConfig = (config) => {
    calls.push(`remember:${config.id}`);
  };
  mcpManager.connect = async () => {
    calls.push("connect");
  };
  mcpManager.completeAuthorization = async (serverId, authorizationCode) => {
    calls.push(`complete:${serverId}:${authorizationCode}`);
  };

  await completeMcpServerAuthorization(server, "auth-code-123");

  assert.deepEqual(calls, [
    "remember:server-1",
    "complete:server-1:auth-code-123",
  ]);
});