// api/bolna/status/route.ts — "can I call anyone right now?"
//
// Separate from /api/settings/bolna because the two answer different questions
// for different audiences. The settings route is admin-only and describes the
// configuration; this one is readable by any signed-in user and describes only
// capability. The call widget renders on lead pages that sales staff open, and
// it needs to know whether to draw a Call button — that must not require handing
// a non-admin a summary of the credentials, even a masked one.
//
// Everything here is a boolean. There is nothing to leak.

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { isBolnaConfigured } from "@/lib/bolnaSettings";
import { readBolnaConfig } from "@/config/bolna.config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const cfg = readBolnaConfig();
  const configured = await isBolnaConfigured();

  return NextResponse.json({
    success: true,
    configured,
    enabled: cfg.enabled,
    // Both must hold for the browser-call button to be worth rendering: the
    // account has to have the beta feature, and credentials have to exist.
    webCallEnabled: cfg.webCallEnabled && configured,
  });
}
