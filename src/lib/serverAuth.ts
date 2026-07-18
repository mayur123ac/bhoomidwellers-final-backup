import { cookies } from "next/headers";

export async function getServerSession() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("crm_session")?.value;

  if (!sessionCookie) return null;

  try {
    const decodedStr = Buffer.from(sessionCookie, "base64").toString("utf-8");
    return JSON.parse(decodedStr);
  } catch (err) {
    return null;
  }
}

export async function requireRole(allowedRoles: string[]) {
  const session = await getServerSession();

  if (!session || !session.role) {
    return {
      isAuthorized: false,
      session: null,
      error: "Unauthorized",
      status: 401,
    };
  }

  const role = session.role.toLowerCase();

  // Normalize allowed roles for comparison
  const normalizedAllowedRoles = allowedRoles.map((r) => r.toLowerCase());

  if (!normalizedAllowedRoles.includes(role)) {
    return {
      isAuthorized: false,
      session,
      error: "Forbidden - Insufficient permissions",
      status: 403,
    };
  }

  return {
    isAuthorized: true,
    session,
    error: null,
    status: 200,
  };
}
