// followUpEvents.ts — live push channel for follow-up messages.
//
// Tenant-partitioned, exactly like lostLeadEvents.ts. A broadcast reaches
// only the subscribers in the same organization. The organization id comes
// from the server session (never from the request).

type Controller = ReadableStreamDefaultController;

/** organization id -> the controllers currently subscribed for that tenant. */
const clientsByOrg = new Map<string, Set<Controller>>();

// ── Event types ─────────────────────────────────────────────────────────────

export type FollowUpEvent =
  | { type: "followup:created"; followUp: FollowUpPayload }
  | { type: "followup:read";    ids: number[]; leadId: number; readAt: string; readBy: string }
  | { type: "connected";        ts: number };

export interface FollowUpPayload {
  _id: string;
  leadId: string;
  salesManagerName: string;
  createdBy: string;
  message: string;
  siteVisitDate: string | null;
  createdAt: string;
  followUpType: string;
  createdByRole: string | null;
  sentToRole: string | null;
  sentToUserId: number | null;
  parentFollowUpId: number | null;
  readAt: string | null;
  clientMessageId?: string;
}

// ── Broadcast ───────────────────────────────────────────────────────────────

export function broadcastFollowUp(organizationId: string, event: FollowUpEvent) {
  const subscribers = clientsByOrg.get(organizationId);
  if (!subscribers || subscribers.size === 0) return;

  const msg = `data: ${JSON.stringify(event)}\n\n`;
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

// ── Subscribe / unsubscribe ─────────────────────────────────────────────────

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

// ── Stream factory ──────────────────────────────────────────────────────────

export function createFollowUpStream(organizationId: string) {
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
