// api/platform/updates/route.ts — Super Admin: list and create System Updates.
//
// ── Why this is a platform route and not an extension of /api/updates ───────
// /api/updates answers "what should this signed-in person see", which is a
// per-user, published-only question. This answers "what exists", drafts
// included, which only a platform operator may ask. Merging them would mean one
// handler whose response shape depended on the caller's role — the kind of
// endpoint where a missing branch leaks a draft.
//
// `requireSuperAdmin()` is the first statement, as in every /api/platform route.
// It re-reads the live users row, so a stale cookie claiming the role does not
// work here even though middleware let the page render.
import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/superAdmin";
import { requestContext, writeAuditLog } from "@/lib/auditLog";
import {
  AUDIENCE_ALL,
  createCrmUpdate,
  listCrmUpdatesForAdmin,
  normaliseFeatures,
  validateUpdateBody,
} from "@/lib/crmUpdates";

export const dynamic = "force-dynamic";

/** The wire shape. Explicit, so a column added later is not shipped by accident. */
function serialize(row: any) {
  return {
    id: row.id,
    version: row.version,
    title: row.title,
    description: row.description,
    type: row.category,
    features: normaliseFeatures(row.features),
    isImportant: row.is_important === true,
    status: row.status,
    audienceType: row.audience_type,
    // The FK name when the account still exists, falling back to the
    // denormalised string so an announcement survives its author being removed.
    createdBy: row.created_by_name ?? row.created_by ?? null,
    publishedBy: row.published_by_name ?? null,
    createdAt: row.created_at,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    readCount: Number(row.read_count ?? 0),
  };
}

export async function GET() {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return gate.response;

  try {
    const rows = await listCrmUpdatesForAdmin();
    return NextResponse.json(
      { success: true, data: rows.map(serialize) },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[GET /api/platform/updates]", err?.message);
    return NextResponse.json(
      { success: false, message: "Could not load system updates." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return gate.response;

  try {
    const body = await req.json().catch(() => ({}));

    const invalid = validateUpdateBody(body);
    if (invalid) return NextResponse.json({ success: false, message: invalid }, { status: 400 });

    // The one field that decides whether this is a draft or a broadcast. Read as
    // a strict boolean: a stray "false" string must not publish.
    const publish = body?.publish === true;

    const created = await createCrmUpdate(
      {
        version: body.version.toString().trim(),
        title: body.title.toString().trim(),
        description: (body.description ?? "").toString().trim() || null,
        category: body.type.toString().trim(),
        features: normaliseFeatures(body.features),
        // The explicit flag, plus the type: choosing type "Important" and then
        // forgetting the checkbox should not produce an announcement that says
        // Important and does not look it.
        is_important: body.isImportant === true || body.type === "Important",
        audience_type: AUDIENCE_ALL,
        publish,
      },
      // Author identity comes from the verified session, never the body.
      { id: gate.admin.id, name: gate.admin.name }
    );

    const { ip, userAgent } = requestContext(req);
    await writeAuditLog({
      userId: gate.admin.id,
      actorName: gate.admin.name,
      action: publish ? "platform.update.publish" : "platform.update.create_draft",
      entityType: "system_update",
      entityId: created.id,
      // Metadata only: version, title, status. Never the body text, which is
      // free-form and can be long.
      newValue: { version: created.version, title: created.title, status: created.status },
      ipAddress: ip,
      userAgent,
    });

    return NextResponse.json(
      { success: true, data: serialize(created), message: publish ? "Update published." : "Draft saved." },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("[POST /api/platform/updates]", err?.message);
    return NextResponse.json(
      { success: false, message: "Could not save the update." },
      { status: 500 }
    );
  }
}
