import vm from "node:vm";
import { createSkillContext } from "@nyxel/skills-sdk";

/**
 * The isolated-execution boundary's child-process entrypoint (ADR-0007) —
 * see plugin-sandbox.ts for the parent side and the full design rationale.
 * Spawned fresh for every `custom_code` call, with a caller-controlled
 * (never inherited) `env`, so the untrusted code's process never has access
 * to the main server process's environment (API keys, DB connection
 * strings, `NYXEL_ENCRYPTION_KEY`, etc.) regardless of what it does.
 *
 * The untrusted code itself runs inside a `node:vm` context whose globals
 * are exactly `{ input, ctx }` — no `require`, no `process`, no `Bun`, no
 * ambient Node/Bun globals of any kind. `ctx` is the same permission-
 * checked skill context every other skill/tool gets (`createSkillContext`),
 * rebuilt here from the `permissions` handed to this process at startup —
 * this process never receives the *server's* secrets, only the one skill's
 * declared network/filesystem allowlist, which was already public
 * information (visible in the tool's own config).
 */

interface InitMessage {
  code: string;
  input: unknown;
  permissions: { network: string[]; filesystem: string[] };
  timeoutMs: number;
}

function readStdin(): Promise<string> {
  return new Response(Bun.stdin.stream()).text();
}

function send(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function main(): Promise<void> {
  const raw = await readStdin();
  let init: InitMessage;
  try {
    init = JSON.parse(raw) as InitMessage;
  } catch {
    send({ type: "done", ok: false, error: "Sandbox worker received malformed init payload." });
    return;
  }

  const ctx = createSkillContext(init.permissions);
  const sandbox = vm.createContext({
    input: init.input,
    ctx,
    Promise,
    JSON,
    Math,
    Date,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Error,
    RegExp,
    setTimeout,
    clearTimeout,
  });

  try {
    const script = new vm.Script(`(async () => {\n${init.code}\n})()`);
    const resultPromise = script.runInContext(sandbox, { timeout: init.timeoutMs });
    const value = await resultPromise;
    send({ type: "done", ok: true, value: value === undefined ? null : value });
  } catch (err) {
    send({ type: "done", ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

main()
  .catch((err) => {
    send({ type: "done", ok: false, error: err instanceof Error ? err.message : String(err) });
  })
  .finally(() => {
    process.exit(0);
  });
