// app/api/loan-applications/[id]/route.ts
// Update a lender application (status, sanction, rejection). Selecting a lender
// (is_selected=true) is the pivotal action: it deselects sibling applications and
// copies the winning lender's details into the single source of truth —
// booking_loan_details if a booking exists, otherwise the lead's draft.
import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";

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
    const body = await req.json();
    const { user_name, user_role } = body;
    if (!user_name || !user_role) {
      return NextResponse.json({ success: false, message: "user_name and user_role are required" }, { status: 400 });
    }
    if (!isLoanManager(user_role)) {
      return NextResponse.json({ success: false, message: "Only Admin, Site Head and Sales Managers can update loan applications." }, { status: 403 });
    }

    const result = await transaction(async (client) => {
      const existing = await client.query(`SELECT * FROM loan_applications WHERE id = $1`, [Number(id)]);
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
                  loan_amount, sanction_amount, sanction_date, sanction_status, loan_status, interest_rate, loan_tenure_months)
               VALUES ($1, true, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
              [targetBookingId, row.bank_name, row.loan_type, row.loan_executive, row.loan_reference_no,
               row.amount_requested, row.amount_sanctioned, row.sanction_date, sanctionStatus, loanStatus,
               row.interest_rate, row.tenure_months],
            );
          }
        } else {
          // No booking yet — merge the winning lender into the lead's draft (JSONB),
          // preserving every other draft key BookingFormModal will read on prefill.
          const merge = {
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
          await client.query(
            `UPDATE walkin_enquiries
               SET loan_tracking_info = COALESCE(loan_tracking_info, '{}'::jsonb) || $2::jsonb
             WHERE id = $1`,
            [app.lead_id, JSON.stringify(merge)],
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
    const { searchParams } = new URL(req.url);
    const role = searchParams.get("user_role") || "";
    if (!isLoanManager(role)) {
      return NextResponse.json({ success: false, message: "Only Admin, Site Head and Sales Managers can delete loan applications." }, { status: 403 });
    }
    await query(`DELETE FROM loan_applications WHERE id = $1`, [Number(id)]);
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err: any) {
    console.error("[DELETE /api/loan-applications/[id]]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
