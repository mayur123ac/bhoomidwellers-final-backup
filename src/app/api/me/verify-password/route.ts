// app/api/me/verify-password/route.ts
//
// POST — Re-authenticate the logged-in user by password.
// On success, issues a short-lived salary-view authorization token
// stored as an HMAC hash in password_change_authorizations (purpose = "salary_view").
//
// The same infrastructure that gates password changes gates salary viewing:
// purpose-specific, time-limited, single-use-per-session grants.

import { NextRequest, NextResponse } from "next/server";
import { requireSession, getSessionUserId } from "@/lib/serverAuth";
import { verifyPassword } from "@/lib/passwords";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { createPasswordChangeAuth } from "@/lib/passwordChangeAuth";

export const dynamic = "force-dynamic";

const SALARY_VIEW_PURPOSE = "salary_view";

// In-memory rate limiter for failed attempts (per userId).
// Survives across requests within the same server instance.
const failedAttempts = new Map<number, { count: number; windowStart: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(userId: number): boolean {
  const now = Date.now();
  const entry = failedAttempts.get(userId);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    return true; // OK
  }
  return entry.count < MAX_ATTEMPTS;
}

function recordFailure(userId: number): void {
  const now = Date.now();
  const entry = failedAttempts.get(userId);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    failedAttempts.set(userId, { count: 1, windowStart: now });
  } else {
    entry.count++;
  }
}

function clearFailures(userId: number): void {
  failedAttempts.delete(userId);
}

export async function POST(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const userId = getSessionUserId(gate.session);
  if (!userId) {
    return NextResponse.json(
      { success: false, message: "Session carries no user ID." },
      { status: 400 }
    );
  }

  // Rate limit
  if (!checkRateLimit(userId)) {
    return NextResponse.json(
      { success: false, message: "Too many attempts. Please try again later." },
      { status: 429 }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const password = (body?.password ?? "").toString();

    if (!password) {
      return NextResponse.json(
        { success: false, message: "Password is required." },
        { status: 400 }
      );
    }

    // Fetch stored password for this user
    const rows = await query<{ password: string }>(
      `SELECT password FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, message: "User not found." },
        { status: 404 }
      );
    }

    const valid = await verifyPassword(password, rows[0].password);

    if (!valid) {
      recordFailure(userId);
      return NextResponse.json(
        { success: false, message: "Incorrect password." },
        { status: 403 }
      );
    }

    // Password correct — clear failures and issue a salary-view grant
    clearFailures(userId);

    const orgId = await getOrganizationId();

    // Reuse password_change_authorizations with purpose = "salary_view"
    // Token expires in 5 minutes (AUTH_TTL_MINUTES from passwordChangeAuth.ts)
    const token = await createPasswordChangeAuth(userId, SALARY_VIEW_PURPOSE, orgId);

    return NextResponse.json({
      success: true,
      salaryViewToken: token,
      expiresInSeconds: 5 * 60,
    });
  } catch (err: any) {
    console.error("[POST /api/me/verify-password]", err?.message);
    return NextResponse.json(
      { success: false, message: "Verification failed." },
      { status: 500 }
    );
  }
}
