// app/api/updates/route.ts — the CRM-user side of System Updates.
//
// This route serves the System Updates modal every signed-in role sees. It reads
// published announcements and records THIS user's read marks. It does not
// create, edit, publish or unpublish anything — those are Super Admin
// operations and live at /api/platform/updates.
//
// ── What changed here, and why ──────────────────────────────────────────────
//
//  1. The feed is now published-only. It is filtered in SQL (see
//     lib/crmUpdates.getUpdatesWithReadStatus), so a draft is never serialised
//     into a response at all.
//
//  2. Marking read no longer requires the Admin role. The whole POST handler was
//     gated with requireRoles(["admin"]), including the `mark_read` branch — so
//     every non-Admin employee clicking "Mark as read" got a 403 and the badge
//     never cleared. Read state is per-user by design; requiring a role to
//     record your own is a contradiction. `mark_read` and `mark_all_read` now
//     take requireSession().
//
//  3. Authoring moved out. POST `create`, PUT and DELETE previously accepted any
//     tenant Admin. `crm_updates` has no organization_id — it is a PLATFORM
//     table — so a tenant Admin writing to it was broadcasting to every
//     organization on the estate. Those verbs now require Super Admin, which is
//     also what the brief specifies: only Super Admin publishes.
//
// DELETE is kept for the Super Admin only and is not what the panel uses:
// retracting an announcement is an unpublish, which preserves the record.

import { NextResponse } from "next/server";
import {
  getUpdatesWithReadStatus,
  markUpdateAsRead,
  markAllUpdatesRead,
  normaliseFeatures,
} from "@/lib/crmUpdates";
import { requireSession } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    // The identity comes from the session, never from ?userId=. The comment this
    // replaces read "we assume userId comes from the client since auth is
    // client-side in localStorage" — which made read-status for ANY user
    // fetchable by editing one query parameter. The parameter is now ignored
    // entirely rather than conditionally trusted.
    if (gate.userId == null) {
      return NextResponse.json(
        { success: false, message: "Session carries no user id." },
        { status: 400 }
      );
    }

    const updates = await getUpdatesWithReadStatus(gate.userId, gate.session.role);

    return NextResponse.json(
      {
        success: true,
        data: updates.map((u) => ({
          id: u.id,
          version: u.version,
          title: u.title,
          description: u.description,
          category: u.category,
          features: normaliseFeatures(u.features),
          is_important: u.is_important,
          // `published_at` is what the modal dates the entry by; `created_at` is
          // kept alongside so nothing that already reads it breaks.
          published_at: u.published_at ?? u.created_at,
          created_at: u.created_at,
          has_read: u.has_read,
        })),
        unreadCount: updates.filter((u) => !u.has_read).length,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("GET UPDATES ERROR:", error);
    return NextResponse.json(
      { success: false, message: "Failed to fetch updates" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    // Every signed-in role, because the only things this handler does are
    // per-user read marks. `userId` in the body is ignored — see below.
    const gate = await requireSession();
    if (!gate.ok) return gate.response;
    if (gate.userId == null) {
      return NextResponse.json(
        { success: false, message: "Session carries no user id." },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => ({}));

    if (body.action === "mark_read") {
      const updateId = Number(body.updateId);
      if (!Number.isFinite(updateId)) {
        return NextResponse.json({ message: "updateId required" }, { status: 400 });
      }
      // gate.userId, not body.userId. A body-supplied id would let anyone mark
      // an announcement read on someone else's behalf, which is a small thing
      // that is nevertheless exactly the wrong shape.
      await markUpdateAsRead(gate.userId, updateId);
      return NextResponse.json({ success: true }, { status: 200 });
    }

    if (body.action === "mark_all_read") {
      const marked = await markAllUpdatesRead(gate.userId);
      return NextResponse.json({ success: true, marked }, { status: 200 });
    }

    // Authoring is not available here. It is a Super Admin operation and lives
    // at /api/platform/updates; answering 403 rather than silently ignoring the
    // action means an old client fails visibly instead of appearing to work.
    if (body.action === "create") {
      return NextResponse.json(
        {
          success: false,
          message:
            "System Updates are published from the Super Admin panel. " +
            "Use /api/platform/updates.",
        },
        { status: 403 }
      );
    }

    return NextResponse.json({ message: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("POST UPDATES ERROR:", error);
    return NextResponse.json(
      { success: false, message: "Failed to process update action" },
      { status: 500 }
    );
  }
}
