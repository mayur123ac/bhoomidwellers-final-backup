import { promises as fs } from "fs";
import path from "path";
import type { PoolClient } from "pg";
import { bucketName, deleteObjectFromR2, listR2KeysByPrefix } from "@/lib/r2";
import { recalculateSrNos } from "@/lib/db";

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

const LEAD_RELATED_DELETES = [
  { table: "booking_documents", column: "lead_id" },
  { table: "booking_forms", column: "lead_id" },
  { table: "booking_applications", column: "lead_id" },
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
  { table: "notification_records", column: "lead_id" },
  { table: "notifications", column: "lead_id" },
  { table: "ai_conversations", column: "lead_id" },
  { table: "audit_references", column: "lead_id" },
  { table: "employee_assignments", column: "lead_id" },
  { table: "lead_assignment_logs", column: "lead_id" },
  { table: "employee_activity_logs", column: "lead_id" },
  { table: "completed_leads", column: "id" },
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
  leadId: number
): Promise<LeadDatabaseDeletionResult> {
  const deletedRecords: Record<string, number> = {};

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

  let clearedLiveStateRows = 0;
  if (await tableHasColumn(client, "employee_live_state", "active_lead_id")) {
    const result = await client.query(
      `
        UPDATE employee_live_state
        SET active_lead_id = NULL,
            active_lead_name = NULL
        WHERE active_lead_id::text = $1
      `,
      [String(leadId)]
    );
    clearedLiveStateRows = result.rowCount ?? 0;
  }

  const leadDeleteResult = await client.query(
    "DELETE FROM walkin_enquiries WHERE id = $1",
    [leadId]
  );
  deletedRecords.walkin_enquiries = leadDeleteResult.rowCount ?? 0;

  await recalculateSrNos(client);

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
