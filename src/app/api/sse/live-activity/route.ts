import { requireRole } from "@/lib/serverAuth";
import { addSSEClient, removeSSEClient } from "@/lib/eventBus";

// ✅ Pass withCredentials so cookies are sent
const eventSource = new EventSource('/api/sse/live-activity', {
  withCredentials: true
});
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const auth = await requireRole(["admin", "super_admin"]);
    console.log("SSE auth result:", auth.isAuthorized, auth.session?.role); // ← add this
    if (!auth.isAuthorized || !auth.session) {
      return new Response("Unauthorized", { status: 401 });
    }


    const responseStream = new TransformStream();
    const writer = responseStream.writable.getWriter();

    const clientId = Math.random().toString(36).substring(7);

    const controller = {
      enqueue: (data: Uint8Array) => writer.write(data),
      close: () => writer.close()
    };

    addSSEClient({
      id: clientId,
      userId: auth.session._id,
      role: auth.session.role,
      controller
    });

    req.signal.addEventListener("abort", () => {
      removeSSEClient(clientId);
    });

    return new Response(responseStream.readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (err) {
    console.error("SSE Error:", err);
    return new Response("Internal Server Error", { status: 500 });
  }
}
