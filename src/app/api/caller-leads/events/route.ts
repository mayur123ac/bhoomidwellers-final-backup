// app/api/caller-leads/events/route.ts
import { NextRequest } from "next/server";

const clients = new Set<ReadableStreamDefaultController>();

export function broadcastUpdate(data: object) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  const dead: ReadableStreamDefaultController[] = [];
  clients.forEach(ctrl => {
    try { ctrl.enqueue(msg); }
    catch { dead.push(ctrl); }
  });
  dead.forEach(c => clients.delete(c));
}

export async function GET(req: NextRequest) {
  let controller: ReadableStreamDefaultController;
  let heartbeatTimer: ReturnType<typeof setInterval>;

  const stream = new ReadableStream({
    start(ctrl) {
      controller = ctrl;
      clients.add(ctrl);
      ctrl.enqueue(`data: ${JSON.stringify({ type: "connected", ts: Date.now() })}\n\n`);

      // ✅ Heartbeat every 25s — prevents proxy/nginx from killing idle connections
      heartbeatTimer = setInterval(() => {
        try {
          ctrl.enqueue(`: heartbeat\n\n`); // SSE comment, ignored by client
        } catch {
          clearInterval(heartbeatTimer);
          clients.delete(ctrl);
        }
      }, 25_000);
    },
    cancel() {
      clearInterval(heartbeatTimer); // ✅ Clean up timer when client disconnects
      clients.delete(controller);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":      "text/event-stream",
      "Cache-Control":     "no-cache, no-transform",
      "Connection":        "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}