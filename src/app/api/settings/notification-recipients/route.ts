// app/api/settings/notification-recipients/route.ts — where my notifications go.
//
// ── How saving an alternative address works ─────────────────────────────────
// PATCH does NOT write the live alternative address. It STAGES a candidate and
// tells the client that verification is required; the address only becomes live
// when PUT /verify succeeds. That ordering is what removes the circular
// dependency an earlier version had, where saving required verification and
// verification required the address to already be saved.
//
// The consequence worth stating plainly: a save that stages an address is still
// a successful save. The response is 200 with `verificationRequired: true`, not
// an error — the user did what was asked, and the next step is theirs to take.
//
// Everything else on this screen (the two destination toggles, the fallback
// switch) saves immediately, because none of it needs proof of anything.
//
// ── Authorisation ───────────────────────────────────────────────────────────
// requireSession(), not requireRoles(): this edits YOUR OWN routing, and every
// role has an email address. The userId comes from the verified session cookie
// and never from the body — accepting a body-supplied id would let anyone
// redirect a colleague's security alerts to an address they control.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/serverAuth";
import { diffFields, requestContext, writeAuditLog } from "@/lib/auditLog";
import { isMailConfigured } from "@/lib/email/config";
import { getPreferences, resolveRecipients } from "@/lib/emailRouting";
import {
  getVerificationState,
  removeAlternativeEmail,
  stagePendingEmail,
} from "@/lib/alternativeEmailVerification";

export const dynamic = "force-dynamic";

/** The shape every response carries, so the client has one thing to parse. */
async function currentState(userId: number) {
  const prefs = await getPreferences(userId);
  if (!prefs) return null;

  const resolution = resolveRecipients(prefs);

  return {
    sendCurrentEmail: prefs.sendCurrentEmail,
    sendAlternativeEmail: prefs.sendAlternativeEmail,
    currentEmail: prefs.currentEmail,
    /** Live and verified, or null. Never a candidate. */
    alternativeEmail: prefs.alternativeEmail,
    alternativeEmailVerified: prefs.alternativeEmailVerified,
    fallbackEnabled: prefs.fallbackEnabled,
    verification: await getVerificationState(userId),
    // Computed server-side so the Delivery Preview cannot disagree with what the
    // routing engine will actually do.
    preview: {
      addresses: resolution.addresses,
      notes: resolution.notes,
      disabled: resolution.addresses.length === 0,
    },
    deliveryConfigured: isMailConfigured(),
  };
}

export async function GET() {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;
  if (!gate.userId) {
    return NextResponse.json({ success: false, message: "Session carries no user id." }, { status: 400 });
  }

  const state = await currentState(gate.userId);
  if (!state) {
    return NextResponse.json({ success: false, message: "User not found." }, { status: 404 });
  }

  return NextResponse.json({ success: true, data: state });
}

export async function PATCH(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;
  if (!gate.userId) {
    return NextResponse.json({ success: false, message: "Session carries no user id." }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const before = await getPreferences(gate.userId);
  if (!before) {
    return NextResponse.json({ success: false, message: "User not found." }, { status: 404 });
  }

  const { ip, userAgent } = requestContext(req);

  /* ── 1. The alternative address ──────────────────────────────────────────
     Handled before the toggles, because removing the address must also switch
     its destination off, and staging one determines whether this request can
     complete at all. */

  let verificationRequired = false;
  let stagedAddress: string | null = null;

  if (body.alternativeEmail !== undefined) {
    const candidate = String(body.alternativeEmail ?? "").trim();

    if (candidate === "") {
      // Clearing is immediate and needs no proof — you are always allowed to
      // stop receiving mail somewhere.
      await removeAlternativeEmail({
        userId: gate.userId,
        actorName: gate.session.name,
        ip,
        userAgent,
      });
    } else if (candidate.toLowerCase() !== (before.alternativeEmail ?? "").toLowerCase()) {
      const staged = await stagePendingEmail({
        userId: gate.userId,
        actorName: gate.session.name,
        candidate,
        currentEmail: before.currentEmail,
        ip,
        userAgent,
      });

      if (!staged.ok) {
        return NextResponse.json(
          { success: false, code: staged.code, message: staged.message },
          { status: 400 }
        );
      }

      verificationRequired = true;
      stagedAddress = staged.address;
    }
    // An unchanged address is a no-op: re-submitting the value already live must
    // not restart verification for it.
  }

  /* ── 2. The toggles ─────────────────────────────────────────────────────*/

  const afterAddressChange = await getPreferences(gate.userId);
  const liveAlternative = afterAddressChange?.alternativeEmail ?? null;

  const sendCurrent =
    body.sendCurrentEmail === undefined ? before.sendCurrentEmail : Boolean(body.sendCurrentEmail);

  let sendAlternative =
    body.sendAlternativeEmail === undefined
      ? (afterAddressChange?.sendAlternativeEmail ?? false)
      : Boolean(body.sendAlternativeEmail);

  // The destination cannot be on without a live address behind it. Coerced
  // rather than rejected: the user asking to enable an alternative while one is
  // mid-verification is a reasonable thing to ask, and the correct answer is
  // "not yet" rather than a validation failure that loses their other edits.
  if (sendAlternative && !liveAlternative) sendAlternative = false;

  const fallbackEnabled =
    body.fallbackEnabled === undefined
      ? (afterAddressChange?.fallbackEnabled ?? true)
      : Boolean(body.fallbackEnabled);

  // ── Turning everything off ──
  // Allowed, but only when the client says it has shown the warning. The flag is
  // not a security control — a direct API caller can set it — it exists so the
  // UI cannot disable someone's security alerts through a mis-click.
  //
  // Skipped while a verification is pending: the user is mid-flow, and the
  // transient "nothing enabled yet" state is not a decision to disable email.
  if (!sendCurrent && !sendAlternative && !verificationRequired && body.confirmDisableAll !== true) {
    return NextResponse.json(
      {
        success: false,
        code: "CONFIRM_DISABLE_ALL",
        message:
          "You are about to disable all email notifications, including security alerts. Confirm to continue.",
      },
      { status: 409 }
    );
  }

  await query(
    `INSERT INTO notification_preferences
       (user_id, send_current_email, send_alternative_email, fallback_enabled, updated_at, updated_by, organization_id)
     VALUES ($1, $2, $3, $4, NOW(), $1,
             (SELECT organization_id FROM users WHERE id = $1))
     ON CONFLICT (user_id) DO UPDATE
       SET send_current_email     = EXCLUDED.send_current_email,
           send_alternative_email = EXCLUDED.send_alternative_email,
           fallback_enabled       = EXCLUDED.fallback_enabled,
           updated_at             = NOW(),
           updated_by             = EXCLUDED.updated_by`,
    [gate.userId, sendCurrent, sendAlternative, fallbackEnabled]
  );

  // Write through to the legacy column so anything still reading it agrees
  // during the transition described in phase 1's migration.
  const legacy =
    sendCurrent && sendAlternative
      ? "both"
      : sendCurrent
        ? "primary"
        : sendAlternative
          ? "secondary"
          : "none";

  await query(
    `UPDATE users SET notification_email_preference = $1, updated_at = NOW() WHERE id = $2`,
    [legacy, gate.userId]
  );

  /* ── 3. Audit ───────────────────────────────────────────────────────────*/

  const { old, next, changed } = diffFields(
    {
      sendCurrentEmail: before.sendCurrentEmail,
      sendAlternativeEmail: before.sendAlternativeEmail,
      fallbackEnabled: before.fallbackEnabled,
    },
    { sendCurrentEmail: sendCurrent, sendAlternativeEmail: sendAlternative, fallbackEnabled },
  );

  if (changed.length > 0) {
    await writeAuditLog({
      userId: gate.userId,
      actorName: gate.session.name,
      // Distinct action name so "who silenced their security alerts" is a
      // single-predicate query against the audit log.
      action: "notification_recipients.update",
      entityType: "user",
      entityId: gate.userId,
      oldValue: old,
      newValue: next,
      ipAddress: ip,
      userAgent,
    });
  }

  const state = await currentState(gate.userId);

  return NextResponse.json({
    success: true,
    data: state,
    changed,
    // The client opens the verification modal on this flag rather than inferring
    // it from the address, so the server stays the authority on whether a step
    // is outstanding.
    verificationRequired,
    pendingAddress: stagedAddress,
    message: verificationRequired
      ? `Verify ${stagedAddress} to finish adding it.`
      : state && state.preview.disabled
        ? "Saved. Email notifications are now disabled."
        : "Notification recipients saved.",
  });
}
