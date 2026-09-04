// SSE endpoint for follow-up events — DEPRECATED.
// Realtime delivery migrated to Supabase Broadcast.
// This endpoint returns 410 Gone so any stale client learns to stop connecting.

export const dynamic = "force-dynamic";

export async function GET() {
  return new Response("Follow-up realtime migrated to Supabase Broadcast.", { status: 410 });
}
