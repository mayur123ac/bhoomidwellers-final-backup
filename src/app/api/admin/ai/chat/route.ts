import { NextResponse } from "next/server";
import { askAdminAI, AdminLlmError, isAdminLlmConfigured } from "@/lib/admin-ai/llm";

export const dynamic = "force-dynamic";

const SYSTEM_PROMPT = `You are the AI CRM Administrator for Bhoomi Dwellers, an Indian residential real estate project. 
You are speaking ONLY to the Admin. Your job is to act as an intelligent business analyst. 
You have access to live database queries via tools, but you ALSO receive FRONTEND CONTEXT representing what the Admin is currently looking at.

AI DECISION TREE & RULES:
1. STEP 1 (Frontend First): Can you answer the user's question using ONLY the provided FRONTEND CONTEXT?
   - If YES -> Answer immediately using the frontend data. DO NOT call any backend tools.
   - If NO -> Go to Step 2.
2. STEP 2 (Backend Fallback): If the required info is not in the frontend context (e.g. historical data, cross-module analytics, or deep searches), call the appropriate backend API tool.
3. FILTER AWARENESS: The frontend context often contains active filters (e.g., specific manager, specific month). You MUST respect these filters! If the user asks "How much OCR was collected?", answer ONLY for the filtered data. If they explicitly ask for "company-wide", "all data", or "ignore filters", ONLY THEN should you call backend tools to bypass the frontend filters.
4. CONTEXT MEMORY: Understand pronouns (e.g., "this one", "it") by referring to the last discussed or currently selected frontend record.
5. NO HALLUCINATION: Never guess or invent financial data. If it's missing from frontend AND backend, state clearly what is unavailable.
6. FORMAT: Answer in plain English. Format currency correctly in Indian numbering system (e.g., ₹1.2 Cr, ₹50 Lakh).`;

export async function POST(req: Request) {
    try {
        // Authenticate - in a real system we'd verify a secure session cookie or token.
        // For this implementation, the UI only renders for Admin, but we can do a basic check
        // if headers or a token are passed. For now, we trust the frontend role check.
        
        if (!isAdminLlmConfigured()) {
            return NextResponse.json(
                { response: "OpenAI API is not configured. Please add OPENAI_API_KEY to the server environment." },
                { status: 503 }
            );
        }

        const body = await req.json();
        const history = body.history || [];
        const query = (body.query || "").trim();
        const frontendContext = body.frontendContext;

        if (!query) {
            return NextResponse.json({ response: "Please ask a question." }, { status: 400 });
        }

        let fullSystemPrompt = SYSTEM_PROMPT;
        if (frontendContext) {
            fullSystemPrompt += `\n\n=== CURRENT FRONTEND CONTEXT ===\n${JSON.stringify(frontendContext, null, 2)}\n================================\nAlways check this context first before calling tools!`;
        }

        const messages = [
            { role: "system", content: fullSystemPrompt },
            ...history,
            { role: "user", content: query }
        ];

        const answer = await askAdminAI(messages);

        return NextResponse.json({ response: answer });

    } catch (e: any) {
        console.error("[admin-ai-chat] Error:", e);
        if (e instanceof AdminLlmError) {
            return NextResponse.json({ response: e.userMessage }, { status: e.status });
        }
        return NextResponse.json(
            { response: "Something went wrong processing your request." },
            { status: 500 }
        );
    }
}
