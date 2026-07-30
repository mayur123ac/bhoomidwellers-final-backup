// api/notifications/retry-sweep/route.ts — the durable half of the retry engine.
//
// The in-process timer in whatsapp.service.ts handles the common case: a send
// fails, it retries 30 seconds later, nobody notices. But timers live in memory.
// A restart, a redeploy, or a crash destroys every pending one, and those
// notifications would be lost forever with no error anywhere.
//
// This endpoint is the recovery path. Point an external cron at it every five
// minutes and any row whose next_retry_at has passed is picked up regardless of
// what the process was doing when it went down. It is the only thing standing
// between "the server restarted during a Meta outage" and "three managers never
// learned about their new partners".
//
// GET and POST both work: cron services frequently only issue GET.

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/serverAuth";
import { normalizeRole } from "@/lib/cpRbac";
import { processDue } from "@/services/whatsapp.service";
import { configSummary, getVerifyToken } from "@/config/whatsapp.config";
import { safeEqual } from "@/lib/whatsapp-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Either an admin session, or the shared secret in a header.
 *
 * VERIFY_TOKEN is reused as the sweep secret rather than introducing a fifth
 * variable — it keeps the promise that four values are all you need to fill in.
 * It is already a secret shared only between this server and Meta, and on this
 * path it never leaves the server. Compared in constant time because it is
 * attacker-supplied input.
 */
async function authorize(req: NextRequest): Promise<{ ok: boolean; via?: string }> {
  const header = req.headers.get("x-sweep-token");
  const expected = getVerifyToken();
  if (header && expected && safeEqual(header, expected)) return { ok: true, via: "token" };

  const session = await getServerSession();
  if (session?.role && normalizeRole(session.role) === "admin") return { ok: true, via: "session" };

  return { ok: false };
}

async function handle(req: NextRequest) {
  const auth = await authorize(req);
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, message: "Unauthorized. Send an admin session or a valid x-sweep-token." },
      { status: 401 }
    );
  }

  const limit = Number(req.nextUrl.searchParams.get("limit")) || 25;

  try {
    const report = await processDue(limit);
    return NextResponse.json(
      { success: true, ...report, via: auth.via, configuration: configSummary() },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[POST /api/notifications/retry-sweep]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
