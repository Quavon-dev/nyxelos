# Build context must be the repo root, e.g.:
#   docker build -f apps/server/Dockerfile -t nyxel-server .
FROM oven/bun:1 AS runtime
WORKDIR /repo
LABEL org.opencontainers.image.title="Nyxel server"
LABEL org.opencontainers.image.description="Nyxel API, auth, agents, and scheduler runtime."

COPY --chown=bun:bun package.json bun.lock* turbo.json tsconfig.base.json ./
COPY --chown=bun:bun apps/server ./apps/server
COPY --chown=bun:bun apps/web/package.json apps/web/package.json
COPY --chown=bun:bun packages ./packages

RUN bun install

# /data is where the SQLite volume (nyxel-data, docker-compose.pc.yml) mounts.
# Docker seeds a fresh named volume from the image's contents at this path on
# first use, so pre-creating it here with bun:bun ownership keeps it writable
# once the process drops root below.
RUN mkdir -p /data && chown bun:bun /data

WORKDIR /repo/apps/server
ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001
USER bun
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD bun -e 'const r = await fetch("http://127.0.0.1:3001/"); if (!r.ok) throw new Error("server unhealthy");'
CMD ["bun", "run", "start"]
