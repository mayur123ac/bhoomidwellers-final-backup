// lib/import/createImportBooking.ts
// Import-safe booking creator.
//
// Creates the full set of booking-related rows that the normal booking POST
// creates, but from import data only — never fabricating values the client
// Excel did not provide.
//
// Rows written (same tables as normal booking POST):
//   booking_applications  — with flat_allocation_status + import_source
//   booking_financials    — ocr_amount from import; other amounts 0/null
//   booking_pipeline      — stage = 'Booking', status = 'Active'
//   financial_accounts    — one per booking; required for financial_ledger
//   financial_ledger      — 'ocr' entry (if ocrAmount > 0, affects_revenue YES)
//                           'booking_amount' entry (if bookingAmount > 0)
//   booking_stage_history — "Created via Excel import."
//   walkin_enquiries      — status set to 'Closing'
//
// Rows NOT written (require data not available at import time):
//   booking_payment_milestones — demand amounts derive from agreement_value (0
//     for imports); a 9-milestone schedule of all-zero demands is meaningless.
//     Milestones are created when flat allocation completes and agreement_value
//     is known.
//   booking_documents / booking_loan_details / booking_registration_details —
//     not present in client Excel; filled in via normal booking Edit panels.
//
// financial_ledger source:
//   Uses transaction_source = 'UI_Update' (same as the normal booking POST).
//   This ensures that if the admin later edits the booking from the UI, the
//   PUT handler's upsert updates the existing rows rather than duplicating them.
//
// Schema dependency: flat_allocation_status and import_source must exist on
// booking_applications. Added by:
//   scripts/migrations/2026-08-31_import_booking_columns.sql

import type { PoolClient } from "pg";
import {
  validateImportBooking,
  type ImportBookingInput,
  type BookingValidationWarning,
} from "./bookingValidation";
import { syncBookingUnit } from "@/lib/inventorySync";

// ── Creator ───────────────────────────────────────────────────────────────────

export interface CreateImportBookingResult {
  bookingId: number;
  bookingNumber: string;
  flatAllocationStatus: "ALLOCATED" | "PENDING";
  warnings: BookingValidationWarning[];
}

/**
 * Create a booking_applications + booking_financials record from import data.
 *
 * Must be called inside an existing transaction (receives the PoolClient).
 * Throws if hard validation fails (negative amounts, missing identity).
 * Returns warnings for soft issues (no flat number, no booking amount, etc.).
 *
 * After creation:
 *   • The lead's status is set to 'Closing' (same as the normal booking flow).
 *   • booking_number is generated in the same BK-YYYY-MM-DD-NNNNN format.
 */
export async function createImportBooking(
  client: PoolClient,
  input: ImportBookingInput
): Promise<CreateImportBookingResult> {
  const validation = validateImportBooking(input);
  if (!validation.ok) {
    throw new Error(
      `Import booking validation failed: ${validation.errors.join("; ")}`
    );
  }

  const flatAllocationStatus: "ALLOCATED" | "PENDING" = input.flatNumber
    ? "ALLOCATED"
    : "PENDING";

  // Use the booking date as the application date; fall back to today.
  // We only need YYYY-MM-DD for the booking_number; the full ISO string
  // is stored in booking_date as-is.
  const applicationDate = input.bookingDate
    ? input.bookingDate.slice(0, 10)   // "2024-03-15T00:00:00.000Z" → "2024-03-15"
    : new Date().toISOString().slice(0, 10);

  // ── Insert booking_applications ───────────────────────────────────────────
  // Column order mirrors the normal POST handler so index-based assumptions
  // (booking_number, gst_rate updates, etc.) stay consistent. Fields not
  // available from the import are set to their neutral defaults (null / 0 / '').
  const insertRes = await client.query(
    `INSERT INTO booking_applications (
      lead_id,
      primary_name, primary_email, primary_mobile, primary_pan, primary_aadhaar,
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
      revenue_include_ocr, revenue_include_sdr, revenue_include_cash,
      revenue_include_sanction, revenue_include_disbursement,
      flat_allocation_status, import_source,
      sourced_by_channel_partner_id,
      organization_id
    ) VALUES (
      $1,
      $2, NULL, $3, NULL, NULL,
      NULL, 'Indian',
      '[]',
      NULL, NULL, NULL, 'India',
      NULL, NULL, $4, NULL,
      0, NULL, NULL,
      '[]', NULL, NULL,
      'Excel Import', NULL, NULL, NULL,
      0, NULL, NULL, NULL, NULL, NULL,
      $5, $6, 'import', 'Pending',
      $7, 0, $8, NULL, NULL,
      NULL, NULL, NULL, NULL,
      NULL, NULL, NULL, NULL, NULL,
      $9, 'excel_import',
      (SELECT channel_partner_id FROM walkin_enquiries
         WHERE id = $1 AND organization_id = $10),
      $10
    ) RETURNING id`,
    [
      input.leadId,                    // $1  lead_id / subquery scope
      input.primaryName,               // $2  primary_name
      input.primaryMobile,             // $3  primary_mobile
      input.flatNumber || null,        // $4  flat_number
      applicationDate,                 // $5  application_date
      input.importedByName,            // $6  created_by
      input.bookingDate || null,       // $7  booking_date
      input.bookingAmount ?? 0,        // $8  booking_amount
      flatAllocationStatus,            // $9  flat_allocation_status
      input.orgId,                     // $10 organization_id
    ]
  );
  const bookingId: number = insertRes.rows[0].id;

  // ── booking_number (same format as normal bookings) ───────────────────────
  const [yyyy, mm, dd] = applicationDate.split("-");
  const bookingNumber = `BK-${yyyy}-${mm}-${dd}-${String(bookingId).padStart(5, "0")}`;
  await client.query(
    `UPDATE booking_applications SET booking_number = $1 WHERE id = $2`,
    [bookingNumber, bookingId]
  );

  // ── booking_financials ────────────────────────────────────────────────────
  // Only ocr_amount is populated from the import. All other financial columns
  // (sdr_amount, cash_component, etc.) start at null/0 and are filled in
  // later via the normal booking Edit panels.
  await client.query(
    `INSERT INTO booking_financials (
      booking_id, token_amount, ocr_amount,
      ocr_received_date, ocr_payment_mode, ocr_remarks,
      sdr_amount, sdr_payment_date, sdr_status, sdr_remarks,
      cash_component, cash_component_date, cash_component_remarks,
      organization_id
    ) VALUES (
      $1, 0, $2,
      NULL, NULL, NULL,
      NULL, NULL, NULL, NULL,
      0, NULL, NULL,
      $3
    )`,
    [bookingId, input.ocrAmount ?? 0, input.orgId]
  );

  // ── booking_pipeline ─────────────────────────────────────────────────────
  // Makes the booking visible in the revenue pipeline dashboard.
  // ON CONFLICT DO NOTHING: booking_pipeline has a UNIQUE constraint on
  // (booking_id). A plain INSERT would throw if createImportBooking is called
  // again for the same booking (e.g. a transaction retry). DO NOTHING makes
  // the second attempt a no-op instead of aborting the transaction.
  await client.query(
    `INSERT INTO booking_pipeline (booking_id, current_stage, status, organization_id)
     VALUES ($1, 'Booking', 'Active', $2)
     ON CONFLICT (booking_id) DO NOTHING`,
    [bookingId, input.orgId]
  );

  // ── financial_accounts ───────────────────────────────────────────────────
  // One account per booking. Required before any financial_ledger rows can
  // be written (FK: financial_ledger.account_id → financial_accounts.id).
  const accRes = await client.query(
    `INSERT INTO financial_accounts (booking_id, organization_id) VALUES ($1, $2) RETURNING id`,
    [bookingId, input.orgId]
  );
  const accountId: number = accRes.rows[0].id;

  // ── financial_ledger ─────────────────────────────────────────────────────
  // Only write entries for amounts that are actually non-zero — a 0-amount
  // ledger row has no financial meaning and clutters the account view.
  //
  // transaction_source = 'UI_Update' matches the normal booking POST so that
  // subsequent UI edits (PUT /api/booking-applications/[id]) upsert these
  // rows rather than inserting duplicates.
  const entryDate = input.bookingDate ? new Date(input.bookingDate) : new Date();

  if ((input.ocrAmount ?? 0) > 0) {
    // OCR = On-Collection Receipt. affects_revenue = 'YES' (same as normal booking).
    await client.query(
      `INSERT INTO financial_ledger (
          account_id, transaction_type, transaction_direction,
          amount, transaction_date, status,
          affects_revenue, received_from, transaction_source,
          created_by, organization_id
        ) VALUES ($1, 'ocr', 'CREDIT', $2, $3, 'Received', 'YES', 'Customer', 'UI_Update', $4, $5)
        ON CONFLICT (account_id, transaction_type, transaction_source) DO UPDATE
          SET amount = EXCLUDED.amount, transaction_date = EXCLUDED.transaction_date`,
      [accountId, input.ocrAmount, entryDate, input.importedByName, input.orgId]
    );
  }

  if ((input.bookingAmount ?? 0) > 0) {
    // booking_amount: affects_revenue = 'NO' (same as normal booking).
    await client.query(
      `INSERT INTO financial_ledger (
          account_id, transaction_type, transaction_direction,
          amount, transaction_date, status,
          affects_revenue, received_from, transaction_source,
          created_by, organization_id
        ) VALUES ($1, 'booking_amount', 'CREDIT', $2, $3, 'Received', 'NO', 'Customer', 'UI_Update', $4, $5)
        ON CONFLICT (account_id, transaction_type, transaction_source) DO UPDATE
          SET amount = EXCLUDED.amount, transaction_date = EXCLUDED.transaction_date`,
      [accountId, input.bookingAmount, entryDate, input.importedByName, input.orgId]
    );
  }

  // ── booking_stage_history ────────────────────────────────────────────────
  // Audit trail. Appears in the booking timeline exactly as a normal booking
  // submission does, but with a distinct remark so staff know it originated
  // from an Excel import rather than the booking form.
  await client.query(
    `INSERT INTO booking_stage_history (booking_id, stage_name, employee_name, remarks, organization_id)
     VALUES ($1, 'Booking Submitted', $2, 'Created via Excel import.', $3)`,
    [bookingId, input.importedByName, input.orgId]
  );

  // ── Inventory sync (Phase 7) ──────────────────────────────────────────────
  // When the import carries enough data to identify the unit (project + tower
  // + flat), mark it as 'booked' in inventory_units atomically with the
  // booking creation. All writes share the same PoolClient so this rolls
  // back together with the rest of the booking if anything throws.
  //
  // syncBookingUnit skips silently (synced: false, skippedReason set) when
  // project_name, tower, or flat_number is absent — matching the normal POST
  // behaviour where inventory sync is best-effort for incomplete unit data.
  //
  // If the flat is already held by another booking, syncBookingUnit throws
  // { httpStatus: 409 }. The per-row try/catch in commitImport marks the row
  // 'failed' without aborting the whole import batch.
  if (flatAllocationStatus === "ALLOCATED") {
    await syncBookingUnit(client, {
      bookingId,
      leadId: input.leadId,
      actor: input.importedByName,
      project_name: input.projectName,
      tower: input.tower,
      wing: input.wing,
      floor_number: input.floorNumber,
      flat_number: input.flatNumber,
    });
  }

  // ── Lock the lead (same transition as the normal booking flow) ────────────
  await client.query(
    `UPDATE walkin_enquiries
        SET status = 'Closing', updated_at = now()
      WHERE id = $1 AND organization_id = $2`,
    [input.leadId, input.orgId]
  );

  return {
    bookingId,
    bookingNumber,
    flatAllocationStatus,
    warnings: validation.warnings,
  };
}
