// api/cp-commissions/preview/route.ts — read-only dry run of a commission.
//
// Runs the identical validation and arithmetic as the commit path, so the preview
// can never show numbers the subsequent POST would reject. No transaction: nothing
// is written.
import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { previewCPCommission, previewCommissionForPartner, CPCommissionError } from "@/lib/cpCommissionEngine";
import { requireSession, requireRoles } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const client = await getPool().connect();
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const body = await req.json();

    const raw = body.overrideGross ?? body.override_gross;
    const hasOverride = raw !== undefined && raw !== null && String(raw).trim() !== "";
    if (hasOverride && (Number.isNaN(Number(raw)) || Number(raw) < 0)) {
      return NextResponse.json(
        { success: false, message: "overrideGross must be a non-negative number.", code: "INVALID_OVERRIDE" },
        { status: 400 }
      );
    }
    const override = hasOverride ? Number(raw) : undefined;

    // Two modes. An existing booking previews by id and gets the full set of
    // checks; the booking form previews by partner + agreement value because the
    // booking row does not exist yet.
    const bookingId = Number(body.bookingId ?? body.booking_id);
    const cpId = Number(body.channelPartnerId ?? body.channel_partner_id);

    if (bookingId && !Number.isNaN(bookingId)) {
      const data = await previewCPCommission(client, bookingId, override);
      return NextResponse.json({ success: true, data }, { status: 200 });
    }

    if (cpId && !Number.isNaN(cpId)) {
      const agreementValue = body.agreementValue ?? body.agreement_value ?? null;
      const data = await previewCommissionForPartner(client, cpId, agreementValue, override);
      return NextResponse.json({ success: true, data }, { status: 200 });
    }

    return NextResponse.json(
      { success: false, message: "Provide either bookingId, or channelPartnerId with agreementValue.", code: "INVALID_BOOKING_ID" },
      { status: 400 }
    );
  } catch (err: any) {
    if (err instanceof CPCommissionError) {
      return NextResponse.json(
        { success: false, message: err.message, code: err.code },
        { status: err.status }
      );
    }
    console.error("[POST /api/cp-commissions/preview]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  } finally {
    client.release();
  }
}
