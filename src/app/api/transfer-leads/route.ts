// app/api/transfer-leads/route.ts
import { NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireRole } from "@/lib/serverAuth";

export async function POST(req: Request) {
  try {
    const auth = await requireRole(["admin"]);
    if (!auth.isAuthorized) {
      return NextResponse.json(
        { success: false, message: auth.error },
        { status: auth.status }
      );
    }

    const body = await req.json();
    const { from, to } = body;

    // ── Validate inputs ──
    if (!from || !to) {
      return NextResponse.json(
        { success: false, message: "Both 'from' and 'to' employee names are required." },
        { status: 400 }
      );
    }

    if (from.trim().toLowerCase() === to.trim().toLowerCase()) {
      return NextResponse.json(
        { success: false, message: "Cannot transfer leads to the same employee." },
        { status: 400 }
      );
    }

    // ── Execute transfer inside a transaction ──
    const transferred = await transaction(async (client) => {
      // Bulk reassignment keyed on employee NAME. Without the organization
      // filter a same-named manager in another builder would have their entire
      // lead book reassigned by this call.
      const orgId = await getOrganizationId(client);

      // Resolve both source and target names to user IDs.
      // WHERE uses dual predicate so migrated rows (FK set) are caught even
      // if the name string diverged from the canonical display name.
      const [fromUserRow, toUserRow] = await Promise.all([
        client.query(
          `SELECT id FROM users
           WHERE organization_id = $1
             AND LOWER(TRIM(name)) = LOWER(TRIM($2))
             AND deleted_at IS NULL
           ORDER BY is_active DESC, id ASC LIMIT 1`,
          [orgId, from.trim()]
        ),
        client.query(
          `SELECT id FROM users
           WHERE organization_id = $1
             AND LOWER(TRIM(name)) = LOWER(TRIM($2))
             AND deleted_at IS NULL
           ORDER BY is_active DESC, id ASC LIMIT 1`,
          [orgId, to]
        ),
      ]);
      const fromUserId: number | null = fromUserRow.rows[0]?.id ?? null;
      const toUserId: number | null = toUserRow.rows[0]?.id ?? null;

      const result = await client.query(
        `UPDATE public.walkin_enquiries
         SET assigned_to = $2,
             assigned_to_user_id = $5
         WHERE (
           ($4::int IS NOT NULL AND assigned_to_user_id = $4::int)
           OR (assigned_to_user_id IS NULL AND LOWER(TRIM(COALESCE(assigned_to, ''))) = LOWER(TRIM($1)))
         ) AND organization_id = $3`,
        [from.trim(), to, orgId, fromUserId, toUserId]
      );
      return result.rowCount ?? 0;
    });

    return NextResponse.json(
      {
        success: true,
        transferred,
        message: transferred > 0
          ? `${transferred} lead(s) transferred from "${from}" to "${to}".`
          : `No leads found assigned to "${from}".`,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("POST /api/transfer-leads error:", error);
    return NextResponse.json(
      { success: false, message: error.message || "Transfer failed." },
      { status: 500 }
    );
  }
}
