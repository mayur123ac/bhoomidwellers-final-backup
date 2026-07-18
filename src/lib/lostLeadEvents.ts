const clients = new Set<ReadableStreamDefaultController>();

export function broadcastLeadUpdate(data: object) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  const dead: ReadableStreamDefaultController[] = [];

  clients.forEach((ctrl) => {
    try {
      ctrl.enqueue(msg);
    } catch {
      dead.push(ctrl);
    }
  });

  dead.forEach((ctrl) => clients.delete(ctrl));
}

export function createLeadUpdateStream() {
  let controller: ReadableStreamDefaultController;
  let heartbeatTimer: ReturnType<typeof setInterval>;

  const stream = new ReadableStream({
    start(ctrl) {
      controller = ctrl;
      clients.add(ctrl);
      ctrl.enqueue(`data: ${JSON.stringify({ type: "connected", ts: Date.now() })}\n\n`);

      heartbeatTimer = setInterval(() => {
        try {
          ctrl.enqueue(": heartbeat\n\n");
        } catch {
          clearInterval(heartbeatTimer);
          clients.delete(ctrl);
        }
      }, 25_000);
    },
    cancel() {
      clearInterval(heartbeatTimer);
      clients.delete(controller);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
