// lostLeadEvents.ts — the live push channel for lost/restored leads.
//
// ── Why this file is tenant-partitioned ─────────────────────────────────────
// It used to hold ONE global `Set<ReadableStreamDefaultController>`. Every
// signed-in user, from every organization, landed in that set, and
// broadcastLeadUpdate() enqueued the message to all of them. The message body
// is the whole `walkin_enquiries` row — name, phone, alt_phone, email, address,
// budget, assignment. So marking a Bhoomi lead lost pushed that lead's complete
// record into the browser of every Viraj user with a dashboard open.
//
// The client-side merge (updateLeadLostState) only rewrites a lead it already
// holds, so nothing foreign appeared on screen — which is exactly why this went
// unnoticed. It was still a cross-tenant disclosure: the data was on the wire
// and in the other tenant's page, readable from devtools or by any script on
// the page. "The UI happened not to render it" is not an access control.
//
// Subscribers are now keyed by organization id, taken from the server session
// (never from the request), and a broadcast reaches only its own tenant's set.

type Controller = ReadableStreamDefaultController;

/** organization id → the controllers currently subscribed for that tenant. */
const clientsByOrg = new Map<string, Set<Controller>>();

/**
 * Push an event to one organization's subscribers.
 *
 * @param organizationId the tenant the event belongs to. Resolve it with
 *                       getOrganizationId() at the call site — a broadcast with
 *                       the wrong id is the same leak this module exists to
 *                       close, so it is a required parameter rather than an
 *                       optional one that silently defaults to "everyone".
 */
export function broadcastLeadUpdate(organizationId: string, data: object) {
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

/**
 * Open an SSE stream scoped to one organization.
 *
 * @param organizationId the caller's tenant, from the server session.
 */
export function createLeadUpdateStream(organizationId: string) {
  let controller: Controller;
  let heartbeatTimer: ReturnType<typeof setInterval>;

  const stream = new ReadableStream({
    start(ctrl) {
      controller = ctrl;
      subscribe(organizationId, ctrl);
      ctrl.enqueue(`data: ${JSON.stringify({ type: "connected", ts: Date.now() })}\n\n`);

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

/** Subscriber counts per tenant. Used by the cross-tenant isolation tests. */
export function subscriberCounts(): Record<string, number> {
  const out: Record<string, number> = {};
  clientsByOrg.forEach((set, org) => { out[org] = set.size; });
  return out;
}
