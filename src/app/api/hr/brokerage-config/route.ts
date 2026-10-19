import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = await requireRoles(["hr", "admin"]);
  if (!gate.ok) return gate.response!;

  try {
    const orgId = await getOrganizationId();
    if (!orgId) {
      return NextResponse.json(
        { success: false, error: "Organization not found" },
        { status: 403 }
      );
    }

    const globalResult = await query(
      `SELECT default_brokerage_rate, default_brokerage_method,
              COALESCE(brokerage_calculation_basis, 'agreement_value') AS brokerage_calculation_basis
       FROM organization_settings
       WHERE organization_id = $1`,
      [orgId]
    );

    const projectsResult = await query(
      `SELECT id, project_name, brokerage_rate, brokerage_method,
              effective_from, notes, created_at, updated_at
       FROM project_brokerage_config
       WHERE organization_id = $1
       ORDER BY project_name`,
      [orgId]
    );

    const g = globalResult[0] || {};
    return NextResponse.json({
      success: true,
      data: {
        global: {
          defaultBrokerageRate: Number(g.default_brokerage_rate ?? 0),
          defaultBrokerageMethod: g.default_brokerage_method || "percentage",
          calculationBasis: g.brokerage_calculation_basis || "agreement_value",
        },
        projects: projectsResult.map((p: any) => ({
          id: p.id,
          projectName: p.project_name,
          brokerageRate: Number(p.brokerage_rate),
          brokerageMethod: p.brokerage_method,
          effectiveFrom: p.effective_from,
          notes: p.notes,
        })),
      },
    });
  } catch (error: any) {
    console.error("GET /api/hr/brokerage-config error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireRoles(["hr", "admin"]);
  if (!gate.ok) return gate.response!;

  try {
    const orgId = await getOrganizationId();
    if (!orgId) {
      return NextResponse.json(
        { success: false, error: "Organization not found" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { type } = body;

    if (type === "global") {
      const brokerageRate = body.defaultBrokerageRate ?? body.brokerageRate;
      const brokerageMethod = body.defaultBrokerageMethod ?? body.brokerageMethod;
      const calculationBasis = body.calculationBasis;

      if (brokerageRate === undefined || !brokerageMethod) {
        return NextResponse.json(
          { success: false, error: "brokerageRate and brokerageMethod are required" },
          { status: 400 }
        );
      }

      if (brokerageMethod !== "percentage" && brokerageMethod !== "fixed") {
        return NextResponse.json(
          { success: false, error: "brokerageMethod must be 'percentage' or 'fixed'" },
          { status: 400 }
        );
      }

      const rate = Number(brokerageRate);
      if (isNaN(rate) || rate < 0) {
        return NextResponse.json(
          { success: false, error: "brokerageRate must be a non-negative number" },
          { status: 400 }
        );
      }

      if (brokerageMethod === "percentage" && rate > 100) {
        return NextResponse.json(
          { success: false, error: "Percentage rate cannot exceed 100" },
          { status: 400 }
        );
      }

      // Validate calculationBasis if provided
      const validBases = ["agreement_value", "booking_amount", "ocr_amount", "disbursement_amount"];
      if (calculationBasis && !validBases.includes(calculationBasis)) {
        return NextResponse.json(
          { success: false, error: `calculationBasis must be one of: ${validBases.join(", ")}` },
          { status: 400 }
        );
      }

      const result = await transaction(async (client) => {
        // Fetch old values for audit
        const oldResult = await client.query(
          `SELECT default_brokerage_rate, default_brokerage_method,
                  COALESCE(brokerage_calculation_basis, 'agreement_value') AS brokerage_calculation_basis
           FROM organization_settings
           WHERE organization_id = $1`,
          [orgId]
        );
        const oldValues = oldResult.rows[0] || {};

        // Update global defaults (include calculation_basis if provided)
        if (calculationBasis) {
          await client.query(
            `UPDATE organization_settings
             SET default_brokerage_rate = $1,
                 default_brokerage_method = $2,
                 brokerage_calculation_basis = $3
             WHERE organization_id = $4`,
            [rate, brokerageMethod, calculationBasis, orgId]
          );
        } else {
          await client.query(
            `UPDATE organization_settings
             SET default_brokerage_rate = $1,
                 default_brokerage_method = $2
             WHERE organization_id = $3`,
            [rate, brokerageMethod, orgId]
          );
        }

        // Insert audit log
        const newValues: any = {
          default_brokerage_rate: rate,
          default_brokerage_method: brokerageMethod,
        };
        if (calculationBasis) newValues.brokerage_calculation_basis = calculationBasis;

        await client.query(
          `INSERT INTO brokerage_audit_log
           (organization_id, entity_type, action, old_values, new_values, changed_by)
           VALUES ($1, 'global_config', 'updated',
                   $2::jsonb, $3::jsonb, $4)`,
          [
            orgId,
            JSON.stringify(oldValues),
            JSON.stringify(newValues),
            gate.userId,
          ]
        );

        return { default_brokerage_rate: rate, default_brokerage_method: brokerageMethod, brokerage_calculation_basis: calculationBasis || oldValues.brokerage_calculation_basis || "agreement_value" };
      });

      return NextResponse.json({ success: true, data: result });
    }

    if (type === "project") {
      const { projectName, brokerageRate, brokerageMethod, effectiveFrom, notes } = body;

      if (!projectName || brokerageRate === undefined || !brokerageMethod) {
        return NextResponse.json(
          { success: false, error: "projectName, brokerageRate, and brokerageMethod are required" },
          { status: 400 }
        );
      }

      if (brokerageMethod !== "percentage" && brokerageMethod !== "fixed") {
        return NextResponse.json(
          { success: false, error: "brokerageMethod must be 'percentage' or 'fixed'" },
          { status: 400 }
        );
      }

      const rate = Number(brokerageRate);
      if (isNaN(rate) || rate < 0) {
        return NextResponse.json(
          { success: false, error: "brokerageRate must be a non-negative number" },
          { status: 400 }
        );
      }

      if (brokerageMethod === "percentage" && rate > 100) {
        return NextResponse.json(
          { success: false, error: "Percentage rate cannot exceed 100" },
          { status: 400 }
        );
      }

      const result = await transaction(async (client) => {
        // Check for existing record for audit
        const existingResult = await client.query(
          `SELECT id, brokerage_rate, brokerage_method, effective_from, notes
           FROM project_brokerage_config
           WHERE organization_id = $1 AND project_name = $2`,
          [orgId, projectName]
        );
        const oldValues = existingResult.rows[0] || null;

        // Upsert project config
        const upsertResult = await client.query(
          `INSERT INTO project_brokerage_config
           (organization_id, project_name, brokerage_rate, brokerage_method, effective_from, notes, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (organization_id, project_name) DO UPDATE
           SET brokerage_rate = EXCLUDED.brokerage_rate,
               brokerage_method = EXCLUDED.brokerage_method,
               effective_from = EXCLUDED.effective_from,
               notes = EXCLUDED.notes,
               updated_at = NOW()
           RETURNING *`,
          [orgId, projectName, rate, brokerageMethod, effectiveFrom || null, notes || null, gate.userId]
        );

        // Insert audit log
        await client.query(
          `INSERT INTO brokerage_audit_log
           (organization_id, entity_type, entity_id, action, old_values, new_values, changed_by)
           VALUES ($1, 'project_config', $2, $3,
                   $4::jsonb, $5::jsonb, $6)`,
          [
            orgId,
            upsertResult.rows[0].id,
            oldValues ? "updated" : "created",
            oldValues ? JSON.stringify(oldValues) : null,
            JSON.stringify(upsertResult.rows[0]),
            gate.userId,
          ]
        );

        return upsertResult.rows[0];
      });

      return NextResponse.json({ success: true, data: result });
    }

    return NextResponse.json(
      { success: false, error: "Invalid type. Must be 'global' or 'project'" },
      { status: 400 }
    );
  } catch (error: any) {
    console.error("POST /api/hr/brokerage-config error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const gate = await requireRoles(["hr", "admin"]);
  if (!gate.ok) return gate.response!;

  try {
    const orgId = await getOrganizationId();
    if (!orgId) {
      return NextResponse.json(
        { success: false, error: "Organization not found" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId");

    if (!projectId) {
      return NextResponse.json(
        { success: false, error: "projectId query parameter is required" },
        { status: 400 }
      );
    }

    await transaction(async (client) => {
      // Fetch existing record for audit
      const existingResult = await client.query(
        `SELECT * FROM project_brokerage_config
         WHERE id = $1 AND organization_id = $2`,
        [projectId, orgId]
      );

      if (existingResult.rows.length === 0) {
        throw new Error("Project brokerage config not found");
      }

      const oldValues = existingResult.rows[0];

      // Delete
      await client.query(
        `DELETE FROM project_brokerage_config
         WHERE id = $1 AND organization_id = $2`,
        [projectId, orgId]
      );

      // Audit log
      await client.query(
        `INSERT INTO brokerage_audit_log
         (organization_id, entity_type, entity_id, action, old_values, new_values, changed_by)
         VALUES ($1, 'project_config', $2, 'deleted',
                 $3::jsonb, NULL, $4)`,
        [orgId, projectId, JSON.stringify(oldValues), gate.userId]
      );
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DELETE /api/hr/brokerage-config error:", error);
    const status = error.message === "Project brokerage config not found" ? 404 : 500;
    return NextResponse.json(
      { success: false, error: error.message || "Internal server error" },
      { status }
    );
  }
}
