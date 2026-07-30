import { adminAiTools } from "./tools";
import { adminServices } from "./services";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini"; // Standardizing on the same fast model

export class AdminLlmError extends Error {
    constructor(public status: number, public userMessage: string) {
        super(userMessage);
        this.name = "AdminLlmError";
    }
}

export function isAdminLlmConfigured(): boolean {
    return !!process.env.OPENAI_API_KEY;
}

export async function askAdminAI(messages: any[]) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new AdminLlmError(503, "The AI is currently unavailable (missing API key).");
    }

    // Pass 1: Ask OpenAI with tools
    let res: Response;
    try {
        res = await fetch(OPENAI_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: MODEL,
                messages,
                tools: adminAiTools,
                tool_choice: "auto",
                temperature: 0.1,
            }),
            signal: AbortSignal.timeout(30_000),
        });
    } catch (e: any) {
        throw new AdminLlmError(504, "The assistant took too long to respond. Try again.");
    }

    if (!res.ok) {
        console.error("[admin-ai] OpenAI error", res.status, await res.text().catch(() => ""));
        throw new AdminLlmError(502, "The assistant encountered an error. Try again.");
    }

    const data = await res.json();
    const message = data.choices[0].message;

    // If the model didn't want to call any tools, just return its response directly
    if (!message.tool_calls || message.tool_calls.length === 0) {
        return message.content;
    }

    // The model wants to call tools
    messages.push(message);

    for (const toolCall of message.tool_calls) {
        const functionName = toolCall.function.name;
        let args = {};
        try {
            args = JSON.parse(toolCall.function.arguments || "{}");
        } catch (e) { }

        console.log(`[admin-ai] GPT called tool: ${functionName}`, args);
        
        const serviceFn = adminServices[functionName];
        let toolResult;
        
        if (serviceFn) {
            try {
                toolResult = await serviceFn(args);
            } catch (e: any) {
                console.error(`[admin-ai] Tool ${functionName} failed:`, e);
                toolResult = { error: "Failed to execute database query." };
            }
        } else {
            toolResult = { error: `Tool ${functionName} not found on backend.` };
        }

        messages.push({
            tool_call_id: toolCall.id,
            role: "tool",
            name: functionName,
            content: JSON.stringify(toolResult),
        });
    }

    // Pass 2: Send the tool results back to OpenAI
    let finalRes: Response;
    try {
        finalRes = await fetch(OPENAI_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: MODEL,
                messages,
                temperature: 0.2,
            }),
            signal: AbortSignal.timeout(30_000),
        });
    } catch (e: any) {
        throw new AdminLlmError(504, "The assistant took too long to formulate the final response.");
    }

    if (!finalRes.ok) {
        console.error("[admin-ai] OpenAI final error", finalRes.status, await finalRes.text().catch(() => ""));
        throw new AdminLlmError(502, "The assistant encountered an error after fetching data.");
    }

    const finalData = await finalRes.json();
    return finalData.choices[0].message.content;
}
