import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The end-to-end tests build and serve from their own folders, so they don't disturb `npm run dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    // Imports send parsed CSV rows (files are capped at 2 MB) to a server action.
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
