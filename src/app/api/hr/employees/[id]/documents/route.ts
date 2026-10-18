// app/api/hr/employees/[id]/documents/route.ts
//
// GET  — list employee documents with verification status
// POST — upload a document to R2 (private, presigned URL for download)
//
// Gate: hr, admin for full access. Employee can upload own permitted docs.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRoles, requireSession, getSessionUserId } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { uploadBufferToR2 } from "@/lib/r2";
import { resolveComplianceTask } from "@/lib/hr/profileCompleteness";
import { MAX_DOC_SIZE_BYTES, ALLOWED_DOC_MIMES } from "@/lib/hr/constants";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const gate = await requireRoles(["hr", "admin"]);
  if (!gate.ok) return gate.response;

  try {
    const orgId = await getOrganizationId();
    const userId = Number(id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json({ success: false, message: "Invalid id." }, { status: 400 });
    }

    const rows = await query<any>(
      `SELECT d.id, d.document_type, d.file_name, d.mime_type, d.file_size,
              d.verification_status, d.verified_by, v.name AS verified_by_name,
              d.verified_at, d.rejection_reason, d.expiry_date, d.version,
              d.created_at, u2.name AS uploaded_by_name
         FROM employee_documents d
         LEFT JOIN users v ON v.id = d.verified_by
         LEFT JOIN users u2 ON u2.id = d.uploaded_by
        WHERE d.user_id = $1 AND d.organization_id = $2
          AND d.superseded_by IS NULL
        ORDER BY d.created_at DESC`,
      [userId, orgId]
    );

    return NextResponse.json({ success: true, data: rows });
  } catch (err: any) {
    console.error("[GET documents]", err);
    return NextResponse.json({ success: false, message: "Failed to load documents." }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Allow HR/admin to upload for any employee, or employee to upload own docs.
  const sessionGate = await requireSession();
  if (!sessionGate.ok) return sessionGate.response;

  const viewerRole = (sessionGate.session.role ?? "").toLowerCase().replace(/_/g, " ");
  const viewerId = getSessionUserId(sessionGate.session);
  const targetUserId = Number(id);
  const isHrOrAdmin = viewerRole === "hr" || viewerRole === "admin";

  if (!isHrOrAdmin && viewerId !== targetUserId) {
    return NextResponse.json(
      { success: false, message: "You can only upload documents for your own profile." },
      { status: 403 }
    );
  }

  try {
    const orgId = await getOrganizationId();
    if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
      return NextResponse.json({ success: false, message: "Invalid id." }, { status: 400 });
    }

    // Verify target user belongs to this org.
    const emp = await query("SELECT id FROM users WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL", [targetUserId, orgId]);
    if (emp.length === 0) {
      return NextResponse.json({ success: false, message: "Employee not found." }, { status: 404 });
    }

    const formData = await req.formData();
    const documentType = formData.get("documentType") as string;
    const file = formData.get("file") as File;

    if (!documentType?.trim()) {
      return NextResponse.json({ success: false, message: "Document type is required." }, { status: 400 });
    }
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ success: false, message: "File is required." }, { status: 400 });
    }
    if (file.size > MAX_DOC_SIZE_BYTES) {
      return NextResponse.json({ success: false, message: `File exceeds ${MAX_DOC_SIZE_BYTES / (1024 * 1024)} MB limit.` }, { status: 400 });
    }
    if (!(ALLOWED_DOC_MIMES as readonly string[]).includes(file.type)) {
      return NextResponse.json({ success: false, message: `File type ${file.type} not allowed.` }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = file.name.split(".").pop() || "bin";
    const r2Key = `hr-docs/${orgId}/${targetUserId}/${documentType}_${Date.now()}.${ext}`;

    await uploadBufferToR2(r2Key, buffer, file.type);

    // Supersede any existing doc of the same type.
    const existing = await query<{ id: number }>(
      `SELECT id FROM employee_documents
        WHERE user_id = $1 AND organization_id = $2 AND document_type = $3
          AND superseded_by IS NULL
        ORDER BY created_at DESC LIMIT 1`,
      [targetUserId, orgId, documentType.trim()]
    );
    const prevVersion = existing.length > 0 ? existing[0].id : null;
    const newVersion = prevVersion ? (await query<{ version: number }>(
      "SELECT version FROM employee_documents WHERE id = $1", [prevVersion]
    ))[0]?.version + 1 || 1 : 1;

    const result = await query<{ id: number }>(
      `INSERT INTO employee_documents
         (user_id, organization_id, document_type, file_name, r2_key, mime_type,
          file_size, verification_status, version, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9)
       RETURNING id`,
      [
        targetUserId, orgId, documentType.trim(), file.name, r2Key,
        file.type, file.size, newVersion, viewerId,
      ]
    );

    const newDocId = result[0].id;

    // Link superseded doc.
    if (prevVersion) {
      await query(
        "UPDATE employee_documents SET superseded_by = $1 WHERE id = $2",
        [newDocId, prevVersion]
      );
    }

    // Auto-resolve compliance task for this doc type.
    if (viewerId) {
      await resolveComplianceTask(targetUserId, orgId, documentType.trim(), viewerId);
    }

    return NextResponse.json(
      { success: true, id: newDocId, message: "Document uploaded." },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("[POST documents]", err);
    return NextResponse.json({ success: false, message: "Failed to upload document." }, { status: 500 });
  }
}

// PATCH — verify or reject a document (HR/admin only).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: _userId } = await params;
  const gate = await requireRoles(["hr", "admin"]);
  if (!gate.ok) return gate.response;

  try {
    const orgId = await getOrganizationId();
    const body = await req.json();
    const { documentId, action, rejectionReason } = body;

    if (!documentId || !["verify", "reject"].includes(action)) {
      return NextResponse.json({ success: false, message: "documentId and action (verify|reject) required." }, { status: 400 });
    }
    if (action === "reject" && !rejectionReason?.trim()) {
      return NextResponse.json({ success: false, message: "Rejection reason is required." }, { status: 400 });
    }

    const verifierId = getSessionUserId(gate.session);
    const status = action === "verify" ? "verified" : "rejected";

    const result = await query<any>(
      `UPDATE employee_documents
          SET verification_status = $1,
              verified_by = $2,
              verified_at = now(),
              rejection_reason = $3
        WHERE id = $4 AND organization_id = $5
          AND verification_status = 'pending'
        RETURNING id, user_id, document_type`,
      [status, verifierId, action === "reject" ? rejectionReason.trim() : null, documentId, orgId]
    );

    if (result.length === 0) {
      return NextResponse.json({ success: false, message: "Document not found or already processed." }, { status: 404 });
    }

    // If verified, resolve the compliance task.
    if (action === "verify" && verifierId) {
      const doc = result[0];
      await resolveComplianceTask(doc.user_id, orgId, doc.document_type, verifierId);
    }

    return NextResponse.json({ success: true, message: `Document ${status}.` });
  } catch (err: any) {
    console.error("[PATCH documents]", err);
    return NextResponse.json({ success: false, message: "Failed to update document." }, { status: 500 });
  }
}
