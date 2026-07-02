# create-nyxel

Set up [NyxelOS](https://github.com/Quavon-dev/nyxelos) for **use** — no
source checkout, no build toolchain, just Docker.

```bash
npx create-nyxel
# or
bunx create-nyxel
```

This writes a `docker-compose.yml`, `.env`, and (server mode) a `Caddyfile`
into a target directory. Those files reference the prebuilt
`ghcr.io/quavon-dev/nyxelos-server` and `ghcr.io/quavon-dev/nyxelos-web`
images — nothing is compiled locally and no application source is
installed.

```bash
cd nyxel
docker compose up -d
```

## Options

```
--mode <pc|server>   Deployment mode (skips the interactive prompt)
--dir <path>         Directory to write into (default: ./nyxel)
--tag <tag>          Image tag to deploy (default: latest)
--domain <domain>    Server mode only — public domain for TLS (Caddy)
--acme-email <email> Server mode only — ACME account email for Caddy
-y, --yes            Accept defaults, skip interactive prompts
-v, --version        Print the CLI version
-h, --help           Show help
```

## Developing NyxelOS instead?

This package is for running NyxelOS, not hacking on it. To contribute or
run it from source, clone the repository instead:

```bash
git clone https://github.com/Quavon-dev/nyxelos.git
cd nyxelos
bun install
bun dev
```

See the [main README](https://github.com/Quavon-dev/nyxelos#readme) for
full development setup.
