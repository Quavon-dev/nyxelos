# ✨ NyxelOS: The Agentic Operating System 🧠

NyxelOS is not just another app; it's a fully open-source, self-hosted agentic OS designed to bring your local and cloud AI models into a single, cohesive interface. Think of it as unifying your digital existence: local servers, cloud services, autonomous agents, and knowledge base—all in one place.

🛡️ **Local-First & Open Source** 🌐
Run NyxelOS entirely on your hardware or deploy it across a server cluster. Full control, full privacy. Contributors are welcome!

---
### 🚀 Core Principles of NyxelOS
*   **🧠 Agentic Autonomy:** Beyond simple chat. Our system supports normal chats, advanced autonomous agents, and Super-Agents capable of complex tasks.
*   **🌳 Local-First:** Usable offline once the local model ecosystem is running. Your data stays yours.
*   **🧱 Modularity:** Swappable components—models, skills, MCP servers, and databases. Everything plugs into the robust core.
*   **🎨 Consistent UI:** A clean, predictable experience powered by `shadcn/ui`.
*   **🎬 AI Video Generation:** Prompt a video right from chat or the Video Studio page — Nyxel auto-picks the model, aspect ratio, and clip length from your wording (or you choose yourself), then plays it back, lets you trim/mute/speed/GIF it, and files it straight into the Library.
*   **🎙️ Local Voice Input:** Dictate messages with a Whisper model running entirely in your browser (WebGPU, WASM fallback — via transformers.js). Audio never leaves your machine, works in every modern browser, in any Whisper language.
*   **💭 Extended Thinking:** Flip the "Nachdenken" toggle in the composer and supported models (Anthropic extended thinking, OpenAI reasoning) think before they answer — the reasoning streams live into a collapsible panel, and unattended task runs think by default.
*   **📋 Live Task Board:** The Tasks page surfaces what's running right now (live output tail, elapsed time, stop button) and what needs your attention (agent questions, pending approvals) — and background runs log every tool call to the task timeline.

### 🛠️ Tech Stack at a Glance
*   **Backend:** Bun runtime, Hono, tRPC. The intelligence layer.
*   **Frontend:** React, TanStack Start/Query, `shadcn/ui`. The visual interface.
*   **Data:** Drizzle ORM layer supporting PostgreSQL (Server Mode) or SQLite (PC/Dev Mode).
*   **Connectivity:** Vercel AI SDK & Official MCP TypeScript SDK for seamless model and tool integration.

---
### 📖 Getting Started & Deployment Modes

#### 🚀 Just want to run it? `npx create-nyxel`
No checkout, no build toolchain — this pulls the published `ghcr.io/quavon-dev/nyxelos-*` images and writes only the Docker Compose files you need to run NyxelOS.
```bash
npx create-nyxel
# or: bunx create-nyxel

cd nyxel
docker compose up -d
```
See [`packages/create-nyxel`](packages/create-nyxel) for all options (`--mode`, `--dir`, `--tag`, `--domain`, ...).

> 💡 Everything below this point (`git clone`, `bun install`, `docker compose -f docker-compose.*.yml up --build`) is the **development** workflow — building from source. Use it if you're contributing to NyxelOS, not just running it.

#### 💻 Local Development (Dev Machines / Quick Test)
Ideal for development and personal testing without Docker. Requires [Bun](https://bun.sh) 1.3+.
```bash
git clone https://github.com/Quavon-dev/nyxelos.git
cd nyxelos
bun install

# Setup environment files
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env.local

bun dev # Start both server and web interfaces
```
> 💡 **Tip:** For models to show up automatically, run Ollama or LM Studio beforehand. API keys can also be configured in `apps/server/.env`.
> 🎬 **Video generation** needs an OpenAI provider with an API key installed under **Settings → Model Providers** (Sora 2 / Sora 2 Pro). **Video editing** (trim/concat/mute/speed/GIF) shells out to `ffmpeg`, so install it on the server host — it isn't bundled.

#### 🍎 macOS Companion Server (Phase 4)
Give Nyxel access to your local ecosystem! The `apps/companion-macos` package functions as a dedicated MCP server for deep integration with:
*   📅 Calendar Events
*   📞 Contacts
*   🖼️ Photo Search
*   🔔 Reminders

This is the bridge between AI and your desktop life. Full detail in [`apps/companion-macos/README.md`](apps/companion-macos/README.md).

#### 🐳 Building the Docker Images From Source (PC Mode / Server Mode)
Prefer to build from this checkout instead of using the published images? Same compose files, with `--build`:

**🖥️ PC Mode (Testing/Home Server):**
```bash
cp .env.example .env   # then set BETTER_AUTH_SECRET and NYXEL_ENCRYPTION_KEY —
                        # openssl rand -base64 32 for each (two different values)
docker compose -f docker-compose.pc.yml up --build
```
Both compose files refuse to start without real values for these — see [`docs/DEPLOYMENT_HARDENING.md`](docs/DEPLOYMENT_HARDENING.md). Access at `http://localhost:3000`.

**🌐 Server Mode (Production/Uptime):**
```bash
cp .env.example .env   # Set NYXEL_DOMAIN, POSTGRES_PASSWORD, BETTER_AUTH_SECRET,
                        # NYXEL_ENCRYPTION_KEY, etc.
docker compose -f docker-compose.server.yml up --build -d
```
Access at `https://NYXEL_DOMAIN`. Caddy handles TLS certificates, health checks (`/healthz`), and routing.

---
### 🖼️ Screenshots

| First-run setup | Overview dashboard |
| --- | --- |
| ![First-run setup wizard](docs/screenshots/setup-wizard.png) | ![Overview dashboard](docs/screenshots/overview-dashboard.png) |

| Chat | Workspace settings |
| --- | --- |
| ![Chat interface](docs/screenshots/chat.png) | ![Workspace settings](docs/screenshots/workspace-settings.png) |

| Agents | Skills catalog |
| --- | --- |
| ![Agents](docs/screenshots/agents.png) | ![Skills catalog](docs/screenshots/skills.png) |

| Document & Image Library | Folder navigation |
| --- | --- |
| ![Document & Image Library](docs/screenshots/library-overview.png) | ![Library folder navigation](docs/screenshots/library-folder.png) |

| Video Studio | Auto mode — model/aspect/length picked from the prompt |
| --- | --- |
| ![Video Studio](docs/screenshots/video-studio.png) | ![Video generation with auto-selected model, aspect ratio, and length](docs/screenshots/video-studio-generation.png) |

| Video playback in the Library | Generate/Edit video tools |
| --- | --- |
| ![Video playback in the Library](docs/screenshots/library-video-playback.png) | ![Generate video and Edit video tools in the Tools catalog](docs/screenshots/tools-video-catalog.png) |

| Rich markdown + live agent thinking | Local Whisper dictation (recording) |
| --- | --- |
| ![Chat with syntax highlighting, agent thinking panel, and tool steps](docs/screenshots/chat-markdown-thinking.png) | ![KaTeX math, GFM task lists, and the in-browser Whisper mic recording](docs/screenshots/voice-recording.png) |

| Live task board | |
| --- | --- |
| ![Tasks page with live activity, needs-attention strip, and running stats](docs/screenshots/tasks-live-board.png) | |

#### 📊 Detailed statistics

The Overview dashboard tracks token usage, spend, and generation activity per workspace — tokens
and estimated cost over time, per-model and per-tool breakdowns, code/lines generated, thinking
time, cache savings, tool success rate, and agent-run outcomes — rendered with `shadcn/ui` charts
(area, donut, stacked bar, radar, and radial gauge) over a selectable 7/30/90-day window.

![Detailed statistics — token usage, cost, and generation KPIs](docs/screenshots/detailed-stats.png)

![Detailed statistics — model usage, tool usage, and content-generation charts](docs/screenshots/detailed-stats-charts.png)

---
### 📂 Project Structure Deep Dive
```
apps/
  web/: Frontend UI (Next.js, shadcn/ui) 🎨
  server/: Core Agent Engine (Bun, Hono, tRPC) 🔥
  companion-macos/: Local macOS Data MCP Server (Phase 4 integration) 🍎

packages/
  db/: Drizzle Schema & Repository Layer (Postgres/SQLite) 🗄️
  model-providers/: Handles routing between local and cloud AI models. ☁️⚡️
  create-nyxel/: The `npx create-nyxel` / `bunx create-nyxel` setup CLI. 🚀
```

### ⚙️ Development Tools
*   **DB Migration:** Use `bun run db:generate` and `bun run db:migrate`.
*   **Knowledge Base:** All documentation lives in the Obsidian vault, automatically synced via ADR-0013.

### 🤖 CI/CD
*   **Pull requests:** lint, typecheck, and build run on every PR (`.github/workflows/ci.yml`), alongside a conventional-commit PR title check, CodeQL analysis, and a dependency review.
*   **Docker images:** `apps/server` and `apps/web` are built on every PR (validation only) and pushed to `ghcr.io/quavon-dev/nyxelos-server` / `nyxelos-web` on merges to `main` and version tags (`.github/workflows/docker.yml`).
*   **`create-nyxel`:** built and smoke-tested on every PR, published to npm on `create-nyxel@<version>` tags (`.github/workflows/package.yml`).

🔗 **Architecture Plan:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
🔗 **Installation Guide:** [`docs/INSTALL.md`](docs/INSTALL.md)
🔗 **Obsidian Knowledge Base:** [`knowledge-base/`](knowledge-base/)