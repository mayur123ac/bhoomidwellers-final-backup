// app/api/inventory/bulk/route.ts
// Bulk soft-delete a set of unit ids. Admin-only. Linked/active units are SKIPPED
// (never force-deleted in a bulk sweep) and reported — matching the created/skipped
// summary pattern. Each deletion writes an inventory_unit_history row.
import { NextRequest, NextResponse } from "next/server";
import { transaction } from "@/lib/db";
import { isAdmin, isLinkedActive, linkDescriptor, softDeleteUnit } from "@/lib/inventoryDelete";

export const dynamic = "force-dynamic";

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { ids, user_name, user_role } = body;

    if (!isAdmin(user_role))
      return NextResponse.json({ success: false, message: "Only Admin can delete units." }, { status: 403 });
    if (!Array.isArray(ids) || ids.length === 0)
      return NextResponse.json({ success: false, message: "No unit ids provided." }, { status: 400 });

    const actor = user_name || "admin";
    const numIds = ids.map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n));

    const result = await transaction(async (client) => {
      const rows = (await client.query(
        `SELECT * FROM inventory_units WHERE id = ANY($1) AND deleted_at IS NULL`,
        [numIds],
      )).rows;

      const skipped: { id: number; flat_no: string; reason: string }[] = [];
      const deletable: any[] = [];
      for (const u of rows) {
        if (isLinkedActive(u)) skipped.push({ id: u.id, flat_no: u.flat_no, reason: `linked to ${linkDescriptor(u)}` });
        else deletable.push(u);
      }

      for (const u of deletable) {
        await softDeleteUnit(client, u, actor, `deleted via bulk action (${deletable.length} units)`);
      }
      return { deleted: deletable.length, skipped };
    });

    return NextResponse.json({
      success: true,
      deleted: result.deleted,
      skipped: result.skipped.length,
      total: numIds.length,
      skipped_details: result.skipped,
    }, { status: 200 });
  } catch (err: any) {
    console.error("[DELETE /api/inventory/bulk]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
