import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["twilio", "puppeteer-core", "@sparticuz/chromium-min"],

  // Compresses HTML and static assets served by the Next server.
  //
  // IMPORTANT: this does NOT cover App Router Route Handlers. Verified against a
  // production build of this app — /api/followups returned byte-identical
  // responses (33,540 bytes) with and without `Accept-Encoding: gzip`, with
  // `Transfer-Encoding: chunked` and no `Content-Encoding`. Route handlers stream
  // their body and Next does not buffer them to compress.
  //
  // API compression is therefore done explicitly in @/lib/apiResponse
  // (jsonCompressed), which the heavy list endpoints use. Do not remove those
  // calls on the assumption that this flag covers them.
  compress: true,

  // Strips the X-Powered-By: Next.js header. A few bytes on every response, and
  // it advertises the framework version to anyone scanning.
  poweredByHeader: false,

  images: {
    // Modern formats first; Next negotiates per request via Accept.
    formats: ["image/avif", "image/webp"],
    // Only the widths this UI actually renders at, so the optimizer is not asked
    // to keep variants nobody requests.
    deviceSizes: [640, 828, 1080, 1200, 1920],
    imageSizes: [32, 48, 64, 96, 128, 256],
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },

  experimental: {
    // Rewrites `import { FaFoo } from "react-icons/fa"` into per-icon deep
    // imports at build time. The dashboard files import 30-40 icons each from
    // barrel files; without this, bundling one icon can pull in the whole set.
    optimizePackageImports: ["react-icons", "framer-motion", "recharts", "lucide-react"],
  },
};

export default nextConfig;
