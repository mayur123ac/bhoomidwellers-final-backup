// api/platform/account/route.ts — the signed-in platform account, for the
// Account Security panel.
//
// Returns the identity and nothing else. In particular it does not return
// `password` in any form, hashed or otherwise: the panel needs to display which
// account is being edited, and that is an email address and a name.
import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/superAdmin";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return gate.response;

  // gate.admin is already the row read back from the database by
  // requireSuperAdmin(), so there is no second query and no chance of
  // returning a field this route did not intend to.
  return NextResponse.json(
    {
      success: true,
      data: {
        id: gate.admin.id,
        name: gate.admin.name,
        email: gate.admin.email,
        role: gate.admin.role,
      },
    },
    { status: 200 }
  );
}
