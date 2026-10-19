import { NextRequest, NextResponse } from "next/server";
import { requireRoles, getSessionUserId } from "@/lib/serverAuth";
import { query } from "@/lib/db";
import { TRIGGER_DEFAULTS, TRIGGER_MAP } from "@/lib/email/triggerDefaults";

export const dynamic = "force-dynamic";

// GET /api/admin/email-config — list all email trigger configurations
export async function GET() {
  const gate = await requireRoles(["admin", "super_admin"]);
  if (!gate.ok) return gate.response;

  try {
    // Ensure all triggers exist in the table (idempotent seed)
    await seedTriggers();

    const rows = await query<{
      trigger_key: string;
      display_name: string;
      category: string;
      description: string;
      recipient_desc: string;
      enabled: boolean;
      custom_subject: string | null;
      custom_body: string | null;
      default_subject: string;
      default_body: string;
      variables: string[];
      updated_at: string;
      updated_by: number | null;
      updater_name: string | null;
    }>(
      `SELECT c.*, u.name AS updater_name
       FROM email_trigger_config c
       LEFT JOIN users u ON u.id = c.updated_by
       ORDER BY c.category, c.display_name`
    );

    const total = rows.length;
    const enabled = rows.filter((r) => r.enabled).length;
    const disabled = total - enabled;

    return NextResponse.json({
      success: true,
      triggers: rows,
      stats: { total, enabled, disabled },
    });
  } catch (err: any) {
    // Table may not exist yet
    if (err.code === "42P01") {
      return NextResponse.json({
        success: true,
        triggers: TRIGGER_DEFAULTS.map((t) => ({
          ...t,
          enabled: true,
          custom_subject: null,
          custom_body: null,
          updated_at: new Date().toISOString(),
          updated_by: null,
          updater_name: null,
        })),
        stats: {
          total: TRIGGER_DEFAULTS.length,
          enabled: TRIGGER_DEFAULTS.length,
          disabled: 0,
        },
        migration_pending: true,
      });
    }
    console.error("[GET /api/admin/email-config]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// PATCH /api/admin/email-config — update a trigger's config
export async function PATCH(req: NextRequest) {
  const gate = await requireRoles(["admin", "super_admin"]);
  if (!gate.ok) return gate.response;

  try {
    const body = await req.json();
    const { trigger_key, enabled, custom_subject, custom_body } = body;

    if (!trigger_key || typeof trigger_key !== "string") {
      return NextResponse.json(
        { success: false, message: "trigger_key is required." },
        { status: 400 }
      );
    }

    if (!TRIGGER_MAP.has(trigger_key)) {
      return NextResponse.json(
        { success: false, message: `Unknown trigger: ${trigger_key}` },
        { status: 400 }
      );
    }

    // Validate lengths
    if (custom_subject !== undefined && custom_subject !== null && custom_subject.length > 500) {
      return NextResponse.json(
        { success: false, message: "Subject must be under 500 characters." },
        { status: 400 }
      );
    }
    if (custom_body !== undefined && custom_body !== null && custom_body.length > 50000) {
      return NextResponse.json(
        { success: false, message: "Body must be under 50,000 characters." },
        { status: 400 }
      );
    }

    const userId = getSessionUserId(gate.session);

    // Build SET clause dynamically
    const sets: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (enabled !== undefined) {
      sets.push(`enabled = $${idx++}`);
      params.push(Boolean(enabled));
    }
    if (custom_subject !== undefined) {
      sets.push(`custom_subject = $${idx++}`);
      params.push(custom_subject || null);
    }
    if (custom_body !== undefined) {
      sets.push(`custom_body = $${idx++}`);
      params.push(custom_body || null);
    }

    if (sets.length === 0) {
      return NextResponse.json(
        { success: false, message: "No fields to update." },
        { status: 400 }
      );
    }

    sets.push(`updated_at = NOW()`);
    sets.push(`updated_by = $${idx++}`);
    params.push(userId);

    params.push(trigger_key);

    await seedTriggers();

    const result = await query(
      `UPDATE email_trigger_config SET ${sets.join(", ")} WHERE trigger_key = $${idx} RETURNING *`,
      params
    );

    if (result.length === 0) {
      return NextResponse.json(
        { success: false, message: "Trigger not found." },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, trigger: result[0] });
  } catch (err: any) {
    if (err.code === "42P01") {
      return NextResponse.json(
        { success: false, message: "Email configuration table not yet migrated. Apply 2026-10-19_email_trigger_config.sql first." },
        { status: 503 }
      );
    }
    console.error("[PATCH /api/admin/email-config]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// Idempotent seed — inserts defaults for any missing trigger_key.
async function seedTriggers() {
  for (const t of TRIGGER_DEFAULTS) {
    await query(
      `INSERT INTO email_trigger_config
         (trigger_key, display_name, category, description, recipient_desc, default_subject, default_body, variables)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       ON CONFLICT (trigger_key) DO NOTHING`,
      [
        t.trigger_key,
        t.display_name,
        t.category,
        t.description,
        t.recipient_desc,
        t.default_subject,
        t.default_body,
        JSON.stringify(t.variables),
      ]
    );
  }
}
