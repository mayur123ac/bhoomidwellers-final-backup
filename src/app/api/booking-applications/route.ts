// app/api/booking-applications/route.ts
import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { uploadBufferToR2 } from "@/lib/r2";

export const dynamic = "force-dynamic";

// ─── Auto-create table ────────────────────────────────────────────────────────
async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS booking_applications (
      id                        SERIAL PRIMARY KEY,
      booking_number            VARCHAR(30) UNIQUE,
      lead_id                   INTEGER NOT NULL,

      -- Primary Applicant
      primary_name              TEXT,
      primary_email             TEXT,
      primary_mobile            TEXT,
      primary_pan               TEXT,
      primary_aadhaar           TEXT,
      primary_aadhaar_front_url TEXT,
      primary_aadhaar_back_url  TEXT,
      primary_pan_url           TEXT,
      primary_occupation        TEXT,
      primary_nationality       TEXT DEFAULT 'Indian',

      -- Joint Applicant (Legacy fields kept for backward compatibility)
      joint_name                TEXT,
      joint_email               TEXT,
      joint_mobile              TEXT,
      joint_pan                 TEXT,
      joint_occupation          TEXT,
      joint_nationality         TEXT,

      -- Dynamic Joint Applicants array
      joint_applicants          JSONB DEFAULT '[]',

      -- Residence
      address                   TEXT,
      pin                       TEXT,
      state                     TEXT,
      country                   TEXT DEFAULT 'India',

      -- Unit
      property_type             TEXT,
      floor_number              TEXT,
      flat_number               TEXT,
      carpet_area               TEXT,
      consideration_value       TEXT,
      consideration_value_words TEXT,
      parking_details           TEXT,

      -- Payments (JSON array)
      payment_details           JSONB DEFAULT '[]',

      -- Witness
      witness_name              TEXT,
      witness_aadhaar           TEXT,

      -- Booking Source
      booking_source            TEXT DEFAULT 'Direct',
      direct_source             TEXT,
      channel_partner_name      TEXT,
      channel_partner_contact   TEXT,

      -- Unit Summary
      unit_cost                 TEXT,
      sdr                       TEXT,
      gst                       TEXT,

      -- Declaration
      declaration_accepted      BOOLEAN DEFAULT false,
      terms_accepted            BOOLEAN DEFAULT false,
      consent_accepted          BOOLEAN DEFAULT false,

      -- Signature (base64 or URL)
      signature_data            TEXT,

      -- Meta
      application_date          DATE DEFAULT CURRENT_DATE,
      booking_status            TEXT DEFAULT 'Pending',
      created_by                TEXT,
      created_role              TEXT,
      created_at                TIMESTAMPTZ DEFAULT NOW(),
      updated_at                TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

// ─── GET — fetch bookings ─────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    await ensureTable();
    const { searchParams } = new URL(req.url);
    const leadId = searchParams.get("lead_id");
    const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);
    const offset = Number(searchParams.get("offset") ?? 0);

    let sql = `
      SELECT b.*, w.name AS lead_name, w.phone AS lead_phone, w.email AS lead_email,
             w.address AS lead_address, w.budget AS lead_budget,
             w.configuration AS lead_configuration, w.purpose AS lead_purpose,
             w.source AS lead_source, w.assigned_to AS lead_assigned_to,
             w.assigned_receptionist AS lead_receptionist,
             w.overseeing_site_head AS lead_site_head,
             w.created_at AS lead_created_at, w.enquiry_date AS lead_enquiry_date,
             w.alt_phone AS lead_alt_phone, w.sr_no AS lead_sr_no
      FROM booking_applications b
      LEFT JOIN walkin_enquiries w ON w.id = b.lead_id
    `;
    const params: any[] = [];
    if (leadId) {
      sql += ` WHERE b.lead_id = $1`;
      params.push(Number(leadId));
    }
    sql += ` ORDER BY b.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const rows = await query(sql, params);
    return NextResponse.json({ success: true, data: rows }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/booking-applications]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// ─── POST — create booking ────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    await ensureTable();
    const formData = await req.formData();
    const getStr = (key: string) => (formData.get(key) as string) || null;
    const getFile = (key: string) => (formData.get(key) as File) || null;

    const lead_id = getStr("lead_id");
    if (!lead_id) return NextResponse.json({ success: false, message: "lead_id is required" }, { status: 400 });

    const primary_name = getStr("primary_name");
    const primary_email = getStr("primary_email");
    const primary_mobile = getStr("primary_mobile");
    const primary_pan = getStr("primary_pan");
    const primary_aadhaar = getStr("primary_aadhaar");
    const primary_occupation = getStr("primary_occupation");
    const primary_nationality = getStr("primary_nationality");

    const address = getStr("address");
    const pin = getStr("pin");
    const state = getStr("state");
    const country = getStr("country");

    const property_type = getStr("property_type");
    const floor_number = getStr("floor_number");
    const flat_number = getStr("flat_number");
    const carpet_area = getStr("carpet_area");
    const consideration_value = getStr("consideration_value");
    const consideration_value_words = getStr("consideration_value_words");
    const parking_details = getStr("parking_details");

    const witness_name = getStr("witness_name");
    const witness_aadhaar = getStr("witness_aadhaar");

    const booking_source = getStr("booking_source");
    const direct_source = getStr("direct_source");
    const channel_partner_name = getStr("channel_partner_name");
    const channel_partner_contact = getStr("channel_partner_contact");

    const unit_cost = getStr("unit_cost");
    const sdr = getStr("sdr");
    const gst = getStr("gst");

    const declaration_accepted = getStr("declaration_accepted") === "true";
    const terms_accepted = getStr("terms_accepted") === "true";
    const consent_accepted = getStr("consent_accepted") === "true";

    const application_date = getStr("application_date") || new Date().toISOString().split("T")[0];
    const created_by = getStr("created_by");
    const created_role = getStr("created_role");
    
    // Parse JSON arrays
    let joint_applicants: any[] = [];
    try { joint_applicants = JSON.parse(getStr("joint_applicants") || "[]"); } catch {}
    
    let payment_details: any[] = [];
    try { payment_details = JSON.parse(getStr("payment_details") || "[]"); } catch {}

    // We will do everything inside a transaction
    const result = await transaction(async (client) => {
      // 1. Insert DB record to get ID
      const insertRes = await client.query(
        `INSERT INTO booking_applications (
          lead_id, primary_name, primary_email, primary_mobile, primary_pan, primary_aadhaar,
          primary_occupation, primary_nationality,
          joint_applicants,
          address, pin, state, country,
          property_type, floor_number, flat_number, carpet_area,
          consideration_value, consideration_value_words, parking_details,
          payment_details, witness_name, witness_aadhaar,
          booking_source, direct_source, channel_partner_name, channel_partner_contact,
          unit_cost, sdr, gst, declaration_accepted, terms_accepted, consent_accepted,
          application_date, created_by, created_role, booking_status
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,'Pending'
        ) RETURNING id`,
        [
          lead_id, primary_name, primary_email, primary_mobile, primary_pan, primary_aadhaar,
          primary_occupation, primary_nationality || "Indian",
          JSON.stringify(joint_applicants),
          address, pin, state, country || "India",
          property_type, floor_number, flat_number, carpet_area,
          consideration_value, consideration_value_words, parking_details,
          JSON.stringify(payment_details), witness_name, witness_aadhaar,
          booking_source || "Direct", direct_source, channel_partner_name, channel_partner_contact,
          unit_cost, sdr, gst, declaration_accepted, terms_accepted, consent_accepted,
          application_date, created_by, created_role
        ]
      );
      const newId = insertRes.rows[0].id;
      
      const dateParts = application_date.split("-");
      const bookingNumber = `BK-${dateParts[0]}-${dateParts[1]}-${dateParts[2]}-${String(newId).padStart(5, "0")}`;

      await client.query(`UPDATE booking_applications SET booking_number = $1 WHERE id = $2`, [bookingNumber, newId]);

      // 2. Upload Files to R2

      const fileToBuffer = async (file: any) => {
        if (!file || typeof file === 'string' || !file.arrayBuffer) return Buffer.from([]);
        return Buffer.from(await file.arrayBuffer());
      };
      const toBase64 = async (file: any) => {
        if (!file || typeof file === 'string' || !file.type) return null;
        const buf = await fileToBuffer(file);
        if (buf.length === 0) return null;
        return "data:" + file.type + ";base64," + buf.toString("base64");
      };

      const imagesForPdf: Record<string, string | null> = {};
      const updatesForDb: Record<string, string | null> = {};

      const uploadDoc = async (file: any, docType: string, appType: string, pathSegment: string) => {
        if (!file || typeof file === 'string' || !file.name) return null;
        let ext = ".jpg";
        if (file.name.lastIndexOf(".") !== -1) {
          ext = file.name.substring(file.name.lastIndexOf("."));
        } else if (file.type === "application/pdf") ext = ".pdf";
        
        const key = `bookings/${bookingNumber}/${pathSegment}/${docType}${ext}`;
        await uploadBufferToR2(key, await fileToBuffer(file), file.type);
        
        await client.query(`
          INSERT INTO booking_documents (booking_id, lead_id, booking_number, document_type, applicant_type, file_name, object_key, mime_type, file_size, uploaded_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [newId, lead_id, bookingNumber, docType, appType, file.name, key, file.type, file.size, created_by]);
        
        return key;
      };

      // Primary
      const pPanFile = getFile("primary_pan_file");
      if (pPanFile) {
        updatesForDb.primary_pan_url = await uploadDoc(pPanFile, "PAN_CARD", "PRIMARY", "primary");
        imagesForPdf.primary_pan = await toBase64(pPanFile);
      }
      const pAadhaarFront = getFile("primary_aadhaar_front_file");
      if (pAadhaarFront) {
        updatesForDb.primary_aadhaar_front_url = await uploadDoc(pAadhaarFront, "AADHAAR_FRONT", "PRIMARY", "primary");
        imagesForPdf.primary_aadhaar_front = await toBase64(pAadhaarFront);
      }
      const pAadhaarBack = getFile("primary_aadhaar_back_file");
      if (pAadhaarBack) {
        updatesForDb.primary_aadhaar_back_url = await uploadDoc(pAadhaarBack, "AADHAAR_BACK", "PRIMARY", "primary");
      }

      // Joint
      for (let i = 0; i < joint_applicants.length; i++) {
        const jPan = getFile(`joint_${i}_pan_file`);
        if (jPan) {
          joint_applicants[i].pan_url = await uploadDoc(jPan, "PAN_CARD", `JOINT_${i+1}`, `joint_${i+1}`);
          imagesForPdf[`joint_${i}_pan`] = await toBase64(jPan);
        }
        const jAFront = getFile(`joint_${i}_aadhaar_front_file`);
        if (jAFront) {
          joint_applicants[i].aadhaar_front_url = await uploadDoc(jAFront, "AADHAAR_FRONT", `JOINT_${i+1}`, `joint_${i+1}`);
          imagesForPdf[`joint_${i}_aadhaar_front`] = await toBase64(jAFront);
        }
        const jABack = getFile(`joint_${i}_aadhaar_back_file`);
        if (jABack) {
          joint_applicants[i].aadhaar_back_url = await uploadDoc(jABack, "AADHAAR_BACK", `JOINT_${i+1}`, `joint_${i+1}`);
        }
      }

      // Signature
      const sigData = getStr("signature_data");
      if (sigData && sigData.startsWith("data:image")) {
        const base64Data = sigData.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64Data, "base64");
        const key = `bookings/${bookingNumber}/primary/signature.png`;
        await uploadBufferToR2(key, buffer, "image/png");
        updatesForDb.signature_data = key; 
        
        await client.query(`INSERT INTO booking_documents (booking_id, lead_id, booking_number, document_type, applicant_type, file_name, object_key, mime_type, file_size, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [newId, lead_id, bookingNumber, "SIGNATURE", "PRIMARY", "signature.png", key, "image/png", buffer.length, created_by]);
      }

      // Re-update the booking applications record with the URLs
      await client.query(`
        UPDATE booking_applications SET
          primary_pan_url = $1, primary_aadhaar_front_url = $2, primary_aadhaar_back_url = $3,
          joint_applicants = $4, signature_data = $5
        WHERE id = $6
      `, [updatesForDb.primary_pan_url || null, updatesForDb.primary_aadhaar_front_url || null, updatesForDb.primary_aadhaar_back_url || null, JSON.stringify(joint_applicants), updatesForDb.signature_data || null, newId]);

      // Return the saved booking row — PDF generation is intentionally decoupled and done on-demand
      const fetchBooking = await client.query(`SELECT * FROM booking_applications WHERE id = $1`, [newId]);
      return fetchBooking.rows[0];
    });

    // Mark booking as Confirmed and Lead as Closed now that the full transaction succeeded
    await query(`UPDATE booking_applications SET booking_status = 'Confirmed' WHERE id = $1`, [result.id]);
    await query(`UPDATE walkin_enquiries SET status = 'Closed' WHERE id = $1`, [lead_id]);

    return NextResponse.json({ success: true, data: { ...result, booking_status: 'Confirmed' } }, { status: 201 });
  } catch (err: any) {
    console.error("[POST /api/booking-applications]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
