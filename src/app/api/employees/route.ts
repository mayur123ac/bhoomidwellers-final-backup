// app/api/employees/route.ts
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireRole } from "@/lib/serverAuth";
import { hashPassword } from "@/lib/passwords";

// ── GET: Fetch all employees ──────────────────────────────────────────────────
export async function GET() {
  try {
    const auth = await requireRole(["admin"]);
    if (!auth.isAuthorized) {
      return NextResponse.json({ message: auth.error }, { status: auth.status });
    }

    // MT-06 (CRITICAL): `password` is NOT selected.
    //
    // This endpoint returned the stored password for EVERY user in the
    // organization — and because passwords in this database are still stored in
    // plaintext, that was the entire staff's credentials in one admin API
    // response. The employees screen rendered them behind a reveal toggle; it
    // falls back to "N/A" when the field is absent, and its edit form skips the
    // password update when the field is empty, so both degrade rather than break.
    //
    // The column list is an allow-list for exactly this reason: SELECT * here
    // would silently re-expose the column the moment anyone added one.
    // organization_id is included so the admin employee view can show which
    // organization each employee belongs to. `password` remains excluded — the
    // plaintext exception is limited to the creation response in POST below.
    const users = await query(
      `SELECT id, name, username, email, role, is_active as "isActive", created_at,
              organization_id
       FROM users
       WHERE organization_id = $1
       ORDER BY created_at DESC`,
      [await getOrganizationId()]
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
    const auth = await requireRole(["admin"]);
    if (!auth.isAuthorized) {
      return NextResponse.json({ message: auth.error }, { status: auth.status });
    }

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

    // The organization is taken from the creating Admin's session and NOTHING
    // else. It is not destructured from the request body, so a browser cannot
    // supply one: an Admin of organization A physically cannot create a user in
    // organization B through this endpoint, whatever it sends.
    const orgId = await getOrganizationId();

    // Hash the password with scrypt before storing. This replaces the plaintext
    // storage that existed here and in every row created before this change.
    // verifyPassword() in lib/passwords.ts accepts both formats, so existing
    // plaintext rows continue to work until each user next changes their password.
    const hashed = await hashPassword(password);

    const created = await query<{
      id: number;
      name: string;
      email: string;
      role: string;
      organization_id: string;
    }>(
      `INSERT INTO users (name, username, email, password, role, is_active, organization_id)
       VALUES ($1, $2, $3, $4, $5, true, $6)
       RETURNING id, name, email, role, organization_id`,
      [name, username?.trim(), email?.trim().toLowerCase(), hashed, role, orgId]
    );

    const row = created[0];

    // The password is NOT echoed back. The admin supplied it a moment ago and
    // does not need the response to confirm it. Sending it back would expose
    // the credential in browser devtools, CDN access logs, and any monitoring
    // tool that captures response bodies.
    return NextResponse.json(
      {
        message: "Employee added successfully.",
        employee: {
          id: row.id,
          _id: String(row.id),
          name: row.name,
          email: row.email,
          role: row.role,
          organization_id: row.organization_id,
        },
      },
      { status: 201 }
    );

  } catch (error: any) {
    // Logs the error only — never the request body, which holds the password.
    // `password` carries no unique constraint, so a Postgres constraint-violation
    // detail string cannot echo it either.
    console.error("POST /api/employees error:", error?.message ?? error);
    return NextResponse.json({ message: "Error adding employee." }, { status: 500 });
  }
}

// ── PUT: Update employee (full edit OR status toggle) ────────────────────────
export async function PUT(req: Request) {
  try {
    const auth = await requireRole(["admin"]);
    if (!auth.isAuthorized) {
      return NextResponse.json({ message: auth.error }, { status: auth.status });
    }

    const body = await req.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json({ message: "User ID is required." }, { status: 400 });
    }

    // ── FULL EDIT ──
    if (body.editData) {
      // `password` is intentionally not destructured here. Password changes go
      // through the OTP-gated POST /api/admin/password-change/confirm endpoint,
      // which hashes the value and revokes the target's sessions. Accepting a
      // raw password field on this general-edit path would bypass both controls.
      const { name, username, email, role } = body.editData;

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
      if (role) { setClauses.push(`role = $${p++}`); values.push(role); }

      if (setClauses.length === 0) {
        return NextResponse.json({ message: "No fields to update." }, { status: 400 });
      }

      // MT-05: userId comes from the request body, so the organization boundary is
      // part of the WHERE clause. Another organization's id matches 0 rows and the
      // handler below answers 404 — the same answer a nonexistent id gets, so this
      // cannot be used to probe which ids exist.
      values.push(userId);
      values.push(await getOrganizationId());
      const updated = await query(
        `UPDATE users SET ${setClauses.join(", ")} WHERE id = $${p} AND organization_id = $${p + 1} RETURNING *`,
        values
      );

      if (updated.length === 0) {
        return NextResponse.json({ message: "User not found." }, { status: 404 });
      }

      const u = updated[0];
      // RETURNING * includes the password column, so the row is NOT spread into
      // the response. The plaintext exception is limited to the creation response
      // in POST; an edit must not hand back the stored password of an account the
      // Admin may not have set. Explicit allow-list rather than a delete, so a
      // column added later cannot leak by default.
      return NextResponse.json(
        {
          message: "Employee updated successfully.",
          user: {
            id: u.id,
            _id: String(u.id),
            name: u.name,
            username: u.username,
            email: u.email,
            role: u.role,
            isActive: u.is_active,
            organization_id: u.organization_id,
          },
        },
        { status: 200 }
      );
    }

    // ── STATUS TOGGLE ──
    if (typeof body.isActive === "boolean") {
      const updated = await query(
        `UPDATE users SET is_active = $1 WHERE id = $2 AND organization_id = $3 RETURNING id`,
        [body.isActive, userId, await getOrganizationId()]
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
    const auth = await requireRole(["admin"]);
    if (!auth.isAuthorized) {
      return NextResponse.json({ message: auth.error }, { status: auth.status });
    }

    const { userId } = await req.json();

    if (!userId) {
      return NextResponse.json({ message: "User ID is required." }, { status: 400 });
    }

    const deleted = await query(
      // MT-05: deleting another organization's user must affect 0 rows.
      `DELETE FROM users WHERE id = $1 AND organization_id = $2 RETURNING id`,
      [userId, await getOrganizationId()]
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