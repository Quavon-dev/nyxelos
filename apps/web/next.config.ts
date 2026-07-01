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
};

export default nextConfig;
