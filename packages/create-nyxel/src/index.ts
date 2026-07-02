#!/usr/bin/env node
// create-nyxel — sets up NyxelOS *for use*, via the published Docker images.
//
// This is intentionally not the developer workflow. Building Nyxel from
// source (`git clone` + `bun install` + `bun dev`) is documented in the
// project README for contributors. This CLI writes only the handful of
// files a Docker Compose deployment needs (compose file, .env, Caddyfile)
// and never touches application source.
import { randomBytes } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import {
  CADDYFILE,
  type RenderOptions,
  renderPcCompose,
  renderPcEnv,
  renderServerCompose,
  renderServerEnv,
} from "./templates.js";

const DEFAULT_REGISTRY = "ghcr.io/quavon-dev";
const VERSION = "0.1.0";

interface Options {
  mode: "pc" | "server" | null;
  dir: string;
  tag: string;
  domain: string;
  acmeEmail: string;
  yes: boolean;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    mode: null,
    dir: "nyxel",
    tag: "latest",
    domain: "nyxel.example.com",
    acmeEmail: "",
    yes: false,
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    const [flag, inlineValue] = splitFlag(arg);
    const next = () => inlineValue ?? argv[++i];

    switch (flag) {
      case "-h":
      case "--help":
        opts.help = true;
        break;
      case "-v":
      case "--version":
        opts.version = true;
        break;
      case "-y":
      case "--yes":
        opts.yes = true;
        break;
      case "--mode": {
        const value = next();
        if (value !== "pc" && value !== "server") {
          throw new Error(`--mode must be "pc" or "server", got "${value}"`);
        }
        opts.mode = value;
        break;
      }
      case "--dir":
        opts.dir = next() ?? opts.dir;
        break;
      case "--tag":
        opts.tag = next() ?? opts.tag;
        break;
      case "--domain":
        opts.domain = next() ?? opts.domain;
        break;
      case "--acme-email":
        opts.acmeEmail = next() ?? opts.acmeEmail;
        break;
      default:
        if (flag.startsWith("-")) {
          throw new Error(`Unknown option: ${flag}`);
        }
    }
  }

  return opts;
}

function splitFlag(arg: string): [string, string | undefined] {
  const eq = arg.indexOf("=");
  if (arg.startsWith("--") && eq !== -1) {
    return [arg.slice(0, eq), arg.slice(eq + 1)];
  }
  return [arg, undefined];
}

function printHelp() {
  console.log(`create-nyxel — set up NyxelOS for use (no source checkout required)

Usage:
  npx create-nyxel [options]
  bunx create-nyxel [options]

Options:
  --mode <pc|server>   Deployment mode (skips the interactive prompt)
  --dir <path>         Directory to write into (default: ./nyxel)
  --tag <tag>          Image tag to deploy (default: latest)
  --domain <domain>    Server mode only — public domain for TLS (Caddy)
  --acme-email <email> Server mode only — ACME account email for Caddy
  -y, --yes            Accept defaults, skip interactive prompts
  -v, --version        Print the CLI version
  -h, --help           Show this help

This only writes a docker-compose.yml, .env, and (server mode) a Caddyfile
that pull prebuilt images from ${DEFAULT_REGISTRY}. It does not clone the
NyxelOS repository or install any application source.

Want to develop NyxelOS instead? See:
  https://github.com/Quavon-dev/nyxelos#-getting-started--deployment-modes
`);
}

async function prompt(rl: ReturnType<typeof createInterface>, question: string, fallback: string) {
  const answer = (await rl.question(question)).trim();
  return answer === "" ? fallback : answer;
}

async function resolveOptionsInteractively(opts: Options): Promise<Options> {
  if (opts.yes) {
    return { ...opts, mode: opts.mode ?? "pc" };
  }

  const rl = createInterface({ input, output });
  try {
    let mode = opts.mode;
    if (!mode) {
      const answer = await prompt(
        rl,
        "Deployment mode — pc (single machine, SQLite) or server (own domain, Postgres + TLS)? [pc]: ",
        "pc",
      );
      mode = answer.toLowerCase().startsWith("s") ? "server" : "pc";
    }

    const dir = await prompt(rl, `Directory to set up in? [${opts.dir}]: `, opts.dir);

    let domain = opts.domain;
    let acmeEmail = opts.acmeEmail;
    if (mode === "server") {
      domain = await prompt(
        rl,
        `Public domain (Caddy will request TLS for it)? [${domain}]: `,
        domain,
      );
      acmeEmail = await prompt(rl, "ACME account email (optional): ", acmeEmail);
    }

    return { ...opts, mode, dir, domain, acmeEmail };
  } finally {
    rl.close();
  }
}

async function ensureEmptyDir(dir: string) {
  await mkdir(dir, { recursive: true });
  const entries = await readdir(dir);
  if (entries.length > 0) {
    throw new Error(
      `"${dir}" is not empty. Choose an empty directory with --dir, or remove its contents first.`,
    );
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    printHelp();
    return;
  }
  if (opts.version) {
    console.log(VERSION);
    return;
  }

  const resolved = await resolveOptionsInteractively(opts);
  const mode = resolved.mode ?? "pc";
  const dir = resolve(process.cwd(), resolved.dir);

  await ensureEmptyDir(dir);

  const renderOpts: RenderOptions = {
    serverImage: `${DEFAULT_REGISTRY}/nyxelos-server:${resolved.tag}`,
    webImage: `${DEFAULT_REGISTRY}/nyxelos-web:${resolved.tag}`,
    betterAuthSecret: randomBytes(32).toString("hex"),
    domain: resolved.domain,
    postgresPassword: randomBytes(16).toString("hex"),
    acmeEmail: resolved.acmeEmail,
  };

  const files: Array<[string, string]> = [
    [
      "docker-compose.yml",
      mode === "pc" ? renderPcCompose(renderOpts) : renderServerCompose(renderOpts),
    ],
    [".env", mode === "pc" ? renderPcEnv(renderOpts) : renderServerEnv(renderOpts)],
  ];
  if (mode === "server") {
    files.push(["Caddyfile", CADDYFILE]);
  }

  for (const [name, contents] of files) {
    await writeFile(resolve(dir, name), contents, "utf8");
  }

  console.log(`\nNyxelOS is ready to run in ${mode} mode at ${dir}\n`);
  console.log("Next steps:");
  console.log(`  cd ${resolved.dir}`);
  if (mode === "server") {
    console.log("  # review .env (NYXEL_DOMAIN, POSTGRES_PASSWORD, ACME_EMAIL)");
  }
  console.log("  docker compose up -d");
  console.log(
    mode === "pc"
      ? "  # then open http://localhost:3000\n"
      : `  # then open https://${resolved.domain}\n`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
