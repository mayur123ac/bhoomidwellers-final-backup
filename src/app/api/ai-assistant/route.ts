import { NextResponse } from "next/server";
import { askOpenAI, buildLeadDigest, MAX_QUESTION_CHARS, Lead } from "./llm";
import { hydrateScope } from "./hydrate";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const query = (body.query || "").trim();
    const leads: Lead[] = body.leads || [];

    if (!leads.length) {
      return NextResponse.json({
        response:
          "No lead data found. Please make sure your leads are synced and try again.",
      });
    }

    if (query.length > MAX_QUESTION_CHARS) {
      return NextResponse.json({
        response: `That question is a bit long — keep it under ${MAX_QUESTION_CHARS} characters and I'll take another look.`,
      });
    }

    try {
      // Read the leads fresh from Postgres. The body decides WHICH leads are in
      // scope; the database decides what is true about them.
      const scope = await hydrateScope(leads as any, body.followUps || []);
      const label =
        scope.leads.length === 1
          ? `one lead — #${(scope.leads[0] as any).sr_no ?? scope.leads[0].id} ${scope.leads[0].name ?? ""}`.trim()
          : `${scope.leads.length} leads currently in the caller's view`;
      const digest = buildLeadDigest(scope.leads as any, scope.followUps, label);
      
      const { answer } = await askOpenAI(query, digest, body.history || []);
      return NextResponse.json({ response: answer });
    } catch (e: any) {
      console.error("[ai-assistant] LLM path failed:", e?.message || e);
      return NextResponse.json(
        { response: e?.userMessage || "The AI assistant is currently unavailable. Please try again later." },
        { status: e?.status || 502 }
      );
    }
  } catch (err) {
    console.error("Bhoomi AI error:", err);
    return NextResponse.json(
      { response: "Something went wrong on my end. Please try again." },
      { status: 500 }
    );
  }
}