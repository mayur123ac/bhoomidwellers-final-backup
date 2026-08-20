import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireRoles } from "@/lib/serverAuth";

export async function GET() {
  try {
    // Admin only. This handler executes DDL. Every statement is CREATE TABLE IF
    // NOT EXISTS so it cannot drop anything, but an anonymous caller could still
    // run schema changes against production and hammer the database by calling
    // it in a loop. A GET that mutates schema should arguably not be an HTTP
    // route at all — scripts/ already holds the migration runners — but gating
    // it is the change that does not break whatever currently calls it.
    const gate = await requireRoles(["admin"]);
    if (!gate.ok) return gate.response;

    // 1. Employee Sessions Table
    await query(`
      CREATE TABLE IF NOT EXISTS employee_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        session_start TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        session_end TIMESTAMP WITH TIME ZONE,
        last_heartbeat TIMESTAMP WITH TIME ZONE,
        ip_address VARCHAR(255),
        device_info VARCHAR(255),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Employee Live State (Global singleton per user)
    await query(`
      CREATE TABLE IF NOT EXISTS employee_live_state (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        current_module VARCHAR(255),
        active_lead_id INTEGER,
        active_lead_name VARCHAR(255),
        current_action VARCHAR(255),
        last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 3. (removed, MT-03) `CREATE TABLE IF NOT EXISTS employee_attendance` used to
    //    live here. Attendance is `attendance_records` now, and leaving this in
    //    place would silently recreate the dropped table on the next admin call.

    // 4. Update walkin_enquiries for new Lead Lifecycle and Tracking fields
    await query(`
      ALTER TABLE walkin_enquiries
      ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS first_contact_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS site_visit_history JSONB DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS loan_tracking_info JSONB DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS referral_info JSONB DEFAULT '{}'::jsonb;
    `);

    // 5. (removed, MT-03) the matching `ALTER TABLE leads` block used to live here.
    //    `leads` is empty, superseded by `walkin_enquiries`, and slated for DROP.

    // 6. Create Audit Logs for Lead Assignments
    await query(`
      CREATE TABLE IF NOT EXISTS lead_assignment_logs (
        id SERIAL PRIMARY KEY,
        lead_id INTEGER NOT NULL,
        assigned_to VARCHAR(255),
        assigned_by VARCHAR(255),
        assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        reason TEXT
      )
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_lead_assignment_logs_lead_id
      ON lead_assignment_logs(lead_id)
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_lead_assignment_logs_assigned_at
      ON lead_assignment_logs(assigned_at DESC)
    `);

    // 7. Update existing status from Routed to Assigned
    //
    // Admin-gated backfill helper, but still organization-scoped: it must not
    // rewrite another builder's rows. The status test is PARENTHESISED first —
    // written flat, SQL binds A OR B AND org as A OR (B AND org), so the
    // 'Routed' branch would have updated every organization.
    const migrateOrgId = await getOrganizationId();
    await query(`
      UPDATE walkin_enquiries
      SET status = 'Assigned'
      WHERE (status = 'Routed' OR status = 'ROUTED')
        AND organization_id = $1
    `, [migrateOrgId]);

    await query(`
      UPDATE walkin_enquiries
      SET assigned_at = COALESCE(assigned_at, created_at, NOW())
      WHERE assigned_at IS NULL
        AND assigned_to IS NOT NULL
        AND assigned_to <> ''
        AND organization_id = $1
    `, [migrateOrgId]);

    // (removed, MT-03) the two `UPDATE leads` backfills that used to follow the
    // walkin_enquiries ones are gone with the table.

    return NextResponse.json({ message: "Migration successful!" }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
