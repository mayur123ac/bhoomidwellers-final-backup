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

    return NextResponse.json({ message: "Migration successful!" }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
