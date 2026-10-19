import { NextRequest, NextResponse } from "next/server";
import { requireRoles } from "@/lib/serverAuth";
import { enhancePrompt, ImageApiError } from "@/lib/creative-studio/imageApi";

export const dynamic = "force-dynamic";

// POST /api/admin/creative-studio/enhance
// Enhances a short prompt into a detailed visual description.
export async function POST(req: NextRequest) {
  const gate = await requireRoles(["admin", "super_admin"]);
  if (!gate.ok) return gate.response;

  try {
    const { prompt } = (await req.json()) as { prompt?: string };

    if (!prompt || typeof prompt !== "string" || prompt.trim().length < 3) {
      return NextResponse.json({ error: "A prompt is required (min 3 characters)." }, { status: 400 });
    }
    if (prompt.length > 1000) {
      return NextResponse.json({ error: "Prompt too long for enhancement (max 1000 characters)." }, { status: 400 });
    }

    const enhanced = await enhancePrompt(prompt.trim());
    return NextResponse.json({ enhanced });
  } catch (err) {
    if (err instanceof ImageApiError) {
      return NextResponse.json({ error: err.userMessage }, { status: err.status });
    }
    console.error("[creative-studio/enhance]", err);
    return NextResponse.json({ error: "Prompt enhancement failed." }, { status: 500 });
  }
}
