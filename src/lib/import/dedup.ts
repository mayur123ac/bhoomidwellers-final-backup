// lib/import/dedup.ts
// Deduplication engine for the staged import pipeline.
// Finds matching existing leads in walkin_enquiries and assigns proposed
// actions (create/update/skip/manual_review) to each import row.

import type { PoolClient } from "pg";
import { query } from "@/lib/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MatchType =
  | "exact_external_ref"
  | "exact_phone"
  | "exact_alt_phone"
  | "phone_as_alt"
  | "fuzzy_phone_suffix";

export interface DedupCandidate {
  existingId: number;
  matchType: MatchType;
  confidence: number; // 0-100
  existingRecord: Record<string, any>;
}

export interface DedupResult {
  importRowId: string;
  candidates: DedupCandidate[];
  bestMatch: DedupCandidate | null;
  proposedAction: "create" | "update" | "skip" | "manual_review";
  reason: string;
}

// Fields that should NEVER be overwritten by an import
const NEVER_OVERWRITE = new Set([
  "id",
  "organization_id",
  "created_at",
  "updated_at",
  "sr_no",
  "import_job_id",
  "status",
  "is_global_shared",
  "channel_partner_id",
]);

// Fields overwritten ONLY when the existing value is null or empty
const FILL_IF_EMPTY = new Set([
  "email",
  "address",
  "occupation",
  "organization",
  "budget",
  "configuration",
  "purpose",
  "alt_phone",
  "source_other",
  "referral_name",
  "cp_name",
  "cp_company",
  "cp_phone",
  "feedback",
  "source",
  "external_ref",
]);

// Fields always overwritten from the import job (not the row)
const ALWAYS_FROM_JOB = new Set(["assigned_to", "overseeing_site_head"]);

// ---------------------------------------------------------------------------
// Candidate finding
// ---------------------------------------------------------------------------

/**
 * Find dedup candidates for a single import row by querying
 * walkin_enquiries on phone, alt_phone, and external_ref.
 */
async function findCandidates(
  phone: string | null,
  altPhone: string | null,
  externalRef: string | null,
  orgId: string,
  client?: PoolClient
): Promise<DedupCandidate[]> {
  const run = client
    ? (sql: string, params: any[]) => client.query(sql, params).then((r) => r.rows)
    : (sql: string, params: any[]) => query(sql, params);

  // Build UNION ALL query for all match types in one round trip
  const unions: string[] = [];
  const params: any[] = [orgId]; // $1 = orgId
  let idx = 2;

  // Track which param index holds the phone value for the fuzzy exclusion
  let phoneParamIdx: number | null = null;

  if (externalRef) {
    params.push(externalRef);
    unions.push(
      `(SELECT id, name, phone, alt_phone, external_ref, 'exact_external_ref' AS match_type, 100 AS confidence
       FROM walkin_enquiries
       WHERE organization_id = $1 AND external_ref = $${idx}
       LIMIT 5)`
    );
    idx++;
  }

  if (phone) {
    params.push(phone);
    phoneParamIdx = idx;
    unions.push(
      `(SELECT id, name, phone, alt_phone, external_ref, 'exact_phone' AS match_type, 95 AS confidence
       FROM walkin_enquiries
       WHERE organization_id = $1 AND phone = $${idx}
       LIMIT 5)`
    );
    // Cross-match: import phone vs existing alt_phone
    unions.push(
      `(SELECT id, name, phone, alt_phone, external_ref, 'exact_alt_phone' AS match_type, 85 AS confidence
       FROM walkin_enquiries
       WHERE organization_id = $1 AND alt_phone = $${idx}
       LIMIT 5)`
    );
    idx++;
  }

  if (altPhone) {
    params.push(altPhone);
    // Cross-match: import alt_phone vs existing phone
    unions.push(
      `(SELECT id, name, phone, alt_phone, external_ref, 'phone_as_alt' AS match_type, 85 AS confidence
       FROM walkin_enquiries
       WHERE organization_id = $1 AND phone = $${idx}
       LIMIT 5)`
    );
    idx++;
  }

  // Fuzzy: last 6 digits of phone (handles +91 prefix differences)
  if (phone && phone.replace(/\D/g, "").length >= 6 && phoneParamIdx !== null) {
    const digits = phone.replace(/\D/g, "");
    const suffix = digits.slice(-6);
    params.push(`%${suffix}`);
    unions.push(
      `(SELECT id, name, phone, alt_phone, external_ref, 'fuzzy_phone_suffix' AS match_type, 60 AS confidence
       FROM walkin_enquiries
       WHERE organization_id = $1 AND phone LIKE $${idx}
         AND phone != $${phoneParamIdx}
       LIMIT 5)`
    );
    idx++;
  }

  if (unions.length === 0) return [];

  const sql = unions.join("\nUNION ALL\n");
  const rows = await run(sql, params);

  // Deduplicate by existing id, keeping highest confidence
  const byId = new Map<number, DedupCandidate>();
  for (const row of rows) {
    const existing = byId.get(row.id);
    if (!existing || row.confidence > existing.confidence) {
      byId.set(row.id, {
        existingId: row.id,
        matchType: row.match_type as MatchType,
        confidence: row.confidence,
        existingRecord: row,
      });
    }
  }

  return Array.from(byId.values()).sort((a, b) => b.confidence - a.confidence);
}

// ---------------------------------------------------------------------------
// Action resolution
// ---------------------------------------------------------------------------

function resolveAction(candidates: DedupCandidate[]): {
  proposedAction: "create" | "update" | "skip" | "manual_review";
  bestMatch: DedupCandidate | null;
  reason: string;
} {
  if (candidates.length === 0) {
    return { proposedAction: "create", bestMatch: null, reason: "no_match" };
  }

  const best = candidates[0]; // already sorted desc by confidence

  if (best.confidence >= 95) {
    return {
      proposedAction: "update",
      bestMatch: best,
      reason: best.matchType,
    };
  }

  if (candidates.length === 1 && best.confidence >= 60) {
    return {
      proposedAction: "manual_review",
      bestMatch: best,
      reason: best.matchType,
    };
  }

  if (candidates.length > 1) {
    return {
      proposedAction: "manual_review",
      bestMatch: best,
      reason: `multiple_matches_${candidates.length}`,
    };
  }

  return { proposedAction: "create", bestMatch: null, reason: "low_confidence" };
}

// ---------------------------------------------------------------------------
// Merge policy
// ---------------------------------------------------------------------------

/**
 * Compute the fields to SET on an UPDATE based on merge policy.
 * Returns only keys that differ and are allowed to change.
 */
export function getMergeFields(
  existing: Record<string, any>,
  incoming: Record<string, any>,
  jobAssignedTo: string,
  jobSiteHead: string | null
): Record<string, any> {
  const updates: Record<string, any> = {};

  // Always overwrite from job metadata
  if (jobAssignedTo && jobAssignedTo !== existing.assigned_to) {
    updates.assigned_to = jobAssignedTo;
  }
  if (jobSiteHead !== undefined && jobSiteHead !== existing.overseeing_site_head) {
    updates.overseeing_site_head = jobSiteHead;
  }

  // Fill-if-empty fields from incoming parsed data
  const fieldMap: Record<string, string> = {
    // incoming key → walkin_enquiries column
    alt_phone: "alt_phone",
    source: "source",
    cp_name: "cp_name",
    cp_phone: "cp_phone",
    feedback: "feedback",
    configuration: "configuration",
    budget: "budget",
    external_ref: "external_ref",
  };

  for (const [inKey, dbCol] of Object.entries(fieldMap)) {
    if (NEVER_OVERWRITE.has(dbCol)) continue;
    const inVal = incoming[inKey];
    if (inVal == null || inVal === "") continue;
    const exVal = existing[dbCol];
    if (exVal != null && exVal !== "" && exVal !== "N/A" && exVal !== "Pending") continue;
    if (FILL_IF_EMPTY.has(dbCol)) {
      updates[dbCol] = inVal;
    }
  }

  // enquiry_date: overwrite if existing is null
  if (incoming.enquiry_date && !existing.enquiry_date) {
    updates.enquiry_date = incoming.enquiry_date;
  }

  // name/phone: never overwrite (these are the identity fields)

  return updates;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run deduplication on all valid rows of an import job.
 * Updates import_rows with proposed_action, matched_record_id, confidence, reason.
 */
export async function runDedup(
  jobId: string,
  orgId: string,
  client?: PoolClient
): Promise<DedupResult[]> {
  const run = client
    ? (sql: string, params: any[]) => client.query(sql, params).then((r) => r.rows)
    : (sql: string, params: any[]) => query(sql, params);

  // 1. Fetch all valid staged rows
  const stagedRows = await run(
    `SELECT id, normalized_data FROM import_rows
     WHERE import_job_id = $1 AND organization_id = $2 AND validation_status = 'valid'
     ORDER BY source_row_number ASC`,
    [jobId, orgId]
  );

  const results: DedupResult[] = [];

  // 2. Process each row
  for (const row of stagedRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : row.normalized_data;

    const phone: string | null = data?.phone || null;
    const altPhone: string | null = data?.alt_phone || null;
    const externalRef: string | null = data?.external_ref || null;

    // 3. Find candidates
    const candidates = await findCandidates(phone, altPhone, externalRef, orgId, client);

    // 4. Resolve action
    const { proposedAction, bestMatch, reason } = resolveAction(candidates);

    // 5. Update import_row
    await (client
      ? client.query(
          `UPDATE import_rows
           SET proposed_action = $1,
               matched_record_id = $2,
               match_confidence = $3,
               match_reason = $4,
               updated_at = now()
           WHERE id = $5`,
          [
            proposedAction,
            bestMatch?.existingId ?? null,
            bestMatch?.confidence ?? 0,
            reason,
            row.id,
          ]
        )
      : query(
          `UPDATE import_rows
           SET proposed_action = $1,
               matched_record_id = $2,
               match_confidence = $3,
               match_reason = $4,
               updated_at = now()
           WHERE id = $5`,
          [
            proposedAction,
            bestMatch?.existingId ?? null,
            bestMatch?.confidence ?? 0,
            reason,
            row.id,
          ]
        ));

    results.push({
      importRowId: row.id,
      candidates,
      bestMatch,
      proposedAction,
      reason,
    });
  }

  return results;
}
