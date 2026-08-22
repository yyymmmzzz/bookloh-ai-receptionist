/** @type {import("next").NextConfig} */
const nextConfig = {
  // Allow Vapi/Twilio webhook payloads up to 1MB (recordings can be heavy)
  experimental: {
    serverActions: {
      bodySizeLimit: "1mb",
    },
  },
  reactStrictMode: true,
};

module.exports = nextConfig;
