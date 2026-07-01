import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Monorepo: pin the Turbopack workspace root to this package so it doesn't
  // try to infer it (and fail) from a nested build directory.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
