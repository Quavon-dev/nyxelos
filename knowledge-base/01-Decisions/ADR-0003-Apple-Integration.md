---
tags: [adr, local-data, mcp]
created: 2026-07-01
status: accepted
---

# ADR-0003: Access to Local Apple Data (Calendar, Contacts, Photos)

## Context

Hearthloom should get access to local data such as Apple Calendar, Contacts, and Photos, ideally through an installer tool or helper that cleanly requests the necessary macOS permissions. Priority is a native macOS companion helper (focus 1), followed by a CLI/AppleScript bridge, and the solution should be built so that Windows can be supported later.

## Decision

The companion helper is not built as a proprietary side protocol but is itself implemented as an MCP server. On macOS, this is a Swift menu-bar app that uses EventKit, Contacts, and PhotoKit, triggers the normal macOS TCC permission dialogs, and offers MCP tools such as `calendar.list_events`, `contacts.search`, and `photos.search` locally (only on `localhost`, with its own token). Focus 1 is this native variant; a CLI/AppleScript bridge (`osascript`, `icalBuddy`) behind the same tool interface serves as a fallback and faster first pass.

## Rationale

Because both variants (native and CLI fallback) sit behind identical MCP tool signatures, nothing in the Hearthloom core needs to change when later switching from the CLI bridge to the native helper or vice versa. For the server, "my computer" is simply another MCP server in the registry. This also satisfies the Windows requirement: a future Windows companion (via Windows calendar/contacts APIs or Outlook interop) only needs to expose the same tool names under the same protocol to be immediately compatible.

## Consequences

Two companion implementations will exist in the monorepo (`apps/companion-macos`, later `apps/companion-windows`), both implementing the same "local connector" tool schema from `packages/mcp-server`. The native helper takes priority over the CLI bridge; the latter serves as a fallback and faster early prototype.
