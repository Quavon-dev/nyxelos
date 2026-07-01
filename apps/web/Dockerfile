# Build context must be the repo root, e.g.:
#   docker build -f apps/web/Dockerfile -t nyxel-web .
FROM oven/bun:1 AS deps
WORKDIR /repo
COPY package.json bun.lock* turbo.json tsconfig.base.json ./
COPY apps/web ./apps/web
COPY apps/server/package.json apps/server/package.json
COPY packages ./packages
RUN bun install --frozen-lockfile

FROM deps AS build
WORKDIR /repo
RUN bun run --cwd apps/web build

FROM oven/bun:1 AS runtime
WORKDIR /repo/apps/web
COPY --from=build /repo/apps/web/.next ./.next
COPY --from=build /repo/apps/web/public ./public
COPY --from=build /repo/apps/web/package.json ./package.json
COPY --from=build /repo/apps/web/next.config.ts ./next.config.ts
COPY --from=build /repo/node_modules ./node_modules
ENV NODE_ENV=production
EXPOSE 3000
CMD ["bun", "run", "start"]
