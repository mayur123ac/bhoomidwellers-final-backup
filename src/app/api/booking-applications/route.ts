// app/api/booking-applications/route.ts
import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { uploadBufferToR2 } from "@/lib/r2";
import { syncBookingUnit } from "@/lib/inventorySync";
import { computeCPCommission } from "@/lib/cpCommissionEngine";
import { requireSession, requireRoles } from "@/lib/serverAuth";
import { resolveGstRate, calcGstAmount } from "@/lib/gst";
import { resolveStampDutyRate, resolveRegistrationFeeRate, calcStampDuty } from "@/lib/charges";
// Single definition of the fully-joined booking shape, shared by GET, POST and
// the PUT in [id]/route.ts — see lib/bookingQuery.ts for why.
import { BOOKING_SELECT_SQL, BOOKING_LIST_SQL, fetchBookingById } from "@/lib/bookingQuery";

export const dynamic = "force-dynamic";

// ─── Schema ──────────────────────────────────────────────────────────────────
// ensureTable() used to live here and ran at the top of GET and POST: 9 CREATE
// TABLE IF NOT EXISTS, 5 ALTER TABLE ... ADD COLUMN IF NOT EXISTS and 1 CREATE
// OR REPLACE VIEW, sequentially, on every single booking request.
//
// All 15 were no-ops after the first deploy, and all 15 cost a full round trip
// to Neon ap-southeast-1. Measured: 82 ms per round trip, 1,320 ms for the
// sequence, against 0.4 ms of actual SQL execution for the booking query itself.
// That was the 3-4 second booking load — not the joins, not the views.
//
// The ALTER TABLEs also took an ACCESS EXCLUSIVE lock on booking_applications
// and the CREATE OR REPLACE VIEW one on customer_ledger_view, so concurrent
// booking reads serialised behind schema changes that changed nothing.
//
// The DDL now lives in scripts/migrations/2026-08-23_booking_schema_baseline.sql.
// Every object it creates was verified present in production before this was
// deleted, so removal cannot break a running deployment; the migration is
// idempotent and exists so the schema has a home outside the request path.

/* ── Document staging ────────────────────────────────────────────────────────
   A document's bytes and metadata, read out of the multipart body BEFORE any
   transaction opens and uploaded to R2 only AFTER it commits.

   `column` names the booking_applications column that should hold the object
   key once the upload succeeds; `jointIndex` does the same for an entry in the
   joint_applicants JSON array. Both are null for documents that only ever live
   in booking_documents. */
interface StagedDoc {
  docType: string;
  applicantType: string;
  pathSegment: string;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
  column?: "primary_pan_url" | "primary_aadhaar_front_url" | "primary_aadhaar_back_url" | "signature_data";
  jointIndex?: number;
  jointField?: "pan_url" | "aadhaar_front_url" | "aadhaar_back_url";
}

async function stageBookingDocuments(
  getStr: (k: string) => string | null,
  getFile: (k: string) => File | null,
  jointApplicants: any[],
): Promise<StagedDoc[]> {
  const staged: StagedDoc[] = [];

  const add = async (
    file: File | null,
    docType: string,
    applicantType: string,
    pathSegment: string,
    extra: Partial<StagedDoc>,
  ) => {
    if (!file || typeof file === "string" || !file.name || !file.arrayBuffer) return;
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length === 0) return;
    let ext = ".jpg";
    if (file.name.lastIndexOf(".") !== -1) ext = file.name.substring(file.name.lastIndexOf("."));
    else if (file.type === "application/pdf") ext = ".pdf";
    staged.push({
      docType, applicantType, pathSegment: `${pathSegment}/${docType}${ext}`,
      fileName: file.name, mimeType: file.type, bytes, ...extra,
    });
  };

  await add(getFile("primary_pan_file"), "PAN_CARD", "PRIMARY", "primary", { column: "primary_pan_url" });
  await add(getFile("primary_aadhaar_front_file"), "AADHAAR_FRONT", "PRIMARY", "primary", { column: "primary_aadhaar_front_url" });
  await add(getFile("primary_aadhaar_back_file"), "AADHAAR_BACK", "PRIMARY", "primary", { column: "primary_aadhaar_back_url" });

  for (let i = 0; i < jointApplicants.length; i++) {
    await add(getFile(`joint_${i}_pan_file`), "PAN_CARD", `JOINT_${i + 1}`, `joint_${i + 1}`, { jointIndex: i, jointField: "pan_url" });
    await add(getFile(`joint_${i}_aadhaar_front_file`), "AADHAAR_FRONT", `JOINT_${i + 1}`, `joint_${i + 1}`, { jointIndex: i, jointField: "aadhaar_front_url" });
    await add(getFile(`joint_${i}_aadhaar_back_file`), "AADHAAR_BACK", `JOINT_${i + 1}`, `joint_${i + 1}`, { jointIndex: i, jointField: "aadhaar_back_url" });
  }

  // The signature arrives as a data: URL in a text field, not as a File.
  const sigData = getStr("signature_data");
  if (sigData && sigData.startsWith("data:image")) {
    const bytes = Buffer.from(sigData.replace(/^data:image\/\w+;base64,/, ""), "base64");
    if (bytes.length > 0) {
      staged.push({
        docType: "SIGNATURE", applicantType: "PRIMARY", pathSegment: "primary/signature.png",
        fileName: "signature.png", mimeType: "image/png", bytes, column: "signature_data",
      });
    }
  }

  return staged;
}

/**
 * Upload staged documents and record them — strictly after the booking commits.
 *
 * ── Ordering, and why this one ──────────────────────────────────────────────
 * For each document: upload to R2 first, and only insert the booking_documents
 * row if that upload returned successfully. So the database can never claim a
 * document exists when its bytes are not in storage, which is the failure the
 * old in-transaction version was protecting against by rolling everything back.
 *
 * The cost of moving out of the transaction is the mirror case: an upload that
 * succeeds while the process dies before the INSERT leaves an object in R2 with
 * no row pointing at it. That is a few orphaned kilobytes, invisible to the app
 * and reclaimable by a bucket sweep — against holding a database transaction
 * open across an arbitrary number of cross-datacentre uploads.
 *
 * A failed upload does NOT fail the booking. The booking is already committed
 * and is the valuable record; the failures are returned so the caller can tell
 * the user which documents need re-attaching from the edit screen.
 */
async function commitBookingDocuments(opts: {
  staged: StagedDoc[];
  bookingId: number;
  bookingNumber: string;
  leadId: string | number;
  uploadedBy: string | null;
  organizationId: string;
  jointApplicants: any[];
}): Promise<{ failed: { docType: string; applicantType: string; reason: string }[] }> {
  const { staged, bookingId, bookingNumber, leadId, uploadedBy, organizationId, jointApplicants } = opts;
  const failed: { docType: string; applicantType: string; reason: string }[] = [];
  const columnUpdates: Record<string, string> = {};
  let jointTouched = false;

  for (const doc of staged) {
    const key = `bookings/${bookingNumber}/${doc.pathSegment}`;
    try {
      const _docT0 = Date.now();
      await uploadBufferToR2(key, doc.bytes, doc.mimeType);
      console.log(`[BOOKING R2] file=${doc.fileName} size=${doc.bytes.length} type=${doc.docType} duration=${Date.now() - _docT0}ms`);
    } catch (e: any) {
      failed.push({ docType: doc.docType, applicantType: doc.applicantType, reason: e?.message || "upload failed" });
      continue; // No row is written for a document that is not in storage.
    }

    try {
      await query(
        `INSERT INTO booking_documents (booking_id, lead_id, booking_number, document_type, applicant_type, file_name, object_key, mime_type, file_size, uploaded_by, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [bookingId, leadId, bookingNumber, doc.docType, doc.applicantType, doc.fileName, key, doc.mimeType, doc.bytes.length, uploadedBy, organizationId],
      );
    } catch (e: any) {
      failed.push({ docType: doc.docType, applicantType: doc.applicantType, reason: e?.message || "record failed" });
      continue;
    }

    if (doc.column) columnUpdates[doc.column] = key;
    if (doc.jointIndex !== undefined && doc.jointField && jointApplicants[doc.jointIndex]) {
      jointApplicants[doc.jointIndex][doc.jointField] = key;
      jointTouched = true;
    }
  }

  // One UPDATE for all the URL columns, rather than one per document.
  const sets: string[] = [];
  const params: any[] = [];
  for (const [col, key] of Object.entries(columnUpdates)) {
    params.push(key);
    sets.push(`${col} = $${params.length}`);
  }
  if (jointTouched) {
    params.push(JSON.stringify(jointApplicants));
    sets.push(`joint_applicants = $${params.length}`);
  }
  if (sets.length > 0) {
    params.push(bookingId, organizationId);
    await query(
      `UPDATE booking_applications SET ${sets.join(", ")}
        WHERE id = $${params.length - 1} AND organization_id = $${params.length}`,
      params,
    );
  }

  return { failed };
}

// ─── GET — fetch bookings ─────────────────────────────────────────────────────
//
// Two read models, chosen by `?view=`:
//
//   view=summary  BOOKING_LIST_SQL   — explicit columns, one join, no views, no
//                                      JSON aggregation. For "does this lead have
//                                      a booking" and any future booking table.
//   view=full     BOOKING_SELECT_SQL — the complete aggregate (default).
//
// `full` stays the DEFAULT deliberately. Every existing caller of this endpoint
// uses `?lead_id=` and feeds the result straight into a booking detail view; the
// two that only need existence and status now ask for `summary` explicitly.
// Flipping the default would have silently emptied every joined field in those
// views — the exact failure lib/bookingQuery.ts was written to prevent.
export async function GET(req: NextRequest) {
  try {
    // The full view returns primary_pan, primary_aadhaar and document URLs.
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const { searchParams } = new URL(req.url);
    const leadId = searchParams.get("lead_id");
    const summaryOnly = searchParams.get("view") === "summary";
    const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);
    const offset = Number(searchParams.get("offset") ?? 0);

    // The full SELECT is also used by POST and by the PUT in [id]/route.ts, so a
    // saved booking comes back in the same shape a fetched one does.
    // The tenant filter is always present, before LIMIT/OFFSET below, so a page
    // of this list can never contain another organization's bookings.
    let sql = summaryOnly ? BOOKING_LIST_SQL : BOOKING_SELECT_SQL;
    const params: any[] = [];
    params.push(await getOrganizationId());
    sql += ` WHERE b.organization_id = $${params.length}`;
    if (leadId) {
      params.push(Number(leadId));
      sql += ` AND b.lead_id = $${params.length}`;
    }
    // id DESC as tiebreaker: two bookings written in the same transaction share a
    // created_at, and the booking form picks data[0] as "the" booking — an
    // unstable order there would open a different record on each refresh.
    // Server-side pagination is retained in both modes.
    sql += ` ORDER BY b.created_at DESC, b.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
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
    // Writes primary_pan / primary_aadhaar.
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const formData = await req.formData();
    const getStr = (key: string) => (formData.get(key) as string) || null;
    const getFile = (key: string) => (formData.get(key) as File) || null;

    const lead_id = getStr("lead_id");
    if (!lead_id) return NextResponse.json({ success: false, message: "lead_id is required" }, { status: 400 });

    // Resolved once for the whole handler. Every tenant predicate below binds
    // this value, and at 82 ms per round trip to Neon a re-resolve is not free.
    const orgId = await getOrganizationId();

    // ── Two guards, one round trip ───────────────────────────────────────────
    //
    // (a) THE LEAD MUST BELONG TO THE CALLER'S ORGANIZATION.
    //     lead_id arrives in the request body and lead ids are global integers,
    //     so without this a signed-in user of one builder could create a booking
    //     against another builder's lead by sending its id. The booking row lands
    //     in the creator's organization but points at a lead they cannot see — a
    //     dangling cross-tenant reference that every join in BOOKING_SELECT_SQL
    //     then silently drops (they all carry
    //     `w.organization_id = b.organization_id`), so it renders as a booking
    //     with no customer and is invisible from both sides.
    //
    //     Found by the post-refactor write smoke test, which sent one tenant's
    //     lead id as another tenant's admin and got a booking created.
    //     Pre-existing: the only thing that ever stood in the way was (b), and
    //     that only fires when the foreign lead already has a booking.
    //
    // (b) ONE LIVE BOOKING PER LEAD.
    //     A lead can only be sold one flat at a time, so a second booking is
    //     always a mistake — and it was a mistake this endpoint used to accept
    //     silently. The booking form is opened from six places; one of them
    //     ("Mark Closing") passes create-mode flags unconditionally, so a
    //     REOPENED closed lead came back through here and inserted a duplicate.
    //     Production already carries the damage: lead 134 has bookings 15 and 17,
    //     both Confirmed. The form now resolves edit mode itself, but that is a UI
    //     convenience; this is the actual guarantee, because it holds for any
    //     caller. Cancelled bookings are excluded — a lead whose booking was
    //     cancelled may legitimately book again.
    //
    //     This check also had NO organization predicate, so a lead id that existed
    //     in another organization matched THAT organization's booking and returned
    //     its booking_number and status in the 409 message.
    //
    // Both answers come from one query. The lead lookup drives it, so a lead
    // outside this organization returns no row at all and the LATERAL never runs.
    const guard = await query<{ booking_id: number | null; booking_number: string | null; booking_status: string | null }>(
      `SELECT live.id AS booking_id, live.booking_number, live.booking_status
         FROM walkin_enquiries w
         LEFT JOIN LATERAL (
           SELECT b.id, b.booking_number, b.booking_status
             FROM booking_applications b
            WHERE b.lead_id = w.id
              AND b.organization_id = w.organization_id
              AND LOWER(COALESCE(b.booking_status, '')) <> 'cancelled'
            -- Same order as GET, so the 409 names the booking the form will
            -- actually open. Naming a different one would send the operator hunting.
            ORDER BY b.created_at DESC, b.id DESC
            LIMIT 1
         ) live ON TRUE
        WHERE w.id = $1 AND w.organization_id = $2
        LIMIT 1`,
      [Number(lead_id), orgId],
    );

    if (guard.length === 0) {
      // 404, not 403: confirming the lead exists elsewhere would let a caller map
      // the platform's lead table by walking ids.
      return NextResponse.json(
        { success: false, code: "LEAD_NOT_FOUND", message: "Lead not found." },
        { status: 404 },
      );
    }
    if (guard[0].booking_id != null) {
      const b = guard[0];
      return NextResponse.json(
        {
          success: false,
          code: "BOOKING_EXISTS",
          bookingId: b.booking_id,
          message: `This lead already has booking ${b.booking_number || `#${b.booking_id}`} (${b.booking_status}). Edit that booking instead of creating a new one.`,
        },
        { status: 409 },
      );
    }

    // Strip commas/₹ before inserting into NUMERIC columns (form sends "50,00,000" style strings)
    const cleanNum = (val: string | null): number => {
      if (!val) return 0;
      const n = parseFloat(val.replace(/[₹,\s]/g, ""));
      return isNaN(n) ? 0 : n;
    };

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

    const apartment_name = getStr("apartment_name");
    const project_name = getStr("project_name");
    const tower = getStr("tower");
    const wing = getStr("wing");
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

    // New Fields
    const booking_date = getStr("booking_date");
    const agreement_value = getStr("agreement_value");
    const booking_amount = getStr("booking_amount");
    const booking_remarks = getStr("booking_remarks");
    const internal_notes = getStr("internal_notes");

    // Revenue recognition flags (which items management counts as revenue)
    const revenue_include_ocr = getStr("revenue_include_ocr") === "true";
    const revenue_include_sdr = getStr("revenue_include_sdr") === "true";
    const revenue_include_cash = getStr("revenue_include_cash") === "true";
    const revenue_include_sanction = getStr("revenue_include_sanction") === "true";
    const revenue_include_disbursement = getStr("revenue_include_disbursement") === "true";

    const token_amount = getStr("token_amount");
    const ocr_amount = getStr("ocr_amount");
    const ocr_received_date = getStr("ocr_received_date");
    const ocr_payment_mode = getStr("ocr_payment_mode");
    const ocr_remarks = getStr("ocr_remarks");
    // DEPRECATED (Phase 6): sdr_amount / sdr_payment_date / sdr_status are no longer read
    // for new bookings — replaced by the stamp_duty_* / registration_fee_* split. Only
    // sdr_remarks is still persisted (not part of the deprecation set).
    const sdr_remarks = getStr("sdr_remarks");
    const cash_component = getStr("cash_component");
    const cash_component_date = getStr("cash_component_date");
    const cash_component_remarks = getStr("cash_component_remarks");

    const expected_registration_date = getStr("expected_registration_date");
    const actual_registration_date = getStr("actual_registration_date");
    const registration_status = getStr("registration_status");
    const registration_number = getStr("registration_number");
    const registration_remarks = getStr("registration_remarks");

    const loan_required = getStr("loan_required") === "true";
    const bank_name = getStr("bank_name");
    const loan_executive = getStr("loan_executive");
    const loan_type = getStr("loan_type");
    const loan_reference_no = getStr("loan_reference_no");
    const loan_amount = getStr("loan_amount");
    const sanction_amount = getStr("sanction_amount");
    const sanction_date = getStr("sanction_date");
    const sanction_status = getStr("sanction_status");
    const loan_status = getStr("loan_status");
    const expected_disbursement_date = getStr("expected_disbursement_date");
    const actual_disbursement_date = getStr("actual_disbursement_date");
    const expected_disbursement_amount = getStr("expected_disbursement_amount");
    const disbursement_amount = getStr("disbursement_amount");
    const disbursement_status = getStr("disbursement_status");

    // EMI details
    const interest_rate = getStr("interest_rate");
    const loan_tenure_months = getStr("loan_tenure_months");
    const emi_start_date = getStr("emi_start_date");
    const payment_type = getStr("payment_type");
    const pre_emi_amount = getStr("pre_emi_amount");
    const emi_amount = getStr("emi_amount");

    // Possession tracking (optional — defaults apply if the client doesn't send these yet)
    const expected_possession_date = getStr("expected_possession_date");
    const actual_possession_date = getStr("actual_possession_date");
    const possession_status = getStr("possession_status");
    const oc_cc_status = getStr("oc_cc_status");
    const oc_cc_date = getStr("oc_cc_date");
    const possession_charges = getStr("possession_charges");
    const maintenance_deposit = getStr("maintenance_deposit");
    const legal_charges = getStr("legal_charges");

    // GST — rate is client-overridable, amount is always server-computed from agreement_value
    const gst_rate_input = getStr("gst_rate");

    // Stamp Duty & Registration Fee — like GST, the rate is client-overridable and
    // the amount derives from it. Both fall back to the Maharashtra defaults only
    // when no rate was sent at all.
    const stamp_duty_rate_input = getStr("stamp_duty_rate");
    const registration_fee_rate_input = getStr("registration_fee_rate");
    const stamp_duty_amount_input = getStr("stamp_duty_amount");
    const stamp_duty_paid_date = getStr("stamp_duty_paid_date");
    const stamp_duty_status = getStr("stamp_duty_status");
    const stamp_duty_payment_mode = getStr("stamp_duty_payment_mode");
    const stamp_duty_receipt_no = getStr("stamp_duty_receipt_no");
    const registration_fee_amount_input = getStr("registration_fee_amount");
    const registration_fee_paid_date = getStr("registration_fee_paid_date");
    const registration_fee_status = getStr("registration_fee_status");
    const registration_fee_payment_mode = getStr("registration_fee_payment_mode");

    let custom_charges: any[] = [];
    try { custom_charges = JSON.parse(getStr("custom_charges") || "[]"); } catch { }

    // Parse JSON arrays
    let joint_applicants: any[] = [];
    try { joint_applicants = JSON.parse(getStr("joint_applicants") || "[]"); } catch { }

    // payment_details JSONB is deprecated as of the ledger-as-source-of-truth model.
    // New bookings write nothing to it; financial_ledger is authoritative going forward.
    // (Legacy bookings created before this change keep their payment_details intact.)

    // CP commission intent from the booking form.
    //   "auto"   — accrue using the partner's configured rate
    //   "manual" — accrue the amount the user typed, recorded as an override
    //   "none"   — record nothing (default, so existing callers are unaffected)
    const cp_commission_mode = (getStr("cp_commission_mode") || "none").toLowerCase();
    const cp_commission_amount = getStr("cp_commission_amount");
    const cp_commission_reason = getStr("cp_commission_reason");

    // Populated inside the transaction; surfaced in the response so the UI can
    // tell the user a booking saved but its commission did not.
    let commissionResult: { accrued: boolean; reason?: string; code?: string } | null = null;

    // ── Document bytes are read BEFORE the transaction opens ─────────────────
    // Reading a File into a Buffer is local work; doing it inside the
    // transaction meant the database connection sat idle during it. The R2
    // uploads themselves happen AFTER commit — see the post-commit block below
    // for the ordering and why it is the safe one.
    const _t0 = Date.now();
    const stagedDocs = await stageBookingDocuments(getStr, getFile, joint_applicants);
    const _tStaged = Date.now();

    // We will do everything inside a transaction
    const result = await transaction(async (client) => {
      // MT-05: the tenant for every row written in this transaction — the same
      // value resolved at the top of the handler, appended as the LAST column of
      // each INSERT so no existing $n placeholder shifts.

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
          application_date, created_by, created_role, booking_status,
          booking_date, agreement_value, booking_amount, booking_remarks, internal_notes,
          apartment_name, project_name, tower, wing,
          revenue_include_ocr, revenue_include_sdr, revenue_include_cash, revenue_include_sanction, revenue_include_disbursement,
          sourced_by_channel_partner_id,
          organization_id,
          created_by_id
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,'Pending',
          $37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,
          -- CP attribution is inherited from the source lead, never re-entered.
          -- Resolves to NULL for direct/non-CP leads and for bookings with no lead.
          -- TENANT: scoped to $51. lead_id comes from the request body, so without
          -- the organization predicate a lead id belonging to another builder
          -- would have attributed THEIR channel partner to this booking — and
          -- commission is accrued against whatever this resolves to.
          (SELECT channel_partner_id FROM walkin_enquiries WHERE id = $1 AND organization_id = $51),
          $51,
          $52
        ) RETURNING id`,
        [
          lead_id, primary_name, primary_email, primary_mobile, primary_pan, primary_aadhaar,
          primary_occupation, primary_nationality || "Indian",
          JSON.stringify(joint_applicants),
          address, pin, state, country || "India",
          property_type, floor_number, flat_number, carpet_area,
          consideration_value, consideration_value_words, parking_details,
          '[]', witness_name, witness_aadhaar,
          booking_source || "Direct", direct_source, channel_partner_name, channel_partner_contact,
          unit_cost, sdr, gst, declaration_accepted, terms_accepted, consent_accepted,
          application_date, created_by, created_role,
          booking_date || null, cleanNum(agreement_value), cleanNum(booking_amount), booking_remarks, internal_notes,
          apartment_name, project_name, tower, wing,
          revenue_include_ocr, revenue_include_sdr, revenue_include_cash, revenue_include_sanction, revenue_include_disbursement,
          orgId,
          gate.userId
        ]
      );
      const newId = insertRes.rows[0].id;

      const dateParts = application_date.split("-");
      const bookingNumber = `BK-${dateParts[0]}-${dateParts[1]}-${dateParts[2]}-${String(newId).padStart(5, "0")}`;

      await client.query(`UPDATE booking_applications SET booking_number = $1 WHERE id = $2`, [bookingNumber, newId]);

      // 1a-2. Auto-compute GST and Stamp Duty / Registration Fee (Maharashtra defaults; overridable by client)
      const agreementVal = cleanNum(agreement_value);
      // Safe as written (the string "0" is truthy) but routed through the shared
      // helper anyway, so create and update resolve the rate identically and a
      // numeric 0 from a non-form caller cannot regress to 5.
      const gstRate = resolveGstRate(gst_rate_input);
      const gstAmount = calcGstAmount(agreementVal, gstRate);
      // Same treatment for stamp duty: resolve the rate (0 survives, absent falls
      // back to the Maharashtra default), then derive the amount from it unless the
      // client sent an explicit figure. The registration fee rate is still resolved
      // and stored for continuity, but no longer decides the amount.
      const stampDutyRate = resolveStampDutyRate(stamp_duty_rate_input);
      const registrationFeeRate = resolveRegistrationFeeRate(registration_fee_rate_input);
      const stampDutyAmount = stamp_duty_amount_input
        ? cleanNum(stamp_duty_amount_input)
        : calcStampDuty(agreementVal, stampDutyRate);
      // Registration fee is the exception: it is entered directly rather than
      // derived, so it is stored exactly as sent, with no percentage fallback and
      // no ₹30,000 cap. Nothing supplied means ₹0, not "estimate it from the
      // agreement value".
      const registrationFeeAmount = cleanNum(registration_fee_amount_input);

      await client.query(`
        UPDATE booking_applications SET
          gst_rate = $1, gst_amount = $2,
          expected_possession_date = $3, actual_possession_date = $4, possession_status = COALESCE($5, possession_status),
          oc_cc_status = COALESCE($6, oc_cc_status), oc_cc_date = $7,
          possession_charges = $8, maintenance_deposit = $9, legal_charges = $10
        WHERE id = $11
      `, [gstRate, gstAmount, expected_possession_date || null, actual_possession_date || null, possession_status || null,
          oc_cc_status || null, oc_cc_date || null,
          cleanNum(possession_charges), cleanNum(maintenance_deposit), cleanNum(legal_charges), newId]);

      // 1b. Insert Financials
      // DEPRECATED (Phase 6): sdr_amount / sdr_payment_date / sdr_status are no longer
      // written for new bookings — the split stamp_duty_* / registration_fee_* columns on
      // booking_registration_details are authoritative (inserted in step 1d below). The old
      // columns are left NULL so legacy rows keep their data and fallback reads still work.
      // (ocr_amount is intentionally still written: it feeds the financial_ledger 'ocr' line,
      // which has no derived replacement yet — see deferred pipeline notes.)
      await client.query(`
        INSERT INTO booking_financials (booking_id, token_amount, ocr_amount, ocr_received_date, ocr_payment_mode, ocr_remarks, sdr_amount, sdr_payment_date, sdr_status, sdr_remarks, cash_component, cash_component_date, cash_component_remarks, organization_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `, [newId, cleanNum(token_amount), cleanNum(ocr_amount), ocr_received_date || null, ocr_payment_mode, ocr_remarks, null, null, null, sdr_remarks, cleanNum(cash_component), cash_component_date || null, cash_component_remarks, orgId]);

      // 1c. Insert Loan Details (incl. EMI fields)
      await client.query(`
        INSERT INTO booking_loan_details (booking_id, loan_required, bank_name, loan_executive, loan_type, loan_reference_no, loan_amount, sanction_amount, sanction_date, sanction_status, loan_status, expected_disbursement_date, actual_disbursement_date, expected_disbursement_amount, disbursement_amount, disbursement_status, interest_rate, loan_tenure_months, emi_start_date, payment_type, pre_emi_amount, emi_amount, organization_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
      `, [newId, loan_required, bank_name, loan_executive, loan_type, loan_reference_no, cleanNum(loan_amount), cleanNum(sanction_amount), sanction_date || null, sanction_status || 'Pending', loan_status || 'Pending', expected_disbursement_date || null, actual_disbursement_date || null, cleanNum(expected_disbursement_amount), cleanNum(disbursement_amount), disbursement_status || 'Pending', cleanNum(interest_rate), cleanNum(loan_tenure_months), emi_start_date || null, payment_type || 'Pre-EMI', cleanNum(pre_emi_amount), cleanNum(emi_amount), orgId]);

      // 1d. Insert Registration Details (with split Stamp Duty / Registration Fee)
      await client.query(`
        INSERT INTO booking_registration_details (
          booking_id, expected_registration_date, actual_registration_date, registration_status, registration_number, registration_remarks,
          stamp_duty_rate, stamp_duty_amount, stamp_duty_paid_date, stamp_duty_status, stamp_duty_payment_mode, stamp_duty_receipt_no,
          registration_fee_rate, registration_fee_amount, registration_fee_paid_date, registration_fee_status, registration_fee_payment_mode,
          organization_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      `, [newId, expected_registration_date || null, actual_registration_date || null, registration_status || 'Pending', registration_number, registration_remarks,
          stampDutyRate, stampDutyAmount, stamp_duty_paid_date || null, stamp_duty_status || 'Pending', stamp_duty_payment_mode, stamp_duty_receipt_no,
          registrationFeeRate, registrationFeeAmount, registration_fee_paid_date || null, registration_fee_status || 'Pending', registration_fee_payment_mode, orgId]);

      // 1e. Insert Custom Charges (batched into one multi-row INSERT)
      if (custom_charges.length > 0) {
        const ccValues: any[] = [];
        const ccPlaceholders: string[] = [];
        let ccIdx = 1;
        for (const charge of custom_charges) {
          ccPlaceholders.push(`($${ccIdx}, $${ccIdx + 1}, $${ccIdx + 2}, $${ccIdx + 3}, $${ccIdx + 4})`);
          ccValues.push(newId, charge.charge_name, charge.amount || 0, charge.remarks, orgId);
          ccIdx += 5;
        }
        await client.query(`
          INSERT INTO booking_custom_charges (booking_id, charge_name, amount, remarks, organization_id)
          VALUES ${ccPlaceholders.join(', ')}
        `, ccValues);
      }

      // 1f. Insert into Revenue Pipeline
      await client.query(`
        INSERT INTO booking_pipeline (booking_id, current_stage, status, organization_id)
        VALUES ($1, 'Booking', 'Active', $2)
      `, [newId, orgId]);

      // 1f-2. Initialize Financial Account & Ledger
      const accInsert = await client.query(`INSERT INTO financial_accounts (booking_id, organization_id) VALUES ($1, $2) RETURNING id`, [newId, orgId]);
      const account_id = accInsert.rows[0].id;

      // 1f-2b. Batch financial ledger upserts (was 5 individual round trips)
      const ledgerRows: Array<{type: string; direction: string; amount: number; date: any; affectsRevenue: string; receivedFrom: string; bankName: string | null; paymentMode: string | null; remarks: string | null}> = [
        { type: 'token', direction: 'CREDIT', amount: cleanNum(token_amount), date: booking_date, affectsRevenue: 'NO', receivedFrom: 'Customer', bankName: null, paymentMode: null, remarks: null },
        { type: 'booking_amount', direction: 'CREDIT', amount: cleanNum(booking_amount), date: booking_date, affectsRevenue: 'NO', receivedFrom: 'Customer', bankName: null, paymentMode: null, remarks: booking_remarks },
        { type: 'ocr', direction: 'CREDIT', amount: cleanNum(ocr_amount), date: ocr_received_date, affectsRevenue: 'YES', receivedFrom: 'Customer', bankName: null, paymentMode: ocr_payment_mode, remarks: ocr_remarks },
        { type: 'cash_component', direction: 'CREDIT', amount: cleanNum(cash_component), date: cash_component_date, affectsRevenue: 'YES', receivedFrom: 'Customer', bankName: null, paymentMode: null, remarks: cash_component_remarks },
        { type: 'loan_disbursement', direction: 'CREDIT', amount: cleanNum(disbursement_amount), date: actual_disbursement_date, affectsRevenue: 'YES', receivedFrom: 'Bank', bankName: bank_name, paymentMode: null, remarks: null },
      ].filter(r => r.amount > 0);

      if (ledgerRows.length > 0) {
        const lValues: any[] = [];
        const lPlaceholders: string[] = [];
        let lIdx = 1;
        for (const r of ledgerRows) {
          lPlaceholders.push(`($${lIdx}, $${lIdx+1}, $${lIdx+2}, $${lIdx+3}, $${lIdx+4}, 'Received', $${lIdx+5}, $${lIdx+6}, 'UI_Update', $${lIdx+7}, $${lIdx+8}, $${lIdx+9}, $${lIdx+10}, $${lIdx+11})`);
          lValues.push(account_id, r.type, r.direction, r.amount, r.date || new Date(), r.affectsRevenue, r.receivedFrom, r.bankName, r.paymentMode, r.remarks, created_by || 'System', orgId);
          lIdx += 12;
        }
        await client.query(`
          INSERT INTO financial_ledger (account_id, transaction_type, transaction_direction, amount, transaction_date, status, affects_revenue, received_from, transaction_source, bank_name, payment_mode, notes, created_by, organization_id)
          VALUES ${lPlaceholders.join(', ')}
          ON CONFLICT (account_id, transaction_type, transaction_source) DO UPDATE
          SET amount = EXCLUDED.amount, transaction_date = EXCLUDED.transaction_date, bank_name = EXCLUDED.bank_name, payment_mode = EXCLUDED.payment_mode, notes = EXCLUDED.notes
        `, lValues);
      }

      // 1f-3. Default Payment Milestones (standard under-construction demand schedule)
      // Token is chronologically first (Booking milestone); the larger Booking Amount
      // (up to the RERA 10% cap) is typically settled just before Agreement execution.
      const defaultMilestones = [
        { name: 'Booking', order: 1, percentage: 10, paid: cleanNum(token_amount), paidDate: booking_date },
        { name: 'Agreement', order: 2, percentage: 10, paid: cleanNum(booking_amount), paidDate: booking_date },
        { name: 'Plinth', order: 3, percentage: 10, paid: 0, paidDate: null },
        { name: 'Slab Completion (1-5)', order: 4, percentage: 15, paid: 0, paidDate: null },
        { name: 'Slab Completion (6-10)', order: 5, percentage: 15, paid: 0, paidDate: null },
        { name: 'Brickwork', order: 6, percentage: 10, paid: 0, paidDate: null },
        { name: 'Plaster & Flooring', order: 7, percentage: 10, paid: 0, paidDate: null },
        { name: 'Finishing', order: 8, percentage: 10, paid: 0, paidDate: null },
        { name: 'Possession', order: 9, percentage: 10, paid: 0, paidDate: null },
      ];
      // Batch all 9 milestone INSERTs into one multi-row statement (was 9 round trips)
      const msValues: any[] = [];
      const msPlaceholders: string[] = [];
      let msIdx = 1;
      for (const ms of defaultMilestones) {
        const demandAmount = agreementVal * ms.percentage / 100;
        const status = ms.paid <= 0 ? 'Upcoming' : ms.paid >= demandAmount ? 'Paid' : 'Partially Paid';
        msPlaceholders.push(`($${msIdx}, $${msIdx+1}, $${msIdx+2}, $${msIdx+3}, $${msIdx+4}, $${msIdx+5}, $${msIdx+6}, $${msIdx+7}, $${msIdx+8})`);
        msValues.push(newId, ms.name, ms.order, ms.percentage, demandAmount, ms.paid, ms.paidDate || null, status, orgId);
        msIdx += 9;
      }
      await client.query(`
        INSERT INTO booking_payment_milestones (booking_id, milestone_name, milestone_order, percentage, demand_amount, paid_amount, paid_date, status, organization_id)
        VALUES ${msPlaceholders.join(', ')}
      `, msValues);

      // 1g. Insert initial stage history
      await client.query(`
        INSERT INTO booking_stage_history (booking_id, stage_name, employee_name, remarks, organization_id)
        VALUES ($1, 'Booking Submitted', $2, 'Initial booking form submitted.', $3)
      `, [newId, created_by || 'System', orgId]);

      // 1h. Phase B5: migrate the lead's multi-bank loan applications to this booking.
      // The lead-level draft (loan_tracking_info.loan_application_ids) references
      // loan_applications rows; on booking creation they become booking-scoped so the
      // shopping history follows the booking. Best-effort — never fails the booking.
      try {
        const leadDraftRes = await client.query(`SELECT loan_tracking_info FROM walkin_enquiries WHERE id = $1 AND organization_id = $2`, [lead_id, orgId]);
        const draftRaw = leadDraftRes.rows[0]?.loan_tracking_info;
        const draft = typeof draftRaw === "string" ? JSON.parse(draftRaw) : (draftRaw || {});
        const ids = Array.isArray(draft?.loan_application_ids)
          ? draft.loan_application_ids.map((n: any) => Number(n)).filter((n: number) => Number.isInteger(n) && n > 0)
          : [];
        if (ids.length > 0) {
          // The ids come out of a lead row this organization owns, but they are
          // still values from a JSON blob: the organization predicate makes the
          // UPDATE itself tenant-safe rather than relying on where they came from.
          await client.query(
            `UPDATE loan_applications SET booking_id = $1, updated_at = NOW()
              WHERE id = ANY($2::int[]) AND organization_id = $3`,
            [newId, ids, orgId]
          );
        }
      } catch (e) {
        console.warn("[POST booking-applications] loan_application_ids migration skipped:", (e as any)?.message);
      }

      // 2. Documents — NOT here any more.
      //
      // Every uploadBufferToR2() call used to run at this point, inside the open
      // transaction: a network round trip to Cloudflare, per document, while this
      // Postgres connection and the row locks taken above stayed held. A booking
      // with four attachments on a slow line held the transaction open for the
      // duration of four uploads' worth of network, doing no database work.
      //
      // The bytes are already in memory (staged before the transaction opened);
      // the uploads and their booking_documents rows now happen after COMMIT.
      // See the post-commit block for the ordering and its failure behaviour.
      //
      // Also removed: an `imagesForPdf` object that base64-encoded every uploaded
      // document — a second full read of each file plus ~33% memory inflation —
      // and was then never read by anything. PDF generation is on-demand and
      // fetches its own images.

      // ── Inventory sync: mark the booked unit (create it if the bulk generator
      // never did). Runs inside this transaction, so a sync failure rolls the whole
      // booking back — no booking succeeds while its inventory link silently fails.
      await syncBookingUnit(client, {
        bookingId: newId,
        leadId: lead_id,
        actor: created_by,
        project_name, tower, wing,
        property_type, floor_number, flat_number, carpet_area,
      });

      // ── CP commission accrual ────────────────────────────────────────────
      // Only when the booking inherited a channel partner AND the form asked for
      // it. Deliberately NON-FATAL, unlike the inventory sync above: the most
      // common failure is CP_RATE_NOT_SET (a partner discovered from lead intake
      // who has never had a rate negotiated), and refusing to save the booking
      // over a missing commission rate would block the sale itself. The reason is
      // returned to the caller so the UI can surface it instead of failing
      // silently — the commission can then be added later from the CP Master.
      if (cp_commission_mode !== "none") {
        const bookingRow = await client.query(
          `SELECT sourced_by_channel_partner_id FROM booking_applications WHERE id = $1 AND organization_id = $2`,
          [newId, orgId]
        );
        const attributedCp = bookingRow.rows[0]?.sourced_by_channel_partner_id ?? null;

        if (attributedCp !== null) {
          try {
            // Nested savepoint: a failed accrual must not poison the outer
            // transaction and take the whole booking down with it.
            await client.query("SAVEPOINT cp_commission");
            const isManual = cp_commission_mode === "manual";
            await computeCPCommission(client, newId, created_by || "system", {
              source: isManual ? "manual" : "auto",
              overrideGross: isManual ? cleanNum(cp_commission_amount) : undefined,
              overrideReason: isManual
                ? (cp_commission_reason || "Manually entered at booking")
                : undefined,
            });
            await client.query("RELEASE SAVEPOINT cp_commission");
            commissionResult = { accrued: true };
          } catch (cErr: any) {
            await client.query("ROLLBACK TO SAVEPOINT cp_commission");
            commissionResult = {
              accrued: false,
              reason: cErr?.message || "Commission could not be recorded.",
              code: cErr?.code || "COMMISSION_FAILED",
            };
            console.warn(`[CP] booking ${newId} saved but commission not accrued: ${commissionResult.reason}`);
          }
        } else {
          commissionResult = {
            accrued: false,
            reason: "No channel partner is attributed to this booking's lead.",
            code: "NO_CP_ATTRIBUTED",
          };
        }
      }

      // The booking id and number are all the post-commit steps need. This used
      // to be `SELECT * FROM booking_applications WHERE id = $1` — a 121-column
      // read of a row that was then discarded, because the response is built
      // from fetchBookingById() below anyway. One wasted round trip per booking.
      return { id: newId as number, booking_number: bookingNumber };
    });
    const _tTxn = Date.now();

    // ── Post-commit ──────────────────────────────────────────────────────────
    // Status flip and lead closure folded into ONE statement. They were two
    // sequential UPDATEs, each its own round trip; a CTE makes it one. Both
    // predicates are unchanged, including the organization scope on each table.
    await query(
      `WITH confirmed AS (
         UPDATE booking_applications SET booking_status = 'Confirmed'
          WHERE id = $1 AND organization_id = $3
       )
       UPDATE walkin_enquiries SET status = 'Closed'
        WHERE id = $2 AND organization_id = $3`,
      [result.id, lead_id, orgId],
    );

    // Documents: uploaded to R2 and recorded now, outside any transaction. A
    // document that fails to upload is reported, not silently dropped, and never
    // gets a booking_documents row. See commitBookingDocuments().
    const _tStatus = Date.now();
    const { failed: failedDocuments } = await commitBookingDocuments({
      staged: stagedDocs,
      bookingId: result.id,
      bookingNumber: result.booking_number,
      leadId: lead_id,
      uploadedBy: created_by,
      organizationId: orgId,
      jointApplicants: joint_applicants,
    });
    const _tDocs = Date.now();

    // Return the SAME shape GET returns, not the bare booking_applications row.
    // The caller feeds this straight into the booking view (sales/page.tsx does
    // `setBookingData(booking)`), and the bare row has no lead_name, lead_phone,
    // token_amount or ocr_amount on it at all — so every joined field rendered
    // as "—" on a booking whose details had just been typed in.
    //
    // This is the ONE read the response needs, and it now reuses the already
    // resolved organization instead of asking for it again.
    const enriched = await fetchBookingById(result.id, orgId);
    const _tEnrich = Date.now();

    console.log(`[BOOKING TIMING] id=${result.id} staging=${_tStaged - _t0}ms transaction=${_tTxn - _tStaged}ms statusCTE=${_tStatus - _tTxn}ms r2Docs=${_tDocs - _tStatus}ms fetchById=${_tEnrich - _tDocs}ms total=${_tEnrich - _t0}ms staged=${stagedDocs.length}docs`);

    return NextResponse.json(
      {
        success: true,
        // Falls back to a minimal row if the enrichment read somehow returns
        // nothing: a booking that saved must never be reported as failed.
        data: enriched ?? { id: result.id, booking_number: result.booking_number, booking_status: "Confirmed" },
        commission: commissionResult,
        // Present only when something failed, so existing callers see no change.
        ...(failedDocuments.length > 0 ? { failedDocuments } : {}),
      },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("[POST /api/booking-applications]", err);
    // syncBookingUnit throws with httpStatus 409 when the chosen flat is already
    // held by another booking. That is the operator's mistake to correct, not a
    // server fault, so it must not be flattened into a 500.
    return NextResponse.json({ success: false, message: err.message }, { status: err?.httpStatus || 500 });
  }
}
