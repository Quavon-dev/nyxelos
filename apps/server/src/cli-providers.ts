/** Auth/login plumbing for the local claude_cli/codex_cli model providers
 * (see packages/model-providers/src/cli.ts for the actual streaming
 * adapter). Login state (`~/.claude`, `~/.codex/auth.json`) lives on this
 * server host's OS user, not per-workspace — every workspace on this
 * install shares one Claude-CLI login and one Codex-CLI login. That's
 * consistent with the confirmed self-hosted/single-admin deployment model,
 * not a multi-tenant SaaS assumption. */

export type CliProviderKind = "claude_cli" | "codex_cli";

export type CliAuthStatusKind = "not_installed" | "needs_login" | "connected" | "error";

export interface CliAuthStatus {
	status: CliAuthStatusKind;
	binaryPath: string | null;
	message?: string;
}

function binaryNameFor(kind: CliProviderKind): string {
	return kind === "claude_cli" ? "claude" : "codex";
}

export function getCliBinaryPath(kind: CliProviderKind): string | null {
	return Bun.which(binaryNameFor(kind)) ?? null;
}

const NEEDS_LOGIN_PATTERN = /not logged in|please (run|log ?in)|unauthorized|authentication required|no credentials/i;

/** Spawns a short, cheap probe command and classifies the result. Exact
 * flags/output are best-effort against the CLI's documented headless mode —
 * verify against whatever version is actually installed; worst case this
 * reports "error" with the raw output rather than crashing. */
export async function checkCliAuthStatus(kind: CliProviderKind): Promise<CliAuthStatus> {
	const binaryPath = getCliBinaryPath(kind);
	if (!binaryPath) return { status: "not_installed", binaryPath: null };

	const args =
		kind === "claude_cli"
			? ["-p", "ping", "--output-format", "json", "--max-turns", "1"]
			: ["login", "status"];

	let proc: ReturnType<typeof Bun.spawn>;
	try {
		proc = Bun.spawn([binaryPath, ...args], {
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});
	} catch (err) {
		return {
			status: "error",
			binaryPath,
			message: err instanceof Error ? err.message : String(err),
		};
	}

	const TIMEOUT_MS = 15_000;
	const timedOut = await Promise.race([
		proc.exited.then(() => false),
		new Promise<boolean>((resolve) => setTimeout(() => resolve(true), TIMEOUT_MS)),
	]);
	if (timedOut) {
		proc.kill();
		return { status: "error", binaryPath, message: "Timed out checking auth status." };
	}

	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
		new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
		proc.exited,
	]);
	const combined = `${stdout}\n${stderr}`;

	if (NEEDS_LOGIN_PATTERN.test(combined)) {
		return { status: "needs_login", binaryPath };
	}
	if (exitCode === 0) {
		return { status: "connected", binaryPath };
	}
	return { status: "error", binaryPath, message: combined.trim().slice(0, 500) || `exit code ${exitCode}` };
}

export type CliLoginStatus = "running" | "exited";

interface CliLoginSession {
	proc: ReturnType<typeof Bun.spawn>;
	output: string;
	status: CliLoginStatus;
	exitCode: number | null;
	url: string | null;
}

const loginSessions = new Map<string, CliLoginSession>();
let nextLoginId = 1;

async function pumpLoginStream(session: CliLoginSession, stream: ReadableStream<Uint8Array>) {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		session.output += decoder.decode(value, { stream: true });
		if (!session.url) {
			const match = session.output.match(/https?:\/\/\S+/);
			if (match) session.url = match[0].replace(/[)\].,]+$/, "");
		}
	}
}

/** Starts `claude login` / `codex login` (or `codex login --api-key <key>`
 * for the API-key variant) and buffers its output for polling. Both CLIs'
 * login flows print a URL to visit and/or open a browser directly; the
 * server can't drive that browser step itself, so the frontend polls
 * `getCliLoginOutput()` and surfaces the extracted URL as a click-through
 * link. Note: an API key passed via `--api-key` is visible in this
 * process's argv (e.g. to other processes via `ps`) for the short lifetime
 * of the login command — acceptable on the confirmed trusted, single-admin
 * host this is designed for, not on a shared multi-user box. */
export function startCliLogin(kind: CliProviderKind, apiKey?: string): { execId: string } {
	const binaryPath = getCliBinaryPath(kind);
	if (!binaryPath) {
		throw new Error(`${binaryNameFor(kind)} is not installed (or not on PATH) on this server host.`);
	}

	const args =
		kind === "codex_cli" && apiKey ? ["login", "--api-key", apiKey] : ["login"];

	const proc = Bun.spawn([binaryPath, ...args], {
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});

	const execId = `cli_login_${nextLoginId++}`;
	const session: CliLoginSession = {
		proc,
		output: "",
		status: "running",
		exitCode: null,
		url: null,
	};
	loginSessions.set(execId, session);

	void pumpLoginStream(session, proc.stdout as ReadableStream<Uint8Array>);
	void pumpLoginStream(session, proc.stderr as ReadableStream<Uint8Array>);
	void proc.exited.then((exitCode) => {
		session.status = "exited";
		session.exitCode = exitCode;
	});

	return { execId };
}

export interface CliLoginOutput {
	status: CliLoginStatus;
	exitCode: number | null;
	output: string;
	url: string | null;
}

export function getCliLoginOutput(execId: string): CliLoginOutput {
	const session = loginSessions.get(execId);
	if (!session) throw new Error(`Unknown CLI login session: ${execId}`);
	return {
		status: session.status,
		exitCode: session.exitCode,
		output: session.output.slice(-4000),
		url: session.url,
	};
}
