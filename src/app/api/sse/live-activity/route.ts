import { requireRole } from "@/lib/serverAuth";
import { addSSEClient, removeSSEClient } from "@/lib/eventBus";
import { getOrganizationId } from "@/lib/tenantContext";

// ✅ Pass withCredentials so cookies are sent

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const auth = await requireRole(["admin", "super_admin", "site_head", "site head"]);
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
      // From the signed session, never the request. Without it the bus filtered
      // only on role, and "admin" exists in every tenant — so one organization's
      // activity feed was delivered to all of them.
      organizationId: await getOrganizationId(),
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
