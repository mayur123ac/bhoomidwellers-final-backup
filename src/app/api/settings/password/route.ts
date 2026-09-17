// api/settings/password/route.ts — DEPRECATED.
//
// This single-step endpoint has been replaced by a multi-step flow:
//   1. POST /api/settings/password/verify-current   (Case A Step 1)
//      POST /api/settings/password/recover           (Case B Step 1)
//   2. POST /api/settings/password/verify-otp        (Step 2)
//   3. POST /api/settings/password/change             (Step 3)
//
// Kept to reject any lingering callers gracefully.
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    {
      success: false,
      message:
        "This endpoint has been retired. Use the multi-step password change flow instead.",
    },
    { status: 410 }
  );
}
