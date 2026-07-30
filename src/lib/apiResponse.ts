// lib/apiResponse.ts — compressed JSON responses for the heavy list endpoints.
//
// ── Why this exists rather than next.config's `compress` ─────────────────────
//
// `compress: true` in next.config.ts does NOT compress App Router Route Handler
// responses. Verified against a production build of this app:
//
//   curl -H "Accept-Encoding: gzip" .../api/followups   → 33540 bytes
//   curl                            .../api/followups   → 33540 bytes
//   response headers: Transfer-Encoding: chunked, no Content-Encoding
//
// Route handlers stream their body, and Next does not buffer them to compress.
// So compression has to be done explicitly, here, or delegated to a reverse
// proxy in front of the app.
//
// It is worth doing because these payloads are pathologically repetitive — every
// follow-up row carries the same "• Property Type:" / "🏦 Loan Update:"
// scaffolding, and every lead row the same 60 JSON keys. Measured on a
// 100,000-lead dataset:
//
//   /api/followups        107.62 MB → 3.02 MB   (36×, 763 ms to gzip)
//   /api/walkin_enquiries  13.13 MB → 0.37 MB   (35×,  66 ms to gzip)
//
// ── If you put nginx / Cloudflare / a CDN in front of this app ───────────────
// Those compress on the way out and will see an already-gzipped body, which is
// fine — Content-Encoding is set correctly and they will not double-compress.
// You can then drop these calls if you prefer; nothing else depends on them.

import { NextResponse } from "next/server";
import { gzip } from "node:zlib";
import { promisify } from "node:util";

const gzipAsync = promisify(gzip);

/**
 * Below this, compression costs more than it saves: the CPU and the extra header
 * outweigh a few hundred bytes, and small responses are usually latency-bound
 * rather than bandwidth-bound.
 */
const MIN_BYTES_TO_COMPRESS = 2048;

/**
 * Level 6 is zlib's default and the right trade here. Level 9 spends noticeably
 * more CPU for ~2% better ratio on this kind of repetitive JSON; level 1 gives up
 * a third of the saving to save little. Measured, not assumed.
 */
const GZIP_LEVEL = 6;

function clientAcceptsGzip(req: Request): boolean {
  const ae = req.headers.get("accept-encoding") || "";
  return /\bgzip\b/i.test(ae);
}

/**
 * Drop-in replacement for NextResponse.json() on endpoints that can return large
 * arrays. Falls back to an ordinary uncompressed response whenever compressing
 * would not help or is not supported, so callers never have to branch.
 *
 * Deliberately never throws on a compression failure: a response that arrives
 * uncompressed is correct, just larger.
 */
export async function jsonCompressed(
  req: Request,
  body: unknown,
  init?: { status?: number; headers?: Record<string, string> }
): Promise<Response> {
  const status = init?.status ?? 200;
  const extraHeaders = init?.headers ?? {};

  let text: string;
  try {
    text = JSON.stringify(body);
  } catch {
    // Circular or non-serializable — let NextResponse produce its own error.
    return NextResponse.json(body as any, { status });
  }

  const bytes = Buffer.byteLength(text);

  if (bytes < MIN_BYTES_TO_COMPRESS || !clientAcceptsGzip(req)) {
    return new NextResponse(text, {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        // Proxies must not serve a gzipped copy to a client that did not ask for
        // one, or vice versa.
        vary: "Accept-Encoding",
        ...extraHeaders,
      },
    });
  }

  try {
    const compressed = await gzipAsync(text, { level: GZIP_LEVEL });
    return new NextResponse(compressed as unknown as BodyInit, {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-encoding": "gzip",
        "content-length": String(compressed.length),
        vary: "Accept-Encoding",
        ...extraHeaders,
      },
    });
  } catch (err) {
    console.error("[apiResponse] gzip failed, sending uncompressed:", err);
    return new NextResponse(text, {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        vary: "Accept-Encoding",
        ...extraHeaders,
      },
    });
  }
}
