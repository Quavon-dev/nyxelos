# Build context must be the repo root, e.g.:
#   docker build -f apps/server/Dockerfile -t nyxel-server .
FROM oven/bun:1 AS runtime
WORKDIR /repo
LABEL org.opencontainers.image.title="Nyxel server"
LABEL org.opencontainers.image.description="Nyxel API, auth, agents, and scheduler runtime."

COPY package.json bun.lock* turbo.json tsconfig.base.json ./
COPY apps/server ./apps/server
COPY apps/web/package.json apps/web/package.json
COPY packages ./packages

RUN bun install

WORKDIR /repo/apps/server
ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD bun -e 'const r = await fetch("http://127.0.0.1:3001/"); if (!r.ok) throw new Error("server unhealthy");'
CMD ["bun", "run", "start"]
