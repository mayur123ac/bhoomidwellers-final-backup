// api/users/update-whatsapp/route.ts — save your own WhatsApp number.
//
// ── Why this was rewritten ──────────────────────────────────────────────────
// The previous version had NO authentication and matched on `WHERE name = $2`.
// That was already wrong — two employees sharing a name were both overwritten —
// but it became a security problem the moment automatic notifications shipped:
// users.whatsapp_number is now the delivery target for Channel Partner alerts
// carrying partner names, phone numbers, office addresses and GST numbers. An
// unauthenticated POST could have redirected every future alert to an
// attacker's WhatsApp.
//
// Now: you must be signed in, and the UPDATE is keyed on YOUR id from the
// session. Admins may target another user explicitly.
//
// The `name` field is still accepted so the existing callers
// (WhatsAppSettingsCard.tsx, dashboard/settings) keep working unchanged — but it
// is only honoured for admins, and only as a way of naming someone else. For
// everyone else the session decides, and the field is ignored.

import { getOrganizationId } from "@/lib/tenantContext";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getServerSession } from "@/lib/serverAuth";
import { normalizeRole } from "@/lib/cpRbac";
import { toE164, describeE164Failure } from "@/lib/phone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Target {
  id: number;
  name: string;
}

/**
 * Works out whose row is being touched.
 *
 * Non-admins can only ever reach their own, whatever they send. Admins may pass
 * user_id (preferred) or name (legacy); the name path is ambiguous by nature, so
 * it refuses rather than guessing when it matches more than one person.
 */
async function resolveTarget(session: any, body: any, orgId: string): Promise<{ ok: true; target: Target } | { ok: false; status: number; message: string }> {
  const selfId = Number(session._id ?? session.id);
  const isAdmin = normalizeRole(session.role) === "admin";

  if (!isAdmin) {
    if (!Number.isInteger(selfId) || selfId <= 0) {
      return { ok: false, status: 401, message: "Your session is missing a user id. Sign in again." };
    }
    return { ok: true, target: { id: selfId, name: session.name ?? "" } };
  }

  // Admin targeting someone else by id.
  const explicitId = Number(body?.user_id);
  if (Number.isInteger(explicitId) && explicitId > 0) {
    const rows = await query<Target>(`SELECT id, name FROM users WHERE id = $1 AND organization_id = $2 LIMIT 1`, [explicitId, orgId]);
    if (!rows[0]) return { ok: false, status: 404, message: "No such user." };
    return { ok: true, target: rows[0] };
  }

  // Admin targeting someone else by name (legacy shape).
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (name && name !== session.name) {
    const rows = await query<Target>(`SELECT id, name FROM users WHERE name = $1 AND organization_id = $2`, [name, orgId]);
    if (rows.length === 0) return { ok: false, status: 404, message: "No such user." };
    if (rows.length > 1) {
      return {
        ok: false,
        status: 409,
        message: `More than one user is named "${name}". Pass user_id instead.`,
      };
    }
    return { ok: true, target: rows[0] };
  }

  if (!Number.isInteger(selfId) || selfId <= 0) {
    return { ok: false, status: 401, message: "Your session is missing a user id. Sign in again." };
  }
  return { ok: true, target: { id: selfId, name: session.name ?? "" } };
}

export async function POST(req: Request) {
  const orgId = await getOrganizationId();
  const session = await getServerSession();
  if (!session?.role) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  try {
    const body = await req.json();
    const raw = body?.whatsapp_number;

    if (!raw || !String(raw).trim()) {
      return NextResponse.json(
        { success: false, message: "A WhatsApp number is required." },
        { status: 400 }
      );
    }

    // Validated here rather than at send time. An unusable number saved now is a
    // notification silently lost weeks later, with the error surfacing nowhere
    // near the person who typed it.
    const phone = toE164(raw);
    if (!phone.ok) {
      return NextResponse.json(
        {
          success: false,
          message: `${describeE164Failure(phone.reason)} Enter a number with the country code, e.g. 919876543210.`,
        },
        { status: 400 }
      );
    }

    const resolved = await resolveTarget(session, body, orgId);
    if (!resolved.ok) {
      return NextResponse.json(
        { success: false, message: resolved.message },
        { status: resolved.status }
      );
    }

    // Stored as bare digits with the country code — the format the UI has always
    // displayed ("+{whatsapp_number}") and the column's varchar(20) expects.
    // toE164 normalises "+91 98765 43210", "09876543210" and "9876543210" onto
    // the same value, so what is saved no longer depends on how it was typed.
    const stored = phone.digits;

    // resolveTarget() already restricts the target to this organization, so this
    // is defence in depth: the boundary is stated on the mutation itself rather
    // than only in the lookup that produced the id.
    await query(`UPDATE public.users SET whatsapp_number = $1 WHERE id = $2 AND organization_id = $3`, [
      stored,
      resolved.target.id,
      orgId,
    ]);

    return NextResponse.json({
      success: true,
      message: "WhatsApp number saved!",
      whatsapp_number: stored,
    });
  } catch (error) {
    console.error("Update WhatsApp error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to save number" },
      { status: 500 }
    );
  }
}

export async function GET(req: Request) {
  const orgId = await getOrganizationId();
  const session = await getServerSession();
  if (!session?.role) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const isAdmin = normalizeRole(session.role) === "admin";
    const askedFor = searchParams.get("name");
    const selfId = Number(session._id ?? session.id);

    // Non-admins read their own number regardless of what they ask for. The old
    // handler would return any employee's number to anyone who knew their name.
    const rows =
      isAdmin && askedFor && askedFor !== session.name
        ? await query<{ whatsapp_number: string | null }>(
            `SELECT whatsapp_number FROM public.users WHERE name = $1 AND organization_id = $2 LIMIT 1`,
            [askedFor, orgId]
          )
        : await query<{ whatsapp_number: string | null }>(
            `SELECT whatsapp_number FROM public.users WHERE id = $1 AND organization_id = $2 LIMIT 1`,
            [selfId, orgId]
          );

    return NextResponse.json({
      success: true,
      whatsapp_number: rows[0]?.whatsapp_number || "",
    });
  } catch (error) {
    console.error("Fetch WhatsApp error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to fetch number" },
      { status: 500 }
    );
  }
}
