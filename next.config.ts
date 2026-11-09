import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["ts-studio.blund.tech"],
  cacheComponents: true,
  // Bookmarks and open tabs from before the addresses became Swedish.
  async redirects() {
    return [
      { source: "/players", destination: "/truppen", permanent: true },
      { source: "/workouts/:id", destination: "/traningar/:id", permanent: true },
      { source: "/settings", destination: "/installningar", permanent: true },
      { source: "/login", destination: "/logga-in", permanent: true },
    ];
  },
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
