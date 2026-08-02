// attendanceWorkbook.ts — the Employee Attendance Register workbook.
//
// ExcelJS, not the `xlsx` already in the bundle: SheetJS community silently
// drops cell fills and freeze panes on write (verified — a fill round-trips as
// patternType "none"). Styling is a SheetJS Pro feature, and colour coding plus
// frozen identity columns are the point of this report.
//
// Sheet 1 Attendance Register — the date-wise matrix, one row per employee
// Sheet 2 Attendance Summary  — per-employee totals
// Sheet 3 Daily Details       — audit-level, one row per employee per day
//
// ── The reconciliation rule ────────────────────────────────────────────────
// `classifyDay()` below is the ONLY place a day is turned into a code, and the
// totals are counted from its output rather than computed separately. That is
// deliberate: the brief's hard requirement is that the register cells and the
// P/A/L columns can never disagree, and the way that breaks is two functions
// each deciding what "present" means.

import ExcelJS from "exceljs";

/* ─────────────────────────── types ─────────────────────────── */

export interface ReportDaily {
  date: string;
  employeeId: number;
  employeeName: string;
  role: string;
  attendanceStatus: string;
  loginTime: string | null;
  logoutTime: string | null;
  punctuality: string;
  lateMinutes: number;
  workedSeconds: number;
  sessionCount: number;
  stillActive: boolean;
}

export interface ReportData {
  from: string;
  to: string;
  totalWorkingDays: number;
  shift: { start: string; end: string; flexible: boolean };
  workingDayBasis: string;
  summary: any[];
  daily: ReportDaily[];
}

type Code = "P" | "A" | "L" | "WO";

/* ─────────────────────────── palette ─────────────────────────── */
// Pastel rather than saturated: a full month of strong red is unreadable, and
// these are the fills Excel itself uses for its Good/Bad/Neutral styles, so they
// look native rather than hand-picked.
const STYLE: Record<Code, { fill: string; font: string }> = {
  P: { fill: "FFC6EFCE", font: "FF006100" },
  L: { fill: "FFFFEB9C", font: "FF9C6500" },
  A: { fill: "FFFFC7CE", font: "FF9C0006" },
  WO: { fill: "FFEDEDED", font: "FF9AA0A6" },
};

const BRAND = "FF9E217B";
const HEADER_FILL = "FF2F3B52";

/* ─────────────────────────── helpers ─────────────────────────── */

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const DAYS_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const asDate = (iso: string) => new Date(`${iso}T00:00:00`);
const isSunday = (iso: string) => asDate(iso).getDay() === 0;

function longDate(iso: string): string {
  const d = asDate(iso);
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
function shortDate(iso: string): string {
  const d = asDate(iso);
  return `${String(d.getDate()).padStart(2, "0")}-${MONTHS[d.getMonth()].slice(0, 3)}-${d.getFullYear()}`;
}
/** "11:00" → "11:00 AM". The shift is stored 24h; HR reads 12h. */
function to12h(hhmm: string): string {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  if (!Number.isFinite(h)) return hhmm || "—";
  const ampm = h >= 12 ? "PM" : "AM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m || 0).padStart(2, "0")} ${ampm}`;
}
function hm(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}
function clockTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Whether a late arrival gets its own cell code.
 *
 * OFF for now, by decision: someone who was late was still present, and a wall
 * of amber made the register read as though half the office had a problem. The
 * cell shows P; lateness is still counted in the "Late" summary column, still
 * carried on the Daily Details sheet, and still visible there as Punctuality and
 * Late Duration — nothing is lost, it just stops competing with A for attention.
 *
 * This is the seam for the planned setting. When organization_settings grows a
 * "count late separately" flag, thread it in as an argument to
 * buildAttendanceWorkbook and pass it here — the L code, its palette entry and
 * its legend row are all still wired up and will light back up unchanged.
 */
const LATE_AS_DISTINCT_CODE = false;

/**
 * The single source of truth for what a day means.
 *
 * `counts` is false for every Sunday — including a Sunday somebody actually
 * worked. That day still shows its real code because hiding genuine weekend work
 * would be a lie, but it stays out of Present/Absent/% so the columns match the
 * stated rule that weekly offs are excluded. The legend carries a footnote
 * saying exactly that.
 *
 * `late` is returned separately from `code` on purpose: the Late column must
 * keep counting late days even while they render as P.
 *
 * "Pending" (a session is open but attendance was never marked) classifies as A.
 * It is not a Present in the API's summary either, and the register must agree
 * with the totals above all else.
 */
function classifyDay(row: ReportDaily): { code: Code; counts: boolean; sunday: boolean; late: boolean } {
  const sunday = isSunday(row.date);
  const present = /present/i.test(row.attendanceStatus);
  const late = present && row.lateMinutes > 0;

  if (present) {
    return { code: late && LATE_AS_DISTINCT_CODE ? "L" : "P", counts: !sunday, sunday, late };
  }
  if (sunday) return { code: "WO", counts: false, sunday, late: false };
  return { code: "A", counts: true, sunday, late: false };
}

/* ─────────────────────────── builder ─────────────────────────── */

export async function buildAttendanceWorkbook(d: ReportData): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Bhoomi Dwellers CRM";
  wb.created = new Date();

  // Ordered day list for the matrix columns. Built from the range, so a
  // 25 Jul → 05 Aug export crosses the month boundary without special-casing.
  const dates = Array.from(new Set(d.daily.map((r) => r.date))).sort();

  // employeeId → date → row
  const byEmp = new Map<number, { name: string; role: string; days: Map<string, ReportDaily> }>();
  for (const r of d.daily) {
    if (!byEmp.has(r.employeeId)) byEmp.set(r.employeeId, { name: r.employeeName, role: r.role, days: new Map() });
    byEmp.get(r.employeeId)!.days.set(r.date, r);
  }
  const employees = [...byEmp.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));

  /* ══════════════ SHEET 1 — ATTENDANCE REGISTER ══════════════ */
  const ws = wb.addWorksheet("Attendance Register", {
    views: [{ state: "frozen", xSplit: 3, ySplit: 12 }],   // identity cols + both header rows
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const IDENT = 3;                       // Employee, ID, Role
  const SUMMARY_COLS = 6;                // P, A, L, Hours, Avg, %
  const lastCol = IDENT + dates.length + SUMMARY_COLS;

  const titleRow = (text: string, size: number, bold: boolean, color: string, height?: number) => {
    const r = ws.addRow([text]);
    ws.mergeCells(r.number, 1, r.number, lastCol);
    r.getCell(1).font = { name: "Calibri", size, bold, color: { argb: color } };
    r.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
    if (height) r.height = height;
    return r;
  };

  titleRow("BHOOMI DWELLERS", 16, true, BRAND, 22);
  titleRow("EMPLOYEE ATTENDANCE REGISTER", 12, true, "FF2F3B52", 18);
  titleRow(`Period:  ${longDate(d.from)}  –  ${longDate(d.to)}`, 10, false, "FF444444");
  titleRow(
    `Shift:  ${d.shift.flexible ? "Flexible" : `${to12h(d.shift.start)} – ${to12h(d.shift.end)}`}`,
    10, false, "FF444444"
  );
  titleRow(`Generated:  ${new Date().toLocaleString("en-IN", { dateStyle: "long", timeStyle: "short" })}`, 10, false, "FF444444");
  titleRow(`Working Days:  ${d.totalWorkingDays}    ·    ${d.workingDayBasis}`, 10, false, "FF444444");
  ws.addRow([]);

  // Legend — the reader must be able to decode the sheet without asking anyone.
  const legend = ws.addRow(["Legend:"]);
  legend.getCell(1).font = { bold: true, size: 9 };
  let lc = 2;
  // The L swatch only appears when late days are actually rendered as L —
  // a legend entry for a code that never occurs is just noise.
  const legendEntries: [Code, string][] = [
    ["P", LATE_AS_DISTINCT_CODE ? "Present" : "Present (includes late arrivals)"],
    ...(LATE_AS_DISTINCT_CODE ? ([["L", "Late (counts as present)"]] as [Code, string][]) : []),
    ["A", "Absent / not marked"],
    ["WO", "Weekly Off (Sunday) — excluded"],
  ];
  for (const [code, label] of legendEntries) {
    const c = legend.getCell(lc);
    c.value = code;
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: STYLE[code].fill } };
    c.font = { bold: true, size: 9, color: { argb: STYLE[code].font } };
    c.alignment = { horizontal: "center" };
    c.border = thin();
    const t = legend.getCell(lc + 1);
    t.value = label;
    t.font = { size: 9, color: { argb: "FF666666" } };
    lc += 4;
  }

  const note = ws.addRow([
    "A Sunday cell showing P or L means the employee worked a weekly off — recorded for visibility, excluded from Present / Absent / Attendance %.",
  ]);
  ws.mergeCells(note.number, 1, note.number, lastCol);
  note.getCell(1).font = { size: 9, italic: true, color: { argb: "FF888888" } };
  ws.addRow([]);

  // ── Two header rows: day number over day name ──
  const h1: (string | number)[] = ["Employee", "ID", "Role"];
  const h2: (string | number)[] = ["", "", ""];
  for (const iso of dates) {
    const dt = asDate(iso);
    h1.push(String(dt.getDate()).padStart(2, "0"));
    h2.push(DAYS_SHORT[dt.getDay()]);
  }
  // "Late" spelled out rather than "L": with LATE_AS_DISTINCT_CODE off there is
  // no L cell anywhere, so a bare "L" header would point at a code that does not
  // appear in the grid. It reads as "of which late".
  h1.push("P", "A", "Late", "Working Hours", "Avg. Hours", "Attendance %");
  h2.push("", "", "", "", "", "");

  const r1 = ws.addRow(h1);
  const r2 = ws.addRow(h2);
  r1.height = 18;
  r2.height = 15;

  for (let c = 1; c <= lastCol; c++) {
    for (const r of [r1, r2]) {
      const cell = r.getCell(c);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
      cell.font = { bold: true, size: c > IDENT && c <= IDENT + dates.length ? 9 : 10, color: { argb: "FFFFFFFF" } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = thin("FF1F2937");
    }
    // Identity and summary headers span both rows; only the date columns differ.
    if (c <= IDENT || c > IDENT + dates.length) ws.mergeCells(r1.number, c, r2.number, c);
  }
  // Sunday headers tinted so the weekly-off columns read as a block.
  dates.forEach((iso, i) => {
    if (!isSunday(iso)) return;
    for (const r of [r1, r2]) {
      r.getCell(IDENT + 1 + i).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4B5563" } };
    }
  });

  // ── Employee rows ──
  employees.forEach(([empId, emp], idx) => {
    const values: (string | number)[] = [emp.name, empId, emp.role];
    let present = 0, absent = 0, late = 0, worked = 0, daysWorked = 0;
    const codes: { code: Code; sunday: boolean }[] = [];

    for (const iso of dates) {
      const row = emp.days.get(iso);
      if (!row) { values.push("—"); codes.push({ code: "WO", sunday: isSunday(iso) }); continue; }
      const cls = classifyDay(row);
      values.push(cls.code);
      codes.push({ code: cls.code, sunday: cls.sunday });
      if (cls.counts) {
        if (cls.code === "A") absent++;
        // Counted off `cls.late`, not the rendered code: with LATE_AS_DISTINCT_CODE
        // off the cell reads P, and reading the code would silently zero this column.
        else { present++; if (cls.late) late++; }
      }
      // Hours follow the day, not the count: time worked on a Sunday is still
      // time worked, and the Working Hours column is a duration, not a rate.
      if (row.workedSeconds > 0) { worked += row.workedSeconds; daysWorked++; }
    }

    const pct = d.totalWorkingDays > 0 ? present / d.totalWorkingDays : 0;
    values.push(present, absent, late, hm(worked), daysWorked ? hm(Math.round(worked / daysWorked)) : "—", pct);

    const row = ws.addRow(values);
    row.height = 16;

    const zebra = idx % 2 === 1 ? "FFF7F8FA" : undefined;
    for (let c = 1; c <= lastCol; c++) {
      const cell = row.getCell(c);
      cell.border = thin();
      if (c <= IDENT) {
        cell.font = { size: 10, bold: c === 1 };
        cell.alignment = { horizontal: c === 2 ? "center" : "left", vertical: "middle" };
        if (zebra) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: zebra } };
      } else if (c <= IDENT + dates.length) {
        const { code, sunday } = codes[c - IDENT - 1];
        // A worked Sunday keeps the grey weekly-off backdrop while showing its
        // real code, so "does not count" is visible at a glance.
        const fillCode: Code = sunday ? "WO" : code;
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: STYLE[fillCode].fill } };
        cell.font = { bold: true, size: 10, color: { argb: STYLE[code].font } };
        cell.alignment = { horizontal: "center", vertical: "middle" };
      } else {
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.font = { size: 10, bold: c === lastCol };
        if (zebra) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: zebra } };
        if (c === lastCol) cell.numFmt = "0.0%";
      }
    }
  });

  ws.getColumn(1).width = 22;
  ws.getColumn(2).width = 6;
  ws.getColumn(3).width = 18;
  for (let i = 0; i < dates.length; i++) ws.getColumn(IDENT + 1 + i).width = 4.5;  // compact: 31 cols must fit
  ["P", "A", "L", "Working Hours", "Avg. Hours", "Attendance %"].forEach((_, i) => {
    ws.getColumn(IDENT + dates.length + 1 + i).width = i < 3 ? 5.5 : 14;
  });
  ws.autoFilter = { from: { row: r1.number, column: 1 }, to: { row: r1.number, column: IDENT } };

  /* ══════════════ SHEET 2 — ATTENDANCE SUMMARY ══════════════ */
  const s2 = wb.addWorksheet("Attendance Summary", { views: [{ state: "frozen", ySplit: 8 }] });
  const s2cols = 10;
  const s2title = (text: string, size: number, bold: boolean, color: string) => {
    const r = s2.addRow([text]);
    s2.mergeCells(r.number, 1, r.number, s2cols);
    r.getCell(1).font = { size, bold, color: { argb: color } };
    r.getCell(1).alignment = { horizontal: "center" };
  };
  s2title("BHOOMI DWELLERS", 14, true, BRAND);
  s2title("ATTENDANCE SUMMARY", 11, true, "FF2F3B52");
  s2title(`${longDate(d.from)} – ${longDate(d.to)}`, 10, false, "FF444444");
  s2title(`Working Days: ${d.totalWorkingDays}  ·  ${d.workingDayBasis}`, 9, false, "FF666666");
  s2.addRow([]);

  const s2head = s2.addRow([
    "Employee Name", "Employee ID", "Role / Department", "Total Working Days",
    "Present Days", "Absent Days", "Late Days", "Total Working Hours",
    "Average Working Hours", "Attendance %",
  ]);
  styleHeader(s2head, s2cols);

  for (const s of d.summary) {
    const r = s2.addRow([
      s.employeeName, s.employeeId, s.role, s.totalWorkingDays,
      s.presentDays, s.absentDays, s.lateDays,
      hm(s.totalWorkedSeconds), hm(s.averageWorkedSeconds), s.attendancePercent / 100,
    ]);
    for (let c = 1; c <= s2cols; c++) {
      const cell = r.getCell(c);
      cell.border = thin();
      cell.alignment = { horizontal: c === 1 || c === 3 ? "left" : "center" };
      if (c === s2cols) { cell.numFmt = "0.0%"; cell.font = { bold: true }; }
    }
  }
  [22, 12, 20, 17, 13, 12, 11, 18, 20, 14].forEach((w, i) => (s2.getColumn(i + 1).width = w));
  s2.autoFilter = { from: { row: s2head.number, column: 1 }, to: { row: s2head.number, column: s2cols } };

  /* ══════════════ SHEET 3 — DAILY DETAILS ══════════════ */
  const s3 = wb.addWorksheet("Daily Details", { views: [{ state: "frozen", ySplit: 1 }] });
  const s3cols = 12;
  const s3head = s3.addRow([
    "Date", "Day", "Employee", "Employee ID", "Role", "Attendance",
    "First Login", "Last Logout", "Punctuality", "Late Duration",
    "Working Hours", "Session Count",
  ]);
  styleHeader(s3head, s3cols);

  const sortedDaily = [...d.daily].sort(
    (a, b) => a.date.localeCompare(b.date) || a.employeeName.localeCompare(b.employeeName)
  );
  for (const r of sortedDaily) {
    const { code } = classifyDay(r);
    const label = code === "P" ? "Present" : code === "L" ? "Late" : code === "WO" ? "Weekly Off" : "Absent";
    const row = s3.addRow([
      shortDate(r.date),
      DAYS_FULL[asDate(r.date).getDay()],
      r.employeeName,
      r.employeeId,
      r.role,
      label,
      clockTime(r.loginTime),
      r.stillActive ? "Still Active" : clockTime(r.logoutTime),
      r.punctuality,
      r.lateMinutes > 0 ? hm(r.lateMinutes * 60) : "—",
      r.workedSeconds > 0 ? hm(r.workedSeconds) : "—",
      r.sessionCount,
    ]);
    for (let c = 1; c <= s3cols; c++) {
      const cell = row.getCell(c);
      cell.border = thin();
      cell.alignment = { horizontal: c === 3 || c === 5 ? "left" : "center" };
      cell.font = { size: 10 };
      if (c === 6) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: STYLE[code].fill } };
        cell.font = { size: 10, bold: true, color: { argb: STYLE[code].font } };
      }
    }
  }
  [13, 12, 20, 12, 18, 12, 12, 13, 14, 13, 13, 13].forEach((w, i) => (s3.getColumn(i + 1).width = w));
  s3.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s3cols } };

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  /* ── local style helpers ── */
  function thin(color = "FFD1D5DB"): ExcelJS.Borders {
    const s = { style: "thin" as const, color: { argb: color } };
    return { top: s, left: s, bottom: s, right: s } as ExcelJS.Borders;
  }
  function styleHeader(row: ExcelJS.Row, cols: number) {
    row.height = 20;
    for (let c = 1; c <= cols; c++) {
      const cell = row.getCell(c);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
      cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = thin("FF1F2937");
    }
  }
}

/** Filename: month form when the range is exactly one calendar month. */
export function attendanceFilename(from: string, to: string): string {
  const wholeMonth = from.slice(8) === "01" && from.slice(0, 7) === to.slice(0, 7);
  if (wholeMonth) return `Attendance_Register_${MONTHS[Number(from.slice(5, 7)) - 1]}_${from.slice(0, 4)}.xlsx`;
  return `Attendance_Register_${shortDate(from)}_to_${shortDate(to)}.xlsx`;
}
