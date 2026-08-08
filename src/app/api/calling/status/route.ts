// api/calling/status/route.ts — "which call buttons should be live?"
//
// The compact counterpart to /api/bolna/status, covering both calling routes in
// one request. Every lead row renders a pair of call buttons, so a per-provider
// endpoint would mean two fetches to answer one question that never changes
// between rows.
//
// Readable by any signed-in user and returns only booleans: the buttons render
// for sales staff, and deciding whether to draw them must not require handing a
// non-admin any part of the credentials, masked or otherwise. There is nothing
// here to leak.

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { isBolnaConfigured } from "@/lib/bolnaSettings";
import { isManualCallingConfigured } from "@/lib/manualCallingSettings";
import { readBolnaConfig } from "@/config/bolna.config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const cfg = readBolnaConfig();
  const [aiConfigured, manualProvider] = await Promise.all([
    isBolnaConfigured(),
    isManualCallingConfigured(),
  ]);

  return NextResponse.json({
    success: true,

    // AI calling has no fallback: without Bolna credentials there is no way to
    // place the call, so the button is genuinely dead and renders disabled.
    aiCallingEnabled: aiConfigured && cfg.enabled,

    // Manual calling always has one: `tel:` needs no credentials. The flag says
    // which mode the click will use, not whether the button works.
    manualCallingEnabled: true,
    manualCallingMode: manualProvider ? ("provider" as const) : ("tel" as const),
  });
}
