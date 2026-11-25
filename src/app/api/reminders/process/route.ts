// api/reminders/process/route.ts — cron endpoint for reminder dispatch.
//
//   - GET and POST both work (cron services frequently only issue GET)
//   - Auth: Vercel CRON_SECRET (Authorization: Bearer), x-reminder-token
//     header (shared secret), or admin session cookie
//   - Token auth: processes all organizations (platform cron)
//   - Session auth: processes only that admin's organization
//
// Registered in vercel.json with schedule "* * * * *" (every minute).

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { getVerifyToken } from "@/config/whatsapp.config";
import { safeEqual } from "@/lib/whatsapp-client";
import { processReminders } from "@/services/reminder.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorize(req: NextRequest): Promise<{ ok: boolean; via?: string }> {
  // 1. Vercel Cron secret (CRON_SECRET env var → Authorization: Bearer header)
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (authHeader && cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return { ok: true, via: "vercel-cron" };
  }

  // 2. Shared secret in x-reminder-token header (constant-time comparison)
  const header = req.headers.get("x-reminder-token");
  const expected = getVerifyToken();
  if (header && expected && safeEqual(header, expected)) return { ok: true, via: "token" };

  // 3. Admin session cookie
  const session = await getServerSession();
  const role = (session?.role ?? "").trim().toLowerCase().replace(/_/g, " ");
  if (role === "admin" || role === "super admin") return { ok: true, via: "session" };

  return { ok: false };
}

async function handle(req: NextRequest) {
  const auth = await authorize(req);
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, message: "Unauthorized. Send an admin session, a valid x-reminder-token, or CRON_SECRET." },
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
