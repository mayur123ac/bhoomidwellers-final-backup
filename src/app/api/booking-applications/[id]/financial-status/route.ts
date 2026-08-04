// app/api/booking-applications/[id]/financial-status/route.ts
//
// The read side of the Financial Obligation Engine: one GET that returns a
// booking's complete derived financial state.
//
// Every UI component that needs to know whether the agreement is funded, what
// may still be collected, or which figures contradict each other reads it from
// here instead of computing its own answer. That is the entire point — the
// contradictions this engine exists to remove (see financialObligationEngine.ts)
// came from four screens each doing their own arithmetic.
//
// READ ONLY. No INSERT, UPDATE or DELETE, and no GET-with-side-effects. Every
// call recomputes from the database; there is deliberately no caching layer
// here, because a stale financial position is worse than a slow one.

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import {
  buildFinancialSnapshot,
  BookingNotFoundError,
  NoActiveBookingForLeadError,
} from "@/lib/buildFinancialSnapshot";
import { computeFinancialObligation } from "@/lib/financialObligationEngine";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    // Every authenticated role reads this: a receptionist taking a payment needs
    // the same locked/unlocked answer an admin does. Deliberately not
    // role-gated — it exposes no figure the booking screens don't already show.
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const bookingId = Number(id);
    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      return NextResponse.json(
        { success: false, error: "Invalid booking id" },
        { status: 400 }
      );
    }

    const snapshot = await buildFinancialSnapshot({ bookingId });
    const obligation = computeFinancialObligation(snapshot);

    return NextResponse.json(
      {
        success: true,
        bookingId,
        // Echoed so a caller rendering "₹X of ₹Y" never needs a second request
        // for the raw inputs behind a derived figure.
        snapshot,
        obligation,
        computedAt: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (err: any) {
    if (err instanceof BookingNotFoundError || err instanceof NoActiveBookingForLeadError) {
      return NextResponse.json({ success: false, error: err.message }, { status: 404 });
    }
    console.error("[GET /api/booking-applications/[id]/financial-status]", err);
    return NextResponse.json({ success: false, error: "Internal error" }, { status: 500 });
  }
}
