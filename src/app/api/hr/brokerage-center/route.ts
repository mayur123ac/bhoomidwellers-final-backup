// app/api/hr/brokerage-center/route.ts
//
// GET — Paginated, searchable booking list for the Brokerage Management Center.
// Returns all organization bookings with LEFT JOIN to booking_brokerage so that
// unconfigured bookings are visible.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = await requireRoles(["hr", "admin"]);
  if (!gate.ok) return gate.response!;

  const orgId = await getOrganizationId();
  if (!orgId) {
    return NextResponse.json({ success: false, error: "Organization not found" }, { status: 403 });
  }

  try {

    const sp = req.nextUrl.searchParams;
    const page = Math.max(1, parseInt(sp.get("page") || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(sp.get("limit") || "20", 10)));
    const offset = (page - 1) * limit;
    const search = (sp.get("search") || "").trim();
    const tab = sp.get("tab") || "all"; // all | received | pending | expected | unconfigured
    const employee = sp.get("employee") || "";
    const project = sp.get("project") || "";
    const dateFrom = sp.get("dateFrom") || "";
    const dateTo = sp.get("dateTo") || "";

    const conditions: string[] = [
      "ba.organization_id = $1",
      "LOWER(COALESCE(ba.booking_status, '')) <> 'cancelled'",
    ];
    const params: any[] = [orgId];
    let pIdx = 2;

    // Tab filters
    if (tab === "received") {
      conditions.push(`bb.status = 'received'`);
    } else if (tab === "pending") {
      conditions.push(`bb.status IN ('partially_received', 'pending')`);
    } else if (tab === "expected") {
      conditions.push(`bb.status = 'expected'`);
    } else if (tab === "unconfigured") {
      conditions.push(`bb.id IS NULL`);
    }

    // Search
    if (search) {
      conditions.push(`(
        ba.booking_number ILIKE $${pIdx}
        OR ba.primary_name ILIKE $${pIdx}
        OR ba.created_by ILIKE $${pIdx}
        OR ba.project_name ILIKE $${pIdx}
        OR w.name ILIKE $${pIdx}
      )`);
      params.push(`%${search}%`);
      pIdx++;
    }

    // Employee filter
    if (employee) {
      conditions.push(`ba.created_by = $${pIdx}`);
      params.push(employee);
      pIdx++;
    }

    // Project filter
    if (project) {
      conditions.push(`ba.project_name = $${pIdx}`);
      params.push(project);
      pIdx++;
    }

    // Date filters
    if (dateFrom) {
      conditions.push(`COALESCE(ba.booking_date, ba.created_at::date) >= $${pIdx}::date`);
      params.push(dateFrom);
      pIdx++;
    }
    if (dateTo) {
      conditions.push(`COALESCE(ba.booking_date, ba.created_at::date) <= $${pIdx}::date`);
      params.push(dateTo);
      pIdx++;
    }

    const where = conditions.join(" AND ");

    // Count
    const countResult = await query<any>(
      `SELECT COUNT(*)::int AS total
       FROM booking_applications ba
       LEFT JOIN booking_brokerage bb ON bb.booking_id = ba.id AND bb.organization_id = ba.organization_id
       LEFT JOIN walkin_enquiries w ON w.id = ba.lead_id AND w.organization_id = ba.organization_id
       WHERE ${where}`,
      params
    );
    const total = Number(countResult[0]?.total ?? 0);

    // Tab counts (summary for badges)
    const tabCountResult = await query<any>(
      `SELECT
         COUNT(*)::int AS all_count,
         COUNT(CASE WHEN bb.status = 'received' THEN 1 END)::int AS received_count,
         COUNT(CASE WHEN bb.status IN ('partially_received','pending') THEN 1 END)::int AS pending_count,
         COUNT(CASE WHEN bb.status = 'expected' THEN 1 END)::int AS expected_count,
         COUNT(CASE WHEN bb.id IS NULL THEN 1 END)::int AS unconfigured_count,
         COALESCE(SUM(CASE WHEN bb.status = 'received' THEN bb.received_amount END), 0) AS received_total,
         COALESCE(SUM(CASE WHEN bb.status IN ('partially_received','pending') THEN bb.brokerage_amount - bb.received_amount END), 0) AS pending_total,
         COALESCE(SUM(CASE WHEN bb.status = 'expected' THEN bb.brokerage_amount END), 0) AS expected_total
       FROM booking_applications ba
       LEFT JOIN booking_brokerage bb ON bb.booking_id = ba.id AND bb.organization_id = ba.organization_id
       WHERE ba.organization_id = $1
         AND LOWER(COALESCE(ba.booking_status, '')) <> 'cancelled'`,
      [orgId]
    );
    const tc = tabCountResult[0] || {};

    // Records — enriched with financial sub-tables (same joins as Revenue Intelligence)
    const records = await query<any>(
      `SELECT ba.id, ba.booking_number, ba.lead_id,
              ba.booking_status,
              TO_CHAR(ba.booking_date, 'YYYY-MM-DD') AS booking_date,
              ba.agreement_value,
              ba.booking_amount,
              ba.project_name,
              ba.flat_number,
              ba.tower,
              ba.wing,
              ba.primary_name,
              ba.primary_mobile,
              ba.created_by,
              ba.created_at,
              w.name AS customer_name,
              w.phone AS customer_phone,
              COALESCE(NULLIF(w.assigned_to, ''), NULLIF(ba.created_by, ''), 'Unassigned') AS sales_manager,
              -- Financial sub-tables
              COALESCE(f.token_amount, 0) AS token_amount,
              COALESCE(f.ocr_amount, 0) AS ocr_amount,
              COALESCE(f.cash_component, 0) AS cash_component,
              COALESCE(l.sanction_amount, 0) AS sanction_amount,
              COALESCE(l.disbursement_amount, 0) AS disbursement_amount,
              l.bank_name,
              COALESCE(r.registration_fee_amount, 0) AS registration_fee_amount,
              -- Brokerage
              bb.id AS brokerage_id,
              bb.brokerage_method,
              bb.brokerage_rate,
              bb.agreement_value_snapshot,
              bb.brokerage_amount,
              bb.source AS brokerage_source,
              bb.status AS brokerage_status,
              bb.received_amount,
              bb.received_date,
              bb.notes AS brokerage_notes
       FROM booking_applications ba
       LEFT JOIN booking_brokerage bb ON bb.booking_id = ba.id AND bb.organization_id = ba.organization_id
       LEFT JOIN walkin_enquiries w ON w.id = ba.lead_id AND w.organization_id = ba.organization_id
       LEFT JOIN booking_financials f ON f.booking_id = ba.id
       LEFT JOIN booking_loan_details l ON l.booking_id = ba.id
       LEFT JOIN booking_registration_details r ON r.booking_id = ba.id
       WHERE ${where}
       ORDER BY COALESCE(ba.booking_date, ba.created_at::date) DESC, ba.id DESC
       LIMIT $${pIdx} OFFSET $${pIdx + 1}`,
      [...params, limit, offset]
    );

    // Distinct employees and projects for filter dropdowns
    const filtersResult = await query<any>(
      `SELECT
         ARRAY_AGG(DISTINCT ba.created_by) FILTER (WHERE ba.created_by IS NOT NULL) AS employees,
         ARRAY_AGG(DISTINCT ba.project_name) FILTER (WHERE ba.project_name IS NOT NULL) AS projects
       FROM booking_applications ba
       WHERE ba.organization_id = $1
         AND LOWER(COALESCE(ba.booking_status, '')) <> 'cancelled'`,
      [orgId]
    );
    const filters = filtersResult[0] || {};

    return NextResponse.json({
      success: true,
      data: {
        records: records.map((r: any) => ({
          id: r.id,
          bookingNumber: r.booking_number,
          bookingStatus: r.booking_status,
          bookingDate: r.booking_date,
          agreementValue: Number(r.agreement_value ?? 0),
          bookingAmount: Number(r.booking_amount ?? 0),
          projectName: r.project_name || "",
          flatNumber: r.flat_number || "",
          tower: r.tower || "",
          wing: r.wing || "",
          primaryName: r.primary_name || "",
          customerName: r.customer_name || r.primary_name || "",
          customerPhone: r.customer_phone || r.primary_mobile || "",
          createdBy: r.created_by || "",
          createdAt: r.created_at,
          salesManager: r.sales_manager || "Unassigned",
          // Financial fields from sub-tables
          tokenAmount: Number(r.token_amount ?? 0),
          ocrAmount: Number(r.ocr_amount ?? 0),
          cashComponent: Number(r.cash_component ?? 0),
          sanctionAmount: Number(r.sanction_amount ?? 0),
          disbursementAmount: Number(r.disbursement_amount ?? 0),
          bankName: r.bank_name || "",
          registrationAmount: Number(r.registration_fee_amount ?? 0),
          // Brokerage
          brokerageId: r.brokerage_id,
          brokerageMethod: r.brokerage_method,
          brokerageRate: r.brokerage_rate != null ? Number(r.brokerage_rate) : null,
          brokerageAmount: r.brokerage_amount != null ? Number(r.brokerage_amount) : null,
          brokerageSource: r.brokerage_source,
          brokerageStatus: r.brokerage_status,
          receivedAmount: Number(r.received_amount ?? 0),
          receivedDate: r.received_date,
          brokerageNotes: r.brokerage_notes,
          agreementValueSnapshot: r.agreement_value_snapshot != null ? Number(r.agreement_value_snapshot) : null,
        })),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        tabCounts: {
          all: Number(tc.all_count ?? 0),
          received: Number(tc.received_count ?? 0),
          pending: Number(tc.pending_count ?? 0),
          expected: Number(tc.expected_count ?? 0),
          unconfigured: Number(tc.unconfigured_count ?? 0),
          receivedTotal: Number(tc.received_total ?? 0),
          pendingTotal: Number(tc.pending_total ?? 0),
          expectedTotal: Number(tc.expected_total ?? 0),
        },
        filters: {
          employees: (filters.employees || []).sort(),
          projects: (filters.projects || []).sort(),
        },
      },
    });
  } catch (error: any) {
    console.error("GET /api/hr/brokerage-center error:", error);

    const msg = String(error.message || "");
    if (msg.includes("does not exist") && msg.includes("booking_brokerage")) {
      // Migration not yet applied — fall back to booking_applications only
      try {
        const sp = req.nextUrl.searchParams;
        const fbPage = Math.max(1, parseInt(sp.get("page") || "1", 10));
        const fbLimit = Math.min(50, Math.max(1, parseInt(sp.get("limit") || "20", 10)));
        const fbOffset = (fbPage - 1) * fbLimit;
        const fbSearch = (sp.get("search") || "").trim();
        const fbTab = sp.get("tab") || "all";

        // Only the "unconfigured" tab makes sense pre-migration (all are unconfigured)
        // Other brokerage tabs return empty because no brokerage records exist
        if (fbTab !== "all" && fbTab !== "unconfigured") {
          return NextResponse.json({
            success: true,
            data: { records: [], pagination: { page: fbPage, limit: fbLimit, total: 0, totalPages: 0 },
              tabCounts: { all: 0, received: 0, pending: 0, expected: 0, unconfigured: 0, receivedTotal: 0, pendingTotal: 0, expectedTotal: 0 },
              filters: { employees: [], projects: [] } },
            _migrationPending: true,
          });
        }

        const fbConditions: string[] = [
          "ba.organization_id = $1",
          "LOWER(COALESCE(ba.booking_status, '')) <> 'cancelled'",
        ];
        const fbParams: any[] = [orgId];
        let fbIdx = 2;

        if (fbSearch) {
          fbConditions.push(`(ba.booking_number ILIKE $${fbIdx} OR ba.primary_name ILIKE $${fbIdx} OR ba.created_by ILIKE $${fbIdx} OR ba.project_name ILIKE $${fbIdx})`);
          fbParams.push(`%${fbSearch}%`);
          fbIdx++;
        }

        const fbWhere = fbConditions.join(" AND ");

        const fbCount = await query<any>(
          `SELECT COUNT(*)::int AS total FROM booking_applications ba WHERE ${fbWhere}`,
          fbParams
        );
        const fbTotal = Number(fbCount[0]?.total ?? 0);

        const fbRecords = await query<any>(
          `SELECT ba.id, ba.booking_number, ba.booking_status,
                  TO_CHAR(ba.booking_date, 'YYYY-MM-DD') AS booking_date,
                  ba.agreement_value, ba.booking_amount, ba.project_name,
                  ba.flat_number, ba.tower, ba.wing, ba.primary_name,
                  ba.primary_mobile, ba.created_by, ba.created_at
           FROM booking_applications ba
           WHERE ${fbWhere}
           ORDER BY COALESCE(ba.booking_date, ba.created_at::date) DESC, ba.id DESC
           LIMIT $${fbIdx} OFFSET $${fbIdx + 1}`,
          [...fbParams, fbLimit, fbOffset]
        );

        const fbFilters = await query<any>(
          `SELECT ARRAY_AGG(DISTINCT ba.created_by) FILTER (WHERE ba.created_by IS NOT NULL) AS employees,
                  ARRAY_AGG(DISTINCT ba.project_name) FILTER (WHERE ba.project_name IS NOT NULL) AS projects
           FROM booking_applications ba
           WHERE ba.organization_id = $1 AND LOWER(COALESCE(ba.booking_status, '')) <> 'cancelled'`,
          [orgId]
        );
        const fbF = fbFilters[0] || {};

        return NextResponse.json({
          success: true,
          data: {
            records: fbRecords.map((r: any) => ({
              id: r.id, bookingNumber: r.booking_number, bookingStatus: r.booking_status,
              bookingDate: r.booking_date, agreementValue: Number(r.agreement_value ?? 0),
              bookingAmount: Number(r.booking_amount ?? 0), projectName: r.project_name || "",
              flatNumber: r.flat_number || "", tower: r.tower || "", wing: r.wing || "",
              primaryName: r.primary_name || "", customerName: r.primary_name || "",
              customerPhone: r.primary_mobile || "", createdBy: r.created_by || "",
              createdAt: r.created_at, salesManager: r.created_by || "Unassigned",
              tokenAmount: 0, ocrAmount: 0, cashComponent: 0,
              sanctionAmount: 0, disbursementAmount: 0, bankName: "",
              registrationAmount: 0,
              brokerageId: null, brokerageMethod: null, brokerageRate: null,
              brokerageAmount: null, brokerageSource: null, brokerageStatus: null,
              receivedAmount: 0, receivedDate: null, brokerageNotes: null,
              agreementValueSnapshot: null,
            })),
            pagination: { page: fbPage, limit: fbLimit, total: fbTotal, totalPages: Math.ceil(fbTotal / fbLimit) },
            tabCounts: { all: fbTotal, received: 0, pending: 0, expected: 0, unconfigured: fbTotal, receivedTotal: 0, pendingTotal: 0, expectedTotal: 0 },
            filters: { employees: (fbF.employees || []).sort(), projects: (fbF.projects || []).sort() },
          },
          _migrationPending: true,
        });
      } catch (fbErr: any) {
        console.error("Fallback query also failed:", fbErr);
        return NextResponse.json({
          success: true,
          data: { records: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
            tabCounts: { all: 0, received: 0, pending: 0, expected: 0, unconfigured: 0, receivedTotal: 0, pendingTotal: 0, expectedTotal: 0 },
            filters: { employees: [], projects: [] } },
          _migrationPending: true,
        });
      }
    }

    return NextResponse.json(
      { success: false, error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
