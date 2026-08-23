//api/users/site-head/route.ts
import { getOrganizationId } from "@/lib/tenantContext";
import { NextResponse } from "next/server";
import { query } from "@/lib/db"; 
import { requireSession, requireRoles } from "@/lib/serverAuth";

export async function GET(req: Request) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;
  const orgId = await getOrganizationId();

    // MT-05: the role test is PARENTHESISED before the organization filter is
    // added. `A OR B AND org` binds as `A OR (B AND org)` in SQL, which would
    // have returned every organization's site heads through the first branch.
    //
    // Columns are listed rather than `SELECT *`. The wildcard shipped the whole
    // users row to any signed-in caller — including `password`, which for legacy
    // rows is still plaintext (see lib/passwords.ts). This endpoint feeds a name
    // dropdown and the notification feed's role labels; it needs identity, not
    // credentials. Any column added to `users` later is now opt-in here.
    const rows = await query(
      `SELECT id, name, email, username, role, is_active AS "isActive",
              whatsapp_number, phone, avatar_key, avatar_url, organization_id
         FROM users
        WHERE (LOWER(role) LIKE '%site%head%'
               OR LOWER(role) = 'site_head')
          AND organization_id = $1
        ORDER BY name ASC`,
      [orgId]
    );

    return NextResponse.json({ 
      success: true, 
      data: rows 
    }, { status: 200 });

  } catch (error: any) {
    // This logs the EXACT error to your VS Code terminal
    console.error("🚨 DB Query Failed in Site Head API:", error.message);
    return NextResponse.json({ 
      success: false, 
      message: error.message 
    }, { status: 500 });
  }
}