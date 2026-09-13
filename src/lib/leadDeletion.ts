import { promises as fs } from "fs";
import path from "path";
import type { PoolClient } from "pg";
import { bucketName, deleteObjectFromR2, listR2KeysByPrefix } from "@/lib/r2";
import { recalculateSrNos } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { releaseUnitForBooking } from "@/lib/inventorySync";

type R2Failure = {
  key: string;
  error: string;
};

export type LeadAssetDeletionResult = {
  leadId: number;
  requestedKeys: string[];
  deletedKeys: string[];
  failures: R2Failure[];
};

export type LocalAssetDeletionResult = {
  target: string;
  deletedFiles: number;
  missing: boolean;
};

export type LeadDatabaseDeletionResult = {
  deletedRecords: Record<string, number>;
  clearedLiveStateRows: number;
};

const KNOWN_ASSET_TABLES = [
  {
    table: "booking_documents",
    leadColumn: "lead_id",
    keyColumns: ["object_key", "file_key", "r2_key", "storage_key", "url", "file_url"],
  },
  {
    table: "uploaded_documents",
    leadColumn: "lead_id",
    keyColumns: ["object_key", "file_key", "r2_key", "storage_key", "url", "file_url"],
  },
  {
    table: "lead_documents",
    leadColumn: "lead_id",
    keyColumns: ["object_key", "file_key", "r2_key", "storage_key", "url", "file_url"],
  },
  {
    table: "customer_documents",
    leadColumn: "lead_id",
    keyColumns: ["object_key", "file_key", "r2_key", "storage_key", "url", "file_url"],
  },
  {
    table: "booking_forms",
    leadColumn: "lead_id",
    keyColumns: ["object_key", "pdf_key", "generated_pdf_key", "url", "file_url"],
  },
];

// Deletion order: child-before-parent. Three rules govern ordering:
//
//   1. A table whose FK points to booking_applications (RESTRICT) must be
//      deleted or nulled out BEFORE booking_applications rows are deleted.
//      Affected: disbursement_tranches, financial_adjustments (have lead_id),
//                cp_commissions, inventory_units.booking_id (subquery — handled
//                separately in deleteLeadDatabaseRecords below this list).
//
//   2. A table whose FK points directly to walkin_enquiries (RESTRICT, no CASCADE)
//      must be deleted before walkin_enquiries row is deleted.
//      Affected: lead_reminders, financial_adjustments (lead_id FK).
//
//   3. Tables with ON DELETE CASCADE are safe in any position — the DB
//      removes their rows automatically (site_visits, cp_assignment_history, …).
//
// The list is processed in order; the SAVEPOINT in the bulk-delete route means
// a table that throws mid-way aborts only the current lead, not the whole batch.
const LEAD_RELATED_DELETES = [
  // ── Must come before booking_applications (RESTRICT FK via booking_id) ──────
  // disbursement_tranches has a direct lead_id column (no FK) AND a RESTRICT
  // booking_id FK; deleting by lead_id removes the booking_id reference first.
  { table: "disbursement_tranches", column: "lead_id" },
  // financial_adjustments has BOTH a RESTRICT lead_id FK (→ walkin_enquiries)
  // AND a RESTRICT booking_id FK (→ booking_applications). Placing it here
  // clears both dependencies before either parent is deleted.
  { table: "financial_adjustments", column: "lead_id" },
  // loan_applications: has lead_id (ON DELETE CASCADE → walkin_enquiries) and
  // booking_id (ON DELETE CASCADE → booking_applications). Explicit delete here
  // before booking_applications prevents the booking CASCADE from racing with
  // the lead CASCADE when both parents are deleted in the same transaction.
  { table: "loan_applications", column: "lead_id" },
  // ── Booking document children (all have ON DELETE CASCADE, order flexible) ──
  { table: "booking_documents", column: "lead_id" },
  { table: "booking_forms", column: "lead_id" },
  // booking_applications: cp_commissions and inventory_units.booking_id are
  // cleared by the subquery block in deleteLeadDatabaseRecords() just before
  // this list is processed — see BOOKING_SUBQUERY_DELETES/NULLS below.
  { table: "booking_applications", column: "lead_id" },
  // ── Remaining lead-scoped tables ─────────────────────────────────────────────
  { table: "customer_documents", column: "lead_id" },
  { table: "lead_documents", column: "lead_id" },
  { table: "uploaded_documents", column: "lead_id" },
  { table: "loan_updates", column: "lead_id" },
  { table: "follow_ups", column: "lead_id" },
  { table: "notes", column: "lead_id" },
  { table: "lead_notes", column: "lead_id" },
  { table: "site_visits", column: "lead_id" },
  { table: "whatsapp_logs", column: "lead_id" },
  { table: "email_history", column: "lead_id" },
  { table: "call_history", column: "lead_id" },
  { table: "reminders", column: "lead_id" },
  // lead_reminders: added 2026-09-02, RESTRICT FK — must precede walkin_enquiries
  { table: "lead_reminders", column: "lead_id" },
  { table: "notification_records", column: "lead_id" },
  { table: "notifications", column: "lead_id" },
  { table: "ai_conversations", column: "lead_id" },
  { table: "audit_references", column: "lead_id" },
  { table: "employee_assignments", column: "lead_id" },
  { table: "lead_assignment_logs", column: "lead_id" },
  { table: "employee_activity_logs", column: "lead_id" },
  // MT-03: `completed_leads` removed from this list — the table is approved for
  // DROP. Entries here are existence-guarded, so a stale name is harmless, but
  // leaving it would imply the archive still exists. A completed lead is now a
  // `booking_applications` row keyed on lead_id; there is no separate archive.
  { table: "bookings", column: "lead_id" },
  { table: "customers", column: "lead_id" },
];

function quoteIdent(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export async function getExistingColumns(client: PoolClient, tableName: string) {
  const result = await client.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
    `,
    [tableName]
  );

  return new Set(result.rows.map((row: { column_name: string }) => row.column_name));
}

async function tableHasColumn(client: PoolClient, tableName: string, columnName: string) {
  const columns = await getExistingColumns(client, tableName);
  return columns.has(columnName);
}

// ── Booking cancellation pre-step ────────────────────────────────────────────
// Reuses the exact same cancellation mechanism as CancellationModal / the
// booking PUT route:
//   1. SET booking_status = 'Cancelled' with reason/cancelled_by/cancelled_at
//   2. releaseUnitForBooking() — sets inventory unit back to 'available',
//      NULLs unit.lead_id + unit.booking_id, writes inventory_unit_history
//   3. INSERT booking_history record
//
// Only runs on non-Cancelled bookings. Already-cancelled bookings (whose unit
// is already released) are skipped so the inventory unit is not double-touched.
//
// ISOLATION: the WHERE clause on booking_applications is scoped to both
// lead_id AND organization_id, so only the deleted lead's org-scoped bookings
// are touched. releaseUnitForBooking() itself calls getOrganizationId() for
// the history insert — also org-scoped.
async function cancelBookingsForLead(
  client: PoolClient,
  leadId: number,
  adminName: string,
  adminRole: string,
  orgId: string,
): Promise<{ cancelledIds: number[] }> {
  // Guard: table may not exist in all environments.
  if (!(await tableHasColumn(client, "booking_applications", "lead_id"))) {
    return { cancelledIds: [] };
  }

  const bookingRows = await client.query(
    `SELECT id, booking_status
       FROM booking_applications
      WHERE lead_id = $1 AND organization_id = $2 AND booking_status != 'Cancelled'
      ORDER BY id ASC`,
    [leadId, orgId],
  );

  const cancelledIds: number[] = [];
  for (const row of bookingRows.rows) {
    const bookingId = row.id as number;
    const prevStatus = String(row.booking_status ?? "");

    // Step 1 — Mark booking Cancelled (same fields as CancellationModal PUT).
    await client.query(
      `UPDATE booking_applications
          SET booking_status        = 'Cancelled',
              cancellation_reason   = 'Lead permanently deleted by admin',
              cancelled_by          = $2,
              cancelled_at          = NOW(),
              updated_at            = NOW()
        WHERE id = $1 AND organization_id = $3`,
      [bookingId, adminName, orgId],
    );

    // Step 2 — Release the linked inventory unit (existing mechanism).
    // Sets unit.status='available', NULLs unit.lead_id + unit.booking_id,
    // and writes inventory_unit_history if the status actually changed.
    await releaseUnitForBooking(
      client,
      bookingId,
      "lead permanently deleted",
      adminName,
    );

    // Step 3 — Booking history record (same format as existing cancellation flow).
    const historyPayload = JSON.stringify({
      booking_status: { from: prevStatus, to: "Cancelled" },
      cancellation_reason: "Lead permanently deleted by admin",
    });
    // booking_history gained organization_id after the baseline migration.
    // Use tableHasColumn so this is safe against older schema snapshots.
    const bhHasOrgId = await tableHasColumn(client, "booking_history", "organization_id");
    if (bhHasOrgId) {
      await client.query(
        `INSERT INTO booking_history
           (booking_id, updated_by, user_role, changed_fields, organization_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [bookingId, adminName, adminRole, historyPayload, orgId],
      );
    } else {
      await client.query(
        `INSERT INTO booking_history
           (booking_id, updated_by, user_role, changed_fields)
         VALUES ($1, $2, $3, $4)`,
        [bookingId, adminName, adminRole, historyPayload],
      );
    }

    cancelledIds.push(bookingId);
  }

  return { cancelledIds };
}

function normalizePotentialR2Key(raw: string) {
  const value = raw.trim();
  if (!value || value.startsWith("data:")) return null;

  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      const pathParts = url.pathname.split("/").filter(Boolean);
      if (bucketName && pathParts[0] === bucketName) pathParts.shift();
      return pathParts.length ? pathParts.join("/") : null;
    } catch {
      return null;
    }
  }

  const key = value.replace(/^\/+/, "");
  if (!key.includes("/")) return null;
  return key;
}

function collectPotentialR2Keys(value: unknown, keys: Set<string>) {
  if (value === null || value === undefined) return;

  if (typeof value === "string") {
    const key = normalizePotentialR2Key(value);
    if (key) keys.add(key);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectPotentialR2Keys(item, keys);
    return;
  }

  if (typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectPotentialR2Keys(item, keys);
    }
  }
}

async function collectKeysFromTable(
  client: PoolClient,
  leadId: number,
  tableName: string,
  leadColumn: string,
  keyColumns: string[],
  keys: Set<string>
) {
  const columns = await getExistingColumns(client, tableName);
  if (!columns.has(leadColumn)) return;

  const existingKeyColumns = keyColumns.filter((column) => columns.has(column));
  if (existingKeyColumns.length === 0) return;

  const result = await client.query(
    `
      SELECT ${existingKeyColumns.map(quoteIdent).join(", ")}
      FROM ${quoteIdent(tableName)}
      WHERE ${quoteIdent(leadColumn)}::text = $1
    `,
    [String(leadId)]
  );

  for (const row of result.rows) {
    for (const column of existingKeyColumns) collectPotentialR2Keys(row[column], keys);
  }
}

async function collectBookingApplicationKeys(
  client: PoolClient,
  leadId: number,
  keys: Set<string>
) {
  const columns = await getExistingColumns(client, "booking_applications");
  if (!columns.has("lead_id")) return [];

  const candidateColumns = [
    "booking_number",
    "primary_aadhaar_front_url",
    "primary_aadhaar_back_url",
    "primary_pan_url",
    "joint_applicants",
    "signature_data",
    "generated_pdf_url",
    "generated_pdf_key",
    "pdf_url",
    "pdf_key",
  ].filter((column) => columns.has(column));

  if (candidateColumns.length === 0) return [];

  const result = await client.query(
    `
      SELECT ${candidateColumns.map(quoteIdent).join(", ")}
      FROM booking_applications
      WHERE lead_id::text = $1
    `,
    [String(leadId)]
  );

  const bookingNumbers: string[] = [];
  for (const row of result.rows) {
    if (row.booking_number) bookingNumbers.push(String(row.booking_number));
    for (const column of candidateColumns) collectPotentialR2Keys(row[column], keys);
  }

  return bookingNumbers;
}

export async function deleteLeadAssets(
  client: PoolClient,
  leadId: number
): Promise<LeadAssetDeletionResult> {
  const keys = new Set<string>();

  const bookingNumbers = await collectBookingApplicationKeys(client, leadId, keys);

  // follow_up_attachments stores R2 keys in r2_object_key but has no lead_id
  // column — it links to follow_ups via follow_up_id. Collect keys via subquery
  // before the generic loop which cannot handle indirect joins.
  // ISOLATION: follow_ups.lead_id = $leadId ensures only this lead's attachments
  // are included. Cannot match another lead's follow-ups.
  const fuaHasR2Key = await tableHasColumn(client, "follow_up_attachments", "r2_object_key");
  const fuaHasFollowUpId = await tableHasColumn(client, "follow_up_attachments", "follow_up_id");
  const fuHasLeadId = await tableHasColumn(client, "follow_ups", "lead_id");
  if (fuaHasR2Key && fuaHasFollowUpId && fuHasLeadId) {
    const fuaRows = await client.query(
      `SELECT r2_object_key
         FROM follow_up_attachments
        WHERE follow_up_id IN (
          SELECT id FROM follow_ups WHERE lead_id::text = $1
        )`,
      [String(leadId)],
    );
    for (const row of fuaRows.rows) {
      if (row.r2_object_key) {
        const k = normalizePotentialR2Key(row.r2_object_key);
        if (k) keys.add(k);
      }
    }
  }

  for (const table of KNOWN_ASSET_TABLES) {
    await collectKeysFromTable(
      client,
      leadId,
      table.table,
      table.leadColumn,
      table.keyColumns,
      keys
    );
  }

  const prefixes = new Set<string>([
    `leads/${leadId}/`,
    `lead-assets/${leadId}/`,
    `walkin_enquiries/${leadId}/`,
    `walkin-enquiries/${leadId}/`,
    `generated-pdfs/${leadId}/`,
    `generated_pdfs/${leadId}/`,
    `booking_documents/lead_${leadId}/`,
    `uploads/booking_documents/lead_${leadId}/`,
  ]);

  for (const bookingNumber of bookingNumbers) {
    prefixes.add(`bookings/${bookingNumber}/`);
  }

  for (const prefix of prefixes) {
    const listedKeys = await listR2KeysByPrefix(prefix);
    for (const key of listedKeys) keys.add(key);
  }

  const requestedKeys = Array.from(keys);
  const deletedKeys: string[] = [];
  const failures: R2Failure[] = [];

  await Promise.all(
    requestedKeys.map(async (key) => {
      try {
        await deleteObjectFromR2(key);
        deletedKeys.push(key);
      } catch (error: any) {
        const message = error?.message || "Unknown R2 deletion error";
        console.error(`[R2] Failed to delete ${key}:`, error);
        failures.push({ key, error: message });
      }
    })
  );

  return {
    leadId,
    requestedKeys,
    deletedKeys,
    failures,
  };
}

async function countFiles(target: string): Promise<number> {
  let entries;
  try {
    entries = await fs.readdir(target, { withFileTypes: true });
  } catch (error: any) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }

  let count = 0;
  for (const entry of entries) {
    const entryPath = path.join(target, entry.name);
    if (entry.isDirectory()) count += await countFiles(entryPath);
    else if (entry.isFile()) count += 1;
  }
  return count;
}

export async function deleteLeadLocalUploads(leadId: number): Promise<LocalAssetDeletionResult> {
  const uploadRoot = path.resolve(process.cwd(), "public", "uploads", "booking_documents");
  const target = path.resolve(uploadRoot, `lead_${leadId}`);

  if (!target.startsWith(uploadRoot + path.sep)) {
    throw new Error("Refusing to delete outside the booking uploads directory.");
  }

  const deletedFiles = await countFiles(target);
  await fs.rm(target, { recursive: true, force: true });

  return {
    target,
    deletedFiles,
    missing: deletedFiles === 0,
  };
}

export async function deleteLeadDatabaseRecords(
  client: PoolClient,
  leadId: number,
  options: { recalc?: boolean; adminName?: string; adminRole?: string } = {}
): Promise<LeadDatabaseDeletionResult> {
  // recalc defaults to true so existing single-delete behavior is unchanged.
  // Bulk delete passes recalc:false and calls recalculateSrNos once after the batch.
  // adminName/adminRole are used for the booking cancellation audit trail.
  const { recalc = true, adminName = "Admin", adminRole = "admin" } = options;
  const deletedRecords: Record<string, number> = {};

  // Both callers already refuse a lead belonging to another organization before
  // reaching this helper. The predicates below are the second lock on the same
  // door: this function deletes rows across a dozen tables from a bare numeric id,
  // and it must not depend on every future caller remembering to check first.
  const orgId = await getOrganizationId(client);

  // ── Step 0: Cancel non-Cancelled bookings FIRST ───────────────────────────────
  // Requirement: "existing booking cancellation flow runs FIRST if the lead has
  // a booking." This runs cancelBookingsForLead(), which for each non-Cancelled
  // booking on this lead:
  //   1. Sets booking_status='Cancelled' with reason + cancelled_by + cancelled_at
  //   2. Calls releaseUnitForBooking() — puts the inventory unit back to 'available',
  //      NULLs unit.lead_id + unit.booking_id, writes inventory_unit_history
  //   3. Inserts a booking_history record (same as CancellationModal)
  //
  // Already-Cancelled bookings are skipped (their unit is already released).
  // This MUST run before the pre-booking cleanup block so that the cancellation
  // metadata and booking_history records exist before booking_applications is deleted.
  //
  // ISOLATION: cancelBookingsForLead() scopes its query to both lead_id=$1 AND
  // organization_id=$2. It cannot touch another lead's bookings.
  const { cancelledIds } = await cancelBookingsForLead(
    client, leadId, adminName, adminRole, orgId,
  );
  deletedRecords["booking_cancellations"] = cancelledIds.length;

  // ── Pre-booking cleanup ───────────────────────────────────────────────────────
  // cp_commissions and inventory_units.booking_id hold RESTRICT FKs to
  // booking_applications(id) but have no lead_id column, so they cannot appear
  // in LEAD_RELATED_DELETES. Clear them via subquery before booking_applications
  // rows are deleted by the main loop below.
  //
  // After Step 0, inventory_units.booking_id is already NULL for bookings that
  // were just cancelled. The UPDATE below is a safe no-op for those rows.
  // cp_commissions still needs an explicit DELETE — the cancellation step does
  // not remove commission records (they are financial records, not status fields).
  const baHasLeadId = await tableHasColumn(client, "booking_applications", "lead_id");
  if (baHasLeadId) {
    // Tables whose only lead link is booking_id → booking_applications: DELETE them.
    for (const tbl of ["cp_commissions"]) {
      if (!(await tableHasColumn(client, tbl, "booking_id"))) continue;
      const r = await client.query(
        `DELETE FROM ${quoteIdent(tbl)}
         WHERE booking_id IN (
           SELECT id FROM booking_applications WHERE lead_id::text = $1
         )`,
        [String(leadId)]
      );
      deletedRecords[tbl] = r.rowCount ?? 0;
    }
    // inventory_units: NULL out booking_id so the unit re-enters available stock.
    // Redundant for bookings cancelled in Step 0 (already NULL'd by releaseUnitForBooking),
    // but needed for any booking that was already Cancelled before this deletion and
    // whose booking_id was not properly cleared by a prior release.
    if (await tableHasColumn(client, "inventory_units", "booking_id")) {
      const r = await client.query(
        `UPDATE inventory_units SET booking_id = NULL
         WHERE booking_id IN (
           SELECT id FROM booking_applications WHERE lead_id::text = $1
         )`,
        [String(leadId)]
      );
      deletedRecords["inventory_units.booking_id_nulled"] = r.rowCount ?? 0;
    }
  }

  // ── follow_up_attachments: delete before follow_ups ───────────────────────────
  // follow_up_attachments.follow_up_id is a plain INTEGER (no FK constraint) so
  // it does not block deletion of follow_ups. However it would be orphaned if
  // follow_ups is deleted first. Delete here via subquery before the main loop
  // processes follow_ups.
  //
  // ISOLATION: the subquery filters follow_ups by lead_id::text = $leadId so only
  // this lead's follow-up attachments are deleted. Another lead's follow_ups are
  // untouched even if they share the same organization.
  if (
    await tableHasColumn(client, "follow_up_attachments", "follow_up_id") &&
    await tableHasColumn(client, "follow_ups", "lead_id")
  ) {
    const r = await client.query(
      `DELETE FROM follow_up_attachments
        WHERE follow_up_id IN (
          SELECT id FROM follow_ups WHERE lead_id::text = $1
        )`,
      [String(leadId)],
    );
    deletedRecords["follow_up_attachments"] = r.rowCount ?? 0;
  }

  for (const item of LEAD_RELATED_DELETES) {
    if (!(await tableHasColumn(client, item.table, item.column))) continue;

    const result = await client.query(
      `
        DELETE FROM ${quoteIdent(item.table)}
        WHERE ${quoteIdent(item.column)}::text = $1
      `,
      [String(leadId)]
    );
    deletedRecords[item.table] = result.rowCount ?? 0;
  }

  // Inventory units hold RESTRICT FKs via lead_id and held_for_lead_id.
  // We NULL them out (not DELETE) so the unit returns to available status.
  // booking_id is handled by the pre-booking block above before booking_applications
  // is deleted; it is intentionally omitted here to avoid double-processing.
  const INVENTORY_NULL_COLS: { table: string; column: string }[] = [
    { table: "inventory_units", column: "lead_id" },
    { table: "inventory_units", column: "held_for_lead_id" },
    { table: "inventory_cost_sheets", column: "lead_id" },
    { table: "inventory_offers", column: "lead_id" },
  ];
  for (const item of INVENTORY_NULL_COLS) {
    if (!(await tableHasColumn(client, item.table, item.column))) continue;
    const result = await client.query(
      `UPDATE ${quoteIdent(item.table)} SET ${quoteIdent(item.column)} = NULL WHERE ${quoteIdent(item.column)}::text = $1`,
      [String(leadId)]
    );
    deletedRecords[`${item.table}.${item.column}_nulled`] = result.rowCount ?? 0;
  }

  let clearedLiveStateRows = 0;
  if (await tableHasColumn(client, "employee_live_state", "active_lead_id")) {
    const result = await client.query(
      `
        UPDATE employee_live_state
        SET active_lead_id = NULL,
            active_lead_name = NULL
        WHERE active_lead_id::text = $1
          AND organization_id = $2
      `,
      [String(leadId), orgId]
    );
    clearedLiveStateRows = result.rowCount ?? 0;
  }

  const leadDeleteResult = await client.query(
    "DELETE FROM walkin_enquiries WHERE id = $1 AND organization_id = $2",
    [leadId, orgId]
  );
  deletedRecords.walkin_enquiries = leadDeleteResult.rowCount ?? 0;

  if (recalc) {
    await recalculateSrNos(client);
  }

  return { deletedRecords, clearedLiveStateRows };
}

export async function ensureLeadDeletionAuditTable(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS lead_deletion_audit_logs (
      id SERIAL PRIMARY KEY,
      admin_id TEXT NOT NULL,
      admin_name TEXT NOT NULL,
      lead_id INTEGER NOT NULL,
      lead_number TEXT,
      customer_name TEXT,
      deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      reason TEXT,
      deleted_file_count INTEGER DEFAULT 0,
      deleted_local_file_count INTEGER DEFAULT 0,
      deleted_records JSONB DEFAULT '{}'::jsonb
    )
  `);
}

export async function insertLeadDeletionAudit(
  client: PoolClient,
  input: {
    adminId: string;
    adminName: string;
    leadId: number;
    leadNumber?: string | null;
    customerName?: string | null;
    reason?: string | null;
    deletedFileCount: number;
    deletedLocalFileCount: number;
    deletedRecords: Record<string, number>;
  }
) {
  await ensureLeadDeletionAuditTable(client);

  await client.query(
    `
      INSERT INTO lead_deletion_audit_logs (
        admin_id,
        admin_name,
        lead_id,
        lead_number,
        customer_name,
        reason,
        deleted_file_count,
        deleted_local_file_count,
        deleted_records
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
    `,
    [
      input.adminId,
      input.adminName,
      input.leadId,
      input.leadNumber || null,
      input.customerName || null,
      input.reason || null,
      input.deletedFileCount,
      input.deletedLocalFileCount,
      JSON.stringify(input.deletedRecords),
    ]
  );

  if (await tableHasColumn(client, "admin_audit_logs", "action")) {
    const action = `Permanent lead deletion: Lead #${input.leadNumber || input.leadId} (${input.customerName || "Unknown"}) by ${input.adminName}; files deleted: ${input.deletedFileCount}; reason: ${input.reason || "N/A"}`;
    await client.query(
      "INSERT INTO admin_audit_logs (admin_id, action) VALUES ($1, $2)",
      [input.adminId, action]
    );
  }
}
