// eventBus.ts — the Attendance Tracker / Live Activity push channel.
//
// ── Tenant scope ────────────────────────────────────────────────────────────
// Subscribers carry an `organizationId`, and broadcastEvent() will not deliver
// to a subscriber from a different one. Before this, the only filters were
// `targetRoles` and `targetUserId`: a heartbeat or activity event raised in one
// organization reached every OTHER organization's admins, because "admin" is a
// role every tenant has. The events carry user names, device info, IP addresses
// and what lead someone is looking at.
//
// `organizationId` is required on both the subscriber and the broadcast. There
// is deliberately no "broadcast to everyone" mode: a future platform-wide
// announcement should be an explicit, separately named function, not an omitted
// argument that quietly defaults to crossing tenants.

interface SSEClient {
  id: string;
  userId: number;
  role: string;
  /** The subscriber's tenant, from the server session. */
  organizationId: string;
  controller: any;
}

declare global {
  var sseClients: SSEClient[] | undefined;
}

if (!global.sseClients) {
  global.sseClients = [];
}

export function addSSEClient(client: SSEClient) {
  global.sseClients?.push(client);
  console.log(
    `[SSE] Client connected: ${client.id} (User: ${client.userId}, Org: ${client.organizationId}). Total: ${global.sseClients?.length}`
  );
}

export function removeSSEClient(id: string) {
  global.sseClients = global.sseClients?.filter(c => c.id !== id);
  console.log(`[SSE] Client disconnected: ${id}. Total: ${global.sseClients?.length}`);
}

/**
 * @param organizationId the tenant the event belongs to; resolve it with
 *                       getOrganizationId() at the call site.
 */
export function broadcastEvent(
  organizationId: string,
  event: any,
  targetRoles?: string[],
  targetUserId?: number
) {
  if (!global.sseClients || global.sseClients.length === 0) return;

  const payload = `data: ${JSON.stringify(event)}\n\n`;
  const encoder = new TextEncoder();
  const data = encoder.encode(payload);

  global.sseClients.forEach(client => {
    // Tenant boundary first, and it is not optional. Everything below it is a
    // routing preference; this one is access control.
    if (client.organizationId !== organizationId) return;

    // Filter by specific user if required (e.g. Force Logout targeted)
    if (targetUserId && String(client.userId) !== String(targetUserId)) return;

    // Filter by roles if required (e.g. Broadcast to admins only)
    if (targetRoles && !targetRoles.includes(client.role)) return;

    try {
      client.controller.enqueue(data);
    } catch (e) {
      removeSSEClient(client.id);
    }
  });
}
