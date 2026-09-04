// SSE endpoint for caller lead events — DEPRECATED.
// Realtime delivery migrated to Supabase Broadcast.

export const dynamic = "force-dynamic";

export async function GET() {
  return new Response("Caller lead realtime migrated to Supabase Broadcast.", { status: 410 });
}
