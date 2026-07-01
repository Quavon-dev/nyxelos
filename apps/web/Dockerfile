# Build context must be the repo root, e.g.:
#   docker build -f apps/web/Dockerfile -t nyxel-web .
FROM oven/bun:1 AS deps
WORKDIR /repo
COPY package.json bun.lock* turbo.json tsconfig.base.json ./
COPY apps/web ./apps/web
COPY apps/server/package.json apps/server/package.json
COPY packages ./packages
RUN bun install

FROM deps AS build
WORKDIR /repo
RUN bun run --cwd apps/web build

FROM oven/bun:1 AS runtime
WORKDIR /repo/apps/web
LABEL org.opencontainers.image.title="Nyxel web"
LABEL org.opencontainers.image.description="Nyxel Next.js frontend runtime."
COPY --from=build /repo/apps/web/.next ./.next
COPY --from=build /repo/apps/web/public ./public
COPY --from=build /repo/apps/web/package.json ./package.json
COPY --from=build /repo/apps/web/next.config.ts ./next.config.ts
COPY --from=build /repo/node_modules ../../node_modules
COPY --from=build /repo/apps/web/node_modules ./node_modules
ENV NODE_ENV=production
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD bun -e 'const r = await fetch("http://127.0.0.1:3000/"); if (!r.ok) throw new Error("web unhealthy");'
CMD ["bun", "run", "start"]
