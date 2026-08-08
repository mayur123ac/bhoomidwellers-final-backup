// app/api/security/device/route.ts — the "Was this you?" response.
//
// Reached from the new-device security email. Like the verification link, it
// takes no session: it is opened from a mailbox, and the token is the
// authorisation. See the header of the verify/link route for the full argument.
//
// ── Why "Secure my account" is safe to expose on an unauthenticated link ────
// The destructive-looking action is the SAFE one. Someone who obtains this token
// can end the account's sessions — an inconvenience — but cannot read anything,
// change a password, or sign in. The genuinely risky direction would be letting
// an attacker mark their own device as trusted, and that requires the token from
// an email sent to the account's own verified recipients.
//
// A confirmation step sits in front of the action rather than acting on the bare
// GET, because mail clients and security scanners prefetch links. Without it, a
// scanner opening the email would silently answer the question on the user's
// behalf — usually as "yes, it was me", which is the wrong default.

import { NextRequest } from "next/server";
import { writeAuditLog } from "@/lib/auditLog";
import { requestContext } from "@/lib/auditLog";
import { respondToDevicePrompt } from "@/lib/loginSecurity";

export const dynamic = "force-dynamic";

function shell(params: {
  ok: boolean;
  title: string;
  body: string;
  form?: { uid: string; token: string; action: string; label: string };
}): Response {
  const accent = params.ok ? "#0f766e" : "#b91c1c";

  const cta = params.form
    ? `<form method="post" style="margin:0">
         <input type="hidden" name="uid" value="${params.form.uid}">
         <input type="hidden" name="token" value="${params.form.token}">
         <input type="hidden" name="action" value="${params.form.action}">
         <button type="submit"
           style="padding:.7rem 1.2rem;background:${accent};color:#fff;border:0;border-radius:8px;font-weight:600;font-size:1rem;cursor:pointer">
           ${params.form.label}
         </button>
       </form>`
    : `<a href="/dashboard/settings/account-security"
         style="display:inline-block;padding:.7rem 1.2rem;background:${accent};color:#fff;border-radius:8px;text-decoration:none;font-weight:600">
         Open account settings
       </a>`;

  return new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${params.title} — Bhoomi Dwellers CRM</title>
</head>
<body style="margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f8fafc;color:#0f172a">
  <main style="max-width:32rem;margin:12vh auto;padding:2rem;background:#fff;border:1px solid #e2e8f0;border-radius:12px">
    <h1 style="margin:0 0 .5rem;font-size:1.25rem">${params.title}</h1>
    <p style="margin:0 0 1.5rem;color:#475569;line-height:1.6">${params.body}</p>
    ${cta}
  </main>
</body>
</html>`,
    {
      status: params.ok ? 200 : 400,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    }
  );
}

/** Rendered by clicking the link. Confirms intent; changes nothing. */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const token = String(params.get("token") ?? "");
  const uid = String(params.get("uid") ?? "");
  const action = String(params.get("action") ?? "");

  if (!token || !uid || (action !== "confirm" && action !== "secure")) {
    return shell({
      ok: false,
      title: "This link is incomplete",
      body: "Open the security email again and use one of the buttons in it.",
    });
  }

  return action === "confirm"
    ? shell({
        ok: true,
        title: "Confirm this device",
        body: "This marks the device from that sign-in as recognised, so you will not be warned about it again.",
        form: { uid, token, action, label: "Yes, it was me" },
      })
    : shell({
        ok: true,
        title: "Secure your account",
        body: "This ends every active session on your account and records that device as untrusted. You will need to sign in again. Change your password afterwards.",
        form: { uid, token, action, label: "Secure my account" },
      });
}

/** The action itself. */
export async function POST(req: NextRequest) {
  let uid = "";
  let token = "";
  let action = "";

  try {
    const form = await req.formData();
    uid = String(form.get("uid") ?? "");
    token = String(form.get("token") ?? "");
    action = String(form.get("action") ?? "");
  } catch {
    return shell({ ok: false, title: "Something went wrong", body: "The form could not be read." });
  }

  const userId = Number(uid);
  if (!Number.isInteger(userId) || userId <= 0 || !token) {
    return shell({ ok: false, title: "This link is not valid", body: "Open the security email again." });
  }
  if (action !== "confirm" && action !== "secure") {
    return shell({ ok: false, title: "Unknown action", body: "Open the security email again." });
  }

  const result = await respondToDevicePrompt({ userId, token, action });

  if (!result.ok) {
    return shell({ ok: false, title: "This link cannot be used", body: result.message });
  }

  const { ip, userAgent } = requestContext(req);
  await writeAuditLog({
    userId,
    actorName: null,
    action: action === "confirm" ? "security.device_confirmed" : "security.device_rejected",
    entityType: "user",
    entityId: userId,
    newValue: { device: result.deviceLabel, sessionsEnded: result.sessionsEnded },
    ipAddress: ip,
    userAgent,
  });

  return action === "confirm"
    ? shell({
        ok: true,
        title: "Device confirmed",
        body: `${result.deviceLabel} is now recognised. You will not be warned about sign-ins from it again.`,
      })
    : shell({
        ok: true,
        title: "Sessions ended",
        body: `${result.sessionsEnded} active session${result.sessionsEnded === 1 ? "" : "s"} on your account ${
          result.sessionsEnded === 1 ? "was" : "were"
        } ended, and ${result.deviceLabel} is marked untrusted. Change your password now from Settings → Account &amp; Security.`,
      });
}
