import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Monorepo + Bun's symlinked node_modules (`node_modules/next` points into
  // the root `node_modules/.bun/...` store) mean the real `next` package
  // lives outside `apps/web`. Turbopack's root must cover that symlink
  // target, so point it at the monorepo root rather than this package.
  turbopack: {
    root: path.join(__dirname, "../.."),
  },
  // Dev-only same-origin proxy to the backend, mirroring the /trpc + /api
  // path routing Caddy does in production — lets the client hit a relative
  // URL instead of a hardcoded cross-origin port during local development.
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    const target = process.env.NYXEL_DEV_SERVER_URL ?? "http://localhost:3001";
    return [
      { source: "/trpc/:path*", destination: `${target}/trpc/:path*` },
      { source: "/api/:path*", destination: `${target}/api/:path*` },
    ];
  },
};

export default nextConfig;
