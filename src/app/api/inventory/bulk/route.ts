// app/api/inventory/bulk/route.ts
// Bulk soft-delete a set of unit ids. Admin-only. Linked/active units are SKIPPED
// (never force-deleted in a bulk sweep) and reported — matching the created/skipped
// summary pattern. Each deletion writes an inventory_unit_history row.
import { NextRequest, NextResponse } from "next/server";
import { transaction } from "@/lib/db";
import { requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { isLinkedActive, isBookingProtected, bookingProtectedReason, linkDescriptor, softDeleteUnit } from "@/lib/inventoryDelete";

export const dynamic = "force-dynamic";

export async function DELETE(req: NextRequest) {
  try {
    // Role comes from the signed session, never the body. This previously read
    // `user_role` out of the POST body, so `{"ids":[1,2,3],"user_role":"admin"}`
    // from any anonymous client soft-deleted inventory. Same policy as before —
    // Admin only — but now it is a control rather than a suggestion.
    const gate = await requireRoles(["admin"]);
    if (!gate.ok) return gate.response;

    const body = await req.json().catch(() => ({}));
    const { ids } = body;

    if (!Array.isArray(ids) || ids.length === 0)
      return NextResponse.json({ success: false, message: "No unit ids provided." }, { status: 400 });

    const actor = gate.session.name || "admin";
    const numIds = ids.map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n));

    const result = await transaction(async (client) => {
      // TENANT: the id list comes straight from the request body. Without the
      // organization predicate this loaded ANOTHER builder's units and — for any
      // of them not linked to a lead or booking — soft-deleted them. The
      // linked-active guard below is a business rule, not an access control; it
      // happened to spare booked stock but would have erased available stock.
      //
      // A foreign id now simply matches no row, so it neither deletes nor appears
      // in `skipped` — the response cannot be used to probe which ids exist
      // elsewhere.
      const rows = (await client.query(
        `SELECT * FROM inventory_units
          WHERE id = ANY($1) AND organization_id = $2 AND deleted_at IS NULL`,
        [numIds, await getOrganizationId(client)],
      )).rows;

      const skipped: { id: number; flat_no: string; reason: string }[] = [];
      const deletable: any[] = [];
      for (const u of rows) {
        // Hard block first: booking-protected units can never be deleted.
        if (isBookingProtected(u)) skipped.push({ id: u.id, flat_no: u.flat_no, reason: bookingProtectedReason(u) });
        else if (isLinkedActive(u)) skipped.push({ id: u.id, flat_no: u.flat_no, reason: `linked to ${linkDescriptor(u)}` });
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
