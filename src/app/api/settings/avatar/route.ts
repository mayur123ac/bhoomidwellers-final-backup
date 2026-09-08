import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { requireSession } from "@/lib/serverAuth";
import { query } from "@/lib/db";
import { avatarSrc } from "@/lib/settingsUser";
import { uploadBufferToR2, deleteObjectFromR2 } from "@/lib/r2";

export const dynamic = "force-dynamic";

// POST /api/settings/avatar — upload avatar (FormData with "file" field)
export async function POST(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const userId = gate.userId;
  if (!userId) {
    return NextResponse.json({ success: false, message: "Session carries no user ID." }, { status: 400 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ success: false, message: "No file provided." }, { status: 400 });
    }
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ success: false, message: "File must be an image." }, { status: 400 });
    }
    if (file.size > 2 * 1024 * 1024) {
      return NextResponse.json({ success: false, message: "File must be under 2 MB." }, { status: 400 });
    }

    // Clean up existing avatar
    const existing = await query<{ avatar_key: string | null; avatar_url: string | null }>(
      `SELECT avatar_key, avatar_url FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    );
    const existingRow = existing[0];

    if (existingRow?.avatar_key) {
      try { await deleteObjectFromR2(existingRow.avatar_key); } catch { /* soft-fail */ }
    }
    if (existingRow?.avatar_url?.startsWith("/uploads/avatars/")) {
      try {
        await fs.unlink(path.join(process.cwd(), "public", existingRow.avatar_url));
      } catch { /* soft-fail */ }
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const ext = file.name.split(".").pop() || "jpg";
    const mimeType = file.type;

    // Try R2 first
    try {
      const key = `avatars/${userId}/${Date.now()}.${ext}`;
      await uploadBufferToR2(key, buffer, mimeType);
      await query(
        `UPDATE users SET avatar_key = $1, avatar_url = NULL WHERE id = $2`,
        [key, userId]
      );
      const avatarUrl = `/api/r2-proxy?key=${encodeURIComponent(key)}`;
      return NextResponse.json({ success: true, avatarUrl });
    } catch {
      // R2 not configured — fall back to local storage
    }

    // Local fallback
    const uploadDir = path.join(process.cwd(), "public", "uploads", "avatars", String(userId));
    await fs.mkdir(uploadDir, { recursive: true });
    const fileName = `${Date.now()}.${ext}`;
    await fs.writeFile(path.join(uploadDir, fileName), buffer);
    const avatarUrl = `/uploads/avatars/${userId}/${fileName}`;
    await query(
      `UPDATE users SET avatar_key = NULL, avatar_url = $1 WHERE id = $2`,
      [avatarUrl, userId]
    );

    return NextResponse.json({ success: true, avatarUrl });
  } catch (err: any) {
    console.error("[POST /api/settings/avatar]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// DELETE /api/settings/avatar
export async function DELETE() {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const userId = gate.userId;
  if (!userId) {
    return NextResponse.json({ success: false, message: "Session carries no user ID." }, { status: 400 });
  }

  try {
    const rows = await query<{ avatar_key: string | null; avatar_url: string | null }>(
      `SELECT avatar_key, avatar_url FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    );
    const row = rows[0];

    if (row?.avatar_key) {
      try { await deleteObjectFromR2(row.avatar_key); } catch { /* soft-fail */ }
    }
    if (row?.avatar_url?.startsWith("/uploads/")) {
      try {
        await fs.unlink(path.join(process.cwd(), "public", row.avatar_url));
      } catch { /* soft-fail */ }
    }

    await query(
      `UPDATE users SET avatar_url = NULL, avatar_key = NULL WHERE id = $1`,
      [userId]
    );

    return NextResponse.json({ success: true, message: "Avatar removed." });
  } catch (err: any) {
    console.error("[DELETE /api/settings/avatar]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
