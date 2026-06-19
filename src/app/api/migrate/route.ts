import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET() {
  try {
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

    // 3. Employee Attendance (Daily records)
    await query(`
      CREATE TABLE IF NOT EXISTS employee_attendance (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        first_login TIMESTAMP WITH TIME ZONE,
        last_logout TIMESTAMP WITH TIME ZONE,
        total_active_minutes INTEGER DEFAULT 0,
        status VARCHAR(50) DEFAULT 'Present',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, date)
      )
    `);

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

    // 5. Update leads for new Lead Lifecycle and Tracking fields
    await query(`
      ALTER TABLE leads
      ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS first_contact_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS site_visit_history JSONB DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS loan_tracking_info JSONB DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS referral_info JSONB DEFAULT '{}'::jsonb;
    `);

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

    // 7. Update existing status from Routed to Assigned
    await query(`
      UPDATE walkin_enquiries
      SET status = 'Assigned'
      WHERE status = 'Routed' OR status = 'ROUTED'
    `);

    await query(`
      UPDATE leads
      SET status = 'Assigned'
      WHERE status = 'Routed' OR status = 'ROUTED'
    `);

    return NextResponse.json({ message: "Migration successful!" }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
