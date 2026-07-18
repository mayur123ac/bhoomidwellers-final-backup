import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["twilio", "puppeteer-core", "@sparticuz/chromium-min"],
};

export default nextConfig;