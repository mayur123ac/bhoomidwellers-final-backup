// app/api/import/[jobId]/rows/[rowId]/override/route.ts
// PATCH — Override the proposed dedup action for a specific import row.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { query } from "@/lib/db";
import { getImportJob } from "@/lib/import/engine";

export const dynamic = "force-dynamic";

const VALID_OVERRIDES = ["create", "update", "skip"] as const;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ jobId: string; rowId: string }> }
) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const orgId = await getOrganizationId();
    const { jobId, rowId } = await params;

    // 1. Verify job exists and is reviewable
    const job = await getImportJob(jobId, orgId);
    if (!job) {
      return NextResponse.json(
        { success: false, message: "Import job not found." },
        { status: 404 }
      );
    }
    if (job.status !== "ready_for_review") {
      return NextResponse.json(
        { success: false, message: `Job is in status "${job.status}" — overrides only allowed during review.` },
        { status: 400 }
      );
    }

    // 2. Parse and validate body
    const body = await req.json();
    const action = body?.action;
    if (!action || !VALID_OVERRIDES.includes(action)) {
      return NextResponse.json(
        { success: false, message: `Invalid action. Must be one of: ${VALID_OVERRIDES.join(", ")}` },
        { status: 400 }
      );
    }

    // 3. Verify row belongs to this job and org
    const rows = await query<{ id: string }>(
      `SELECT id FROM import_rows
        WHERE id = $1 AND import_job_id = $2 AND organization_id = $3`,
      [rowId, jobId, orgId]
    );
    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, message: "Import row not found." },
        { status: 404 }
      );
    }

    // 4. Apply override
    await query(
      `UPDATE import_rows SET user_override_action = $1, updated_at = now()
        WHERE id = $2`,
      [action, rowId]
    );

    return NextResponse.json({ success: true, action });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, message: msg }, { status: 500 });
  }
}
