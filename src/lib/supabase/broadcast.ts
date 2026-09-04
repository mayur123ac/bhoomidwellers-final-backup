// lib/supabase/broadcast.ts — server-side Supabase Realtime broadcast helper.
//
// Sends events to a private Supabase Realtime channel from the API layer.
// The application database remains Neon; Supabase is only the transport.
//
// Call broadcastToOrg() ONLY after a successful Neon mutation. It is
// fire-and-forget — it must never delay the HTTP response or throw to the
// caller. If the broadcast fails, the client's next poll or reconnect-sync
// will catch up; a failed push is never worse than the SSE system it replaces,
// which lost events across Vercel instances anyway.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

function getServerSupabase(): SupabaseClient | null {
  if (_client) return _client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;

  _client = createClient(url, key, {
    auth: { persistSession: false },
    realtime: { heartbeatIntervalMs: 15_000 },
  });
  return _client;
}

/**
 * Broadcast an event to an organization's private channel.
 *
 * Fire-and-forget. Never throws to the caller. A failed broadcast is logged
 * but does not break the mutation that triggered it.
 */
export async function broadcastToOrg(
  organizationId: string,
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const sb = getServerSupabase();
    if (!sb) return;

    const channel = sb.channel(`org:${organizationId}`, {
      config: { private: true },
    });

    // subscribe, send, then immediately remove the channel
    await new Promise<void>((resolve) => {
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          channel
            .send({ type: "broadcast", event, payload })
            .then(() => {
              sb.removeChannel(channel);
              resolve();
            })
            .catch(() => {
              sb.removeChannel(channel);
              resolve();
            });
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          sb.removeChannel(channel);
          resolve();
        }
      });

      // Safety timeout — never hang the server
      setTimeout(() => {
        sb.removeChannel(channel);
        resolve();
      }, 5_000);
    });
  } catch (err) {
    console.warn("[supabase-broadcast] failed:", event, err);
  }
}

/**
 * Broadcast to a user-scoped private channel (e.g. for FORCE_LOGOUT).
 */
export async function broadcastToUser(
  organizationId: string,
  userId: number | string,
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const sb = getServerSupabase();
    if (!sb) return;

    const channel = sb.channel(`org:${organizationId}:user:${userId}`, {
      config: { private: true },
    });

    await new Promise<void>((resolve) => {
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          channel
            .send({ type: "broadcast", event, payload })
            .then(() => {
              sb.removeChannel(channel);
              resolve();
            })
            .catch(() => {
              sb.removeChannel(channel);
              resolve();
            });
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          sb.removeChannel(channel);
          resolve();
        }
      });

      setTimeout(() => {
        sb.removeChannel(channel);
        resolve();
      }, 5_000);
    });
  } catch (err) {
    console.warn("[supabase-broadcast] user broadcast failed:", event, err);
  }
}
