import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Imports send parsed CSV rows (files are capped at 2 MB) to a server action.
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
