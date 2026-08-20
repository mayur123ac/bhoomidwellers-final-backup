// app/api/inventory/offers/[id]/decide/route.ts
// Approve / reject / counter an offer.
//
// Two rules make the bands real rather than advisory:
//   1. The decider's role must match the band frozen on the offer. A Sales
//      Manager cannot approve a discount that landed in the Admin band.
//   2. Nobody approves their own request. That is the whole point of an approval
//      step — without it the band is just a label on a self-service discount.
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireRoles } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

const DECISIONS = ["approved", "rejected", "countered"];

const normRole = (r: unknown) => String(r ?? "").trim().toLowerCase().replace(/_/g, " ");

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const gate = await requireRoles(["admin", "sales manager"]);
    if (!gate.ok) return gate.response;

    const body = await req.json().catch(() => ({}));
    const decision = String(body.decision || "").trim().toLowerCase();
    if (!DECISIONS.includes(decision)) {
      return NextResponse.json(
        { success: false, message: `decision must be one of: ${DECISIONS.join(", ")}.` },
        { status: 400 },
      );
    }

    // MT-06: approving/rejecting an offer is a mutation keyed on a caller-supplied
    // id — scoped so another tenant's offer is not decidable from here.
    const rows = await query<any>(`SELECT * FROM inventory_offers WHERE id = $1 AND organization_id = $2`, [Number(id), await getOrganizationId()]);
    if (!rows.length) {
      return NextResponse.json({ success: false, message: "Offer not found." }, { status: 404 });
    }
    const offer = rows[0];

    if (offer.status !== "pending") {
      return NextResponse.json(
        { success: false, message: `This offer is already ${offer.status}.` },
        { status: 409 },
      );
    }

    const actor = gate.session.name || "system";
    const actorRole = normRole(gate.session.role);

    // Rule 2 — separation of duties. Admin is not exempt: an Admin who raised the
    // request is still the requester, and self-approval would void the record.
    if (offer.requested_by && offer.requested_by === actor) {
      return NextResponse.json(
        {
          success: false,
          message: "You raised this offer, so you cannot decide it. It needs a second person.",
          code: "SELF_APPROVAL",
        },
        { status: 403 },
      );
    }

    // Rule 1 — the band frozen at request time governs. Admin may decide any band
    // (it is the top of the ladder); anyone else must match exactly.
    const required = normRole(offer.required_approver_role);
    if (required && actorRole !== "admin" && actorRole !== required) {
      return NextResponse.json(
        {
          success: false,
          message: `A ${offer.discount_pct}% discount needs ${offer.required_approver_role} approval.`,
          code: "WRONG_APPROVER",
        },
        { status: 403 },
      );
    }

    let counterPrice: number | null = null;
    if (decision === "countered") {
      const c = Number(String(body.counter_price ?? "").replace(/[₹,\s]/g, ""));
      if (!Number.isFinite(c) || c <= 0) {
        return NextResponse.json(
          { success: false, message: "counter_price is required to counter an offer." },
          { status: 400 },
        );
      }
      if (c > Number(offer.list_price)) {
        return NextResponse.json(
          { success: false, message: "Counter price cannot exceed the list price." },
          { status: 400 },
        );
      }
      counterPrice = c;
    }

    const updated = await query(
      `UPDATE inventory_offers
          SET status = $2, counter_price = $3,
              decided_by = $4, decided_at = NOW(), decision_remarks = $5
        WHERE id = $1
        RETURNING *`,
      [Number(id), decision, counterPrice, actor, body.remarks ? String(body.remarks).trim() : null],
    );

    return NextResponse.json({ success: true, data: updated[0] }, { status: 200 });
  } catch (err: any) {
    console.error("[POST /api/inventory/offers/[id]/decide]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
