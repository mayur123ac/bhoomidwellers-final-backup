// lib/ingestion/parseLeadSheet.ts
// Parses an uploaded .xlsx lead sheet into structured rows using fuzzy header matching.
import * as XLSX from "xlsx";
// Type-only deps inside cpCommissionEngine, so importing it here adds no runtime
// weight to the client bundle this parser runs in.
import { isChannelPartnerSource } from "@/lib/cpCommissionEngine";

export interface ParsedLead {
  name: string;
  phone: string;
  alt_phone: string | null;
  external_ref: string | null;
  enquiry_date: string; // ISO string
  source: string | null;
  cp_name: string | null;
  cp_phone: string | null;
  feedback: string | null; // raw remarks text, stored verbatim as a follow-up
  configuration: string | null;
  budget: string | null;
}

export interface ErrorRow {
  rowNum: number;
  errors: string[];
  raw: Record<string, any>;
}

export interface ParseResult {
  validRows: ParsedLead[];
  errorRows: ErrorRow[];
}

// Max data rows (excluding header) accepted in a single import.
export const MAX_IMPORT_ROWS = 500;

// Thrown when a sheet exceeds MAX_IMPORT_ROWS; the API route maps this to a 400.
export class RowCapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RowCapError";
  }
}

// Canonical fields and their accepted header aliases.
// Matching is case-insensitive, whitespace/punctuation-stripped, with Levenshtein <= 2 tolerance.
const FIELD_ALIASES: Record<string, string[]> = {
  name: ["Name", "Client Name", "NAME"],
  phone: ["Contact", "Mobile", "Phone", "CONTACT"],
  external_ref: ["Form No", "Form Number", "Enquiry No"],
  enquiry_date: ["Date", "DATE", "Enquiry Date"],
  source: ["Source", "SOURCE"],
  cp_name: ["Channel Partner", "Chanel Patner", "CP"],
  // Declared AFTER `phone` on purpose: matchHeader breaks fuzzy ties by first
  // occurrence, so an ambiguous header like "Contact No" still resolves to the
  // lead's own phone rather than the partner's.
  cp_phone: ["CP Phone", "CP Contact", "CP Mobile", "Channel Partner Phone", "Channel Partner Contact"],
  feedback: ["Feedback", "FEEDBACK", "Remarks"],
  configuration: ["Prop Type", "Property Type", "Configuration"],
  budget: ["Budget", "BUDGET"],
};

// Normalize a header for comparison: lowercase, strip whitespace & punctuation.
function normalizeHeader(h: string): string {
  return String(h)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// Standard Levenshtein edit distance.
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    let prevDiag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = prev[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      prev[j] = Math.min(
        prev[j] + 1, // deletion
        prev[j - 1] + 1, // insertion
        prevDiag + cost // substitution
      );
      prevDiag = temp;
    }
  }
  return prev[b.length];
}

// Precompute normalized aliases once.
const NORMALIZED_ALIASES: { field: string; norm: string }[] = [];
for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
  for (const alias of aliases) {
    NORMALIZED_ALIASES.push({ field, norm: normalizeHeader(alias) });
  }
}

// Given a raw header cell, return the canonical field it maps to (or null).
function matchHeader(rawHeader: string): string | null {
  const norm = normalizeHeader(rawHeader);
  if (!norm) return null;

  // Exact normalized match wins first.
  for (const { field, norm: aliasNorm } of NORMALIZED_ALIASES) {
    if (aliasNorm === norm) return field;
  }

  // Fuzzy match: Levenshtein <= 2, pick the closest.
  let best: { field: string; dist: number } | null = null;
  for (const { field, norm: aliasNorm } of NORMALIZED_ALIASES) {
    const dist = levenshtein(norm, aliasNorm);
    if (dist <= 2 && (!best || dist < best.dist)) {
      best = { field, dist };
    }
  }
  return best ? best.field : null;
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
};

function buildUTCDate(year: number, month: number, day: number): string | null {
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (!isNaN(d.getTime()) && d.getUTCDate() === day && d.getUTCMonth() === month - 1) {
    return d.toISOString();
  }
  return null;
}

// Parse a date cell (Excel serial, Date object, DD-MM-YYYY, DD/MM/YYYY, or DD-MMM-YYYY)
// into an ISO string. Returns null if unparseable — caller flags the row. Never defaults.
function parseEnquiryDate(value: any): string | null {
  if (value === null || value === undefined || value === "") return null;

  // Already a JS Date (SheetJS can emit these with cellDates).
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString();
  }

  // Excel serial number.
  if (typeof value === "number" && isFinite(value)) {
    const parsed = XLSX.SSF?.parse_date_code
      ? XLSX.SSF.parse_date_code(value)
      : null;
    if (parsed && parsed.y) {
      const d = new Date(
        Date.UTC(parsed.y, (parsed.m || 1) - 1, parsed.d || 1, parsed.H || 0, parsed.M || 0, parsed.S || 0)
      );
      if (!isNaN(d.getTime())) return d.toISOString();
    }
    return null;
  }

  const str = String(value).trim();
  if (!str) return null;

  // DD-MMM-YYYY / DD MMM YYYY (month name, e.g. 24-Dec-2023).
  const mn = str.match(/^(\d{1,2})[-/ ]([A-Za-z]{3,9})[-/ ](\d{2,4})$/);
  if (mn) {
    const [, dd, monName, yyyy] = mn;
    const month = MONTH_NAMES[monName.toLowerCase()];
    if (!month) return null;
    return buildUTCDate(parseInt(yyyy, 10), month, parseInt(dd, 10));
  }

  // DD-MM-YYYY or DD/MM/YYYY (day first; tolerates single-digit day/month, 2-digit year).
  const m = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    return buildUTCDate(parseInt(yyyy, 10), parseInt(mm, 10), parseInt(dd, 10));
  }

  return null;
}

function cellToString(value: any): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

// The phone / alt_phone columns are VARCHAR(20). Lead sheets frequently pack two
// numbers into one cell ("9876543210, 9123456789"), which overflows the column.
// Split explicit multi-number cells into a primary + secondary; strip formatting
// so a single spaced number ("+91 98765 43210") collapses to fit.
function normalizePhones(raw: string): { phone: string; alt: string | null } {
  const s = raw.trim();
  if (!s) return { phone: "", alt: null };

  const parts = s
    .split(/[,/;|&\n\r]+/)
    .map((p) => p.replace(/[^\d+]/g, ""))
    .filter((p) => p.replace(/\D/g, "").length >= 6);

  if (parts.length === 0) {
    // No separator match — clean the whole string (drops spaces/dashes).
    return { phone: s.replace(/[^\d+]/g, ""), alt: null };
  }
  return { phone: parts[0], alt: parts[1] || null };
}

/**
 * Parse an .xlsx buffer into validated lead rows.
 * @param buffer Raw file bytes (ArrayBuffer or Node Buffer)
 */
export function parseLeadSheet(buffer: ArrayBuffer | Buffer): ParseResult {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const validRows: ParsedLead[] = [];
  const errorRows: ErrorRow[] = [];

  if (!sheetName) {
    return { validRows, errorRows };
  }

  const sheet = workbook.Sheets[sheetName];
  // header: 1 => array-of-arrays so we control header-row parsing ourselves.
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: "",
    blankrows: false,
  });

  if (rows.length === 0) {
    return { validRows, errorRows };
  }

  // First non-empty row is the header row.
  const headerRow = rows[0];
  const colMap: (string | null)[] = headerRow.map((h) => matchHeader(cellToString(h)));

  // Enforce the row cap (data rows, excluding the header) before doing any work.
  const dataRowCount = rows.length - 1;
  if (dataRowCount > MAX_IMPORT_ROWS) {
    throw new RowCapError("Please split into files of 500 rows or fewer.");
  }

  for (let i = 1; i < rows.length; i++) {
    const rowNum = i + 1; // 1-indexed, matching spreadsheet row numbers
    const row = rows[i];

    // Build a raw record of matched + unmatched columns for error reporting.
    const raw: Record<string, any> = {};
    const mapped: Record<string, any> = {};
    for (let c = 0; c < headerRow.length; c++) {
      const rawHeader = cellToString(headerRow[c]) || `col${c + 1}`;
      raw[rawHeader] = row[c];
      const field = colMap[c];
      if (field && (mapped[field] === undefined || mapped[field] === "")) {
        mapped[field] = row[c];
      }
    }

    // Skip fully blank rows silently.
    const isBlank = row.every((v) => cellToString(v) === "");
    if (isBlank) continue;

    const errors: string[] = [];

    const name = cellToString(mapped.name);
    const { phone, alt: altPhone } = normalizePhones(cellToString(mapped.phone));
    if (!name) errors.push("Missing required field: name");
    if (!phone) errors.push("Missing required field: phone");

    // enquiry_date must be present and parseable — never guessed or defaulted to today.
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

    // A CP-sourced row must carry the partner's phone. Without it the partner can
    // only be matched on name, which is how the historical 124 unattributed leads
    // happened — and where two partners share a name, name-only matching merges
    // them and pays commission to the wrong person. Flagging the row here (rather
    // than importing it unattributed) is the same contract as the other required
    // fields above: the importer reports it, nothing silently degrades.
    const rowSource = cellToString(mapped.source);
    const cpPhoneRaw = cellToString(mapped.cp_phone);
    if (isChannelPartnerSource(rowSource) && cpPhoneRaw === "") {
      errors.push(`Missing required field: cp_phone (required when source is "${rowSource}")`);
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
      source: rowSource || null,
      cp_name: cellToString(mapped.cp_name) || null,
      cp_phone: cpPhoneRaw || null,
      feedback: cellToString(mapped.feedback) || null,
      configuration: cellToString(mapped.configuration) || null,
      budget: cellToString(mapped.budget) || null,
    });
  }

  return { validRows, errorRows };
}
