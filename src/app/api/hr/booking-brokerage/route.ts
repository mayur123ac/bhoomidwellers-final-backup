import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = await requireRoles(["hr", "admin"]);
  if (!gate.ok) return gate.response!;

  try {
    const orgId = await getOrganizationId();
    if (!orgId) {
      return NextResponse.json(
        { success: false, error: "Organization not found" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
    const offset = (page - 1) * limit;

    const conditions: string[] = ["bb.organization_id = $1"];
    const params: any[] = [orgId];
    let paramIndex = 2;

    if (status) {
      conditions.push(`bb.status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    if (from) {
      conditions.push(`bb.created_at >= $${paramIndex}`);
      params.push(from);
      paramIndex++;
    }

    if (to) {
      conditions.push(`bb.created_at <= $${paramIndex}`);
      params.push(to);
      paramIndex++;
    }

    const whereClause = conditions.join(" AND ");

    // Count total
    const countResult = await query(
      `SELECT COUNT(*) AS total
       FROM booking_brokerage bb
       WHERE ${whereClause}`,
      params
    );
    const total = parseInt(countResult[0]?.total ?? "0", 10);

    // Fetch records with joins
    const records = await query<any>(
      `SELECT bb.id, bb.booking_id, bb.brokerage_method, bb.brokerage_rate,
              bb.agreement_value_snapshot, bb.brokerage_amount, bb.source,
              bb.status, bb.received_amount, bb.received_date, bb.notes,
              bb.created_at,
              ba.booking_number, ba.agreement_value, ba.booking_date, ba.created_by AS employee_name
       FROM booking_brokerage bb
       LEFT JOIN booking_applications ba ON ba.id = bb.booking_id AND ba.organization_id = bb.organization_id
       WHERE ${whereClause}
       ORDER BY bb.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    return NextResponse.json({
      success: true,
      data: {
        records: records.map((r: any) => ({
          id: r.id, bookingId: r.booking_id, bookingNumber: r.booking_number,
          agreementValue: Number(r.agreement_value ?? r.agreement_value_snapshot ?? 0),
          brokerageMethod: r.brokerage_method, brokerageRate: Number(r.brokerage_rate),
          brokerageAmount: Number(r.brokerage_amount), source: r.source,
          status: r.status, receivedAmount: Number(r.received_amount ?? 0),
          receivedDate: r.received_date, employeeName: r.employee_name || "—",
          bookingDate: r.booking_date, notes: r.notes,
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error: any) {
    console.error("GET /api/hr/booking-brokerage error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireRoles(["hr", "admin"]);
  if (!gate.ok) return gate.response!;

  try {
    const orgId = await getOrganizationId();
    if (!orgId) {
      return NextResponse.json(
        { success: false, error: "Organization not found" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { bookingId, brokerageMethod, brokerageRate, source, notes } = body;

    if (!bookingId) {
      return NextResponse.json(
        { success: false, error: "bookingId is required" },
        { status: 400 }
      );
    }

    const result = await transaction(async (client) => {
      // 1. Fetch the booking with financial sub-tables for calculation basis
      const bookingResult = await client.query(
        `SELECT ba.id, ba.agreement_value, ba.booking_amount, ba.booking_number,
                COALESCE(f.ocr_amount, 0) AS ocr_amount,
                COALESCE(l.disbursement_amount, 0) AS disbursement_amount
         FROM booking_applications ba
         LEFT JOIN booking_financials f ON f.booking_id = ba.id
         LEFT JOIN booking_loan_details l ON l.booking_id = ba.id
         WHERE ba.id = $1 AND ba.organization_id = $2`,
        [bookingId, orgId]
      );

      if (bookingResult.rows.length === 0) {
        throw new Error("Booking not found");
      }

      const booking = bookingResult.rows[0];

      // Determine calculation basis from org settings
      const basisResult = await client.query(
        `SELECT COALESCE(brokerage_calculation_basis, 'agreement_value') AS basis
         FROM organization_settings WHERE organization_id = $1`,
        [orgId]
      );
      const calculationBasis = basisResult.rows[0]?.basis || "agreement_value";
      const agreementValue = Number(booking[calculationBasis] ?? booking.agreement_value) || 0;

      // 2. Determine rate and method — precedence: explicit > project > global
      let finalRate = brokerageRate !== undefined ? Number(brokerageRate) : null;
      let finalMethod = brokerageMethod || null;
      let finalSource = source || "manual_override";

      if (finalRate === null || finalMethod === null) {
        // Try project-level override first
        const projectResult = await client.query(
          `SELECT brokerage_rate, brokerage_method
           FROM project_brokerage_config
           WHERE organization_id = $1
             AND project_name = (SELECT project_name FROM booking_applications WHERE id = $2 AND organization_id = $1)
             AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)`,
          [orgId, bookingId]
        );

        if (projectResult.rows.length > 0) {
          const proj = projectResult.rows[0];
          if (finalRate === null) finalRate = Number(proj.brokerage_rate);
          if (finalMethod === null) finalMethod = proj.brokerage_method;
          finalSource = "project_override";
        } else {
          // Fall back to org-wide global defaults
          const orgDefaults = await client.query(
            `SELECT default_brokerage_rate, default_brokerage_method
             FROM organization_settings
             WHERE organization_id = $1`,
            [orgId]
          );

          if (orgDefaults.rows.length > 0) {
            const defaults = orgDefaults.rows[0];
            if (finalRate === null) {
              finalRate = defaults.default_brokerage_rate !== null
                ? Number(defaults.default_brokerage_rate)
                : 0;
            }
            if (finalMethod === null) {
              finalMethod = defaults.default_brokerage_method || "percentage";
            }
          } else {
            finalRate = finalRate ?? 0;
            finalMethod = finalMethod || "percentage";
          }
          finalSource = "global_default";
        }
      }

      if (finalMethod !== "percentage" && finalMethod !== "fixed") {
        throw new Error("brokerageMethod must be 'percentage' or 'fixed'");
      }

      if (isNaN(finalRate!) || finalRate! < 0) {
        throw new Error("brokerageRate must be a non-negative number");
      }

      if (finalMethod === "percentage" && finalRate! > 100) {
        throw new Error("Percentage rate cannot exceed 100");
      }

      // 3. Calculate brokerage amount
      let brokerageAmount: number;
      if (finalMethod === "percentage") {
        brokerageAmount = agreementValue * finalRate! / 100;
      } else {
        brokerageAmount = finalRate!;
      }

      // 4. Check for existing record (for audit)
      const existingResult = await client.query(
        `SELECT * FROM booking_brokerage
         WHERE booking_id = $1 AND organization_id = $2`,
        [bookingId, orgId]
      );
      const oldValues = existingResult.rows[0] || null;

      // 5. Upsert booking brokerage
      const upsertResult = await client.query(
        `INSERT INTO booking_brokerage
         (booking_id, organization_id, brokerage_rate, brokerage_method,
          brokerage_amount, agreement_value_snapshot, source, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (booking_id, organization_id) DO UPDATE
         SET brokerage_rate = EXCLUDED.brokerage_rate,
             brokerage_method = EXCLUDED.brokerage_method,
             brokerage_amount = EXCLUDED.brokerage_amount,
             agreement_value_snapshot = EXCLUDED.agreement_value_snapshot,
             source = EXCLUDED.source,
             notes = EXCLUDED.notes,
             updated_at = NOW()
         RETURNING *`,
        [
          bookingId,
          orgId,
          finalRate,
          finalMethod,
          brokerageAmount,
          agreementValue,
          finalSource,
          notes || null,
          gate.userId,
        ]
      );

      // 6. Audit log
      await client.query(
        `INSERT INTO brokerage_audit_log
         (organization_id, entity_type, entity_id, action, old_values, new_values, changed_by)
         VALUES ($1, 'booking_brokerage', $2, $3,
                 $4::jsonb, $5::jsonb, $6)`,
        [
          orgId,
          upsertResult.rows[0].id,
          oldValues ? "updated" : "created",
          oldValues ? JSON.stringify(oldValues) : null,
          JSON.stringify(upsertResult.rows[0]),
          gate.userId,
        ]
      );

      return upsertResult.rows[0];
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    console.error("POST /api/hr/booking-brokerage error:", error);
    const status = error.message === "Booking not found" ? 404 : 500;
    return NextResponse.json(
      { success: false, error: error.message || "Internal server error" },
      { status }
    );
  }
}
