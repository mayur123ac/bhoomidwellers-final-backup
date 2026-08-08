// app/api/settings/api-keys/usage/route.ts — API usage statistics.
//
// Reads the per-minute buckets written by lib/apiKeys.ts and rolls them up. All
// three shapes the UI needs come from one request, because they are three
// aggregations of the same rows and issuing three round trips to compute them
// would be slower and could show mutually inconsistent totals.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRoles } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = await requireRoles(["admin"]);
  if (!gate.ok) return gate.response;

  const params = new URL(req.url).searchParams;

  // Bounded: an unbounded window would scan the whole retention period on a
  // page that loads on every visit to the Developer API tab.
  const days = Math.min(Math.max(Number(params.get("days")) || 7, 1), 90);

  const keyIdRaw = params.get("keyId");
  const keyId = keyIdRaw ? Number(keyIdRaw) : null;
  if (keyIdRaw && (!Number.isInteger(keyId) || keyId! <= 0)) {
    return NextResponse.json({ success: false, message: "Invalid keyId." }, { status: 400 });
  }

  const since = `${days} days`;

  // ── Totals ──
  const totals = await query<{
    requests: string;
    errors: string;
    avg_ms: string | null;
  }>(
    `SELECT COALESCE(SUM(request_count), 0)::text AS requests,
            COALESCE(SUM(request_count) FILTER (WHERE status_class >= 4), 0)::text AS errors,
            -- Weighted by request_count: a bucket holding 300 calls must not
            -- count the same as one holding 1 when averaging latency.
            CASE WHEN SUM(request_count) > 0
                 THEN (SUM(total_duration_ms)::numeric / SUM(request_count))::int::text
            END AS avg_ms
       FROM api_key_usage
      WHERE bucket_start >= NOW() - $1::interval
        AND ($2::int IS NULL OR api_key_id = $2::int)`,
    [since, keyId]
  );

  // ── Daily series, for the chart ──
  const daily = await query<{ day: string; requests: string; errors: string }>(
    `SELECT to_char(date_trunc('day', bucket_start), 'YYYY-MM-DD') AS day,
            SUM(request_count)::text AS requests,
            COALESCE(SUM(request_count) FILTER (WHERE status_class >= 4), 0)::text AS errors
       FROM api_key_usage
      WHERE bucket_start >= NOW() - $1::interval
        AND ($2::int IS NULL OR api_key_id = $2::int)
      GROUP BY 1
      ORDER BY 1`,
    [since, keyId]
  );

  // ── Per-endpoint breakdown ──
  const endpoints = await query<{
    endpoint: string;
    requests: string;
    errors: string;
    avg_ms: string | null;
  }>(
    `SELECT endpoint,
            SUM(request_count)::text AS requests,
            COALESCE(SUM(request_count) FILTER (WHERE status_class >= 4), 0)::text AS errors,
            CASE WHEN SUM(request_count) > 0
                 THEN (SUM(total_duration_ms)::numeric / SUM(request_count))::int::text
            END AS avg_ms
       FROM api_key_usage
      WHERE bucket_start >= NOW() - $1::interval
        AND ($2::int IS NULL OR api_key_id = $2::int)
      GROUP BY endpoint
      ORDER BY SUM(request_count) DESC
      LIMIT 25`,
    [since, keyId]
  );

  // ── Per-key breakdown (only in the all-keys view) ──
  const byKey = keyId
    ? []
    : await query<{ id: number; name: string; key_prefix: string; requests: string }>(
        `SELECT k.id, k.name, k.key_prefix, SUM(u.request_count)::text AS requests
           FROM api_key_usage u
           JOIN api_keys k ON k.id = u.api_key_id
          WHERE u.bucket_start >= NOW() - $1::interval
          GROUP BY k.id, k.name, k.key_prefix
          ORDER BY SUM(u.request_count) DESC`,
        [since]
      );

  return NextResponse.json({
    success: true,
    data: {
      windowDays: days,
      totals: {
        requests: Number(totals[0]?.requests ?? 0),
        errors: Number(totals[0]?.errors ?? 0),
        avgMs: totals[0]?.avg_ms == null ? null : Number(totals[0].avg_ms),
      },
      daily: daily.map((d) => ({
        day: d.day,
        requests: Number(d.requests),
        errors: Number(d.errors),
      })),
      endpoints: endpoints.map((e) => ({
        endpoint: e.endpoint,
        requests: Number(e.requests),
        errors: Number(e.errors),
        avgMs: e.avg_ms == null ? null : Number(e.avg_ms),
      })),
      byKey: byKey.map((k) => ({
        id: k.id,
        name: k.name,
        prefix: k.key_prefix,
        requests: Number(k.requests),
      })),
    },
  });
}
