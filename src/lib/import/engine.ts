// lib/import/engine.ts
// Core staged import engine. Wraps the existing bulk-insert path with staging
// tables (import_jobs, import_rows, import_errors) so every import can be
// previewed before commit and rolled back after.

import * as crypto from "crypto";
import type { PoolClient } from "pg";
import { query, transaction, recalculateSrNos } from "@/lib/db";
import { parseLeadSheet } from "@/lib/ingestion/parseLeadSheet";
import type { ParsedLead } from "@/lib/ingestion/parseLeadSheet";
import type { BookingClaim } from "@/lib/ingestion/analyzeWorkbook";
import { createImportBooking } from "./createImportBooking";
import { isChannelPartnerSource, resolveChannelPartnerId } from "@/lib/cpCommissionEngine";
import { runDedup, getMergeFields } from "./dedup";
import type {
  ImportJob,
  ImportRow,
  ImportError,
  ImportStatus,
  ImportTemplate,
  StageResult,
  CommitResult,
  RollbackResult,
} from "./types";
import { VALID_TRANSITIONS } from "./types";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Clamp a string to a VARCHAR limit. Copied locally from bulkInsertLeads. */
const clamp = (val: string | null, max: number): string | null =>
  val == null ? null : val.length > max ? val.slice(0, max) : val;

/**
 * Validate and execute a status transition. Throws if the transition is not
 * allowed by VALID_TRANSITIONS. Must be called with a transaction client so the
 * UPDATE is atomic with surrounding writes.
 */
export async function transitionStatus(
  client: PoolClient,
  jobId: string,
  from: ImportStatus,
  to: ImportStatus
): Promise<void> {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new Error(
      `Invalid import status transition: "${from}" -> "${to}". ` +
        `Allowed transitions from "${from}": [${(allowed || []).join(", ")}]`
    );
  }

  const res = await client.query(
    `UPDATE import_jobs
        SET status = $1, updated_at = now()
      WHERE id = $2 AND status = $3
      RETURNING id`,
    [to, jobId, from]
  );

  if (res.rows.length === 0) {
    throw new Error(
      `Status transition failed: import_jobs row ${jobId} is no longer in status "${from}".`
    );
  }
}

// ── Stage ────────────────────────────────────────────────────────────────────

export interface StageImportParams {
  buffer: Buffer;
  filename: string;
  orgId: string;
  uploadedById: number;
  uploadedByName: string;
  assignedTo: string;
  overseeingSiteHead: string | null;
  // Phase 2 additions:
  sheetName?: string;          // which sheet to process (default: first)
  mapping?: Record<string, string>;  // confirmed column mapping
  templateId?: string;         // template used, for provenance
}

/**
 * Parse an xlsx buffer, stage its rows into import_rows, and leave the job in
 * `ready_for_review` status so the user can preview before committing.
 */
export async function stageImport(params: StageImportParams): Promise<StageResult> {
  const stageStart = Date.now();
  const {
    buffer,
    filename,
    orgId,
    uploadedById,
    uploadedByName,
    assignedTo,
    overseeingSiteHead,
  } = params;

  // 1. Compute file hash for idempotency check
  const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");

  // 2. Duplicate check — reject if an identical file was already imported
  const dupeRows = await query<{ id: string; status: string }>(
    `SELECT id, status FROM import_jobs
      WHERE file_hash = $1 AND organization_id = $2
        AND status IN ('completed', 'ready_for_review')
      LIMIT 1`,
    [fileHash, orgId]
  );
  if (dupeRows.length > 0) {
    const dupe = dupeRows[0];
    throw new Error(
      `Duplicate file: this file has already been imported (job ${dupe.id}, status "${dupe.status}"). ` +
        `Upload a different file or cancel the existing import first.`
    );
  }

  // 3. Parse — if explicit mapping provided, use parseWithMapping; otherwise fall back
  let validRows: ParsedLead[];
  let errorRows: { rowNum: number; errors: string[]; raw: Record<string, any> }[];
  let bookingClaims: BookingClaim[] = [];
  let sheetName: string;

  if (params.mapping && params.sheetName) {
    const { parseWithMapping } = await import("@/lib/ingestion/analyzeWorkbook");
    const result = await parseWithMapping(buffer, {
      sheetName: params.sheetName,
      mapping: params.mapping,
    });
    validRows = result.validRows;
    errorRows = result.errorRows;
    bookingClaims = result.bookingClaims || [];
    sheetName = params.sheetName;
  } else {
    const parsed = parseLeadSheet(buffer);
    validRows = parsed.validRows;
    errorRows = parsed.errorRows;
    // Detect sheet name from workbook
    const XLSX = await import("xlsx");
    const wb = XLSX.read(buffer, { type: "buffer" });
    sheetName = wb.SheetNames[0] || "Sheet1";
  }

  const totalRows = validRows.length + errorRows.length;

  // Build auto-detected column mapping from header row (used when no explicit mapping)
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const autoSheet = workbook.Sheets[sheetName];
  const autoRows: any[][] = autoSheet
    ? XLSX.utils.sheet_to_json(autoSheet, { header: 1, raw: true, defval: "", blankrows: false })
    : [];
  const headerRow = autoRows.length > 0 ? autoRows[0] : [];
  const autoDetectedMapping: Record<string, string> = {};
  for (let c = 0; c < headerRow.length; c++) {
    const rawHeader = String(headerRow[c] ?? "").trim();
    if (rawHeader) {
      autoDetectedMapping[`col_${c}`] = rawHeader;
    }
  }

  // Use explicit mapping if provided, otherwise auto-detected
  const columnMapping = params.mapping || autoDetectedMapping;

  // Build a lookup from rowNum -> bookingClaim for merging into normalized_data
  const bookingByRow = new Map<number, typeof bookingClaims[0]>();
  for (const bc of bookingClaims) {
    bookingByRow.set(bc.rowIndex, bc);
  }

  // 4. Transaction: create job + rows + errors
  return transaction(async (client) => {
    // 4a. INSERT import_jobs (with optional template_id)
    const jobRes = await client.query(
      `INSERT INTO import_jobs (
          organization_id, uploaded_by_id, uploaded_by_name, filename,
          file_hash, file_size_bytes, import_type, target_entity,
          status, total_rows, valid_rows, invalid_rows,
          created_rows, updated_rows, skipped_rows, failed_rows,
          sheet_name, column_mapping, assigned_to, overseeing_site_head,
          template_id
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7, $8,
          'parsing', $9, $10, $11,
          0, 0, 0, 0,
          $12, NULL, NULL, NULL,
          $13
        ) RETURNING id`,
      [
        orgId,                         // $1
        uploadedById,                  // $2
        uploadedByName,                // $3
        filename,                      // $4
        fileHash,                      // $5
        buffer.length,                 // $6
        "lead_import",                 // $7
        "walkin_enquiries",            // $8
        totalRows,                     // $9
        validRows.length,             // $10
        errorRows.length,             // $11
        sheetName,                     // $12
        params.templateId || null,     // $13
      ]
    );
    const jobId: string = jobRes.rows[0].id;

    // 4b. INSERT valid rows into import_rows
    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      const rowNum = i + 1;

      // Merge booking claim fields into normalized_data if present.
      // Keys prefixed with _ are internal — never written to walkin_enquiries.
      // Phase 5 reads them to create a booking_applications record on commit.
      const normalizedData: Record<string, any> = { ...row };
      const bc = bookingByRow.get(rowNum);
      if (bc) {
        normalizedData._booking_status = bc.claimedBooked ?? null;
        normalizedData._booking_date = bc.bookingDate ?? null;
        normalizedData._booking_amount = bc.bookingAmount ?? null;
        normalizedData._booking_amount_raw = bc.bookingAmountRaw ?? null;
        normalizedData._booking_reference = bc.bookingReference ?? null;
        // Phase 2: OCR amount and flat number from the client Excel.
        // ocrAmount is the On-Collection Receipt value → booking_financials.ocr_amount.
        // flatNumber is the unit identifier → booking_applications.flat_number.
        // Both are null when the column was absent or the cell was blank.
        normalizedData._ocr_amount = bc.ocrAmount ?? null;
        normalizedData._ocr_amount_raw = bc.ocrAmountRaw ?? null;
        normalizedData._flat_number = bc.flatNumber ?? null;
        // Phase 7: Property identity → syncBookingUnit.
        // All four are null when the column was absent or the cell was blank.
        normalizedData._project_name = bc.projectName ?? null;
        normalizedData._tower = bc.tower ?? null;
        normalizedData._wing = bc.wing ?? null;
        normalizedData._floor_number = bc.floorNumber ?? null;
      }

      await client.query(
        `INSERT INTO import_rows (
            import_job_id, organization_id, source_row_number, source_sheet,
            raw_data, normalized_data, validation_status, proposed_action,
            final_action, matched_record_id, target_record_id, warnings, errors
          ) VALUES (
            $1, $2, $3, $4,
            $5, $6, 'valid', 'create',
            NULL, NULL, NULL, '{}', '{}'
          )`,
        [
          jobId,                                // $1
          orgId,                                // $2
          rowNum,                               // $3  source_row_number (1-indexed within valid batch)
          sheetName,                            // $4
          JSON.stringify(row),                  // $5  raw_data
          JSON.stringify(normalizedData),        // $6  normalized_data
        ]
      );
    }

    // 4c. INSERT error rows into import_rows
    for (const errRow of errorRows) {
      const importRowRes = await client.query(
        `INSERT INTO import_rows (
            import_job_id, organization_id, source_row_number, source_sheet,
            raw_data, normalized_data, validation_status, proposed_action,
            final_action, matched_record_id, target_record_id, warnings, errors
          ) VALUES (
            $1, $2, $3, $4,
            $5, NULL, 'invalid', 'error',
            NULL, NULL, NULL, '{}', $6
          ) RETURNING id`,
        [
          jobId,                            // $1
          orgId,                            // $2
          errRow.rowNum,                    // $3  source_row_number (from parser, spreadsheet row)
          sheetName,                        // $4
          JSON.stringify(errRow.raw),       // $5  raw_data
          JSON.stringify(errRow.errors),    // $6  errors as JSON array
        ]
      );
      const importRowId: string = importRowRes.rows[0].id;

      // 4d. INSERT individual errors into import_errors
      for (const errMsg of errRow.errors) {
        await client.query(
          `INSERT INTO import_errors (
              import_job_id, import_row_id, organization_id, source_row_number, source_field,
              error_code, error_message, severity,
              original_value, normalized_value
            ) VALUES (
              $1, $2, $3, $4, NULL,
              'VALIDATION_ERROR', $5, 'error',
              NULL, NULL
            )`,
          [
            jobId,             // $1
            importRowId,       // $2
            orgId,             // $3
            errRow.rowNum,     // $4
            errMsg,            // $5
          ]
        );
      }
    }

    // 4e. Run deduplication engine on valid rows
    const dedupResults = await runDedup(jobId, orgId, client);
    const dedupSummary = {
      creates: dedupResults.filter((r) => r.proposedAction === "create").length,
      updates: dedupResults.filter((r) => r.proposedAction === "update").length,
      skips: dedupResults.filter((r) => r.proposedAction === "skip").length,
      manualReview: dedupResults.filter((r) => r.proposedAction === "manual_review").length,
    };

    // 4f. Transition to ready_for_review
    await transitionStatus(client, jobId, "parsing", "ready_for_review");

    // 4g. UPDATE with column_mapping, assigned_to, overseeing_site_head
    await client.query(
      `UPDATE import_jobs
          SET column_mapping = $1,
              assigned_to = $2,
              overseeing_site_head = $3,
              updated_at = now()
        WHERE id = $4`,
      [
        JSON.stringify(columnMapping),  // $1
        assignedTo,                     // $2
        overseeingSiteHead,             // $3
        jobId,                          // $4
      ]
    );

    const stageElapsed = Date.now() - stageStart;
    console.log(
      `[import:stage] job=${jobId} file="${filename}" rows=${totalRows} valid=${validRows.length} invalid=${errorRows.length} dedup=${JSON.stringify(dedupSummary)} elapsed=${stageElapsed}ms`
    );

    return {
      jobId,
      totalRows,
      validRows: validRows.length,
      invalidRows: errorRows.length,
      sheetName,
      dedupSummary,
    };
  });
}

// ── Read ─────────────────────────────────────────────────────────────────────

/** Fetch a single import job by id, scoped to organization. */
export async function getImportJob(
  jobId: string,
  orgId: string
): Promise<ImportJob | null> {
  const rows = await query<ImportJob>(
    `SELECT * FROM import_jobs WHERE id = $1 AND organization_id = $2`,
    [jobId, orgId]
  );
  return rows.length > 0 ? rows[0] : null;
}

export interface PreviewOptions {
  limit?: number;
  offset?: number;
  filter?: "all" | "valid" | "invalid";
}

/** Fetch staged rows for preview, with pagination and optional filter. */
export async function getImportPreview(
  jobId: string,
  orgId: string,
  opts?: PreviewOptions
): Promise<{ rows: ImportRow[]; total: number }> {
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;
  const filter = opts?.filter ?? "all";

  let filterClause = "";
  const params: any[] = [jobId, orgId];

  if (filter === "valid") {
    filterClause = " AND validation_status = 'valid'";
  } else if (filter === "invalid") {
    filterClause = " AND validation_status = 'invalid'";
  }

  const countRes = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM import_rows
      WHERE import_job_id = $1 AND organization_id = $2${filterClause}`,
    params
  );
  const total = parseInt(countRes[0]?.count || "0", 10);

  const rows = await query<ImportRow>(
    `SELECT * FROM import_rows
      WHERE import_job_id = $1 AND organization_id = $2${filterClause}
      ORDER BY source_row_number ASC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  return { rows, total };
}

/** Fetch all errors for a job, ordered by row number. */
export async function getImportErrors(
  jobId: string,
  orgId: string
): Promise<ImportError[]> {
  return query<ImportError>(
    `SELECT ie.* FROM import_errors ie
      INNER JOIN import_jobs ij ON ij.id = ie.import_job_id
      WHERE ie.import_job_id = $1 AND ij.organization_id = $2
      ORDER BY ie.source_row_number ASC, ie.id ASC`,
    [jobId, orgId]
  );
}

/** Fetch import history for an organization, newest first. */
export async function getImportHistory(
  orgId: string,
  opts?: { limit?: number; offset?: number }
): Promise<ImportJob[]> {
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;
  return query<ImportJob>(
    `SELECT * FROM import_jobs
      WHERE organization_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
    [orgId, limit, offset]
  );
}

// ── Commit ───────────────────────────────────────────────────────────────────

/**
 * Commit all valid staged rows into walkin_enquiries. Mirrors the INSERT logic
 * from bulkInsertLeads but tracks per-row outcomes and sets import_job_id on
 * every created lead for rollback traceability.
 */
export async function commitImport(
  jobId: string,
  orgId: string,
  committedByName: string
): Promise<CommitResult> {
  // 1. Verify the job exists and is ready
  const job = await getImportJob(jobId, orgId);
  if (!job) {
    throw new Error(`Import job ${jobId} not found for this organization.`);
  }
  if (job.status !== "ready_for_review") {
    throw new Error(
      `Import job ${jobId} is in status "${job.status}" — only "ready_for_review" jobs can be committed.`
    );
  }

  const startTime = Date.now();

  // 2–3. Transition + insert inside a single transaction
  return transaction(async (client) => {
    // 2a. Advisory lock to prevent concurrent commits of the same job
    // Uses a hash of the jobId as the lock key
    const lockKey = Math.abs(jobId.split("").reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0));
    await client.query(`SELECT pg_advisory_xact_lock($1)`, [lockKey]);

    // 2b. Transition to committing (will fail if another process already transitioned)
    await transitionStatus(client, jobId, "ready_for_review", "committing");

    // 3a. Fetch all valid staged rows
    const stagedRes = await client.query(
      `SELECT * FROM import_rows
        WHERE import_job_id = $1 AND organization_id = $2 AND validation_status = 'valid'
        ORDER BY source_row_number ASC`,
      [jobId, orgId]
    );
    const stagedRows = stagedRes.rows as ImportRow[];

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    let rowIdx = 0;

    for (const staged of stagedRows) {
      // Each row runs under its own SAVEPOINT so a Postgres-level error
      // (FK violation, constraint, type mismatch) rolls back only that row.
      // Without a SAVEPOINT the first error puts the whole transaction into an
      // aborted state; the catch block's UPDATE/INSERT then fail with
      // "current transaction is aborted, commands ignored until end of
      // transaction block" and every subsequent row is silently dropped.
      rowIdx++;
      const sp = `sp${rowIdx}`;
      await client.query(`SAVEPOINT ${sp}`);
      try {
        // 3b. Determine effective action (user override takes precedence)
        const action = staged.user_override_action || staged.proposed_action || "create";

        // 3b2. Skip / manual_review rows are not committed
        if (action === "skip" || action === "manual_review") {
          skipped++;
          await client.query(
            `UPDATE import_rows SET final_action = 'skipped', updated_at = now()
              WHERE id = $1`,
            [staged.id]
          );
          await client.query(`RELEASE SAVEPOINT ${sp}`);
          continue;
        }

        // 3b3. Reconstruct a ParsedLead from normalized_data
        const data: ParsedLead =
          typeof staged.normalized_data === "string"
            ? JSON.parse(staged.normalized_data as string)
            : staged.normalized_data;

        const rowSource = clamp(data.source || "Direct Walk-in", 100);

        // ── UPDATE path ─────────────────────────────────────────────
        if (action === "update" && staged.matched_record_id) {
          // 3u1. Fetch existing record (scoped to org)
          const existingRes = await client.query(
            `SELECT * FROM walkin_enquiries WHERE id = $1 AND organization_id = $2`,
            [staged.matched_record_id, orgId]
          );
          if (existingRes.rows.length === 0) {
            // Matched record gone — fall through to create
          } else {
            const existing = existingRes.rows[0];

            // 3u2. Save pre-update snapshot for rollback
            await client.query(
              `UPDATE import_rows SET pre_update_snapshot = $1, updated_at = now()
                WHERE id = $2`,
              [JSON.stringify(existing), staged.id]
            );

            // 3u3. Compute merge fields
            const mergeFields = getMergeFields(
              existing,
              data,
              job.assigned_to || "",
              job.overseeing_site_head || null
            );

            // 3u4. Execute UPDATE if there are fields to change
            const fieldNames = Object.keys(mergeFields);
            if (fieldNames.length > 0) {
              const setClauses = fieldNames
                .map((f, i) => `"${f}" = $${i + 3}`)
                .join(", ");
              const values = fieldNames.map((f) => mergeFields[f]);
              await client.query(
                `UPDATE walkin_enquiries SET ${setClauses}, updated_at = now()
                  WHERE id = $1 AND organization_id = $2`,
                [staged.matched_record_id, orgId, ...values]
              );
            }

            // 3u5. Mark row as updated
            updated++;
            await client.query(
              `UPDATE import_rows
                  SET final_action = 'updated', target_record_id = $1, updated_at = now()
                WHERE id = $2`,
              [staged.matched_record_id, staged.id]
            );

            // 3u6. Historical booking claims for updates + Phase 5 booking creation.
            //
            // Order of operations matters here:
            //   a) Extract all booking fields from normalized_data.
            //   b) If booking data is present, check whether the lead already has
            //      a booking_applications row (the "conflict check"). We do this
            //      BEFORE the historical_booking_claims INSERT so we can write
            //      existing_booking_id in a single statement instead of an
            //      insert-then-update.
            //   c) Write historical_booking_claims with all Phase 2 fields
            //      (ocr_amount, flat_number) and existing_booking_id when a
            //      conflict is found. This row is the permanent audit trail —
            //      it is written regardless of whether a new booking was created.
            //   d) If no conflict, call createImportBooking() to create the
            //      booking_applications + booking_financials rows. This runs
            //      inside the same transaction so lead-update + booking-create
            //      are atomic: either both commit or both roll back.
            const nd = staged.normalized_data as any;
            const bookingStatus = nd?._booking_status;
            const bookingDate = nd?._booking_date;
            const bookingAmount = nd?._booking_amount;
            const bookingAmountRaw = nd?._booking_amount_raw;
            const bookingRef = nd?._booking_reference;
            const ocrAmount = typeof nd?._ocr_amount === "number" ? nd._ocr_amount : null;
            const ocrAmountRaw = nd?._ocr_amount_raw || null;
            const flatNumber = nd?._flat_number || null;
            // Phase 7: property identity for syncBookingUnit.
            const projectName = nd?._project_name || null;
            const tower = nd?._tower || null;
            const wing = nd?._wing || null;
            const floorNumber = nd?._floor_number || null;
            const claimedBooked = bookingStatus === true ||
              (typeof bookingStatus === "string" && ["yes", "y", "booked", "true", "1"].includes(bookingStatus.toLowerCase()));

            if (claimedBooked || bookingDate || bookingAmount || bookingRef) {
              // b) Conflict check — must precede the claim INSERT.
              // Only meaningful for claimedBooked rows; partial-data rows
              // (date/amount/ref but no explicit status) are not promoted to
              // booking_applications and need no existence guard.
              let existingBookingId: number | null = null;
              if (claimedBooked) {
                const existingBookingRes = await client.query(
                  `SELECT id FROM booking_applications
                     WHERE lead_id = $1 AND organization_id = $2
                     LIMIT 1`,
                  [staged.matched_record_id, orgId]
                );
                if (existingBookingRes.rows.length > 0) {
                  existingBookingId = existingBookingRes.rows[0].id;
                }
              }

              // c) Write the audit claim with all imported fields.
              await client.query(
                `INSERT INTO historical_booking_claims (
                    organization_id, lead_id, import_job_id, import_row_id,
                    claimed_booked, booking_date, booking_amount, booking_amount_raw,
                    booking_reference, source_row_number, source_filename,
                    ocr_amount, ocr_amount_raw, flat_number,
                    existing_booking_id,
                    requires_reconciliation
                  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
                [
                  orgId, staged.matched_record_id, jobId, staged.id,
                  claimedBooked, bookingDate || null, bookingAmount || null, bookingAmountRaw || null,
                  bookingRef || null, staged.source_row_number, job.filename,
                  ocrAmount, ocrAmountRaw, flatNumber,
                  existingBookingId,   // non-null only when a conflict was found
                  true
                ]
              );

              // d) Create booking_applications when no conflict exists.
              if (claimedBooked && existingBookingId === null) {
                await createImportBooking(client, {
                  leadId: staged.matched_record_id,
                  primaryName: existing.name,
                  primaryMobile: existing.phone,
                  orgId,
                  importedByName: committedByName,
                  bookingDate: bookingDate || null,
                  bookingAmount: typeof bookingAmount === "number" ? bookingAmount : null,
                  bookingAmountRaw: bookingAmountRaw || null,
                  bookingReference: bookingRef || null,
                  ocrAmount,
                  ocrAmountRaw,
                  flatNumber,
                  projectName,
                  tower,
                  wing,
                  floorNumber,
                });
              }
            }

            // 3u7. Follow-up for updates
            const feedback = (data.feedback || "").trim();
            if (feedback) {
              await client.query(
                `INSERT INTO follow_ups (lead_id, message, created_by_name, created_at, followup_date, organization_id)
                 VALUES ($1, $2, $3, $4, NULL, $5)`,
                [staged.matched_record_id, feedback, clamp(committedByName, 150), data.enquiry_date, orgId]
              );
            }

            await client.query(`RELEASE SAVEPOINT ${sp}`);
            continue;
          }
        }

        // ── CREATE path (default) ───────────────────────────────────

        // 3f. CP resolution
        const channelPartnerId = isChannelPartnerSource(rowSource)
          ? await resolveChannelPartnerId(
              client,
              {
                cp_name: data.cp_name,
                cp_company: null,
                cp_phone: data.cp_phone,
                source: rowSource,
              },
              committedByName
            )
          : null;

        // 3c. INSERT into walkin_enquiries with import_job_id
        const insertRes = await client.query(
          `INSERT INTO walkin_enquiries (
              name, phone, email, address, occupation, organization,
              budget, configuration, purpose, source,
              alt_phone, source_other, referral_name,
              cp_name, cp_company, cp_phone,
              loan_planned, assigned_to, assigned_receptionist, status,
              is_global_shared, overseeing_site_head,
              enquiry_date, auto_date_enabled, external_ref, channel_partner_id,
              organization_id, import_job_id
            )
            VALUES (
              $1,  $2,  $3,  $4,  $5,  $6,
              $7,  $8,  $9,  $10,
              $11, $12, $13,
              $14, $15, $16,
              $17, $18, $19, $20,
              $21, $22,
              $23, $24, $25, $26,
              $27, $28
            )
            ON CONFLICT (organization_id, external_ref) WHERE external_ref IS NOT NULL DO NOTHING
            RETURNING id`,
          [
            clamp(data.name, 150),                          // $1
            clamp(data.phone, 20),                          // $2
            null,                                           // $3  email
            null,                                           // $4  address
            null,                                           // $5  occupation
            null,                                           // $6  organization
            clamp(data.budget || "Pending", 100),           // $7
            clamp(data.configuration || null, 100),         // $8
            null,                                           // $9  purpose
            rowSource,                                      // $10
            clamp(data.alt_phone, 20),                      // $11
            null,                                           // $12 source_other
            null,                                           // $13 referral_name
            clamp(data.cp_name, 150),                       // $14
            null,                                           // $15 cp_company
            clamp(data.cp_phone, 20),                       // $16
            "Pending",                                      // $17 loan_planned
            clamp(job.assigned_to, 150),                    // $18
            null,                                           // $19 assigned_receptionist
            "Assigned",                                     // $20 status
            false,                                          // $21 is_global_shared
            clamp(job.overseeing_site_head, 150),           // $22
            data.enquiry_date,                              // $23
            false,                                          // $24 auto_date_enabled
            clamp(data.external_ref || null, 100),          // $25
            channelPartnerId,                               // $26
            orgId,                                          // $27
            jobId,                                          // $28 import_job_id
          ]
        );

        if (insertRes.rows.length === 0) {
          // 3d. ON CONFLICT DO NOTHING — duplicate external_ref, skip
          skipped++;
          await client.query(
            `UPDATE import_rows SET final_action = 'skipped', updated_at = now()
              WHERE id = $1`,
            [staged.id]
          );
          await client.query(`RELEASE SAVEPOINT ${sp}`);
          continue;
        }

        // 3e. Successful insert
        const leadId: number = insertRes.rows[0].id;
        created++;
        await client.query(
          `UPDATE import_rows
              SET final_action = 'created', target_record_id = $1, updated_at = now()
            WHERE id = $2`,
          [leadId, staged.id]
        );

        // 3e2. Historical booking claims + Phase 5 booking creation (CREATE path).
        //
        // A freshly created lead cannot already have a booking_applications row,
        // so no conflict check is needed here. The claim INSERT and the
        // createImportBooking() call share the same transaction client:
        // if either throws, both the lead INSERT and all booking writes are
        // rolled back and the row is marked 'failed' by the catch block below.
        const nd = staged.normalized_data as any;
        const bookingStatus = nd?._booking_status;
        const bookingDate = nd?._booking_date;
        const bookingAmount = nd?._booking_amount;
        const bookingAmountRaw = nd?._booking_amount_raw;
        const bookingRef = nd?._booking_reference;
        const ocrAmount = typeof nd?._ocr_amount === "number" ? nd._ocr_amount : null;
        const ocrAmountRaw = nd?._ocr_amount_raw || null;
        const flatNumber = nd?._flat_number || null;
        // Phase 7: property identity for syncBookingUnit.
        const projectName = nd?._project_name || null;
        const tower = nd?._tower || null;
        const wing = nd?._wing || null;
        const floorNumber = nd?._floor_number || null;

        const claimedBooked = bookingStatus === true ||
          (typeof bookingStatus === 'string' && ['yes', 'y', 'booked', 'true', '1'].includes(bookingStatus.toLowerCase()));

        if (claimedBooked || bookingDate || bookingAmount || bookingRef) {
          await client.query(
            `INSERT INTO historical_booking_claims (
                organization_id, lead_id, import_job_id, import_row_id,
                claimed_booked, booking_date, booking_amount, booking_amount_raw,
                booking_reference, source_row_number, source_filename,
                ocr_amount, ocr_amount_raw, flat_number,
                existing_booking_id,
                requires_reconciliation
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
            [
              orgId, leadId, jobId, staged.id,
              claimedBooked, bookingDate || null, bookingAmount || null, bookingAmountRaw || null,
              bookingRef || null, staged.source_row_number, job.filename,
              ocrAmount, ocrAmountRaw, flatNumber,
              null,  // no conflict possible on a freshly created lead
              true
            ]
          );
        }

        // 3e3. Phase 5 — create booking_applications for confirmed bookings.
        // Partial-data rows (date/amount/ref but no explicit booking_status) are
        // captured in historical_booking_claims only and left for manual review.
        if (claimedBooked) {
          await createImportBooking(client, {
            leadId,
            primaryName: data.name,
            primaryMobile: data.phone,
            orgId,
            importedByName: committedByName,
            bookingDate: bookingDate || null,
            bookingAmount: typeof bookingAmount === "number" ? bookingAmount : null,
            bookingAmountRaw: bookingAmountRaw || null,
            bookingReference: bookingRef || null,
            ocrAmount,
            ocrAmountRaw,
            flatNumber,
            projectName,
            tower,
            wing,
            floorNumber,
          });
        }

        // 3g. If row has feedback, create follow_up
        const feedback = (data.feedback || "").trim();
        if (feedback) {
          await client.query(
            `INSERT INTO follow_ups (lead_id, message, created_by_name, created_at, followup_date, organization_id)
             VALUES ($1, $2, $3, $4, NULL, $5)`,
            [leadId, feedback, clamp(committedByName, 150), data.enquiry_date, orgId]
          );
        }
        await client.query(`RELEASE SAVEPOINT ${sp}`);
      } catch (err) {
        // Roll back only this row — the outer transaction stays open so
        // remaining rows can still be processed.
        await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        failed++;
        const errMsg = err instanceof Error ? err.message : String(err);
        await client.query(
          `UPDATE import_rows SET final_action = 'failed', updated_at = now()
            WHERE id = $1`,
          [staged.id]
        );
        await client.query(
          `INSERT INTO import_errors (
              import_job_id, import_row_id, organization_id, source_row_number, source_field,
              error_code, error_message, severity,
              original_value, normalized_value
            ) VALUES ($1, $2, $3, $4, NULL, 'COMMIT_ERROR', $5, 'error', NULL, NULL)`,
          [jobId, staged.id, orgId, staged.source_row_number, errMsg]
        );
      }
    }

    // 3h. Recalculate gapless Sr. Nos once
    await recalculateSrNos(client);

    // 3i. Mark invalid rows as failed
    await client.query(
      `UPDATE import_rows
          SET final_action = 'failed', updated_at = now()
        WHERE import_job_id = $1 AND organization_id = $2
          AND validation_status = 'invalid' AND final_action IS NULL`,
      [jobId, orgId]
    );

    // 3j. Update job with final counts and transition to completed
    await client.query(
      `UPDATE import_jobs
          SET created_rows = $1, updated_rows = $2, skipped_rows = $3, failed_rows = $4,
              completed_at = now(), updated_at = now()
        WHERE id = $5`,
      [created, updated, skipped, failed + (job.invalid_rows || 0), jobId]
    );
    await transitionStatus(client, jobId, "committing", "completed");

    const elapsed = Date.now() - startTime;
    console.log(
      `[import:commit] job=${jobId} rows=${stagedRows.length} created=${created} updated=${updated} skipped=${skipped} failed=${failed} elapsed=${elapsed}ms`
    );

    return { jobId, created, updated, skipped, failed };
  });
}

// ── Cancel ───────────────────────────────────────────────────────────────────

/** Cancel a staged import. Only allowed from statuses that permit cancellation. */
export async function cancelImport(jobId: string, orgId: string): Promise<void> {
  const job = await getImportJob(jobId, orgId);
  if (!job) {
    throw new Error(`Import job ${jobId} not found for this organization.`);
  }

  const allowed = VALID_TRANSITIONS[job.status];
  if (!allowed || !allowed.includes("cancelled")) {
    throw new Error(
      `Import job ${jobId} cannot be cancelled from status "${job.status}".`
    );
  }

  await transaction(async (client) => {
    await transitionStatus(client, jobId, job.status, "cancelled");
  });
}

// ── Rollback ─────────────────────────────────────────────────────────────────

/**
 * Roll back a completed import: delete the leads and follow-ups it created,
 * then recalculate Sr. Nos.
 */
export async function rollbackImport(
  jobId: string,
  orgId: string,
  _rolledBackByName: string
): Promise<RollbackResult> {
  // 1. Verify status is completed
  const job = await getImportJob(jobId, orgId);
  if (!job) {
    throw new Error(`Import job ${jobId} not found for this organization.`);
  }
  if (job.status !== "completed") {
    throw new Error(
      `Import job ${jobId} is in status "${job.status}" — only "completed" jobs can be rolled back.`
    );
  }

  return transaction(async (client) => {
    // 2a. Advisory lock
    const lockKey = Math.abs(jobId.split("").reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0));
    await client.query(`SELECT pg_advisory_xact_lock($1)`, [lockKey]);

    // 2b. Transition to rolling_back
    await transitionStatus(client, jobId, "completed", "rolling_back");

    // 3a. Find all created rows with target_record_ids
    const createdRes = await client.query(
      `SELECT id, target_record_id FROM import_rows
        WHERE import_job_id = $1 AND organization_id = $2
          AND final_action = 'created' AND target_record_id IS NOT NULL`,
      [jobId, orgId]
    );
    const targetIds: number[] = createdRes.rows.map(
      (r: { target_record_id: number }) => r.target_record_id
    );

    let rolledBack = 0;

    if (targetIds.length > 0) {
      // 3b0. DELETE historical_booking_claims for these leads
      await client.query(
        `DELETE FROM historical_booking_claims
          WHERE lead_id = ANY($1::int[]) AND organization_id = $2 AND import_job_id = $3`,
        [targetIds, orgId, jobId]
      );

      // 3b. DELETE follow_ups created for these leads
      await client.query(
        `DELETE FROM follow_ups
          WHERE lead_id = ANY($1::int[]) AND organization_id = $2`,
        [targetIds, orgId]
      );

      // 3c. DELETE the leads themselves — scoped to both org AND import_job_id
      const deleteRes = await client.query(
        `DELETE FROM walkin_enquiries
          WHERE id = ANY($1::int[]) AND organization_id = $2 AND import_job_id = $3
          RETURNING id`,
        [targetIds, orgId, jobId]
      );
      rolledBack = deleteRes.rows.length;

      // 3d. Mark import_rows as rolled_back
      await client.query(
        `UPDATE import_rows
            SET final_action = 'rolled_back', updated_at = now()
          WHERE import_job_id = $1 AND organization_id = $2
            AND final_action = 'created'`,
        [jobId, orgId]
      );
    }

    // 3e. Restore updated rows from pre_update_snapshot
    const updatedRes = await client.query(
      `SELECT id, target_record_id, pre_update_snapshot FROM import_rows
        WHERE import_job_id = $1 AND organization_id = $2
          AND final_action = 'updated' AND pre_update_snapshot IS NOT NULL`,
      [jobId, orgId]
    );

    for (const row of updatedRes.rows) {
      const snapshot =
        typeof row.pre_update_snapshot === "string"
          ? JSON.parse(row.pre_update_snapshot)
          : row.pre_update_snapshot;

      // Build SET clause from snapshot, excluding identity columns
      const fields = Object.keys(snapshot).filter(
        (k) => k !== "id" && k !== "organization_id" && k !== "created_at"
      );
      if (fields.length > 0 && row.target_record_id) {
        const setClauses = fields.map((f, i) => `"${f}" = $${i + 3}`).join(", ");
        const values = fields.map((f) => snapshot[f]);
        await client.query(
          `UPDATE walkin_enquiries SET ${setClauses}
            WHERE id = $1 AND organization_id = $2`,
          [row.target_record_id, orgId, ...values]
        );
        rolledBack++;
      }

      // Delete booking claims created for updated leads
      if (row.target_record_id) {
        await client.query(
          `DELETE FROM historical_booking_claims
            WHERE lead_id = $1 AND organization_id = $2 AND import_job_id = $3`,
          [row.target_record_id, orgId, jobId]
        );
      }
    }

    // Mark updated rows as rolled_back
    await client.query(
      `UPDATE import_rows SET final_action = 'rolled_back', updated_at = now()
        WHERE import_job_id = $1 AND organization_id = $2 AND final_action = 'updated'`,
      [jobId, orgId]
    );

    // 3f. Recalculate Sr. Nos
    await recalculateSrNos(client);

    // 3g. Transition to rolled_back
    await client.query(
      `UPDATE import_jobs
          SET rolled_back_at = now(), updated_at = now()
        WHERE id = $1`,
      [jobId]
    );
    await transitionStatus(client, jobId, "rolling_back", "rolled_back");

    return { jobId, rolledBack };
  });
}

// ── Templates ─────────────────────────────────────────────────────────────────

/** List all active templates for an organization, defaults first. */
export async function getTemplates(orgId: string): Promise<ImportTemplate[]> {
  return query<ImportTemplate>(
    `SELECT * FROM import_templates
      WHERE organization_id = $1 AND status = 'active'
      ORDER BY is_default DESC, updated_at DESC`,
    [orgId]
  );
}

/** Fetch a single template by id, scoped to organization. */
export async function getTemplate(templateId: string, orgId: string): Promise<ImportTemplate | null> {
  const rows = await query<ImportTemplate>(
    `SELECT * FROM import_templates WHERE id = $1 AND organization_id = $2`,
    [templateId, orgId]
  );
  return rows[0] || null;
}

/** Save a new import template. If is_default, unsets any prior default first. */
export async function saveTemplate(params: {
  orgId: string;
  name: string;
  mappings: Record<string, string>;
  ignoredColumns?: string[];
  valueMappings?: Record<string, Record<string, string>>;
  dateFormat?: string;
  isDefault?: boolean;
  createdById: number;
  createdByName: string;
}): Promise<{ id: string }> {
  return transaction(async (client) => {
    if (params.isDefault) {
      await client.query(
        `UPDATE import_templates SET is_default = false, updated_at = now()
          WHERE organization_id = $1 AND import_type = 'leads' AND is_default = true`,
        [params.orgId]
      );
    }
    const res = await client.query(
      `INSERT INTO import_templates (
          organization_id, name, mappings, ignored_columns, value_mappings,
          date_format, is_default, created_by_id, created_by_name
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id`,
      [
        params.orgId, params.name,
        JSON.stringify(params.mappings),
        JSON.stringify(params.ignoredColumns || []),
        JSON.stringify(params.valueMappings || {}),
        params.dateFormat || 'DD/MM/YYYY',
        params.isDefault || false,
        params.createdById, params.createdByName,
      ]
    );
    return { id: res.rows[0].id };
  });
}

/** Soft-delete a template by setting status to inactive. */
export async function deleteTemplate(templateId: string, orgId: string): Promise<void> {
  await query(
    `UPDATE import_templates SET status = 'inactive', updated_at = now()
      WHERE id = $1 AND organization_id = $2`,
    [templateId, orgId]
  );
}
