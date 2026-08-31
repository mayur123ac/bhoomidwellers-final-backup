// lib/import/bookingValidation.ts
// Tolerant booking validation for the import path.
//
// IMPORTANT: This is NOT the same as the booking form's validate() in
// BookingFormModal.tsx. That validator guards the normal manual-booking flow
// and requires flat_number, agreement_value, signature, etc.
//
// This validator only hard-rejects rows that would produce semantically wrong
// data (negative amounts, identity fields missing). Everything else that is
// absent from the client Excel becomes a warning — the booking is still
// created, but with a neutral placeholder and flat_allocation_status = 'PENDING'.

export interface ImportBookingInput {
  // Always present — sourced from the walkin_enquiries row just created/matched.
  leadId: number;
  primaryName: string;
  primaryMobile: string;
  orgId: string;
  importedByName: string;

  // From BookingClaim — all optional; null means the client Excel did not
  // provide the column or left the cell blank. Never fabricate values here.
  bookingDate: string | null;       // ISO string or null
  bookingAmount: number | null;     // parsed from booking_amount column
  bookingAmountRaw: string | null;  // original cell text for error messages
  bookingReference: string | null;  // booking number / reference string
  ocrAmount: number | null;         // On-Collection Receipt → booking_financials
  ocrAmountRaw: string | null;      // original cell text for error messages
  flatNumber: string | null;        // unit identifier; null → PENDING allocation
  // Phase 7: property identity for syncBookingUnit. All nullable — if any of
  // project_name / tower / flat_number is absent, syncBookingUnit skips with
  // skippedReason = "incomplete unit" instead of throwing.
  projectName: string | null;
  tower: string | null;
  wing: string | null;
  floorNumber: string | null;
}

export interface BookingValidationWarning {
  field: string;
  message: string;
}

export interface ImportBookingValidationResult {
  ok: boolean;
  errors: string[];                     // hard errors — booking CANNOT be created
  warnings: BookingValidationWarning[]; // soft — booking created with placeholders
}

/**
 * Validate an import booking input.
 *
 * Hard errors (booking rejected):
 *   • leadId / primaryName / primaryMobile missing
 *   • bookingAmount or ocrAmount is negative
 *
 * Soft warnings (booking created with neutral defaults):
 *   • flat_number absent → flat_allocation_status = PENDING
 *   • bookingAmount absent → recorded as 0
 *   • bookingDate absent → today's date used as application_date
 */
export function validateImportBooking(
  input: ImportBookingInput
): ImportBookingValidationResult {
  const errors: string[] = [];
  const warnings: BookingValidationWarning[] = [];

  // ── Hard errors ────────────────────────────────────────────────────────────
  if (!input.leadId) {
    errors.push("leadId is required");
  }
  if (!input.primaryName?.trim()) {
    errors.push("primaryName is required");
  }
  if (!input.primaryMobile?.trim()) {
    errors.push("primaryMobile is required");
  }
  if (input.bookingAmount !== null && input.bookingAmount < 0) {
    errors.push(
      `bookingAmount cannot be negative (received: "${input.bookingAmountRaw ?? input.bookingAmount}")`
    );
  }
  if (input.ocrAmount !== null && input.ocrAmount < 0) {
    errors.push(
      `ocrAmount cannot be negative (received: "${input.ocrAmountRaw ?? input.ocrAmount}")`
    );
  }

  // ── Soft warnings (never block creation) ──────────────────────────────────
  if (!input.flatNumber) {
    warnings.push({
      field: "flat_number",
      message:
        "Flat number not provided in the import — unit allocation status will be PENDING until assigned manually.",
    });
  }
  if (!input.bookingAmount) {
    warnings.push({
      field: "booking_amount",
      message:
        "Booking amount not provided in the import — recorded as 0. Update via the booking Edit panel.",
    });
  }
  if (!input.bookingDate) {
    warnings.push({
      field: "booking_date",
      message:
        "Booking date not provided in the import — today's date will be used as the application date.",
    });
  }
  if (!input.ocrAmount) {
    warnings.push({
      field: "ocr_amount",
      message:
        "OCR amount not provided in the import — recorded as 0. Update via the booking Financials panel.",
    });
  }

  return { ok: errors.length === 0, errors, warnings };
}
