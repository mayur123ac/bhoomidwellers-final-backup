//api/users/site-head/route.ts
import { NextResponse } from "next/server";
import { query } from "@/lib/db"; 

export async function GET(req: Request) {
  try {
    // CHANGED: Using the "users" table and SELECT * to avoid column name mismatches
    const rows = await query(
      `SELECT * FROM users 
       WHERE LOWER(role) LIKE '%site%head%' 
          OR LOWER(role) = 'site_head' 
       ORDER BY name ASC`
    );

    return NextResponse.json({ 
      success: true, 
      data: rows 
    }, { status: 200 });

  } catch (error: any) {
    // This logs the EXACT error to your VS Code terminal
    console.error("🚨 DB Query Failed in Site Head API:", error.message);
    return NextResponse.json({ 
      success: false, 
      message: error.message 
    }, { status: 500 });
  }
}