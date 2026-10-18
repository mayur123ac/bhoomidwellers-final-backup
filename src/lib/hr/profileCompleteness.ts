// lib/hr/profileCompleteness.ts
//
// Evaluates whether an employee's HR profile is complete: do they have every
// mandatory document uploaded and accepted?
//
// The mandatory list is per-organization (hr_mandatory_documents). An employee
// is "complete" when every active mandatory type has at least one document in
// 'verified' or 'pending' status that has not been superseded. 'rejected'
// documents do not count.

import { query } from "@/lib/db";

export interface CompletenessResult {
  complete: boolean;
  total: number;
  fulfilled: number;
  missing: string[];
}

/**
 * Returns the profile-completeness status for one employee.
 *
 * `orgId` must come from the signed session / tenantContext, never from the
 * request body.
 */
export async function evaluateCompleteness(
  userId: number,
  orgId: string
): Promise<CompletenessResult> {
  const rows = await query<{
    document_type: string;
    label: string;
    doc_id: number | null;
  }>(
    `SELECT m.document_type, m.label, d.id AS doc_id
       FROM hr_mandatory_documents m
       LEFT JOIN employee_documents d
         ON d.user_id = $1
        AND d.organization_id = $2
        AND d.document_type = m.document_type
        AND d.verification_status IN ('verified', 'pending')
        AND d.superseded_by IS NULL
      WHERE m.organization_id = $2
        AND m.is_active = true
      ORDER BY m.sort_order`,
    [userId, orgId]
  );

  const missing: string[] = [];
  for (const r of rows) {
    if (r.doc_id === null) missing.push(r.document_type);
  }

  return {
    complete: missing.length === 0,
    total: rows.length,
    fulfilled: rows.length - missing.length,
    missing,
  };
}

/**
 * Creates idempotent compliance tasks for missing mandatory documents.
 *
 * The unique partial index on hr_compliance_tasks prevents duplicates: if a
 * pending/overdue task already exists for this (user, org, doc_type), the
 * INSERT is a no-op.
 */
export async function ensureComplianceTasks(
  userId: number,
  orgId: string,
  missing: string[],
  assignedHrId: number | null,
  deadlineDays: number = 14
): Promise<number> {
  if (missing.length === 0) return 0;

  let created = 0;
  const deadline = new Date();
  deadline.setDate(deadline.getDate() + deadlineDays);
  const deadlineStr = deadline.toISOString().slice(0, 10);

  for (const docType of missing) {
    const result = await query<{ id: number }>(
      `INSERT INTO hr_compliance_tasks
         (user_id, organization_id, document_type, deadline, assigned_hr_id)
       VALUES ($1, $2, $3, $4::date, $5)
       ON CONFLICT (user_id, organization_id, document_type)
         WHERE status IN ('pending', 'overdue')
       DO NOTHING
       RETURNING id`,
      [userId, orgId, docType, deadlineStr, assignedHrId]
    );
    if (result.length > 0) created++;
  }
  return created;
}

/**
 * Resolves a compliance task after the document is uploaded and verified.
 */
export async function resolveComplianceTask(
  userId: number,
  orgId: string,
  docType: string,
  resolvedBy: number
): Promise<void> {
  await query(
    `UPDATE hr_compliance_tasks
        SET status = 'resolved',
            resolved_at = now(),
            resolved_by = $4,
            updated_at = now()
      WHERE user_id = $1
        AND organization_id = $2
        AND document_type = $3
        AND status IN ('pending', 'overdue')`,
    [userId, orgId, docType, resolvedBy]
  );
}
