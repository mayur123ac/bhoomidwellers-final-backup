// api/settings/notification-recipients/route.ts
//
// GET  — returns the current notification email routing for the signed-in user.
// POST — saves updated notification email routing.
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/serverAuth";
import { loadSettingsUser } from "@/lib/settingsUser";

export const dynamic = "force-dynamic";

function buildRecipientState(row: any) {
  const pref = row.notification_email_preference || "primary";
  const altEmail = row.secondary_email || null;
  const altVerified = Boolean(row.secondary_email_verified);

  const sendCurrent = pref === "primary" || pref === "both";
  const sendAlt = (pref === "alternative" || pref === "both") && altVerified;

  const addresses: string[] = [];
  const notes: string[] = [];
  if (sendCurrent && row.email) addresses.push(row.email);
  if (sendAlt && altEmail) addresses.push(altEmail);
  if (addresses.length === 0 && row.email) {
    addresses.push(row.email);
    notes.push("Falling back to primary email.");
  }

  return {
    sendCurrentEmail: sendCurrent,
    sendAlternativeEmail: pref === "alternative" || pref === "both",
    currentEmail: row.email || null,
    alternativeEmail: altEmail,
    alternativeEmailVerified: altVerified,
    fallbackEnabled: true,
    verification: {
      status: altVerified ? "verified" : altEmail ? "pending_changes" : "none",
      alternativeEmail: altEmail,
      pendingEmail: null,
      verifiedAt: null,
      sessionId: null,
      resendAvailableIn: 0,
      otpExpiresIn: 0,
      attemptsUsed: 0,
      attemptsRemaining: 5,
      otpsSentThisHour: 0,
      otpsRemainingThisHour: 5,
      failureReason: null,
    },
    preview: { addresses, notes, disabled: false },
    deliveryConfigured: true,
  };
}

export async function GET() {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const userId = gate.userId;
  if (!userId) {
    return NextResponse.json({ success: false, message: "No user ID." }, { status: 400 });
  }

  try {
    const row = await loadSettingsUser(userId);
    if (!row) {
      return NextResponse.json({ success: false, message: "User not found." }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: buildRecipientState(row) });
  } catch (err: any) {
    console.error("[GET /api/settings/notification-recipients]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const userId = gate.userId;
  if (!userId) {
    return NextResponse.json({ success: false, message: "No user ID." }, { status: 400 });
  }

  try {
    const body = await req.json();
    const {
      sendCurrentEmail,
      sendAlternativeEmail,
      alternativeEmail,
    } = body;

    // Derive preference value.
    let pref = "primary";
    if (sendCurrentEmail && sendAlternativeEmail) pref = "both";
    else if (sendAlternativeEmail && !sendCurrentEmail) pref = "alternative";
    else pref = "primary";

    // If alternative email changed, mark as unverified.
    const rows = await query<{ secondary_email: string | null }>(
      `SELECT secondary_email FROM users WHERE id = $1`,
      [userId]
    );
    const currentAlt = rows[0]?.secondary_email || null;
    const newAlt = (alternativeEmail || "").trim() || null;
    const altChanged = newAlt !== currentAlt;

    await query(
      `UPDATE users
          SET notification_email_preference = $1,
              secondary_email = $2,
              secondary_email_verified = CASE WHEN $3 THEN false ELSE secondary_email_verified END
        WHERE id = $4`,
      [pref, newAlt, altChanged, userId]
    );

    const updatedRow = await loadSettingsUser(userId);
    return NextResponse.json({
      success: true,
      data: buildRecipientState(updatedRow),
      message: "Notification routing saved.",
      verificationRequired: altChanged && Boolean(newAlt),
      pendingAddress: altChanged ? newAlt : null,
    });
  } catch (err: any) {
    console.error("[POST /api/settings/notification-recipients]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
