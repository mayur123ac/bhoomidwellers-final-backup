// app/api/hr/assets/route.ts
//
// GET  — list all company assets (filterable by status, type)
// POST — create a new company asset
//
// Gate: hr, admin.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRoles, getSessionUserId } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { ASSET_CONDITIONS, ASSET_STATUSES } from "@/lib/hr/constants";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = await requireRoles(["hr", "admin"]);
  if (!gate.ok) return gate.response;

  try {
    const orgId = await getOrganizationId();
    const sp = req.nextUrl.searchParams;
    const status = sp.get("status") || "";
    const type = sp.get("type") || "";
    const search = (sp.get("search") || "").trim();

    const conditions: string[] = ["ca.organization_id = $1"];
    const values: any[] = [orgId];
    let idx = 2;

    if (status && (ASSET_STATUSES as readonly string[]).includes(status)) {
      conditions.push(`ca.asset_status = $${idx++}`);
      values.push(status);
    }
    if (type) {
      conditions.push(`ca.asset_type = $${idx++}`);
      values.push(type);
    }
    if (search) {
      conditions.push(`(ca.asset_name ILIKE $${idx} OR ca.serial_number ILIKE $${idx})`);
      values.push(`%${search}%`);
      idx++;
    }

    const rows = await query<any>(
      `SELECT ca.id, ca.asset_type, ca.asset_name, ca.serial_number, ca.make_model,
              ca.purchase_date, ca.purchase_value, ca.current_condition,
              ca.asset_status, ca.remarks, ca.created_at,
              -- Current assignment (if any)
              asgn.user_id AS assigned_to_id,
              u.name AS assigned_to_name,
              asgn.assigned_date
         FROM company_assets ca
         LEFT JOIN LATERAL (
           SELECT user_id, assigned_date
             FROM employee_asset_assignments
            WHERE asset_id = ca.id AND returned_date IS NULL
            ORDER BY assigned_date DESC LIMIT 1
         ) asgn ON true
         LEFT JOIN users u ON u.id = asgn.user_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY ca.created_at DESC`,
      values
    );

    return NextResponse.json({ success: true, data: rows });
  } catch (err: any) {
    console.error("[GET /api/hr/assets]", err);
    return NextResponse.json({ success: false, message: "Failed to load assets." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireRoles(["hr", "admin"]);
  if (!gate.ok) return gate.response;

  try {
    const orgId = await getOrganizationId();
    const body = await req.json();
    const {
      assetType, assetName, serialNumber, makeModel,
      purchaseDate, purchaseValue, currentCondition, remarks,
    } = body;

    if (!assetType?.trim() || !assetName?.trim()) {
      return NextResponse.json(
        { success: false, message: "Asset type and name are required." },
        { status: 400 }
      );
    }

    const condition = (ASSET_CONDITIONS as readonly string[]).includes(currentCondition)
      ? currentCondition
      : "good";

    const createdBy = getSessionUserId(gate.session);

    const result = await query<{ id: number }>(
      `INSERT INTO company_assets
         (organization_id, asset_type, asset_name, serial_number, make_model,
          purchase_date, purchase_value, current_condition, asset_status, remarks, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'available', $9, $10)
       RETURNING id`,
      [
        orgId, assetType.trim(), assetName.trim(),
        serialNumber?.trim() || null,
        makeModel?.trim() || null,
        purchaseDate || null,
        purchaseValue != null ? purchaseValue : null,
        condition,
        remarks?.trim() || null,
        createdBy,
      ]
    );

    return NextResponse.json(
      { success: true, id: result[0].id, message: "Asset created." },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("[POST /api/hr/assets]", err);
    return NextResponse.json({ success: false, message: "Failed to create asset." }, { status: 500 });
  }
}
