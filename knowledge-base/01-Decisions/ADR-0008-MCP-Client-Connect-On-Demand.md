---
tags: [adr, mcp, agents]
created: 2026-07-01
status: accepted
---

# ADR-0008: MCP Servers Connect On Demand, Not Kept Running

## Context

ARCHITECTURE.md section 8 requires Nyxel to act as an MCP client to arbitrary external servers (local stdio processes like `npx @modelcontextprotocol/server-filesystem`, or remote HTTP servers) plus, per ADR-0003, to the planned macOS/Windows companion helper through the same interface. A user can configure any number of MCP servers per workspace, each attachable to any number of agents; most won't be in active use at any given moment, and a stdio server means spawning a child process.

## Decision

`packages/mcp-client`'s `McpClientManager` is a thin, explicit connection pool: `connect(config)` is a no-op if already connected, `disconnect(id)` closes and forgets a client, `listTools`/`callTool` require an existing connection and throw otherwise. Nothing connects automatically on server startup or on `mcpServers.create`. Two call sites decide when a connection is actually needed: `mcpServers.listTools` (the UI's "test connection" button) and `buildToolsForAgent` (`apps/server/src/tools.ts`, called once per chat turn for chats bound to an agent) — both call `ensureMcpServerConnected()` first, which checks `mcpManager.isConnected()` and connects only if not already.

Connections that do succeed are kept open in the process-wide `mcpManager` singleton (`apps/server/src/mcp-runtime.ts`) rather than closed after each use, since MCP `initialize`/stdio process spawn has real latency and a connected server is likely to be reused on the next chat turn or tool-list request.

Unreachable or misconfigured servers fail soft: `buildToolsForAgent` catches connection errors per-server, logs, and continues building the tool set from whatever did connect, rather than failing the whole chat turn over one broken MCP server.

## Consequences

The server process accumulates long-lived child processes/HTTP connections for every MCP server that's ever been used, with no idle-timeout or explicit disconnect path yet beyond `disconnectAll()` (only called nowhere yet, a gap to close before this ships to a always-on server deployment — likely an idle reaper or a disconnect-on-agent-delete hook). This was accepted for Phase 1 in exchange for simplicity: eagerly connecting every configured server up front would mean spawning processes for servers nobody is using, and disconnecting after every call would make a multi-tool-call agent turn pay reconnect latency repeatedly. Namespacing MCP tool names as `${server.name}__${tool.name}` in `buildToolsForAgent` avoids collisions when two attached servers happen to expose a same-named tool.
