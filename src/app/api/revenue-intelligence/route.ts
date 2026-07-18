import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRole } from "@/lib/serverAuth";
import { buildRevenueAnalytics } from "@/lib/revenueCalculations";

export const dynamic = "force-dynamic";

const REQUIRED_TABLES = [
  "booking_applications",
  "booking_financials",
  "booking_loan_details",
  "booking_registration_details",
  "financial_accounts",
  "financial_ledger",
  "customer_ledger_view",
];

async function getExistingTables() {
  const rows = await query<{ table_name: string }>(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
    `,
    [REQUIRED_TABLES],
  );
  return new Set(rows.map((row) => row.table_name));
}

async function getColumns(tableName: string) {
  const rows = await query<{ column_name: string }>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
    `,
    [tableName],
  );
  return new Set(rows.map((row) => row.column_name));
}

async function ensureRevenueIndexes() {
  await Promise.all([
    query(`CREATE INDEX IF NOT EXISTS idx_rev_booking_status_date ON booking_applications (booking_status, booking_date)`),
    query(`CREATE INDEX IF NOT EXISTS idx_rev_booking_created_at ON booking_applications (created_at DESC)`),
    query(`CREATE INDEX IF NOT EXISTS idx_rev_financials_booking_id ON booking_financials (booking_id)`),
    query(`CREATE INDEX IF NOT EXISTS idx_rev_loan_booking_id ON booking_loan_details (booking_id)`),
    query(`CREATE INDEX IF NOT EXISTS idx_rev_loan_expected_disbursement ON booking_loan_details (expected_disbursement_date)`),
    query(`CREATE INDEX IF NOT EXISTS idx_rev_registration_booking_id ON booking_registration_details (booking_id)`),
    query(`CREATE INDEX IF NOT EXISTS idx_rev_registration_expected_date ON booking_registration_details (expected_registration_date)`),
  ]);
}

function optionalWalkinColumn(columns: Set<string>, columnName: string, alias: string) {
  if (columns.has(columnName)) return `w.${columnName} AS ${alias}`;
  return `NULL::text AS ${alias}`;
}

function addTextFilter(clauses: string[], params: any[], fieldName: string, value: string | null) {
  if (!value) return;
  params.push(value);
  clauses.push(`LOWER(COALESCE(${fieldName}::text, '')) = LOWER($${params.length})`);
}

function addDateFilter(clauses: string[], params: any[], comparator: ">=" | "<=", value: string | null) {
  if (!value) return;
  params.push(value);
  clauses.push(`COALESCE(expected_disbursement_date, expected_registration_date, booking_date, application_date, created_at::date) ${comparator} $${params.length}::date`);
}

function addRevenueFilter(clauses: string[], params: any[], comparator: ">=" | "<=", value: string | null) {
  if (!value) return;
  params.push(Number(String(value).replace(/[^0-9.-]/g, "")) || 0);
  clauses.push(`agreement_value_number ${comparator} $${params.length}::numeric`);
}

function uniqueOptions(records: Record<string, any>[], key: string) {
  return Array.from(
    new Set(
      records
        .map((record) => String(record[key] || "").trim())
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b));
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireRole(["admin"]);
    if (!auth.isAuthorized) {
      return NextResponse.json({ success: false, message: auth.error }, { status: auth.status });
    }

    const existingTables = await getExistingTables();
    const hasRequiredTables = REQUIRED_TABLES.every((tableName) => existingTables.has(tableName));
    if (!hasRequiredTables) {
      const emptyAnalytics = buildRevenueAnalytics([]);
      return NextResponse.json({
        success: true,
        data: {
          ...emptyAnalytics,
          filters: {
            projects: [],
            buildings: [],
            wings: [],
            floors: [],
            sales_managers: [],
            banks: [],
            loan_statuses: [],
            registration_statuses: [],
            disbursement_statuses: [],
          },
          total: 0,
          updated_at: new Date().toISOString(),
        },
      });
    }

    await ensureRevenueIndexes();

    const { searchParams } = new URL(req.url);
    const walkinColumns = await getColumns("walkin_enquiries");
    const projectSelect = optionalWalkinColumn(walkinColumns, "project", "project");
    const buildingSelect = optionalWalkinColumn(walkinColumns, "building", "building");
    const wingSelect = optionalWalkinColumn(walkinColumns, "wing", "wing");

    const params: any[] = [];
    const clauses: string[] = [];

    addTextFilter(clauses, params, "project", searchParams.get("project"));
    addTextFilter(clauses, params, "building", searchParams.get("building"));
    addTextFilter(clauses, params, "wing", searchParams.get("wing"));
    addTextFilter(clauses, params, "floor", searchParams.get("floor"));
    addTextFilter(clauses, params, "sales_manager", searchParams.get("sales_manager"));
    addTextFilter(clauses, params, "bank_name", searchParams.get("bank"));
    addTextFilter(clauses, params, "loan_status", searchParams.get("loan_status"));
    addTextFilter(clauses, params, "registration_status", searchParams.get("registration_status"));
    addTextFilter(clauses, params, "disbursement_status", searchParams.get("disbursement_status"));
    addDateFilter(clauses, params, ">=", searchParams.get("date_from"));
    addDateFilter(clauses, params, "<=", searchParams.get("date_to"));
    addRevenueFilter(clauses, params, ">=", searchParams.get("revenue_min"));
    addRevenueFilter(clauses, params, "<=", searchParams.get("revenue_max"));

    const whereClause = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

    const sql = `
      WITH base AS (
        SELECT
          b.id AS booking_id,
          b.booking_number,
          COALESCE(NULLIF(b.primary_name, ''), NULLIF(w.name, ''), 'Unknown Customer') AS customer_name,
          COALESCE(NULLIF(w.assigned_to, ''), NULLIF(b.created_by, ''), 'Unassigned') AS sales_manager,
          ${projectSelect},
          ${buildingSelect},
          ${wingSelect},
          b.floor_number AS floor,
          b.flat_number,
          b.property_type,
          b.booking_date,
          b.application_date,
          b.created_at,
          b.booking_status,
          COALESCE(b.agreement_value, 0)::numeric AS agreement_value,
          COALESCE(b.agreement_value, 0)::numeric AS agreement_value_number,
          COALESCE(b.booking_amount, 0)::numeric AS booking_amount,
          COALESCE(clv.gross_collection, 0)::numeric AS gross_collection,
          COALESCE(clv.developer_revenue, 0)::numeric AS developer_revenue,
          COALESCE(clv.government_charges, 0)::numeric AS government_charges,
          COALESCE(clv.net_collection, 0)::numeric AS net_collection,
          COALESCE(clv.outstanding_balance, 0)::numeric AS outstanding_balance,
          COALESCE(f.token_amount, 0)::numeric AS token_amount,
          COALESCE(f.ocr_amount, 0)::numeric AS ocr_amount,
          f.ocr_received_date,
          f.sdr_amount,
          f.sdr_payment_date,
          f.sdr_status,
          COALESCE(f.cash_component, 0)::numeric AS cash_component,
          f.cash_component_date,
          l.loan_required,
          l.bank_name,
          l.loan_executive,
          l.loan_type,
          COALESCE(l.loan_amount, 0)::numeric AS loan_amount,
          COALESCE(l.sanction_amount, 0)::numeric AS sanction_amount,
          l.sanction_date,
          l.sanction_status,
          l.loan_status,
          l.expected_disbursement_date,
          l.actual_disbursement_date,
          COALESCE(l.expected_disbursement_amount, 0)::numeric AS expected_disbursement_amount,
          COALESCE(l.disbursement_amount, 0)::numeric AS disbursement_amount,
          l.disbursement_status,
          r.expected_registration_date,
          r.actual_registration_date,
          r.registration_status,
          r.registration_number,
          p.current_stage,
          p.status AS pipeline_status
        FROM booking_applications b
        LEFT JOIN walkin_enquiries w ON w.id = b.lead_id
        LEFT JOIN booking_financials f ON f.booking_id = b.id
        LEFT JOIN booking_loan_details l ON l.booking_id = b.id
        LEFT JOIN booking_registration_details r ON r.booking_id = b.id
        LEFT JOIN booking_pipeline p ON p.booking_id = b.id
        LEFT JOIN customer_ledger_view clv ON clv.booking_id = b.id
        WHERE LOWER(COALESCE(b.booking_status, '')) IN ('confirmed', 'approved')
      ),
      filtered AS (
        SELECT *
        FROM base
        ${whereClause}
      )
      SELECT *
      FROM filtered
      ORDER BY expected_disbursement_date ASC NULLS LAST, created_at DESC
      LIMIT 5000
    `;

    const records = await query(sql, params);
    const analytics = buildRevenueAnalytics(records);
    const enrichedRecords = analytics.records;

    return NextResponse.json({
      success: true,
      data: {
        ...analytics,
        filters: {
          projects: uniqueOptions(enrichedRecords, "project"),
          buildings: uniqueOptions(enrichedRecords, "building"),
          wings: uniqueOptions(enrichedRecords, "wing"),
          floors: uniqueOptions(enrichedRecords, "floor"),
          sales_managers: uniqueOptions(enrichedRecords, "sales_manager"),
          banks: uniqueOptions(enrichedRecords, "bank_name"),
          loan_statuses: uniqueOptions(enrichedRecords, "loan_status"),
          registration_statuses: uniqueOptions(enrichedRecords, "registration_status"),
          disbursement_statuses: uniqueOptions(enrichedRecords, "disbursement_status"),
        },
        total: enrichedRecords.length,
        updated_at: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    console.error("[GET /api/revenue-intelligence]", err);
    return NextResponse.json({ success: false, message: err.message || "Revenue intelligence failed" }, { status: 500 });
  }
}
