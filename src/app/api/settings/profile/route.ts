import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { query } from "@/lib/db";
import {
  loadSettingsUser,
  serializeSettingsUser,
  joinName,
} from "@/lib/settingsUser";

export const dynamic = "force-dynamic";

// GET /api/settings/profile — returns the signed-in user's profile
export async function GET() {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const userId = gate.userId;
  if (!userId) {
    return NextResponse.json(
      { success: false, message: "Session carries no user ID." },
      { status: 400 }
    );
  }

  try {
    const row = await loadSettingsUser(userId);
    if (!row) {
      return NextResponse.json(
        { success: false, message: "User not found." },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, user: serializeSettingsUser(row) });
  } catch (err: any) {
    console.error("[GET /api/settings/profile]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// PATCH /api/settings/profile — update name, phone, whatsapp, timezone, weekStartDay
export async function PATCH(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const userId = gate.userId;
  if (!userId) {
    return NextResponse.json(
      { success: false, message: "Session carries no user ID." },
      { status: 400 }
    );
  }

  try {
    const { firstName, lastName, phone, whatsappNumber, timezone, weekStartDay } =
      await req.json();

    if (!firstName?.trim()) {
      return NextResponse.json(
        { success: false, message: "First name is required." },
        { status: 400 }
      );
    }
    if ((firstName ?? "").length > 50) {
      return NextResponse.json(
        { success: false, message: "First name must be 50 characters or fewer." },
        { status: 400 }
      );
    }
    if ((lastName ?? "").length > 50) {
      return NextResponse.json(
        { success: false, message: "Last name must be 50 characters or fewer." },
        { status: 400 }
      );
    }

    const name = joinName(firstName, lastName);

    await query(
      `UPDATE users
          SET name           = $1,
              phone          = $2,
              whatsapp_number = $3,
              timezone       = $4,
              week_start_day = $5
        WHERE id = $6`,
      [
        name,
        phone?.trim() || null,
        whatsappNumber?.trim() || null,
        timezone || "Asia/Kolkata",
        weekStartDay ?? 1,
        userId,
      ]
    );

    const row = await loadSettingsUser(userId);
    if (!row) {
      return NextResponse.json(
        { success: false, message: "User not found after update." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      user: serializeSettingsUser(row),
      message: "Profile saved.",
    });
  } catch (err: any) {
    console.error("[PATCH /api/settings/profile]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
