import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["ts-studio.blund.tech"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
