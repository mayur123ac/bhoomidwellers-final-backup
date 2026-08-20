// TEMPORARY DIAGNOSTIC — DELETE THIS FILE ONCE LOGIN IS WORKING.
//
// Exists to separate two failures the login error cannot tell apart:
//   "SESSION_SECRET was never injected into this deployment"   → present: false
//   "it was injected but rejected by the length guard"          → present: true, len < 16
//
// Deliberately unauthenticated: login is broken, so there is no session to gate
// on. That makes this an information-disclosure endpoint — it confirms to any
// caller whether a secret is configured and how long it is. That is a small leak
// but a real one, which is why it must not outlive the debugging session.
//
// NEVER returns the value, any prefix of it, or a hash of it. Length and
// presence only.
import { NextResponse } from "next/server";
import { requireRoles } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

export async function GET() {
  // MT-06: this reports the LENGTH of SESSION_SECRET, whether it has stray
  // whitespace, and which deployment answered. That is a useful diagnostic for an
  // admin and a useful reconnaissance result for anyone else, so it is no longer
  // answered anonymously.
  const gate = await requireRoles(["admin"]);
  if (!gate.ok) return gate.response;

  const secret = process.env.SESSION_SECRET;

  return NextResponse.json({
    present: !!secret,
    len: secret?.length ?? 0,
    // The exact condition lib/sessionCookie.ts#getSecret applies. If this is
    // false, login returns 503 regardless of what the dashboard shows.
    passesGuard: !!secret && secret.length >= 16,
    // Catches the paste artefacts: a trailing newline or space makes the value
    // "present" and long enough while still being the wrong secret.
    hasLeadingOrTrailingWhitespace: !!secret && secret !== secret.trim(),
    // Confirms which deployment answered, so you can tell a stale instance from
    // a fresh one without reading Vercel's UI.
    vercelEnv: process.env.VERCEL_ENV ?? null,
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    builtAt: new Date().toISOString(),
  });
}
