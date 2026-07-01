# Build context must be the repo root, e.g.:
#   docker build -f apps/server/Dockerfile -t nyxel-server .
FROM oven/bun:1 AS runtime
WORKDIR /repo

COPY package.json bun.lock* turbo.json tsconfig.base.json ./
COPY apps/server ./apps/server
COPY apps/web/package.json apps/web/package.json
COPY packages ./packages

RUN bun install --frozen-lockfile

WORKDIR /repo/apps/server
ENV NODE_ENV=production
EXPOSE 3001
CMD ["bun", "run", "start"]
