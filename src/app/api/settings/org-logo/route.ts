import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { query } from "@/lib/db";
import { uploadBufferToR2, deleteObjectFromR2 } from "@/lib/r2";

export const dynamic = "force-dynamic";

function logoSrc(row: { logo_key: string | null; logo_url: string | null }): string | null {
  if (row.logo_key) return `/api/r2-proxy?key=${encodeURIComponent(row.logo_key)}`;
  return row.logo_url || null;
}

export async function GET() {
  const gate = await requireRoles(["admin"]);
  if (!gate.ok) return gate.response;

  try {
    const orgId = await getOrganizationId();
    const rows = await query<{ logo_key: string | null; logo_url: string | null }>(
      "SELECT logo_key, logo_url FROM public.organizations WHERE id = $1 LIMIT 1",
      [orgId]
    );

    if (rows.length === 0) {
      return NextResponse.json({ success: false, message: "Organization not found" }, { status: 404 });
    }

    const row = rows[0];
    const logo = logoSrc(row);
    return NextResponse.json({ success: true, logo, hasLogo: Boolean(logo) });
  } catch (err: any) {
    console.error("[GET /api/settings/org-logo]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireRoles(["admin"]);
  if (!gate.ok) return gate.response;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ success: false, message: "No file provided" }, { status: 400 });
    }
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ success: false, message: "File must be an image" }, { status: 400 });
    }
    if (file.size > 2 * 1024 * 1024) {
      return NextResponse.json({ success: false, message: "File must be under 2 MB" }, { status: 400 });
    }

    const orgId = await getOrganizationId();

    // Fetch existing logo for cleanup
    const existing = await query<{ logo_key: string | null; logo_url: string | null }>(
      "SELECT logo_key, logo_url FROM public.organizations WHERE id = $1 LIMIT 1",
      [orgId]
    );
    const existingRow = existing[0];

    if (existingRow?.logo_key) {
      try { await deleteObjectFromR2(existingRow.logo_key); } catch { /* soft-fail */ }
    }
    if (existingRow?.logo_url?.startsWith("/uploads/org-logos/")) {
      try {
        await fs.unlink(path.join(process.cwd(), "public", existingRow.logo_url));
      } catch { /* soft-fail */ }
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const ext = file.name.split(".").pop() || "png";
    const mimeType = file.type;

    // Try R2 first
    try {
      const key = `org-logos/${orgId}/${Date.now()}.${ext}`;
      await uploadBufferToR2(key, buffer, mimeType);
      await query(
        "UPDATE public.organizations SET logo_key = $1, logo_url = NULL WHERE id = $2",
        [key, orgId]
      );
      const logo = `/api/r2-proxy?key=${encodeURIComponent(key)}`;
      return NextResponse.json({ success: true, logo });
    } catch {
      // R2 not configured — fall back to local storage
    }

    // Local fallback
    const uploadDir = path.join(process.cwd(), "public", "uploads", "org-logos", orgId);
    await fs.mkdir(uploadDir, { recursive: true });
    const fileName = `${Date.now()}.${ext}`;
    await fs.writeFile(path.join(uploadDir, fileName), buffer);
    const logoUrl = `/uploads/org-logos/${orgId}/${fileName}`;
    await query(
      "UPDATE public.organizations SET logo_key = NULL, logo_url = $1 WHERE id = $2",
      [logoUrl, orgId]
    );
    return NextResponse.json({ success: true, logo: logoUrl });
  } catch (err: any) {
    console.error("[POST /api/settings/org-logo]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

export async function DELETE() {
  const gate = await requireRoles(["admin"]);
  if (!gate.ok) return gate.response;

  try {
    const orgId = await getOrganizationId();
    const rows = await query<{ logo_key: string | null; logo_url: string | null }>(
      "SELECT logo_key, logo_url FROM public.organizations WHERE id = $1 LIMIT 1",
      [orgId]
    );

    const row = rows[0];
    if (row?.logo_key) {
      try { await deleteObjectFromR2(row.logo_key); } catch { /* soft-fail */ }
    }
    if (row?.logo_url?.startsWith("/uploads/")) {
      try {
        await fs.unlink(path.join(process.cwd(), "public", row.logo_url));
      } catch { /* soft-fail */ }
    }

    await query(
      "UPDATE public.organizations SET logo_key = NULL, logo_url = NULL WHERE id = $1",
      [orgId]
    );
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[DELETE /api/settings/org-logo]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
