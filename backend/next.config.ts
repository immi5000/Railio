import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@react-pdf/renderer"],
  experimental: {
    // Allow importing the shared contract from outside backend/
    externalDir: true,
  },
};

export default nextConfig;
