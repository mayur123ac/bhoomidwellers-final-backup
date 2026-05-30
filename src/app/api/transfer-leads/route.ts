// app/api/transfer-leads/route.ts
import { NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
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
      const result = await client.query(
        `UPDATE public.walkin_enquiries
         SET assigned_to = $2
         WHERE assigned_to = $1`,
        [from.trim(), to.trim()]
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
