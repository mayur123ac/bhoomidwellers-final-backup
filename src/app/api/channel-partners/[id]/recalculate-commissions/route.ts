// api/channel-partners/[id]/recalculate-commissions/route.ts
//
// Re-applies a partner's rate to their still-open commissions — the "sales manager
// used the wrong rate, admin corrects it centrally" flow.
//
// Scope is deliberately narrow:
//   • only 'accrued' and 'due' rows. 'paid' money has already left; 'reversed' is
//     history. Both need a reversal + fresh entry, not a silent rewrite.
//   • only rows that are NOT overrides, unless includeOverrides is set. An override
//     is a deliberate one-off amount with a stated reason; re-deriving it from a
//     rate would destroy that intent without telling anyone.
import { NextRequest, NextResponse } from "next/server";
import { transaction } from "@/lib/db";
import { recalculateCommission, CPCommissionError } from "@/lib/cpCommissionEngine";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await req.json();

    if ((body.user_role || "").toString().trim().toLowerCase() !== "admin") {
      return NextResponse.json(
        { success: false, message: "Only an Admin can recalculate recorded commissions.", code: "FORBIDDEN" },
        { status: 403 }
      );
    }

    const cpId = Number(id);
    if (!cpId || Number.isNaN(cpId)) {
      return NextResponse.json({ success: false, message: "Invalid partner id." }, { status: 400 });
    }

    const includeOverrides = body.includeOverrides === true;
    const updatedBy = (body.updated_by || body.user_name || "admin").toString();

    const result = await transaction(async (client) => {
      const cpRes = await client.query(
        `SELECT id, name, default_commission_rate FROM channel_partners WHERE id = $1`,
        [cpId]
      );
      if (cpRes.rows.length === 0) {
        throw new CPCommissionError(`Channel partner ${cpId} not found.`, "CP_NOT_FOUND", 404);
      }
      const cp = cpRes.rows[0];

      // Explicit rate wins, else the partner's current configured rate.
      const rate = body.ratePercent ?? body.rate_percent ?? cp.default_commission_rate;
      if (rate === null || rate === undefined || String(rate).trim() === "") {
        throw new CPCommissionError(
          `Channel partner "${cp.name}" has no commission rate set — set one before recalculating.`,
          "CP_RATE_NOT_SET", 400
        );
      }

      const targets = await client.query(
        `SELECT id FROM cp_commissions
          WHERE channel_partner_id = $1
            AND status IN ('accrued', 'due')
            ${includeOverrides ? "" : "AND COALESCE(is_override, false) = false"}
          ORDER BY id ASC`,
        [cpId]
      );

      const updated: number[] = [];
      const skipped: { id: number; reason: string }[] = [];
      for (const t of targets.rows) {
        try {
          await recalculateCommission(client, t.id, { ratePercent: rate }, updatedBy);
          updated.push(t.id);
        } catch (e: any) {
          // A row that can't be re-derived (e.g. its booking lost its agreement
          // value) must not abort the rest of the batch.
          skipped.push({ id: t.id, reason: e?.message || "could not recalculate" });
        }
      }
      return { updated, skipped, rate: String(rate), partner: cp.name };
    });

    return NextResponse.json(
      {
        success: true,
        updatedCount: result.updated.length,
        updatedIds: result.updated,
        skipped: result.skipped,
        rate: result.rate,
      },
      { status: 200 }
    );
  } catch (err: any) {
    if (err instanceof CPCommissionError) {
      return NextResponse.json(
        { success: false, message: err.message, code: err.code },
        { status: err.status }
      );
    }
    console.error("[POST /api/channel-partners/[id]/recalculate-commissions]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
