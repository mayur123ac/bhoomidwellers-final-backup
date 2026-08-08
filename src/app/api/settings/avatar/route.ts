// app/api/settings/avatar/route.ts — profile picture upload and removal.
//
// The spec calls for Cloudflare Images with `avatar=fit:cover,width=200` URL
// transforms. This project uses Cloudflare R2 (plain object storage, via the S3
// SDK in lib/r2.ts) and has no Images subscription — there is no transform
// pipeline to call. So the resize happens client-side: ProfilePictureUpload
// crops to a square and downscales to 512px on a canvas before posting, which
// means what lands in the bucket is already avatar-sized and no CDN transform is
// needed to keep the payload small.
//
// R2 objects are private and are read back through the existing session-gated
// /api/r2-proxy. When R2 is unconfigured (a fresh clone with no R2_* vars) the
// file falls back to public/uploads/avatars, mirroring what /api/upload does, so
// the feature works locally without cloud credentials.

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/serverAuth";
import { deleteObjectFromR2, uploadBufferToR2 } from "@/lib/r2";
import { requestContext, writeAuditLog } from "@/lib/auditLog";
import { avatarSrc, loadSettingsUser } from "@/lib/settingsUser";

export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024; // 5MB, per spec
const ALLOWED = new Map<string, string>([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
]);

function r2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_ENDPOINT &&
      process.env.R2_BUCKET_NAME
  );
}

/** Remove whatever the user had before, so replacing an avatar doesn't leak objects. */
async function removeExisting(row: { avatar_key: string | null; avatar_url: string | null }) {
  if (row.avatar_key) {
    try {
      await deleteObjectFromR2(row.avatar_key);
    } catch (err: any) {
      // A dangling object is untidy; failing the user's upload over it is worse.
      console.error("[avatar] could not delete old R2 object:", err?.message);
    }
  }
  if (row.avatar_url?.startsWith("/uploads/avatars/")) {
    try {
      await fs.unlink(path.join(process.cwd(), "public", row.avatar_url));
    } catch {
      /* already gone */
    }
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;
  if (!gate.userId) {
    return NextResponse.json({ success: false, message: "Session carries no user id." }, { status: 400 });
  }

  const form = await req.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, message: "No file uploaded." }, { status: 400 });
  }

  // Both checks run server-side even though the client checks too — the client
  // check is a courtesy, this one is the rule.
  const extension = ALLOWED.get(file.type);
  if (!extension) {
    return NextResponse.json(
      { success: false, message: "Supports JPG, PNG, GIF or WebP only." },
      { status: 400 }
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { success: false, message: "Image must be under 5MB." },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const existing = await loadSettingsUser(gate.userId);
  if (!existing) {
    return NextResponse.json({ success: false, message: "User not found." }, { status: 404 });
  }

  const filename = `user_${gate.userId}_${Date.now()}.${extension}`;
  let avatarKey: string | null = null;
  let avatarUrl: string | null = null;

  if (r2Configured()) {
    avatarKey = await uploadBufferToR2(`avatars/${filename}`, buffer, file.type);
  } else {
    const dir = path.join(process.cwd(), "public", "uploads", "avatars");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, filename), buffer);
    avatarUrl = `/uploads/avatars/${filename}`;
  }

  await removeExisting(existing);

  // Exactly one of the two columns is ever set; the other is cleared so
  // avatarSrc() has no ambiguity about which storage the file is in.
  await query(
    `UPDATE users SET avatar_key = $1, avatar_url = $2, updated_at = NOW() WHERE id = $3`,
    [avatarKey, avatarUrl, gate.userId]
  );

  const { ip, userAgent } = requestContext(req);
  await writeAuditLog({
    userId: gate.userId,
    actorName: existing.name,
    action: "profile.avatar.update",
    entityType: "user",
    entityId: gate.userId,
    newValue: { storage: avatarKey ? "r2" : "local", filename },
    ipAddress: ip,
    userAgent,
  });

  return NextResponse.json({
    success: true,
    avatarUrl: avatarSrc({ avatar_key: avatarKey, avatar_url: avatarUrl }),
    message: "Profile picture updated",
  });
}

export async function DELETE(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;
  if (!gate.userId) {
    return NextResponse.json({ success: false, message: "Session carries no user id." }, { status: 400 });
  }

  const existing = await loadSettingsUser(gate.userId);
  if (!existing) {
    return NextResponse.json({ success: false, message: "User not found." }, { status: 404 });
  }

  await removeExisting(existing);
  await query(
    `UPDATE users SET avatar_key = NULL, avatar_url = NULL, updated_at = NOW() WHERE id = $1`,
    [gate.userId]
  );

  const { ip, userAgent } = requestContext(req);
  await writeAuditLog({
    userId: gate.userId,
    actorName: existing.name,
    action: "profile.avatar.remove",
    entityType: "user",
    entityId: gate.userId,
    ipAddress: ip,
    userAgent,
  });

  return NextResponse.json({ success: true, message: "Profile picture removed" });
}
