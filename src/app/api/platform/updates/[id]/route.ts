// api/platform/updates/[id]/route.ts — Super Admin: view, edit, publish and
// unpublish one System Update.
//
// ── Why publish/unpublish are actions and not a status field on PATCH ───────
// "Save" and "broadcast to every user in the product" are different decisions
// with different consequences, and a form that can do the second by setting a
// field is a form that will eventually do it by accident. So editing content is
// one action, changing publication state is another, and each is audited under
// its own name.
//
// There is no DELETE. Retracting a published announcement is `unpublish`, which
// removes it from the live feed and keeps the row, its publication history and
// every user's read marks — the brief asks for exactly that, and a hard delete
// would also cascade crm_update_reads away.
import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/superAdmin";
import { requestContext, writeAuditLog } from "@/lib/auditLog";
import {
  AUDIENCE_ALL,
  getCrmUpdateById,
  normaliseFeatures,
  publishCrmUpdate,
  unpublishCrmUpdate,
  updateCrmUpdate,
  validateUpdateBody,
} from "@/lib/crmUpdates";

export const dynamic = "force-dynamic";

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
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
  };
}

/** Bounds the id before it reaches Postgres. */
function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return gate.response;

  const id = parseId((await params).id);
  if (id == null) {
    return NextResponse.json({ success: false, message: "Invalid update id." }, { status: 400 });
  }

  const row = await getCrmUpdateById(id);
  if (!row) {
    return NextResponse.json({ success: false, message: "Update not found." }, { status: 404 });
  }
  return NextResponse.json({ success: true, data: serialize(row) }, { status: 200 });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return gate.response;

  const id = parseId((await params).id);
  if (id == null) {
    return NextResponse.json({ success: false, message: "Invalid update id." }, { status: 400 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = (body?.action ?? "save").toString();

    const before = await getCrmUpdateById(id);
    if (!before) {
      return NextResponse.json({ success: false, message: "Update not found." }, { status: 404 });
    }

    const { ip, userAgent } = requestContext(req);

    // ── Publish ────────────────────────────────────────────────────────────
    if (action === "publish") {
      const row = await publishCrmUpdate(id, gate.admin.id);
      await writeAuditLog({
        userId: gate.admin.id,
        actorName: gate.admin.name,
        action: "platform.update.publish",
        entityType: "system_update",
        entityId: id,
        oldValue: { status: before.status },
        newValue: { status: "published", version: before.version, title: before.title },
        ipAddress: ip,
        userAgent,
      });
      return NextResponse.json(
        { success: true, data: serialize(row), message: "Update published." },
        { status: 200 }
      );
    }

    // ── Unpublish ──────────────────────────────────────────────────────────
    if (action === "unpublish") {
      const row = await unpublishCrmUpdate(id);
      await writeAuditLog({
        userId: gate.admin.id,
        actorName: gate.admin.name,
        action: "platform.update.unpublish",
        entityType: "system_update",
        entityId: id,
        oldValue: { status: before.status },
        newValue: { status: "draft", version: before.version, title: before.title },
        ipAddress: ip,
        userAgent,
      });
      return NextResponse.json(
        {
          success: true,
          data: serialize(row),
          message: "Update removed from the live feed. Its record is kept.",
        },
        { status: 200 }
      );
    }

    // ── Edit content ───────────────────────────────────────────────────────
    if (action === "save") {
      const invalid = validateUpdateBody(body);
      if (invalid) {
        return NextResponse.json({ success: false, message: invalid }, { status: 400 });
      }

      const row = await updateCrmUpdate(id, {
        version: body.version.toString().trim(),
        title: body.title.toString().trim(),
        description: (body.description ?? "").toString().trim() || null,
        category: body.type.toString().trim(),
        features: normaliseFeatures(body.features),
        is_important: body.isImportant === true || body.type === "Important",
        audience_type: AUDIENCE_ALL,
      });

      await writeAuditLog({
        userId: gate.admin.id,
        actorName: gate.admin.name,
        action: "platform.update.edit",
        entityType: "system_update",
        entityId: id,
        // Metadata only. The description is free-form prose and is not copied
        // into the audit trail.
        oldValue: { version: before.version, title: before.title, type: before.category },
        newValue: { version: row?.version, title: row?.title, type: row?.category },
        ipAddress: ip,
        userAgent,
      });

      return NextResponse.json(
        { success: true, data: serialize(row), message: "Update saved." },
        { status: 200 }
      );
    }

    return NextResponse.json({ success: false, message: "Unknown action." }, { status: 400 });
  } catch (err: any) {
    console.error("[PATCH /api/platform/updates/[id]]", err?.message);
    return NextResponse.json(
      { success: false, message: "Could not update the announcement." },
      { status: 500 }
    );
  }
}
