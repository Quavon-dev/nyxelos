import assert from "node:assert/strict";
import { test } from "bun:test";
import { McpClientManager } from "./manager";

test("completeAuthorization exchanges the callback code without reconnecting", async () => {
  const exchanged: Array<{
    serverUrl: string;
    authorizationCode: string;
  }> = [];

  const manager = new McpClientManager(async (provider, input) => {
    exchanged.push({
      serverUrl: String(input.serverUrl),
      authorizationCode: input.authorizationCode ?? "",
    });
    return { accessToken: "fake" } as any;
  });

  const config = {
    id: "server-1",
    name: "Notion",
    transport: "http" as const,
    url: "https://example.com/mcp",
    oauth: {
      callbackUrl: "http://localhost:3000/mcp-auth/callback?serverId=server-1&workspaceId=workspace-1",
      clientName: "Nyxel · Notion",
    },
  };

  (manager as any).configs.set(config.id, config);

  let connectCalled = false;
  manager.connect = async () => {
    connectCalled = true;
  };

  await manager.completeAuthorization(config.id, "auth-code-123");

  assert.equal(connectCalled, false);
  assert.deepEqual(exchanged, [
    {
      serverUrl: "https://example.com/mcp",
      authorizationCode: "auth-code-123",
    },
  ]);
});
