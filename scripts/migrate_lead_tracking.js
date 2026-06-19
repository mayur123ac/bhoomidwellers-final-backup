const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const envPath = path.join(__dirname, "..", ".env.local");
const envFile = fs.readFileSync(envPath, "utf8");

let dbUrl = "";
for (const line of envFile.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const sep = trimmed.indexOf("=");
  if (sep === -1) continue;
  const key = trimmed.slice(0, sep);
  if (key === "DATABASE_URL") {
    dbUrl = trimmed.slice(sep + 1).trim().replace(/^"|"$/g, "");
    break;
  }
}

if (!dbUrl) {
  console.error("ERROR: DATABASE_URL not found in .env.local");
  process.exit(1);
}

const pool = new Pool({ connectionString: dbUrl });

async function migrate() {
  const client = await pool.connect();
  try {
    console.log("Migrating lead tracking fields...");
    await client.query("BEGIN");

    await client.query(`
      ALTER TABLE walkin_enquiries
      ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS first_contact_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS site_visit_history JSONB DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS loan_tracking_info JSONB DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS referral_info JSONB DEFAULT '{}'::jsonb
    `);

    await client.query(`
      DO $$
      BEGIN
        IF to_regclass('public.leads') IS NOT NULL THEN
          EXECUTE $sql$
            ALTER TABLE leads
            ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP WITH TIME ZONE,
            ADD COLUMN IF NOT EXISTS first_contact_at TIMESTAMP WITH TIME ZONE,
            ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP WITH TIME ZONE,
            ADD COLUMN IF NOT EXISTS site_visit_history JSONB DEFAULT '[]'::jsonb,
            ADD COLUMN IF NOT EXISTS loan_tracking_info JSONB DEFAULT '{}'::jsonb,
            ADD COLUMN IF NOT EXISTS referral_info JSONB DEFAULT '{}'::jsonb
          $sql$;
        END IF;
      END $$;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS lead_assignment_logs (
        id SERIAL PRIMARY KEY,
        lead_id INTEGER NOT NULL,
        assigned_to VARCHAR(255),
        assigned_by VARCHAR(255),
        assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        reason TEXT
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_lead_assignment_logs_lead_id
      ON lead_assignment_logs(lead_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_lead_assignment_logs_assigned_at
      ON lead_assignment_logs(assigned_at DESC)
    `);

    await client.query(`
      UPDATE walkin_enquiries
      SET status = 'Assigned'
      WHERE status IN ('Routed', 'ROUTED')
    `);

    await client.query(`
      DO $$
      BEGIN
        IF to_regclass('public.leads') IS NOT NULL THEN
          EXECUTE $sql$
            UPDATE leads
            SET status = 'Assigned'
            WHERE status IN ('Routed', 'ROUTED')
          $sql$;
        END IF;
      END $$;
    `);

    await client.query(`
      UPDATE walkin_enquiries
      SET assigned_at = COALESCE(assigned_at, created_at, NOW())
      WHERE assigned_at IS NULL
        AND assigned_to IS NOT NULL
        AND assigned_to <> ''
    `);

    await client.query(`
      DO $$
      BEGIN
        IF to_regclass('public.leads') IS NOT NULL THEN
          EXECUTE $sql$
            UPDATE leads
            SET assigned_at = COALESCE(assigned_at, created_at, NOW())
            WHERE assigned_at IS NULL
              AND assign_manager IS NOT NULL
              AND assign_manager <> ''
          $sql$;
        END IF;
      END $$;
    `);

    await client.query("COMMIT");
    console.log("Lead tracking migration successful!");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Lead tracking migration failed:", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
