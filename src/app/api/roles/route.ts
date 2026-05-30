// app/api/roles/route.ts
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRole } from "@/lib/serverAuth";

// ── GET: Fetch all roles ──────────────────────────────────────────────────────
export async function GET() {
  try {
    const roles = await query(
      `SELECT id, name FROM roles ORDER BY name ASC`
    );

    // Map id → _id so the employees page keeps working without changes
    const mapped = roles.map(r => ({ ...r, _id: String(r.id) }));
    return NextResponse.json(mapped, { status: 200 });

  } catch (error) {
    console.error("GET /api/roles error:", error);
    return NextResponse.json({ message: "Error fetching roles." }, { status: 500 });
  }
}

// ── POST: Add a new role ──────────────────────────────────────────────────────
export async function POST(req: Request) {
  try {
    const auth = await requireRole(["admin"]);
    if (!auth.isAuthorized) {
      return NextResponse.json({ message: auth.error }, { status: auth.status });
    }

    const { name } = await req.json();

    if (!name?.trim()) {
      return NextResponse.json({ message: "Role name is required." }, { status: 400 });
    }

    // Conflict check
    const existing = await query(
      `SELECT id FROM roles WHERE LOWER(name) = LOWER($1) LIMIT 1`,
      [name.trim()]
    );
    if (existing.length > 0) {
      return NextResponse.json({ message: "Role already exists." }, { status: 400 });
    }

    const [newRole] = await query(
      `INSERT INTO roles (name) VALUES ($1) RETURNING id, name`,
      [name.trim()]
    );

    return NextResponse.json(
      { ...newRole, _id: String(newRole.id) },
      { status: 201 }
    );

  } catch (error) {
    console.error("POST /api/roles error:", error);
    return NextResponse.json({ message: "Error creating role." }, { status: 500 });
  }
}