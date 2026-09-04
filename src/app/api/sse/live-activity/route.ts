// SSE endpoint for live activity events — DEPRECATED.
// Realtime delivery migrated to Supabase Broadcast.

export const dynamic = "force-dynamic";

export async function GET() {
  return new Response("Live activity realtime migrated to Supabase Broadcast.", { status: 410 });
}
