import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const tz = await query(`
      SELECT id, login_time, pg_typeof(login_time) as type,
             login_time AT TIME ZONE 'Asia/Kolkata' as converted_to_ist
      FROM attendance_records 
      ORDER BY id DESC LIMIT 1
    `);
    
    let jsDateStr = "";
    let localString = "";
    if (tz.length > 0 && tz[0].login_time) {
      const d = new Date(tz[0].login_time);
      jsDateStr = d.toISOString();
      localString = d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    }

    const projects = await query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'inventory_projects';
    `);

    return NextResponse.json({
      attendance: tz,
      jsDateStr,
      localString,
      projects_schema: projects
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
