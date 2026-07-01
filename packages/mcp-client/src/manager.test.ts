import assert from "node:assert/strict";
import { test } from "bun:test";
import { McpClientManager } from "./manager";

type ManagerInternals = {
	oauthProviders: Map<
		string,
		{
			saveCodeVerifier(codeVerifier: string): void;
			redirectToAuthorization(authorizationUrl: URL): void;
		}
	>;
};

test("completeAuthorization exchanges the callback code without reconnecting", async () => {
	const exchanged: Array<{
		serverUrl: string;
		authorizationCode: string;
	}> = [];

	const manager = new McpClientManager(async (provider, input) => {
		void provider;
		exchanged.push({
			serverUrl: String(input.serverUrl),
			authorizationCode: input.authorizationCode ?? "",
		});
		return "AUTHORIZED";
	});

	const config = {
		id: "server-1",
		name: "Notion",
		transport: "http" as const,
		url: "https://example.com/mcp",
		oauth: {
			callbackUrl:
				"http://localhost:3000/mcp-auth/callback?serverId=server-1&workspaceId=workspace-1",
			clientName: "Nyxel · Notion",
		},
	};

	manager.rememberConfig(config);
	const provider = (manager as unknown as ManagerInternals).oauthProviders.get(
		config.id,
	);
	provider?.saveCodeVerifier("pkce-verifier");
	provider?.redirectToAuthorization(new URL("https://example.com/authorize"));

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

test("completeAuthorization asks to restart sign-in when PKCE state is missing", async () => {
	const manager = new McpClientManager(async () => {
		throw new Error("exchange should not run without PKCE state");
	});

	const config = {
		id: "server-2",
		name: "Notion",
		transport: "http" as const,
		url: "https://example.com/mcp",
		oauth: {
			callbackUrl:
				"http://localhost:3000/mcp-auth/callback?serverId=server-2&workspaceId=workspace-1",
			clientName: "Nyxel · Notion",
		},
	};

	manager.rememberConfig(config);

	await assert.rejects(
		manager.completeAuthorization(config.id, "auth-code-456"),
		/has no pending OAuth session\. Start sign-in again from Nyxel\./,
	);
});

test("completeAuthorization times out when the OAuth exchange hangs", async () => {
	const manager = new McpClientManager(
		() => new Promise<"AUTHORIZED">(() => undefined),
		20,
	);

	const config = {
		id: "server-3",
		name: "Notion",
		transport: "http" as const,
		url: "https://example.com/mcp",
		oauth: {
			callbackUrl:
				"http://localhost:3000/mcp-auth/callback?serverId=server-3&workspaceId=workspace-1",
			clientName: "Nyxel · Notion",
		},
	};

	manager.rememberConfig(config);
	const provider = (manager as unknown as ManagerInternals).oauthProviders.get(
		config.id,
	);
	provider?.saveCodeVerifier("pkce-verifier");
	provider?.redirectToAuthorization(new URL("https://example.com/authorize"));

	const startedAt = Date.now();
	await assert.rejects(
		manager.completeAuthorization(config.id, "auth-code-789"),
		/did not finish OAuth sign-in within 0\.02 seconds\. Retry the connection from Nyxel\./,
	);
	assert.ok(Date.now() - startedAt < 1000);
});
