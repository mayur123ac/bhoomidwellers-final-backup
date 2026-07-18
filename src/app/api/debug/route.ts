import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET() {
  try {
    // This will show EXACTLY which database Vercel is connected to
    const db = await query(`SELECT current_database() AS db, inet_server_addr() AS host`);
    const cols = await query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'walkin_enquiries' 
      ORDER BY ordinal_position
    `);
    return NextResponse.json({ 
      database: db[0],
      columns: cols.map((r: any) => r.column_name)
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message });
  }
}
// ```

// Push this to Vercel, then visit:
// ```
// https://bhoomi-dwellers-sh11-git-main-streamspheres-projects.vercel.app/api/debug
// ```

// This will tell you **exactly** which DB Vercel is hitting and which columns exist there.

// ---

// ## Step 2 — Check Vercel Environment Variables

// Go to **Vercel Dashboard → Your Project → Settings → Environment Variables**

// Make sure `DATABASE_URL` is set and check the value — does it match your Neon connection string exactly?
// ```
// ⚠️ Common mistake: You might have TWO Neon projects
//    - One called "bhoomi_crm" (where you ran the SQL)  
//    - One called "neondb" (what Vercel is actually connecting to)
// ```

// ---

// ## Step 3 — Get the RIGHT Connection String from Neon

// In Neon dashboard:
// 1. Click your project
// 2. Click **"Connect"** button top right
// 3. Select **Branch: main**
// 4. Copy the **full connection string**

// It looks like:
// ```
// postgresql://neondb_owner:AbCdEf@ep-cool-wind-123456.us-east-2.aws.neon.tech/neondb?sslmode=require