import { NextRequest, NextResponse } from "next/server";
import { requireRoles } from "@/lib/serverAuth";
import {
  generateImage,
  editImage,
  ImageApiError,
  SIZES,
  QUALITY_OPTIONS,
  type ImageSize,
  type ImageQuality,
} from "@/lib/creative-studio/imageApi";
import { uploadBufferToR2, generatePresignedUrl } from "@/lib/r2";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

// POST /api/admin/creative-studio/generate
// Generates images from a prompt, optionally with reference images (edit mode).
export async function POST(req: NextRequest) {
  const gate = await requireRoles(["admin", "super_admin"]);
  if (!gate.ok) return gate.response;

  try {
    const body = await req.json();
    const {
      prompt,
      size = "1024x1024",
      quality = "auto",
      n = 1,
      referenceImages,
      mode = "generate",
    } = body as {
      prompt?: string;
      size?: string;
      quality?: string;
      n?: number;
      referenceImages?: string[];
      mode?: "generate" | "edit";
    };

    if (!prompt || typeof prompt !== "string" || prompt.trim().length < 3) {
      return NextResponse.json({ error: "A prompt is required (min 3 characters)." }, { status: 400 });
    }
    if (prompt.length > 4000) {
      return NextResponse.json({ error: "Prompt too long (max 4000 characters)." }, { status: 400 });
    }
    if (!(size in SIZES)) {
      return NextResponse.json({ error: `Invalid size. Use: ${Object.keys(SIZES).join(", ")}` }, { status: 400 });
    }
    if (!QUALITY_OPTIONS.includes(quality as ImageQuality)) {
      return NextResponse.json({ error: `Invalid quality. Use: ${QUALITY_OPTIONS.join(", ")}` }, { status: 400 });
    }
    const count = Math.min(Math.max(Number(n) || 1, 1), 4);

    let results;

    if (mode === "edit" && Array.isArray(referenceImages) && referenceImages.length > 0) {
      // Edit/combine mode — pass reference images
      if (referenceImages.length > 4) {
        return NextResponse.json({ error: "Maximum 4 reference images allowed." }, { status: 400 });
      }
      // Validate each image is base64
      for (const img of referenceImages) {
        if (typeof img !== "string" || img.length < 100) {
          return NextResponse.json({ error: "Invalid reference image data." }, { status: 400 });
        }
      }
      results = await editImage({
        prompt: prompt.trim(),
        images: referenceImages,
        size: size as ImageSize,
        quality: quality as ImageQuality,
      });
    } else {
      // Standard generation
      results = await generateImage({
        prompt: prompt.trim(),
        size: size as ImageSize,
        quality: quality as ImageQuality,
        n: count,
      });
    }

    // Save to R2 and return presigned URLs
    let orgId: string;
    try {
      orgId = String(await getOrganizationId());
    } catch {
      orgId = "unknown";
    }

    const images = await Promise.all(
      results.map(async (img, i) => {
        const ts = Date.now();
        const key = `creative-studio/${orgId}/${ts}_${i}.png`;
        const buf = Buffer.from(img.b64, "base64");
        await uploadBufferToR2(key, buf, "image/png");
        const url = await generatePresignedUrl(key, 3600); // 1 hour
        return {
          url,
          r2Key: key,
          revisedPrompt: img.revisedPrompt,
          size,
        };
      })
    );

    return NextResponse.json({ images });
  } catch (err) {
    if (err instanceof ImageApiError) {
      return NextResponse.json({ error: err.userMessage }, { status: err.status });
    }
    console.error("[creative-studio/generate]", err);
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}
