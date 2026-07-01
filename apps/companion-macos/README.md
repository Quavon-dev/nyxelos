# Nyxel macOS Companion

Local MCP server for macOS data access. It exposes:

- `companion.status`
- `calendar.list_events`
- `contacts.search`
- `photos.search`

Backend selection:

- `native` bridge: Swift helper using EventKit, Contacts.framework, and PhotoKit
- `fallback` bridge: AppleScript/Spotlight-based access behind the same MCP tools
- `auto` (default): prefer native, fall back automatically when the Swift bridge is not built

## Build the native bridge

```bash
npm install --prefix apps/companion-macos --package-lock=false
swift build --package-path apps/companion-macos/native -c release
```

## Run the MCP server locally

```bash
node --experimental-strip-types apps/companion-macos/src/index.ts
```

Force the fallback backend:

```bash
env NYXEL_COMPANION_BACKEND=fallback \
  node --experimental-strip-types apps/companion-macos/src/index.ts
```

## Register in Nyxel

Use the existing MCP server UI and add a `stdio` server:

- Name: `My Mac`
- Command: `node`
- Arguments: `--experimental-strip-types /ABSOLUTE/PATH/TO/apps/companion-macos/src/index.ts`

If you want the fallback backend explicitly:

- Command: `env`
- Arguments: `NYXEL_COMPANION_BACKEND=fallback node --experimental-strip-types /ABSOLUTE/PATH/TO/apps/companion-macos/src/index.ts`

The first tool call may trigger macOS permission dialogs for Calendar, Contacts, or Photos.
