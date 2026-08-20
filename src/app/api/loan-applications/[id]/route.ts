// app/api/loan-applications/[id]/route.ts
// Update a lender application (status, sanction, rejection). Selecting a lender
// (is_selected=true) is the pivotal action: it deselects sibling applications and
// copies the winning lender's details into the single source of truth —
// booking_loan_details if a booking exists, otherwise the lead's draft.
import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireSession, requireRoles } from "@/lib/serverAuth";
import {
  buildFinancialSnapshot,
  resolveBookingIdForLead,
  BookingNotFoundError,
  fmtINR,
} from "@/lib/buildFinancialSnapshot";
import { computeFinancialObligation } from "@/lib/financialObligationEngine";

export const dynamic = "force-dynamic";

function isLoanManager(role: string) {
  const clean = (role || "").trim().toLowerCase();
  return ["admin", "sales manager", "sales_manager", "site_head", "site head"].includes(clean);
}

const cleanNum = (v: any) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[₹,\s]/g, ""));
  return isNaN(n) ? null : n;
};

// Fields a client may edit, with their coercion.
const EDITABLE: Record<string, (v: any) => any> = {
  bank_name: v => String(v),
  loan_type: v => (v == null ? null : String(v)),
  dsa_agent_name: v => (v == null ? null : String(v)),
  dsa_agent_contact: v => (v == null ? null : String(v)),
  loan_executive: v => (v == null ? null : String(v)),
  loan_reference_no: v => (v == null ? null : String(v)),
  amount_requested: cleanNum,
  amount_sanctioned: cleanNum,
  interest_rate: cleanNum,
  tenure_months: cleanNum,
  application_date: v => v || null,
  status: v => (v == null ? null : String(v)),
  sanction_date: v => v || null,
  rejection_reason: v => (v == null ? null : String(v)),
  rejection_date: v => v || null,
  is_selected: v => !!v,
  remarks: v => (v == null ? null : String(v)),
};

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const body = await req.json();
    // Session-derived. The body still carries user_name/user_role and callers may
    // keep sending them, but they are no longer read: `isLoanManager(body.user_role)`
    // meant the request declared its own permission, so "user_role":"admin" in the
    // JSON was the entire check.
    const user_name = gate.session.name || "system";
    const user_role = gate.session.role || "";
    if (!isLoanManager(user_role)) {
      return NextResponse.json({ success: false, message: "Only Admin, Site Head and Sales Managers can update loan applications." }, { status: 403 });
    }

    // ── FOE gate: a sanction may not exceed its ceiling ──────────────────────
    // Phase 2. Validation only — nothing below this block changed. The column is
    // amount_sanctioned (there is no `sanctioned_amount` in this schema), so that
    // is the key watched for here.
    if ("amount_sanctioned" in body) {
      const appRows = await query<{ booking_id: number | null; lead_id: number | null }>(
        // MT-06: ownership gate — a foreign loan application resolves to nothing.
        `SELECT booking_id, lead_id FROM loan_applications WHERE id = $1 AND organization_id = $2`,
        [Number(id), await getOrganizationId()]
      );
      if (appRows.length === 0) {
        return NextResponse.json({ success: false, message: "Loan application not found" }, { status: 404 });
      }
      // An application raised before a booking exists carries no booking_id; fall
      // back to the lead's booking, exactly as the selection logic below does.
      const gateBookingId = appRows[0].booking_id ?? (await resolveBookingIdForLead(Number(appRows[0].lead_id)));

      // No booking means no agreement value, and therefore no ceiling to breach.
      // Nothing to validate — let the write through rather than inventing a limit.
      if (gateBookingId) {
        try {
          const snapshot = await buildFinancialSnapshot(gateBookingId);
          const proposedSanction = Number(String(body.amount_sanctioned ?? "").replace(/[₹,\s]/g, "")) || 0;
          const obligation = computeFinancialObligation({ ...snapshot, sanctionedAmount: proposedSanction });

          if (obligation.loanOverLimit) {
            return NextResponse.json(
              {
                success: false,
                error: "LOAN_EXCEEDS_CEILING",
                message: `Sanction of ₹${fmtINR(proposedSanction)} exceeds ceiling of ₹${fmtINR(obligation.maxAllowedLoan)} based on current customer contributions.`,
                maxAllowedLoan: obligation.maxAllowedLoan,
                qualifyingContribution: obligation.agreementFunded - obligation.disbursedAmount,
                obligation,
              },
              { status: 422 }
            );
          }
        } catch (e: any) {
          if (e instanceof BookingNotFoundError) {
            return NextResponse.json(
              { success: false, error: "BOOKING_NOT_FOUND", message: e.message },
              { status: 404 }
            );
          }
          throw e;
        }
      }
    }

    const result = await transaction(async (client) => {
      const existing = await client.query(`SELECT * FROM loan_applications WHERE id = $1 AND organization_id = $2`, [Number(id), await getOrganizationId(client)]);
      if (existing.rows.length === 0) return { notFound: true as const };
      const app = existing.rows[0];

      // 1. Dynamic update of provided editable fields.
      const setParts: string[] = [];
      const vals: any[] = [];
      for (const [key, coerce] of Object.entries(EDITABLE)) {
        if (key in body) {
          vals.push(coerce(body[key]));
          setParts.push(`${key} = $${vals.length}`);
        }
      }
      setParts.push(`updated_at = NOW()`);
      vals.push(Number(id));
      const updated = await client.query(
        `UPDATE loan_applications SET ${setParts.join(", ")} WHERE id = $${vals.length} RETURNING *`,
        vals,
      );
      const row = updated.rows[0];

      // 2. Selection logic — only when explicitly selecting this lender.
      if (body.is_selected === true) {
        // Exactly one selected per lead: set this one true, all siblings false.
        await client.query(
          `UPDATE loan_applications SET is_selected = (id = $1), updated_at = NOW() WHERE lead_id = $2`,
          [Number(id), app.lead_id],
        );

        // Resolve the target booking: the app's own booking, else the lead's latest.
        let targetBookingId: number | null = app.booking_id ?? null;
        if (!targetBookingId) {
          const b = await client.query(
            `SELECT id FROM booking_applications WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 1`,
            [app.lead_id],
          );
          targetBookingId = b.rows[0]?.id ?? null;
        }

        const sanctionStatus = row.status === "Sanctioned" ? "Approved" : row.status === "Rejected" ? "Rejected" : "Pending";
        const loanStatus = row.status === "Sanctioned" ? "Sanctioned" : "Pending";

        if (targetBookingId) {
          // Keep the application row pointed at the booking it now drives.
          if (!app.booking_id) {
            await client.query(`UPDATE loan_applications SET booking_id = $1 WHERE id = $2`, [targetBookingId, Number(id)]);
          }
          const upd = await client.query(
            `UPDATE booking_loan_details SET
               loan_required = true, bank_name = $1, loan_type = $2, loan_executive = $3, loan_reference_no = $4,
               loan_amount = $5, sanction_amount = $6, sanction_date = $7, sanction_status = $8, loan_status = $9,
               interest_rate = $10, loan_tenure_months = $11, updated_at = NOW()
             WHERE booking_id = $12`,
            [row.bank_name, row.loan_type, row.loan_executive, row.loan_reference_no,
             row.amount_requested, row.amount_sanctioned, row.sanction_date, sanctionStatus, loanStatus,
             row.interest_rate, row.tenure_months, targetBookingId],
          );
          if (upd.rowCount === 0) {
            await client.query(
              `INSERT INTO booking_loan_details
                 (booking_id, loan_required, bank_name, loan_type, loan_executive, loan_reference_no,
                  loan_amount, sanction_amount, sanction_date, sanction_status, loan_status, interest_rate, loan_tenure_months,
                  organization_id)
               VALUES ($1, true, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                       (SELECT organization_id FROM booking_applications WHERE id = $1))`,
              [targetBookingId, row.bank_name, row.loan_type, row.loan_executive, row.loan_reference_no,
               row.amount_requested, row.amount_sanctioned, row.sanction_date, sanctionStatus, loanStatus,
               row.interest_rate, row.tenure_months],
            );
          }
        } else {
          // No booking yet — merge the winning lender into the lead's draft (JSONB),
          // preserving every other draft key BookingFormModal will read on prefill.
          const merge: Record<string, any> = {
            loan_required: true,
            bank_name: row.bank_name || "",
            loan_type: row.loan_type || "",
            loan_executive: row.loan_executive || "",
            loan_reference_no: row.loan_reference_no || "",
            loan_amount: row.amount_requested != null ? String(row.amount_requested) : "",
            sanction_amount: row.amount_sanctioned != null ? String(row.amount_sanctioned) : "",
            sanction_date: row.sanction_date ? String(row.sanction_date).split("T")[0] : "",
            sanction_status: sanctionStatus,
            loan_status: loanStatus,
            interest_rate: row.interest_rate != null ? String(row.interest_rate) : "",
            loan_tenure_months: row.tenure_months != null ? String(row.tenure_months) : "",
          };
          // Carry forward expected-disbursement planning fields if the lender application
          // row tracks them — otherwise leave the draft's existing values untouched.
          if (row.expected_disbursement_date) merge.expected_disbursement_date = String(row.expected_disbursement_date).split("T")[0];
          if (row.expected_disbursement_amount != null) merge.expected_disbursement_amount = String(row.expected_disbursement_amount);
          await client.query(
            `UPDATE walkin_enquiries
               SET loan_tracking_info = COALESCE(loan_tracking_info, '{}'::jsonb) || $2::jsonb
             WHERE id = $1 AND organization_id = $3`,
            [app.lead_id, JSON.stringify(merge), await getOrganizationId(client)],
          );
        }
      }

      return { row };
    });

    if ("notFound" in result) {
      return NextResponse.json({ success: false, message: "Loan application not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: result.row }, { status: 200 });
  } catch (err: any) {
    console.error("[PUT /api/loan-applications/[id]]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// ─── DELETE — remove a lender application (withdraw from shopping list) ────────
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    // Mirrors `canManage` in LenderApplicationsTracker, which decides whether the
    // delete control renders at all. Site Head belongs here: the component shows
    // them the button, so omitting the role server-side produced a visible action
    // that 403s. UI policy and API policy have to name the same roles.
    const gate = await requireRoles(["admin", "sales manager", "site head"]);
    if (!gate.ok) return gate.response;

    // requireRoles above is the gate. This second check is kept because it is the
    // one that names the policy in the error message, but it now reads the role
    // from the session — `?user_role=admin` on the URL used to satisfy it.
    if (!isLoanManager(gate.session.role || "")) {
      return NextResponse.json({ success: false, message: "Only Admin, Site Head and Sales Managers can delete loan applications." }, { status: 403 });
    }
    await query(`DELETE FROM loan_applications WHERE id = $1`, [Number(id)]);
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err: any) {
    console.error("[DELETE /api/loan-applications/[id]]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
