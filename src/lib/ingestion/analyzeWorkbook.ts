// lib/ingestion/analyzeWorkbook.ts
// Mapping wizard: workbook analysis, explicit-mapping parse, and value normalization.
import * as XLSX from "xlsx";
import { isChannelPartnerSource } from "@/lib/cpCommissionEngine";
import {
  FIELD_ALIASES,
  NORMALIZED_ALIASES,
  normalizeHeader,
  levenshtein,
  matchHeader,
  parseEnquiryDate,
  normalizePhones,
  cellToString,
  type ParsedLead,
  type ErrorRow,
  MAX_IMPORT_ROWS,
  RowCapError,
} from "./parseLeadSheet";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SheetInfo {
  name: string;
  rowCount: number; // data rows (excluding header)
  isHidden: boolean;
  isEmpty: boolean;
  headers: string[]; // raw header values
}

export interface MappingSuggestion {
  excelColumn: string; // raw Excel header
  excelColumnIndex: number;
  suggestedField: string | null; // CRM field name or null
  confidence: number; // 0-100
  matchType: "exact" | "fuzzy" | "none";
  distance: number; // Levenshtein distance (0 for exact)
  alternatives: { field: string; confidence: number }[]; // other possible matches
}

export interface SheetAnalysis {
  sheet: SheetInfo;
  mappings: MappingSuggestion[];
  unmappedRequired: string[]; // required CRM fields not mapped
  bookingFieldsDetected: boolean; // true if any booking-related columns found
}

export interface WorkbookAnalysis {
  sheets: SheetAnalysis[];
  fileSize: number;
}

export interface ParseWithMappingOptions {
  sheetName: string;
  mapping: Record<string, string>; // { "Excel Header": "crm_field" }
  ignoredColumns?: string[];
}

export interface BookingClaim {
  rowIndex: number; // 1-indexed
  claimedBooked: boolean;
  bookingDate: string | null; // ISO string if parseable
  bookingAmount: number | null;
  bookingAmountRaw: string | null;
  bookingReference: string | null;
  // ── Phase 2 additions ──────────────────────────────────────────────────────
  // OCR amount from the client Excel ("OCR Amount" / "On-Collection Receipt").
  // Distinct from bookingAmount: bookingAmount is the token / booking cheque;
  // ocrAmount is the On-Collection Receipt payment that populates
  // booking_financials.ocr_amount in the CRM.
  ocrAmount: number | null;
  ocrAmountRaw: string | null;
  // Flat / unit identifier as a raw string. null when absent from the sheet.
  // Stored as-is; Phase 5 will decide whether to pre-fill flat_number on the
  // created booking_applications row or mark flatAllocationStatus = PENDING.
  flatNumber: string | null;
  // ── Phase 7 additions ──────────────────────────────────────────────────────
  // Property identity fields used by syncBookingUnit to locate the inventory
  // row for the booked unit. All four are nullable; syncBookingUnit skips
  // gracefully when project_name / tower / flat_number cannot be resolved.
  projectName: string | null;
  tower: string | null;
  wing: string | null;
  floorNumber: string | null;
}

export interface ExtendedParseResult {
  validRows: ParsedLead[];
  errorRows: ErrorRow[];
  bookingClaims: BookingClaim[];
}

// ---------------------------------------------------------------------------
// Value normalization
// ---------------------------------------------------------------------------

const VALUE_NORMALIZATIONS: Record<string, Record<string, string>> = {
  status: {
    ASSIGNED: "Assigned",
    assigned: "Assigned",
    ROUTED: "Routed",
    routed: "Routed",
    NEW: "New",
    new: "New",
  },
  source: {
    "DIRECT WALK-IN": "Direct Walk-in",
    "direct walk-in": "Direct Walk-in",
    "WALK IN": "Direct Walk-in",
    "walk in": "Direct Walk-in",
    WALKIN: "Direct Walk-in",
    CP: "Channel Partner",
    cp: "Channel Partner",
    "CHANNEL PARTNER": "Channel Partner",
  },
  loan_planned: {
    YES: "Yes",
    yes: "Yes",
    NO: "No",
    no: "No",
    Y: "Yes",
    N: "No",
    PENDING: "Pending",
    pending: "Pending",
  },
};

/**
 * Normalize a CRM field value to its canonical form.
 * Returns the original value unchanged if no normalization rule applies.
 */
export function normalizeValue(field: string, value: string): string {
  const fieldMap = VALUE_NORMALIZATIONS[field];
  if (!fieldMap) return value;
  return fieldMap[value] ?? value;
}

// ---------------------------------------------------------------------------
// Indian numeric amount parser
// ---------------------------------------------------------------------------

/**
 * Parse Indian-format numeric amounts:
 *   5000000, 5,000,000, 50,00,000, ₹50,00,000,
 *   50L, 50 Lakh, 50 Lakhs, 5Cr, 5 Crore
 * Returns null if unparseable.
 */
export function parseNumericAmount(raw: string): number | null {
  if (!raw || typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s) return null;

  // Strip currency symbols and leading/trailing whitespace.
  s = s.replace(/^[₹$€£\s]+/, "").replace(/[₹$€£\s]+$/, "").trim();
  if (!s) return null;

  // Check for Lakh / Crore suffix first.
  const lakhMatch = s.match(/^([\d,.]+)\s*(?:L|Lakh|Lakhs)$/i);
  if (lakhMatch) {
    const base = parseFloat(lakhMatch[1].replace(/,/g, ""));
    if (isNaN(base)) return null;
    return base * 100000;
  }

  const croreMatch = s.match(/^([\d,.]+)\s*(?:Cr|Crore|Crores)$/i);
  if (croreMatch) {
    const base = parseFloat(croreMatch[1].replace(/,/g, ""));
    if (isNaN(base)) return null;
    return base * 10000000;
  }

  // Plain number: strip commas (handles both Western 5,000,000 and Indian 50,00,000).
  const cleaned = s.replace(/,/g, "");
  const n = parseFloat(cleaned);
  if (isNaN(n)) return null;
  return n;
}

// ---------------------------------------------------------------------------
// Booking field detection helpers
// ---------------------------------------------------------------------------

const BOOKING_FIELDS = [
  "booking_status",
  "booking_date",
  "booking_amount",
  "booking_reference",
  "ocr_amount",
  "flat_number",
] as const;

function isBookingField(field: string): boolean {
  return (BOOKING_FIELDS as readonly string[]).includes(field);
}

const BOOKING_STATUS_TRUTHY = new Set([
  "yes",
  "y",
  "true",
  "1",
  "booked",
  "confirmed",
]);

// ---------------------------------------------------------------------------
// analyzeWorkbook
// ---------------------------------------------------------------------------

/**
 * Analyze all sheets in a workbook and return mapping suggestions for each.
 */
export function analyzeWorkbook(buffer: Buffer | ArrayBuffer): WorkbookAnalysis {
  const fileSize =
    buffer instanceof ArrayBuffer ? buffer.byteLength : buffer.length;
  const workbook = XLSX.read(buffer, { type: "buffer" });

  const sheets: SheetAnalysis[] = workbook.SheetNames.map((name, idx) => {
    const sheet = workbook.Sheets[name];
    const isHidden = !!(workbook.Workbook?.Sheets?.[idx]?.Hidden);

    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: true,
      defval: "",
      blankrows: false,
    });

    const isEmpty = rows.length === 0;
    const headers: string[] = isEmpty
      ? []
      : (rows[0] as any[]).map((h) => cellToString(h));
    const rowCount = isEmpty ? 0 : rows.length - 1;

    // Build mapping suggestions for each header.
    const mappedFields = new Set<string>();
    const mappings: MappingSuggestion[] = headers.map((rawHeader, colIdx) => {
      const suggestion = buildSuggestion(rawHeader, colIdx, mappedFields);
      if (suggestion.suggestedField) {
        mappedFields.add(suggestion.suggestedField);
      }
      return suggestion;
    });

    // Required CRM fields that have no mapping.
    const requiredFields = ["name", "phone", "enquiry_date"];
    const unmappedRequired = requiredFields.filter((f) => !mappedFields.has(f));

    // Check if any booking-related columns were detected.
    const bookingFieldsDetected = mappings.some(
      (m) => m.suggestedField !== null && isBookingField(m.suggestedField)
    );

    return {
      sheet: { name, rowCount, isHidden, isEmpty, headers },
      mappings,
      unmappedRequired,
      bookingFieldsDetected,
    };
  });

  return { sheets, fileSize };
}

function buildSuggestion(
  rawHeader: string,
  colIdx: number,
  alreadyMapped: Set<string>
): MappingSuggestion {
  const norm = normalizeHeader(rawHeader);

  if (!norm) {
    return {
      excelColumn: rawHeader,
      excelColumnIndex: colIdx,
      suggestedField: null,
      confidence: 0,
      matchType: "none",
      distance: -1,
      alternatives: [],
    };
  }

  // Collect all candidates with their distances.
  const candidates: { field: string; dist: number }[] = [];
  for (const { field, norm: aliasNorm } of NORMALIZED_ALIASES) {
    const dist = levenshtein(norm, aliasNorm);
    if (dist <= 2) {
      candidates.push({ field, dist });
    }
  }

  // Deduplicate: keep best distance per field.
  const bestByField = new Map<string, number>();
  for (const c of candidates) {
    const existing = bestByField.get(c.field);
    if (existing === undefined || c.dist < existing) {
      bestByField.set(c.field, c.dist);
    }
  }

  // Sort by distance.
  const sorted = Array.from(bestByField.entries())
    .map(([field, dist]) => ({ field, dist }))
    .sort((a, b) => a.dist - b.dist);

  // Pick the best that hasn't been mapped yet (to avoid duplicate assignments).
  let best: { field: string; dist: number } | null = null;
  const alternatives: { field: string; confidence: number }[] = [];

  for (const entry of sorted) {
    const conf = distanceToConfidence(entry.dist);
    if (!best && !alreadyMapped.has(entry.field)) {
      best = entry;
    } else {
      alternatives.push({ field: entry.field, confidence: conf });
    }
  }

  if (!best) {
    return {
      excelColumn: rawHeader,
      excelColumnIndex: colIdx,
      suggestedField: null,
      confidence: 0,
      matchType: "none",
      distance: -1,
      alternatives,
    };
  }

  const confidence = distanceToConfidence(best.dist);
  const matchType: "exact" | "fuzzy" | "none" =
    best.dist === 0 ? "exact" : "fuzzy";

  return {
    excelColumn: rawHeader,
    excelColumnIndex: colIdx,
    suggestedField: best.field,
    confidence,
    matchType,
    distance: best.dist,
    alternatives,
  };
}

function distanceToConfidence(dist: number): number {
  if (dist === 0) return 100;
  if (dist === 1) return 90;
  if (dist === 2) return 75;
  return 0;
}

// ---------------------------------------------------------------------------
// parseWithMapping
// ---------------------------------------------------------------------------

/**
 * Parse a specific sheet using an explicit column mapping.
 * Supports booking field extraction in addition to lead fields.
 */
export function parseWithMapping(
  buffer: Buffer | ArrayBuffer,
  options: ParseWithMappingOptions
): ExtendedParseResult {
  const { sheetName, mapping, ignoredColumns } = options;
  const ignoredSet = new Set(ignoredColumns ?? []);

  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    return { validRows: [], errorRows: [], bookingClaims: [] };
  }

  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: "",
    blankrows: false,
  });

  if (rows.length === 0) {
    return { validRows: [], errorRows: [], bookingClaims: [] };
  }

  const headerRow: string[] = (rows[0] as any[]).map((h) => cellToString(h));

  // Build column map from the explicit mapping.
  const colMap: (string | null)[] = headerRow.map((h) => {
    if (ignoredSet.has(h)) return null;
    return mapping[h] ?? null;
  });

  // Enforce the row cap.
  const dataRowCount = rows.length - 1;
  if (dataRowCount > MAX_IMPORT_ROWS) {
    throw new RowCapError("Please split into files of 2,000 rows or fewer.");
  }

  const validRows: ParsedLead[] = [];
  const errorRows: ErrorRow[] = [];
  const bookingClaims: BookingClaim[] = [];

  for (let i = 1; i < rows.length; i++) {
    const rowNum = i + 1; // 1-indexed spreadsheet row
    const row = rows[i];

    // Build raw + mapped records.
    const raw: Record<string, any> = {};
    const mapped: Record<string, any> = {};
    for (let c = 0; c < headerRow.length; c++) {
      const rawHeader = headerRow[c] || `col${c + 1}`;
      raw[rawHeader] = row[c];
      const field = colMap[c];
      if (field && (mapped[field] === undefined || mapped[field] === "")) {
        mapped[field] = row[c];
      }
    }

    // Skip fully blank rows.
    const isBlank = row.every((v) => cellToString(v) === "");
    if (isBlank) continue;

    // ----- Booking claim extraction (before validation, every non-blank row) -----
    const hasAnyBookingField = BOOKING_FIELDS.some(
      (bf) => mapped[bf] !== undefined && mapped[bf] !== ""
    );
    if (hasAnyBookingField) {
      const statusRaw = cellToString(mapped.booking_status).toLowerCase();
      const claimedBooked = BOOKING_STATUS_TRUTHY.has(statusRaw);

      const bookingDateRaw = mapped.booking_date;
      const bookingDate = bookingDateRaw ? parseEnquiryDate(bookingDateRaw) : null;

      const amountRaw = cellToString(mapped.booking_amount);
      const bookingAmount = amountRaw ? parseNumericAmount(amountRaw) : null;

      const bookingReference = cellToString(mapped.booking_reference) || null;

      // Phase 2: OCR amount — the On-Collection Receipt payment.
      // Parsed from whatever the client labelled "OCR Amount", "OCR", etc.
      const ocrRaw = cellToString(mapped.ocr_amount);
      const ocrAmount = ocrRaw ? parseNumericAmount(ocrRaw) : null;

      // Phase 2: Flat number — stored verbatim; never fabricated from other fields.
      const flatNumber = cellToString(mapped.flat_number) || null;

      // Phase 7: Property identity fields for syncBookingUnit.
      // Extracted verbatim from whatever columns the client labelled as
      // project/tower/wing/floor. All four are null when absent or blank.
      const projectName = cellToString(mapped.project_name) || null;
      const tower = cellToString(mapped.tower) || null;
      const wing = cellToString(mapped.wing) || null;
      const floorNumber = cellToString(mapped.floor_number) || null;

      bookingClaims.push({
        rowIndex: rowNum,
        claimedBooked,
        bookingDate,
        bookingAmount,
        bookingAmountRaw: amountRaw || null,
        bookingReference,
        ocrAmount,
        ocrAmountRaw: ocrRaw || null,
        flatNumber,
        projectName,
        tower,
        wing,
        floorNumber,
      });
    }

    // ----- Lead validation (same logic as parseLeadSheet) -----
    const errors: string[] = [];

    const name = cellToString(mapped.name);
    const { phone, alt: altPhone } = normalizePhones(cellToString(mapped.phone));
    if (!name) errors.push("Missing required field: name");
    if (!phone) errors.push("Missing required field: phone");

    let enquiryDateIso: string | null = null;
    const rawDate = cellToString(mapped.enquiry_date);
    if (rawDate === "") {
      errors.push("Missing required field: enquiry_date");
    } else {
      enquiryDateIso = parseEnquiryDate(mapped.enquiry_date);
      if (enquiryDateIso === null) {
        errors.push(`Unparseable enquiry_date: "${rawDate}"`);
      }
    }

    const rowSource = cellToString(mapped.source);
    const cpPhoneRaw = cellToString(mapped.cp_phone);
    if (isChannelPartnerSource(rowSource) && cpPhoneRaw === "") {
      errors.push(
        `Missing required field: cp_phone (required when source is "${rowSource}")`
      );
    }

    if (errors.length > 0) {
      errorRows.push({ rowNum, errors, raw });
      continue;
    }

    validRows.push({
      name,
      phone,
      alt_phone: altPhone,
      external_ref: cellToString(mapped.external_ref) || null,
      enquiry_date: enquiryDateIso as string,
      source: rowSource ? normalizeValue("source", rowSource) : null,
      cp_name: cellToString(mapped.cp_name) || null,
      cp_phone: cpPhoneRaw || null,
      feedback: cellToString(mapped.feedback) || null,
      configuration: cellToString(mapped.configuration) || null,
      budget: cellToString(mapped.budget) || null,
    });
  }

  return { validRows, errorRows, bookingClaims };
}
