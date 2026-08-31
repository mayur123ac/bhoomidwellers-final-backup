// src/app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { signSession } from "@/lib/sessionCookie";
import { verifyPassword } from "@/lib/passwords";
import { writeAuditLog } from "@/lib/auditLog";
import { handleFailedLogin, notifyLogin } from "@/lib/loginNotification";
import { clearFailedLogins } from "@/lib/loginSecurity";
import { avatarSrc } from "@/lib/settingsUser";

export async function POST(req: Request) {
  try {
    const { identifier, password, latitude, longitude } = await req.json();

    if (!identifier || !password) {
      return NextResponse.json(
        { message: "Please provide both a username/email and password." },
        { status: 400 },
      );
    }

    // ── Location is mandatory ──────────────────────────────────────────────
    // The frontend collects GPS coordinates before calling this route.
    // A missing or invalid location is rejected BEFORE credentials are
    // checked, so an unauthenticated caller learns nothing about which
    // accounts exist. The validation is server-side — a frontend boolean
    // like `locationEnabled: true` would be trivially spoofable.
    if (
      latitude == null ||
      longitude == null ||
      typeof latitude !== "number" ||
      typeof longitude !== "number" ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      return NextResponse.json(
        { message: "Location access is required to log in. Please enable location permission and try again." },
        { status: 400 },
      );
    }

    const cleanIdentifier = identifier.trim();

    // Accepts the account email, the user's name, or the VERIFIED alternative
    // notification address.
    //
    // ── Why the alternative address is a valid sign-in identifier ──
    // Because someone who has proved they control that mailbox already receives
    // this account's password-reset and security mail; being able to type it at
    // the sign-in prompt grants nothing they could not already obtain. Refusing
    // it would only be security theatre.
    //
    // ── Why `alternative_email_verified` is not optional here ──
    // An unverified address is one nobody has proved they control. Accepting it
    // would let any user type an arbitrary address into their settings and
    // thereby create a second identifier for their account — or, worse, collide
    // with an address belonging to someone else. The join demands the verified
    // flag for exactly that reason.
    const rows = await query(
      `SELECT u.*
         FROM users u
         LEFT JOIN notification_preferences np ON np.user_id = u.id
        WHERE LOWER(u.email) = LOWER($1)
           OR LOWER(u.name)  = LOWER($1)
           OR (np.alternative_email_verified = true
               AND LOWER(np.alternative_email) = LOWER($1))
        LIMIT 1`,
      [cleanIdentifier],
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { message: "No account found with that email or username." },
        { status: 401 },
      );
    }

    const user = rows[0];

    // Request context is needed by both the failure and success paths below, so
    // it is read once here rather than after the password check.
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "Unknown";
    const userAgent = req.headers.get("user-agent") || "Unknown Device";

    // Absolute origin for the links in the security email. Built from the
    // forwarded headers rather than req.url: behind a reverse proxy req.url
    // carries the INTERNAL address (http://localhost:3000), and a "Was this
    // you?" link pointing at localhost is useless in someone's inbox.
    const forwardedHost = req.headers.get("x-forwarded-host") || req.headers.get("host");
    const forwardedProto = req.headers.get("x-forwarded-proto") || "http";
    const origin = forwardedHost
      ? `${forwardedProto}://${forwardedHost}`
      : new URL(req.url).origin;

    // Accepts both storage formats. Rows still holding plaintext — which is all
    // of them until someone uses Settings → Account & Security — take the legacy
    // branch inside verifyPassword and behave exactly as before. Rows written by
    // the new password-change flow are scrypt hashes and are verified properly.
    // See lib/passwords.ts for why there is no bulk migration.
    if (!(await verifyPassword(password, user.password))) {
      // Records the attempt, sends the per-attempt alert, and fires the burst
      // alert if this is the fifth failure in fifteen minutes. Not awaited: see
      // the header of lib/loginNotification.ts.
      void handleFailedLogin({
        userId: user.id,
        name: user.name,
        role: user.role,
        accountEmail: user.email,
        identifier: cleanIdentifier,
        ip,
        userAgent,
        origin,
      });

      await writeAuditLog({
        userId: user.id,
        actorName: user.name,
        action: "login.failed",
        entityType: "user",
        entityId: user.id,
        newValue: { reason: "incorrect password", identifier: cleanIdentifier },
        ipAddress: ip,
        userAgent,
      });

      return NextResponse.json(
        { message: "Incorrect password. Please try again." },
        { status: 401 },
      );
    }

    if (user.is_active === false) {
      return NextResponse.json(
        { message: "Account deactivated. Please contact admin." },
        { status: 403 },
      );
    }

    // ── A suspended organization cannot sign anyone in ────────────────────────
    //
    // `organizations.status` is set by Super Admin (PATCH
    // /api/platform/organizations/[id]), which also revokes every live session
    // belonging to the tenant. Without this check that revocation would last
    // exactly as long as it takes the person to type their password again, and
    // "suspended" would be a colour on a pill rather than a control.
    //
    // Ordered after the password check on purpose: an unauthenticated caller
    // learns nothing about which organizations are suspended, because they never
    // reach this line.
    //
    // A platform account has `organization_id IS NULL`, so this query returns no
    // row for it and the Super Admin can still sign in to lift the suspension —
    // which is the whole reason the platform account is not a tenant role.
    if (user.organization_id) {
      const orgRows = await query<{ status: string }>(
        `SELECT COALESCE(NULLIF(btrim(status), ''), 'active') AS status
           FROM organizations WHERE id = $1`,
        [user.organization_id],
      );
      if (orgRows[0]?.status === "suspended") {
        return NextResponse.json(
          { message: "This organization's access has been suspended. Please contact your administrator." },
          { status: 403 },
        );
      }
    }

    const userData = {
      _id: String(user.id),
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.is_active,
      // MT-05: the tenant claim. Taken from the row we just authenticated
      // against, never from anything the client sent, and carried inside the
      // signed payload so it cannot be edited by the cookie holder.
      //
      // `?? undefined` rather than a fallback organization: a user with no
      // organization must produce a session with no claim, so tenant
      // resolution falls back to the sole-organization path and fails loudly
      // once a second organization exists. Inventing an organization here
      // would be exactly the hardcoded tenant MT-02 removed.
      org: (user.organization_id as string | null) ?? undefined,
    };

    // `ip` and `userAgent` are read once near the top of the handler, because
    // the failed-password branch needs them too.
    //
    // This block builds the SHORT label stored on employee_sessions. It is kept
    // as-is rather than replaced with describeDevice() from lib/emailRouting.ts:
    // the Attendance Tracker and Active Sessions screens already display these
    // exact strings, and changing them would rewrite how every historical
    // session reads. describeDevice() is the richer parse used for the email.
    let device_info = userAgent;
    if (userAgent.includes("Windows")) device_info = "Windows PC";
    else if (userAgent.includes("Mac OS")) device_info = "Mac";
    else if (userAgent.includes("Android")) device_info = "Android Device";
    else if (userAgent.includes("iPhone") || userAgent.includes("iPad")) device_info = "iOS Device";
    else if (userAgent.includes("Linux")) device_info = "Linux PC";

    if (userAgent.includes("Chrome") && !userAgent.includes("Edge") && !userAgent.includes("OPR")) device_info += " / Chrome";
    else if (userAgent.includes("Safari") && !userAgent.includes("Chrome")) device_info += " / Safari";
    else if (userAgent.includes("Firefox")) device_info += " / Firefox";
    else if (userAgent.includes("Edge")) device_info += " / Edge";

    const now = new Date();
    const sessionRes = await query(
      // Organization inherited from the user in SQL: this runs DURING login, so
      // the session cookie carrying the org claim does not exist yet.
      `INSERT INTO employee_sessions (user_id, session_start, last_heartbeat, ip_address, device_info, is_active, organization_id, login_latitude, login_longitude)
       SELECT $1, $2, $3, $4, $5, true, u.organization_id, $6, $7 FROM users u WHERE u.id = $1 RETURNING id`,
      [user.id, now, now, ip, device_info, latitude, longitude]
    );
    const loginSessionId = sessionRes[0].id;

    // Account & Security shows "Last login". employee_sessions already records
    // every login, but that table is heavily written by the heartbeat and the
    // MAX(session_start) lookup is not free; a stamped column keeps the panel a
    // single-row read. Best-effort — a failure here must not fail the login.
    try {
      await query(
        `UPDATE users
            SET last_login_at = $1,
                first_login_at = COALESCE(first_login_at, $1)
          WHERE id = $2`,
        [now, user.id],
      );
    } catch (err) {
      console.error(
        "[login] could not stamp last_login_at:",
        err instanceof Error ? err.message : String(err)
      );
    }

    await writeAuditLog({
      userId: user.id,
      actorName: user.name,
      action: "login",
      entityType: "user",
      entityId: user.id,
      newValue: { latitude, longitude },
      ipAddress: ip,
      userAgent,
    });

    // The sign-in alert, routed through the user's notification preferences.
    // Not awaited — the response should not wait on an SMTP handshake. See the
    // header of lib/loginNotification.ts for why that is safe in this app.
    // A successful sign-in clears the burst history, so five fumbled attempts
    // followed by a correct one do not leave the account one failure away from a
    // spurious "someone is attacking you" alert next week.
    void clearFailedLogins(cleanIdentifier);

    void notifyLogin({
      userId: user.id,
      name: user.name,
      role: user.role,
      accountEmail: user.email,
      identifierUsed: cleanIdentifier,
      ip,
      userAgent,
      sessionId: loginSessionId,
      status: "Successful",
      origin,
      latitude,
      longitude,
    });

    // Signed, not just encoded. Refuse to issue a session at all when no secret
    // is configured: an unverifiable cookie is one every route would have to
    // trust blindly, so failing the login is the safer outcome.
    const sessionValue = await signSession(userData);
    if (!sessionValue) {
      console.error("[login] SESSION_SECRET is not configured — refusing to issue a session.");
      return NextResponse.json(
        { message: "Sign-in is unavailable: the server is missing its session secret." },
        { status: 503 },
      );
    }

    // Attendance will now be marked manually by the user from the UI.
    const response = NextResponse.json(
      {
        message: "Login successful.",
        // MT-06 (CRITICAL): the password is NOT returned, in any form.
        //
        // This previously shipped the account's plaintext password whenever the
        // stored value had not yet been hashed, so that several dashboards could
        // render it behind a show/hide toggle. The client persists this whole
        // object to localStorage (app/page.tsx), which meant every signed-in
        // browser held a readable copy of the user's password — recoverable by
        // any XSS, any malicious extension, and anyone with access to the
        // machine's profile directory. A credential must never travel back to
        // the client that just supplied it.
        //
        // The show/hide widgets already fall back to "N/A"/dots when the field
        // is absent, so they degrade rather than break. `isHashed` is no longer
        // needed here: hashed or not, nothing is sent.
        user: userData,
        // The durable half of the theme preference, so the choice survives a
        // sign-out — and follows the user to a machine whose localStorage has
        // never heard of them. Returned as its own field rather than folded
        // into `user`, which is signed into the session cookie and should not
        // grow a field that changes every time someone flips a switch.
        //
        // Legacy "system" values are passed through untouched; the client
        // resolves them, because only the client can see the OS preference.
        theme: user.theme_preference ?? null,
        // The profile picture, for the same reason and by the same route as the
        // theme: it is what makes the header avatar correct on the very first
        // paint after signing in, on a machine whose localStorage has never
        // heard of this user. Also a sibling of `user` rather than part of it —
        // `user` is signed into the session cookie, and a field that changes
        // every time someone uploads a photo does not belong in a signed token.
        //
        // avatarSrc() resolves which of the two storage columns is in play, so
        // the client receives one ready-to-use URL and never has to know that
        // R2 and local uploads are different things.
        avatarUrl: avatarSrc({
          avatar_key: user.avatar_key ?? null,
          avatar_url: user.avatar_url ?? null,
        }),
      },
      { status: 200 },
    );

    // Set HttpOnly cookie for session (valid for 7 days)
    response.cookies.set({
      name: "crm_session",
      value: sessionValue,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    return response;
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json({ message: "Login failed. Something went wrong." }, { status: 500 });
  }
}
