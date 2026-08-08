// instrumentation.ts — runs once when the server starts.
//
// Next calls `register()` a single time per server process, before any request
// is handled. That makes it the one place where "is this deployment actually
// configured?" can be answered at startup rather than discovered by a user who
// never received their password-reset email.
//
// ── Why the runtime guard ───────────────────────────────────────────────────
// This file is also evaluated in the Edge runtime, where `node:` modules and
// most of lib/ are unavailable. NEXT_RUNTIME tells the two apart, and the
// dynamic import inside the branch keeps the Node-only code out of the Edge
// bundle entirely — a static import would be resolved for both.
//
// ── Why nothing here throws ─────────────────────────────────────────────────
// A configuration problem is reported, not fatal. Mail is one feature; leads,
// bookings, inventory and reporting do not depend on it, and refusing to boot
// over a missing SMTP password would turn a degraded feature into a total
// outage. The console provider keeps the send path working and visibly honest
// until the credentials arrive.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { reportMailConfigAtStartup } = await import("@/lib/email/config");
    reportMailConfigAtStartup();
  } catch (err) {
    console.error(
      "[instrumentation] mail configuration check failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}
