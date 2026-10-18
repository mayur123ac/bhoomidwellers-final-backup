// app/api/hr/holidays/route.ts
//
// GET  — list organization holidays (filterable by year)
// POST — create a new holiday
//
// Gate: hr, admin.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRoles, getSessionUserId } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { HOLIDAY_TYPES } from "@/lib/hr/constants";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = await requireRoles(["hr", "admin"]);
  if (!gate.ok) return gate.response;

  try {
    const orgId = await getOrganizationId();
    const sp = req.nextUrl.searchParams;
    const year = sp.get("year") || new Date().getFullYear().toString();
    const includeInactive = sp.get("includeInactive") === "true";

    const conditions = ["h.organization_id = $1", "EXTRACT(YEAR FROM h.holiday_date) = $2"];
    const values: any[] = [orgId, Number(year)];

    if (!includeInactive) {
      conditions.push("h.is_active = true");
    }

    const rows = await query<any>(
      `SELECT h.id, h.holiday_date, h.name, h.type, h.is_active,
              h.created_by, cb.name AS created_by_name,
              h.deactivated_by, db.name AS deactivated_by_name,
              h.deactivated_at, h.created_at
         FROM organization_holidays h
         LEFT JOIN users cb ON cb.id = h.created_by
         LEFT JOIN users db ON db.id = h.deactivated_by
        WHERE ${conditions.join(" AND ")}
        ORDER BY h.holiday_date ASC`,
      values
    );

    return NextResponse.json({ success: true, data: rows });
  } catch (err: any) {
    console.error("[GET /api/hr/holidays]", err);
    return NextResponse.json({ success: false, message: "Failed to load holidays." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireRoles(["hr", "admin"]);
  if (!gate.ok) return gate.response;

  try {
    const orgId = await getOrganizationId();
    const body = await req.json();
    const { holidayDate, name, type } = body;

    if (!holidayDate || !name?.trim()) {
      return NextResponse.json(
        { success: false, message: "Holiday date and name are required." },
        { status: 400 }
      );
    }

    const holidayType = (HOLIDAY_TYPES as readonly string[]).includes(type) ? type : "public";
    const createdBy = getSessionUserId(gate.session);

    const result = await query<{ id: number }>(
      `INSERT INTO organization_holidays
         (organization_id, holiday_date, name, type, created_by)
       VALUES ($1, $2::date, $3, $4, $5)
       ON CONFLICT (organization_id, holiday_date, name) WHERE is_active = true
       DO NOTHING
       RETURNING id`,
      [orgId, holidayDate, name.trim(), holidayType, createdBy]
    );

    if (result.length === 0) {
      return NextResponse.json(
        { success: false, message: "An active holiday with the same date and name already exists." },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { success: true, id: result[0].id, message: "Holiday created." },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("[POST /api/hr/holidays]", err);
    return NextResponse.json({ success: false, message: "Failed to create holiday." }, { status: 500 });
  }
}
