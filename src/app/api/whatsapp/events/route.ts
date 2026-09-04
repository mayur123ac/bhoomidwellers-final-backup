// SSE endpoint for WhatsApp events — DEPRECATED.
// Realtime delivery migrated to Supabase Broadcast.

export const dynamic = "force-dynamic";

export async function GET() {
  return new Response("WhatsApp realtime migrated to Supabase Broadcast.", { status: 410 });
}
