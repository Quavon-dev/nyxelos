# Installation

This project ships two self-hosting modes:

- `PC mode`: SQLite, direct localhost ports, optimized for one person on one machine.
- `Server mode`: PostgreSQL, HTTPS, and Caddy for a shared or remotely reachable deployment.

## Prerequisites

- Docker Engine with the Compose plugin
- A checked-out copy of this repository
- One strong `BETTER_AUTH_SECRET`
- For server mode: a DNS record pointing `NYXEL_DOMAIN` at the host

## PC mode

1. Create the root env file:

```bash
cp .env.example .env
```

2. Set at least:

```env
BETTER_AUTH_SECRET=replace-with-a-long-random-string
```

3. Build and start the stack:

```bash
docker compose -f docker-compose.pc.yml up --build
```

4. Open [http://localhost:3000](http://localhost:3000).

5. In the setup wizard:

- choose `PC mode`
- enter the first owner name, email, and password
- confirm the primary workspace name
- leave `http://localhost:3000` as the public app URL unless you changed the port mapping

PC mode stores the application database in the Docker volume `nyxel-data`.

## Server mode

1. Create the root env file:

```bash
cp .env.example .env
```

2. Set:

```env
NYXEL_DOMAIN=nyxel.example.com
POSTGRES_PASSWORD=replace-me
BETTER_AUTH_SECRET=replace-with-a-long-random-string
ACME_EMAIL=ops@example.com
```

3. Start the stack:

```bash
docker compose -f docker-compose.server.yml up --build -d
```

4. Wait for Caddy to obtain the certificate, then open `https://NYXEL_DOMAIN`.

5. In the setup wizard:

- choose `Server mode`
- create the first owner account
- confirm the public app URL shown by default

Server mode persists:

- PostgreSQL data in `nyxel-postgres`
- Caddy certificates in `nyxel-caddy-data`
- Caddy runtime config in `nyxel-caddy-config`

## What the wizard writes

The first-run wizard persists:

- the chosen installation mode
- the owner Better-Auth account
- the primary workspace id
- the public application URL

The server uses that installation record on subsequent boots instead of falling back to a demo-only bootstrap path.

## Operations notes

- The server now runs database migrations automatically on startup for both SQLite and PostgreSQL.
- Server-mode Caddy serves a lightweight health endpoint at `/healthz`.
- Compose assigns stable local image tags: `nyxel/server:pc`, `nyxel/web:pc`, `nyxel/server:server`, and `nyxel/web:server`.

## Updating

After pulling new code:

```bash
docker compose -f docker-compose.pc.yml up --build
```

or

```bash
docker compose -f docker-compose.server.yml up --build -d
```

The server applies any pending migrations during boot.
