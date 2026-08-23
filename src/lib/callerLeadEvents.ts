// callerLeadEvents.ts — the live push channel for the Caller Panel.
//
// Lifted out of app/api/caller-leads/events/route.ts and partitioned by tenant,
// for the same reason as lib/lostLeadEvents.ts: the registry was a single global
// Set, so `lead_updated` — whose payload is the PATCH body, i.e. name,
// contact_no, email, budget, location — was enqueued to every organization's
// subscribers, not just the one the lead belongs to. `leads_uploaded` and the
// two delete events leaked file names and batch ids the same way, and made
// other tenants' panels refetch on a change that was never theirs.
//
// Module scope rather than the route file also fixes a Next.js hazard: a route
// module is not a stable singleton to import from, so the client registry could
// be instantiated more than once and a broadcast would reach only some of the
// open streams.

type Controller = ReadableStreamDefaultController;

/** organization id → controllers currently subscribed for that tenant. */
const clientsByOrg = new Map<string, Set<Controller>>();

/**
 * Push an event to one organization's Caller Panel subscribers.
 *
 * @param organizationId resolved server-side with getOrganizationId(). Required,
 *                       so a call site cannot omit it and silently broadcast to
 *                       every tenant.
 */
export function broadcastCallerUpdate(organizationId: string, data: object) {
  const subscribers = clientsByOrg.get(organizationId);
  if (!subscribers || subscribers.size === 0) return;

  const msg = `data: ${JSON.stringify(data)}\n\n`;
  const dead: Controller[] = [];

  subscribers.forEach((ctrl) => {
    try {
      ctrl.enqueue(msg);
    } catch {
      dead.push(ctrl);
    }
  });

  dead.forEach((ctrl) => subscribers.delete(ctrl));
  if (subscribers.size === 0) clientsByOrg.delete(organizationId);
}

function subscribe(organizationId: string, ctrl: Controller) {
  let set = clientsByOrg.get(organizationId);
  if (!set) {
    set = new Set<Controller>();
    clientsByOrg.set(organizationId, set);
  }
  set.add(ctrl);
}

function unsubscribe(organizationId: string, ctrl: Controller) {
  const set = clientsByOrg.get(organizationId);
  if (!set) return;
  set.delete(ctrl);
  if (set.size === 0) clientsByOrg.delete(organizationId);
}

/** Open an SSE stream scoped to one organization. */
export function createCallerUpdateStream(organizationId: string) {
  let controller: Controller;
  let heartbeatTimer: ReturnType<typeof setInterval>;

  const stream = new ReadableStream({
    start(ctrl) {
      controller = ctrl;
      subscribe(organizationId, ctrl);
      ctrl.enqueue(`data: ${JSON.stringify({ type: "connected", ts: Date.now() })}\n\n`);

      // Heartbeat every 25s — keeps proxies from killing an idle connection.
      heartbeatTimer = setInterval(() => {
        try {
          ctrl.enqueue(": heartbeat\n\n");
        } catch {
          clearInterval(heartbeatTimer);
          unsubscribe(organizationId, ctrl);
        }
      }, 25_000);
    },
    cancel() {
      clearInterval(heartbeatTimer);
      unsubscribe(organizationId, controller);
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
