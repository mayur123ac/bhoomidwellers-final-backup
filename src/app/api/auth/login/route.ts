// src/app/api/auth/login/route.ts
//
// RUN THIS SQL ONCE BEFORE DEPLOYING (the session INSERT below uses the column):
//
//   ALTER TABLE employee_sessions ADD COLUMN IF NOT EXISTS impersonated_by TEXT;
//
// If lib/sessionCookie.ts types its payload strictly, add `impersonatedBy?: string`.

import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { signSession } from "@/lib/sessionCookie";
import { verifyPassword } from "@/lib/passwords";
import { writeAuditLog } from "@/lib/auditLog";
import { handleFailedLogin, notifyLogin } from "@/lib/loginNotification";
import { clearFailedLogins } from "@/lib/loginSecurity";
import { avatarSrc } from "@/lib/settingsUser";
import { enrichSessionLocation } from "@/lib/reverseGeocode";
import { describeDevice } from "@/lib/emailRouting";
import { broadcastToOrg } from "@/lib/supabase/broadcast";

// Roles that can NEVER be entered through the admin-override path. Without
// this, the admin password would be a master key to admin/platform accounts.
const PROTECTED_ROLES = ["admin", "super admin"];
const normRole = (r: unknown) =>
  String(r ?? "").toLowerCase().trim().replace(/_/g, " ");

export async function POST(req: Request) {
  try {
    const { identifier, password, latitude, longitude, accuracy } = await req.json();

    // Accuracy is optional enrichment — not validated as strictly as coordinates.
    // A non-finite or negative value is silently discarded rather than blocking login.
    const gpsAccuracy: number | null =
      typeof accuracy === "number" && Number.isFinite(accuracy) && accuracy >= 0
        ? accuracy
        : null;

    if (!identifier || !password) {
      return NextResponse.json(
        { message: "Please provide both a username/email and password." },
        { status: 400 },
      );
    }

    // ── Location is mandatory ──────────────────────────────────────────────
    // Rejected BEFORE credentials are checked, so an unauthenticated caller
    // learns nothing about which accounts exist. Validation is server-side.
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
    // notification address (the verified flag is mandatory: an unverified
    // address is one nobody has proved they control).
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

    // Request context is needed by both the failure and success paths below.
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "Unknown";
    const userAgent = req.headers.get("user-agent") || "Unknown Device";

    // Absolute origin for links in the security email, built from forwarded
    // headers because req.url carries the internal address behind a proxy.
    const forwardedHost = req.headers.get("x-forwarded-host") || req.headers.get("host");
    const forwardedProto = req.headers.get("x-forwarded-proto") || "http";
    const origin = forwardedHost
      ? `${forwardedProto}://${forwardedHost}`
      : new URL(req.url).origin;

    // ── Password check ─────────────────────────────────────────────────────
    // 1) The employee's own password always works.
    // 2) Otherwise, if the target is a non-admin employee, the password of an
    //    active admin IN THE SAME ORGANIZATION is accepted. The admin's
    //    password is read from the DB (hashed or legacy plaintext, both handled
    //    by verifyPassword), never hardcoded, so changing it changes the
    //    override automatically.
    let impersonatedBy: { id: string; name: string } | null = null;

    let passwordOk = await verifyPassword(password, user.password);

    if (
      !passwordOk &&
      user.organization_id &&
      !PROTECTED_ROLES.includes(normRole(user.role))
    ) {
      const admins = await query(
        `SELECT id, name, password
           FROM users
          WHERE organization_id = $1
            AND REPLACE(LOWER(BTRIM(role)), '_', ' ') = 'admin'
            AND is_active IS DISTINCT FROM false`,
        [user.organization_id],
      );
      for (const a of admins) {
        if (await verifyPassword(password, a.password)) {
          passwordOk = true;
          impersonatedBy = { id: String(a.id), name: a.name };
          break;
        }
      }
    }

    if (!passwordOk) {
      // Records the attempt, sends the per-attempt alert, and fires the burst
      // alert on the fifth failure in fifteen minutes. Not awaited.
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

    // Deactivated employees stay blocked even for an admin override.
    if (user.is_active === false) {
      return NextResponse.json(
        { message: "Account deactivated. Please contact admin." },
        { status: 403 },
      );
    }

    // ── A suspended organization cannot sign anyone in ─────────────────────
    // Ordered after the password check so an unauthenticated caller learns
    // nothing about which organizations are suspended. Platform accounts have
    // organization_id NULL, so a Super Admin can still sign in to lift it.
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
      // MT-05: tenant claim, taken from the authenticated row, never the client.
      org: (user.organization_id as string | null) ?? undefined,
      // Marks an admin-as-employee session so routes/UI can show a banner or
      // block sensitive actions (e.g. password change). Signed into the cookie.
      ...(impersonatedBy && { impersonatedBy: impersonatedBy.id }),
    };

    // Short device label stored on employee_sessions (kept as-is; the
    // Attendance Tracker and Active Sessions screens display these strings).
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

    const parsedDevice = describeDevice(userAgent);

    const now = new Date();
    // impersonated_by lets attendance/field-tracking reports exclude or flag
    // rows where the GPS position belongs to the admin, not the employee
    // (filter with `WHERE impersonated_by IS NULL`).
    const sessionRes = await query(
      `INSERT INTO employee_sessions (user_id, session_start, last_heartbeat, ip_address, device_info, is_active, organization_id, login_latitude, login_longitude, login_location_accuracy, login_device_name, login_device_type, login_os, login_browser, impersonated_by)
       SELECT $1, $2, $3, $4, $5, true, u.organization_id, $6, $7, $8, $9, $10, $11, $12, $13 FROM users u WHERE u.id = $1 RETURNING id`,
      [
        user.id,
        now,
        now,
        ip,
        device_info,
        latitude,
        longitude,
        gpsAccuracy,
        parsedDevice.deviceName,
        parsedDevice.deviceType,
        parsedDevice.osWithVersion,
        parsedDevice.browser,
        impersonatedBy?.id ?? null,
      ],
    );
    const loginSessionId = sessionRes[0].id;

    // Fire-and-forget reverse geocode; a Nominatim outage must never block sign-in.
    void enrichSessionLocation(loginSessionId, latitude, longitude, gpsAccuracy);

    // Realtime ONLINE/OFFLINE broadcast. Skipped for admin overrides so the
    // employee does not appear online while an admin is using their account.
    if (user.organization_id && !impersonatedBy) {
      void broadcastToOrg(
        user.organization_id as string,
        "activity.attendance_sync",
        { type: "ATTENDANCE_SYNC", userId: user.id },
      );
    }

    // "Last login" stamp. Skipped for admin overrides so the employee's own
    // last-login time is not overwritten by an admin visit. Best-effort.
    if (!impersonatedBy) {
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
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    // Audit trail: an override login is never silent. Recorded under a distinct
    // action with the admin named as the actor.
    await writeAuditLog({
      userId: user.id,
      actorName: impersonatedBy ? `${impersonatedBy.name} (as ${user.name})` : user.name,
      action: impersonatedBy ? "login.impersonated" : "login",
      entityType: "user",
      entityId: user.id,
      newValue: {
        latitude,
        longitude,
        ...(impersonatedBy && { impersonatedBy: impersonatedBy.id }),
      },
      ipAddress: ip,
      userAgent,
    });

    // Sign-in alert email and burst-history reset are for the employee's own
    // sign-ins only. Override logins are tracked via the audit log instead.
    // (To notify employees of override logins, call notifyLogin here with a
    // different `status`.)
    if (!impersonatedBy) {
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
        accuracy: gpsAccuracy,
      });
    }

    // Refuse to issue a session when no secret is configured.
    const sessionValue = await signSession(userData);
    if (!sessionValue) {
      console.error("[login] SESSION_SECRET is not configured — refusing to issue a session.");
      return NextResponse.json(
        { message: "Sign-in is unavailable: the server is missing its session secret." },
        { status: 503 },
      );
    }

    const response = NextResponse.json(
      {
        message: "Login successful.",
        // MT-06 (CRITICAL): the password is NOT returned, in any form.
        user: userData,
        // Durable theme preference, sibling of `user` (not signed into the cookie).
        theme: user.theme_preference ?? null,
        // Profile picture as one ready-to-use URL (R2 vs local resolved server-side).
        avatarUrl: avatarSrc({
          avatar_key: user.avatar_key ?? null,
          avatar_url: user.avatar_url ?? null,
        }),
      },
      { status: 200 },
    );

    // HttpOnly session cookie (valid for 7 days)
    response.cookies.set({
      name: "crm_session",
      value: sessionValue,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    return response;
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json({ message: "Login failed. Something went wrong." }, { status: 500 });
  }
}