import { NextRequest, NextResponse } from "next/server";
import { requireRoles, getSessionUserId } from "@/lib/serverAuth";
import { query } from "@/lib/db";
import { generatePresignedUrl, deleteObjectFromR2 } from "@/lib/r2";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

// GET /api/admin/creative-studio/gallery — list saved images
export async function GET() {
  const gate = await requireRoles(["admin", "super_admin"]);
  if (!gate.ok) return gate.response;

  try {
    const orgId = await getOrganizationId();

    const rows = await query<{
      id: number;
      r2_key: string;
      prompt: string;
      mode: string;
      template_id: string | null;
      size: string;
      created_at: string;
      created_by: number;
      creator_name: string | null;
    }>(
      `SELECT g.*, u.name AS creator_name
       FROM creative_studio_gallery g
       LEFT JOIN users u ON u.id = g.created_by
       WHERE g.organization_id = $1
       ORDER BY g.created_at DESC
       LIMIT 100`,
      [orgId]
    );

    // Generate fresh presigned URLs
    const images = await Promise.all(
      rows.map(async (r) => {
        let url: string;
        try {
          url = await generatePresignedUrl(r.r2_key, 3600);
        } catch {
          url = "";
        }
        return {
          id: r.id,
          url,
          r2Key: r.r2_key,
          prompt: r.prompt,
          mode: r.mode,
          templateId: r.template_id,
          size: r.size,
          createdAt: r.created_at,
          createdBy: r.creator_name || "Unknown",
        };
      })
    );

    return NextResponse.json({ images });
  } catch (err: any) {
    // Table may not exist yet
    if (err?.code === "42P01") {
      return NextResponse.json({ images: [] });
    }
    console.error("[creative-studio/gallery] GET", err);
    return NextResponse.json({ error: "Failed to load gallery." }, { status: 500 });
  }
}

// POST /api/admin/creative-studio/gallery — save an image to gallery
export async function POST(req: NextRequest) {
  const gate = await requireRoles(["admin", "super_admin"]);
  if (!gate.ok) return gate.response;

  try {
    const { r2Key, prompt, mode, templateId, size } = (await req.json()) as {
      r2Key?: string;
      prompt?: string;
      mode?: string;
      templateId?: string;
      size?: string;
    };

    if (!r2Key || typeof r2Key !== "string") {
      return NextResponse.json({ error: "r2Key is required." }, { status: 400 });
    }

    const orgId = await getOrganizationId();
    const userId = getSessionUserId(gate.session);

    const rows = await query<{ id: number }>(
      `INSERT INTO creative_studio_gallery
         (organization_id, r2_key, prompt, mode, template_id, size, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [orgId, r2Key, prompt || "", mode || "generate", templateId || null, size || "1024x1024", userId]
    );

    return NextResponse.json({ id: rows[0]?.id, saved: true });
  } catch (err: any) {
    if (err?.code === "42P01") {
      return NextResponse.json({ error: "Gallery table not yet created. Run the migration." }, { status: 503 });
    }
    console.error("[creative-studio/gallery] POST", err);
    return NextResponse.json({ error: "Failed to save image." }, { status: 500 });
  }
}

// DELETE /api/admin/creative-studio/gallery — delete a saved image
export async function DELETE(req: NextRequest) {
  const gate = await requireRoles(["admin", "super_admin"]);
  if (!gate.ok) return gate.response;

  try {
    const { id } = (await req.json()) as { id?: number };
    if (!id || typeof id !== "number") {
      return NextResponse.json({ error: "Image id is required." }, { status: 400 });
    }

    const orgId = await getOrganizationId();

    // Fetch the R2 key before deleting
    const rows = await query<{ r2_key: string }>(
      `DELETE FROM creative_studio_gallery
       WHERE id = $1 AND organization_id = $2
       RETURNING r2_key`,
      [id, orgId]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: "Image not found." }, { status: 404 });
    }

    // Best-effort R2 cleanup
    try {
      await deleteObjectFromR2(rows[0].r2_key);
    } catch (e) {
      console.warn("[creative-studio/gallery] R2 delete failed:", e);
    }

    return NextResponse.json({ deleted: true });
  } catch (err: any) {
    if (err?.code === "42P01") {
      return NextResponse.json({ error: "Gallery table not yet created." }, { status: 503 });
    }
    console.error("[creative-studio/gallery] DELETE", err);
    return NextResponse.json({ error: "Failed to delete image." }, { status: 500 });
  }
}
