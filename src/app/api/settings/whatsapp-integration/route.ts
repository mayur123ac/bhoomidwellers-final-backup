// app/api/settings/whatsapp-integration/route.ts — read-only status for the
// Settings → WhatsApp Integration screen.
//
// GET only, deliberately. The number itself is written through the existing
// /api/users/update-whatsapp, which already resolves the target from the
// session and normalises through toE164; a second writer would be a second
// place for that validation to drift.
//
// ── What "mode" means ────────────────────────────────────────────────────────
// There are two ways a lead can receive a WhatsApp message from this CRM, and
// only one of them is ever live:
//
//   manual — no Business API credentials. "Send WhatsApp" opens wa.me on the
//            user's own device, so the message comes from their personal number
//            and the CRM only logs that it happened.
//   api    — credentials present and WHATSAPP_ENABLED is not false. Messages go
//            through the company's Business number via the Cloud API, and the
//            personal number stops being the sender.
//
// The API wins whenever it is available: a company that has paid for a Business
// number does not want half its leads answering a salesperson's mobile.
//
// ── Why the number stays editable in either mode ─────────────────────────────
// users.whatsapp_number is not only a sender identity. It is also the DELIVERY
// TARGET for the CRM's own alerts (see services/whatsapp.service.ts), which
// only exist once the API is configured. Locking the field when the API comes
// online would therefore break the exact feature it powers. What switches off
// is manual *sending*, not the number.
//
// Only the four booleans below cross the wire for a non-admin. The env var
// names in `missing` are admin-only — they are a to-do list for whoever edits
// .env.local, and mean nothing to a Sales Manager beyond "not set up yet".

import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/serverAuth";
import { normalizeRole } from "@/lib/cpRbac";
import { configSummary } from "@/config/whatsapp.config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type WhatsAppMode = "api" | "manual" | "none";

export async function GET() {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;
  if (!gate.userId) {
    return NextResponse.json(
      { success: false, message: "Session carries no user id." },
      { status: 400 }
    );
  }

  const summary = configSummary();
  const apiActive = summary.configured && summary.enabled;

  const rows = await query<{ whatsapp_number: string | null; name: string | null }>(
    `SELECT whatsapp_number, name FROM public.users WHERE id = $1 LIMIT 1`,
    [gate.userId]
  );
  const number = rows[0]?.whatsapp_number || "";

  const isAdmin = normalizeRole(gate.session.role) === "admin";

  const mode: WhatsAppMode = apiActive ? "api" : number ? "manual" : "none";

  return NextResponse.json({
    success: true,
    mode,
    api: {
      // `configured` and `enabled` are separate on purpose: credentials present
      // but WHATSAPP_ENABLED=false is a deliberate pause, not a missing setup,
      // and the screen says so rather than telling an admin to re-enter keys
      // that are already correct.
      configured: summary.configured,
      enabled: summary.enabled,
      active: apiActive,
      businessNumberHint: summary.phoneNumberId, // last 4 of the phone number id
      // Env var names are an admin's to-do list; nobody else can act on them.
      missing: isAdmin ? summary.missing : [],
    },
    manual: {
      number,
      // Manual sending is available only while the API is not. The number may
      // still be set, and still receives CRM alerts, either way.
      active: !apiActive && Boolean(number),
      configured: Boolean(number),
    },
    viewer: { name: rows[0]?.name ?? null, isAdmin },
  });
}
