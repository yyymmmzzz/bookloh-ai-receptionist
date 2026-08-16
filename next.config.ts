import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow Vapi/Twilio webhook payloads up to 1MB (recordings can be heavy)
  experimental: {
    serverActions: {
      bodySizeLimit: "1mb",
    },
  },
  // Suppress noisy hydration warnings from third-party widgets
  reactStrictMode: true,
};

export default nextConfig;
