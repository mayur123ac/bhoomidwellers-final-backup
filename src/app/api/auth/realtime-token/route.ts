import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { requireSession, getSessionUserId } from "@/lib/serverAuth";

const REALTIME_TTL_SECONDS = 60;

function getSupabaseJwtSecret(): Uint8Array | null {
  const raw = process.env.SUPABASE_JWT_SECRET;
  if (!raw || raw.length < 32) return null;
  return new TextEncoder().encode(raw);
}

export async function POST() {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const secret = getSupabaseJwtSecret();
  if (!secret) {
    return NextResponse.json(
      { success: false, message: "Realtime is not configured." },
      { status: 503 },
    );
  }

  const { session } = gate;
  const userId = getSessionUserId(session);

  const token = await new SignJWT({
    sub: String(userId ?? session._id),
    role: "authenticated",
    org: session.org ?? null,
    crm_role: session.role,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(`${REALTIME_TTL_SECONDS}s`)
    .sign(secret);

  return NextResponse.json({ token, expires_in: REALTIME_TTL_SECONDS });
}
