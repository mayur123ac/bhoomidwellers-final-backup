// api/reminders/process/route.ts — cron endpoint for reminder dispatch.
//
// Mirrors /api/notifications/retry-sweep exactly:
//   - GET and POST both work (cron services frequently only issue GET)
//   - Auth: x-reminder-token header (shared secret) OR admin session
//   - Token auth: processes all organizations (platform cron)
//   - Session auth: processes only that admin's organization
//
// Point an external cron at this endpoint every 60 seconds:
//   curl -H "x-reminder-token: $SECRET" https://www.bhoomidwellers.com/api/reminders/process
//
// The secret reuses VERIFY_TOKEN (same as retry-sweep) to avoid introducing
// another env var. It is already a secret shared only between this server and
// Meta/cron, and on this path it never leaves the server.

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { getVerifyToken } from "@/config/whatsapp.config";
import { safeEqual } from "@/lib/whatsapp-client";
import { processReminders } from "@/services/reminder.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorize(req: NextRequest): Promise<{ ok: boolean; via?: string }> {
  // 1. Shared secret in header (constant-time comparison)
  const header = req.headers.get("x-reminder-token");
  const expected = getVerifyToken();
  if (header && expected && safeEqual(header, expected)) return { ok: true, via: "token" };

  // 2. Admin session cookie
  const session = await getServerSession();
  const role = (session?.role ?? "").trim().toLowerCase().replace(/_/g, " ");
  if (role === "admin" || role === "super admin") return { ok: true, via: "session" };

  return { ok: false };
}

async function handle(req: NextRequest) {
  const auth = await authorize(req);
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, message: "Unauthorized. Send an admin session or a valid x-reminder-token." },
      { status: 401 },
    );
  }

  const limit = Number(req.nextUrl.searchParams.get("limit")) || 100;

  // MT-05: token = all orgs, session = this org only (same as retry-sweep)
  const orgId = auth.via === "session" ? await getOrganizationId() : null;

  try {
    const report = await processReminders(limit, orgId);
    return NextResponse.json(
      { success: true, ...report, via: auth.via },
      { status: 200 },
    );
  } catch (err: any) {
    console.error("[GET /api/reminders/process]", err);
    return NextResponse.json(
      { success: false, message: err.message },
      { status: 500 },
    );
  }
}

export const GET = handle;
export const POST = handle;
