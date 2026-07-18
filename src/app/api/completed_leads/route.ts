//api/completed_leads/route.ts
import { NextResponse } from "next/server";
import { Pool } from "pg"; 

const pool = new Pool({
  connectionString: process.env.DATABASE_URL, 
});

export async function GET(req: Request) {
  try {
    const result = await pool.query("SELECT * FROM completed_leads ORDER BY completed_at DESC");
    return NextResponse.json({ success: true, data: result.rows }, { status: 200 });
  } catch (error: any) {
    console.error("GET Completed Leads Error:", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    // 🔥 FIX: Accept both 'lead_id' and 'id' from the request body
    const { lead_id, id, name, email, phone, budget, propertyType, location, siteVisitDate } = body;
    const resolvedLeadId = lead_id || id || null;

    const query = `
      INSERT INTO completed_leads (id, name, email, phone, budget, property_type, location, site_visit_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *;
    `;
    
    const values = [
      resolvedLeadId,
      name || "Unknown", 
      email || "N/A", 
      phone || "N/A", 
      budget || "N/A", 
      propertyType || "N/A", 
      location || "N/A", 
      siteVisitDate || "Pending"
    ];
    
    const result = await pool.query(query, values);
    return NextResponse.json({ success: true, data: result.rows[0] }, { status: 201 });
  } catch (error: any) {
    console.error("PostgreSQL Error:", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}