// app/api/employees/route.ts
import { NextResponse } from "next/server";
import { query } from "@/lib/db";

// ── GET: Fetch all employees ──────────────────────────────────────────────────
export async function GET() {
  try {
    const users = await query(
      `SELECT id, name, username, email, password, role, is_active as "isActive", created_at
       FROM users
       ORDER BY created_at DESC`
    );

    // Map id → _id so the frontend (employees page) keeps working without any changes
    const mapped = users.map(u => ({ ...u, _id: String(u.id) }));
    return NextResponse.json(mapped, { status: 200 });

  } catch (error: any) {
    console.error("GET /api/employees error:", error);
    return NextResponse.json({ message: "Error fetching employees." }, { status: 500 });
  }
}

// ── POST: Add new employee ────────────────────────────────────────────────────
export async function POST(req: Request) {
  try {
    const { name, username, email, password, role } = await req.json();

    // Check email conflict
    const emailCheck = await query(
      `SELECT id FROM users WHERE email = $1 LIMIT 1`,
      [email?.trim().toLowerCase()]
    );
    if (emailCheck.length > 0) {
      return NextResponse.json({ message: "Email already exists." }, { status: 400 });
    }

    // Check username conflict
    const usernameCheck = await query(
      `SELECT id FROM users WHERE username = $1 LIMIT 1`,
      [username?.trim()]
    );
    if (usernameCheck.length > 0) {
      return NextResponse.json({ message: "Username already taken." }, { status: 400 });
    }

    await query(
      `INSERT INTO users (name, username, email, password, role, is_active)
       VALUES ($1, $2, $3, $4, $5, true)`,
      [name, username?.trim(), email?.trim().toLowerCase(), password, role]
    );

    return NextResponse.json({ message: "Employee added successfully." }, { status: 201 });

  } catch (error: any) {
    console.error("POST /api/employees error:", error);
    return NextResponse.json({ message: "Error adding employee." }, { status: 500 });
  }
}

// ── PUT: Update employee (full edit OR status toggle) ────────────────────────
export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json({ message: "User ID is required." }, { status: 400 });
    }

    // ── FULL EDIT ──
    if (body.editData) {
      const { name, username, email, password, role } = body.editData;

      // Username conflict check (exclude self)
      if (username) {
        const conflict = await query(
          `SELECT id FROM users WHERE username = $1 AND id != $2 LIMIT 1`,
          [username.trim(), userId]
        );
        if (conflict.length > 0) {
          return NextResponse.json({ message: "Username already taken by another user." }, { status: 400 });
        }
      }

      // Email conflict check (exclude self)
      if (email) {
        const conflict = await query(
          `SELECT id FROM users WHERE email = $1 AND id != $2 LIMIT 1`,
          [email.trim().toLowerCase(), userId]
        );
        if (conflict.length > 0) {
          return NextResponse.json({ message: "Email already in use by another user." }, { status: 400 });
        }
      }

      const setClauses: string[] = [];
      const values: any[] = [];
      let p = 1;

      if (name) { setClauses.push(`name = $${p++}`); values.push(name); }
      if (username) { setClauses.push(`username = $${p++}`); values.push(username.trim()); }
      if (email) { setClauses.push(`email = $${p++}`); values.push(email.trim().toLowerCase()); }
      if (password) { setClauses.push(`password = $${p++}`); values.push(password); }
      if (role) { setClauses.push(`role = $${p++}`); values.push(role); }

      if (setClauses.length === 0) {
        return NextResponse.json({ message: "No fields to update." }, { status: 400 });
      }

      values.push(userId);
      const updated = await query(
        `UPDATE users SET ${setClauses.join(", ")} WHERE id = $${p} RETURNING *`,
        values
      );

      if (updated.length === 0) {
        return NextResponse.json({ message: "User not found." }, { status: 404 });
      }

      const u = updated[0];
      return NextResponse.json(
        { message: "Employee updated successfully.", user: { ...u, _id: String(u.id) } },
        { status: 200 }
      );
    }

    // ── STATUS TOGGLE ──
    if (typeof body.isActive === "boolean") {
      const updated = await query(
        `UPDATE users SET is_active = $1 WHERE id = $2 RETURNING id`,
        [body.isActive, userId]
      );
      if (updated.length === 0) {
        return NextResponse.json({ message: "User not found." }, { status: 404 });
      }
      return NextResponse.json({ message: "Employee status updated successfully." }, { status: 200 });
    }

    return NextResponse.json({ message: "No valid update data provided." }, { status: 400 });

  } catch (error: any) {
    console.error("PUT /api/employees error:", error);
    return NextResponse.json({ message: "Error updating employee." }, { status: 500 });
  }
}

// ── DELETE: Permanently remove an employee ────────────────────────────────────
export async function DELETE(req: Request) {
  try {
    const { userId } = await req.json();

    if (!userId) {
      return NextResponse.json({ message: "User ID is required." }, { status: 400 });
    }

    const deleted = await query(
      `DELETE FROM users WHERE id = $1 RETURNING id`,
      [userId]
    );

    if (deleted.length === 0) {
      return NextResponse.json({ message: "User not found." }, { status: 404 });
    }

    return NextResponse.json({ message: "User deleted successfully." }, { status: 200 });

  } catch (error: any) {
    console.error("DELETE /api/employees error:", error);
    return NextResponse.json({ message: "Error deleting employee." }, { status: 500 });
  }
}