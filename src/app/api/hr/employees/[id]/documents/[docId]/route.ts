// app/api/hr/employees/[id]/documents/[docId]/route.ts
//
// GET    — generate a short-lived presigned URL for private document download
// DELETE — soft-delete (supersede) a document
//
// Gate: hr, admin.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { generatePresignedUrl } from "@/lib/r2";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  const { id, docId } = await params;
  const gate = await requireRoles(["hr", "admin"]);
  if (!gate.ok) return gate.response;

  try {
    const orgId = await getOrganizationId();
    const userId = Number(id);
    const documentId = Number(docId);

    if (!Number.isInteger(userId) || !Number.isInteger(documentId)) {
      return NextResponse.json({ success: false, message: "Invalid ids." }, { status: 400 });
    }

    const rows = await query<{ r2_key: string; file_name: string }>(
      `SELECT r2_key, file_name FROM employee_documents
        WHERE id = $1 AND user_id = $2 AND organization_id = $3`,
      [documentId, userId, orgId]
    );

    if (rows.length === 0) {
      return NextResponse.json({ success: false, message: "Document not found." }, { status: 404 });
    }

    const url = await generatePresignedUrl(rows[0].r2_key, 300); // 5-minute URL

    return NextResponse.json({
      success: true,
      data: { url, fileName: rows[0].file_name },
    });
  } catch (err: any) {
    console.error("[GET document download]", err);
    return NextResponse.json(
      { success: false, message: "Failed to generate download link." },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  const { id, docId } = await params;
  const gate = await requireRoles(["hr", "admin"]);
  if (!gate.ok) return gate.response;

  try {
    const orgId = await getOrganizationId();
    const userId = Number(id);
    const documentId = Number(docId);

    if (!Number.isInteger(userId) || !Number.isInteger(documentId)) {
      return NextResponse.json({ success: false, message: "Invalid ids." }, { status: 400 });
    }

    // Soft-delete: set superseded_by to itself (marks it as retired).
    const result = await query<any>(
      `UPDATE employee_documents
          SET superseded_by = id
        WHERE id = $1 AND user_id = $2 AND organization_id = $3
          AND superseded_by IS NULL
        RETURNING id`,
      [documentId, userId, orgId]
    );

    if (result.length === 0) {
      return NextResponse.json({ success: false, message: "Document not found." }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: "Document removed." });
  } catch (err: any) {
    console.error("[DELETE document]", err);
    return NextResponse.json({ success: false, message: "Failed to delete document." }, { status: 500 });
  }
}
