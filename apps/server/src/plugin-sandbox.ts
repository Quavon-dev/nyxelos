import { fileURLToPath } from "node:url";
import type { SkillPermissions } from "@nyxel/skills-sdk";

/**
 * A small isolated-execution boundary for `custom_code` tools (ADR-0007) —
 * the one place in the codebase that runs a user-supplied JavaScript string
 * (`tools-dynamic.ts`'s `custom_code` case). Previously that ran via `new
 * Function(...)` directly in the main server process, with the same
 * process-wide access as the server itself (full `process.env`, real
 * `require("node:fs")`/`child_process`, the whole in-memory object graph of
 * whatever closures happened to be reachable) — see
 * docs/PLUGIN_SECURITY.md's "core gap" section. This module is the first,
 * intentionally minimal step toward closing it, not a full rewrite of the
 * skill runtime:
 *
 * - Each call spawns a fresh, short-lived subprocess (`plugin-sandbox-
 *   worker.ts`) with a caller-controlled `env` — the untrusted code's
 *   process never inherits the server's real environment (API keys, DB
 *   connection strings, `NYXEL_ENCRYPTION_KEY`, ...).
 * - Inside that subprocess, the code itself runs in a `node:vm` context
 *   whose only globals are `input` and `ctx` — no `require`, `process`,
 *   `Bun`, or any other ambient Node/Bun API, so a script that ignores
 *   `ctx.*` and tries to reach the filesystem/network/child_process
 *   directly hits a `ReferenceError`, not a working escape hatch.
 * - `ctx` is the same permission-checked context every other skill/tool
 *   gets (`createSkillContext`) — this is the "narrow ctx API" the
 *   sandboxed code communicates through; nothing else crosses the
 *   process boundary except the one-shot init payload and final result.
 *
 * What this does *not* do (documented, not silently implied): the child
 * process is still a full Bun runtime with its own real filesystem/network
 * access outside the vm sandbox — this is process isolation plus a
 * language-level sandbox for the untrusted code specifically, not a kernel-
 * level container/seccomp boundary. A sufficiently advanced `vm` escape is
 * a known theoretical risk class; this raises the bar substantially over
 * same-process `new Function` without claiming to be uncircumventable.
 */

export class PluginSandboxError extends Error {}

const WORKER_SCRIPT_PATH = fileURLToPath(new URL("./plugin-sandbox-worker.ts", import.meta.url));

export interface RunIsolatedCodeOptions {
  /** Hard wall-clock limit for the whole call — the subprocess is killed
   * if it hasn't produced a result by then. Defaults to 30s. */
  timeoutMs?: number;
  /** The *only* environment variables the sandboxed process receives —
   * never `process.env` itself. Defaults to none. */
  env?: Record<string, string>;
  /** Serialized-size cap on the sandboxed code's returned value — a runaway
   * script (e.g. one that reads and returns a huge file via ctx.readFile)
   * shouldn't be able to balloon the caller's memory/DB row/model context
   * just because the process boundary itself succeeded. Defaults to 200KB,
   * matching the order of magnitude other output caps in this codebase use
   * (see safe-fetch.ts's maxResponseBytes). */
  maxOutputChars?: number;
}

const DEFAULT_MAX_OUTPUT_CHARS = 200_000;

/** Caps a sandboxed call's returned value to `maxChars` serialized — see
 * RunIsolatedCodeOptions.maxOutputChars. A value that already fits is
 * returned as-is (not re-serialized/re-parsed) so its original shape/types
 * survive unchanged; only an oversized value is replaced with a truncated
 * string preview. */
function capOutputSize(value: unknown, maxChars: number): unknown {
  let serialized: string;
  try {
    serialized = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return value;
  }
  if (serialized.length <= maxChars) return value;
  return {
    truncated: true,
    originalChars: serialized.length,
    preview: serialized.slice(0, maxChars),
  };
}

function readLines(stream: ReadableStream<Uint8Array>): AsyncIterable<string> {
  async function* generator() {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (line.trim()) yield line;
        newlineIndex = buffer.indexOf("\n");
      }
    }
    if (buffer.trim()) yield buffer;
  }
  return generator();
}

/**
 * Runs `code` (a JS statement list, matching `custom_code`'s existing
 * `new Function("input", "ctx", ...)` contract) in the isolated subprocess
 * described above, and returns its result. Throws `PluginSandboxError` on a
 * script error, a malformed sandbox response, or a timeout.
 */
export async function runIsolatedCustomCode(
  code: string,
  input: unknown,
  permissions: SkillPermissions,
  options: RunIsolatedCodeOptions = {},
): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;

  const proc = Bun.spawn([process.execPath, "run", WORKER_SCRIPT_PATH], {
    env: options.env ?? {},
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdin = proc.stdin;
  if (stdin && typeof stdin !== "number") {
    // flush() before end() matters here: a large custom-code body or input
    // object can easily exceed the pipe's internal buffer, and end() racing
    // an unflushed write silently truncates it (see cli.ts's streamClaudeCli
    // for the same fix applied to CLI-spawned model providers).
    stdin.write(JSON.stringify({ code, input, permissions, timeoutMs }));
    await stdin.flush();
    await stdin.end();
  }

  const timeoutHandle = setTimeout(() => proc.kill(), timeoutMs);
  try {
    for await (const line of readLines(proc.stdout as ReadableStream<Uint8Array>)) {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.type === "done") {
        if (message.ok) return capOutputSize(message.value ?? null, maxOutputChars);
        // Errors come back as plain strings from the worker (see
        // plugin-sandbox-worker.ts's catch) — capped and stripped of any
        // path-shaped detail the sandboxed script's own error might have
        // echoed, so a script that deliberately throws `new
        // Error(JSON.stringify(hugeInternalState))` can't use the error
        // channel to bypass the value-size cap above, and no stack trace
        // (only ever `err.message`, never `err.stack`) ever reaches the
        // caller.
        const rawError =
          typeof message.error === "string" ? message.error : "Sandboxed code failed.";
        throw new PluginSandboxError(
          rawError.length > maxOutputChars
            ? `${rawError.slice(0, maxOutputChars)}… [truncated]`
            : rawError,
        );
      }
    }

    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();
    throw new PluginSandboxError(
      `Sandbox process exited (code ${exitCode}) without a result.${
        stderr.trim() ? ` stderr: ${stderr.trim()}` : ""
      }`,
    );
  } finally {
    clearTimeout(timeoutHandle);
    proc.kill();
  }
}
