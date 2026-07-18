interface SSEClient {
  id: string;
  userId: number;
  role: string;
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
  console.log(`[SSE] Client connected: ${client.id} (User: ${client.userId}). Total: ${global.sseClients?.length}`);
}

export function removeSSEClient(id: string) {
  global.sseClients = global.sseClients?.filter(c => c.id !== id);
  console.log(`[SSE] Client disconnected: ${id}. Total: ${global.sseClients?.length}`);
}

export function broadcastEvent(event: any, targetRoles?: string[], targetUserId?: number) {
  if (!global.sseClients || global.sseClients.length === 0) return;

  const payload = `data: ${JSON.stringify(event)}\n\n`;
  const encoder = new TextEncoder();
  const data = encoder.encode(payload);

  global.sseClients.forEach(client => {
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
