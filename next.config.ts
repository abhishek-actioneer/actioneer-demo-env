import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the Next.js dev-tools indicator (the floating "N" badge in development).
  devIndicators: false,
  serverExternalPackages: ["@duckdb/node-api", "@duckdb/node-bindings", "better-sqlite3", "twilio", "ws", "unpdf", "mammoth"],
  turbopack: {
    root: __dirname,
  },
  experimental: {
    proxyClientMaxBodySize: "50mb",
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "fivetran.com" },
      { protocol: "https", hostname: "cdn.brandfetch.io" },
    ],
  },
};

export default nextConfig;
