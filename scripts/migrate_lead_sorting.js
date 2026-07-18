const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

const envContent = fs.readFileSync(path.join(__dirname, "../.env.local"), "utf-8");
const dbUrlMatch = envContent.match(/DATABASE_URL="?([^"\n]+)"?/);
const pool = new Pool({ connectionString: dbUrlMatch[1] });

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    console.log("Adding lead_number_sorting_enabled to organization_settings...");
    await client.query(`
      ALTER TABLE organization_settings 
      ADD COLUMN IF NOT EXISTS lead_number_sorting_enabled BOOLEAN NOT NULL DEFAULT FALSE;
    `);
    // Ensure default row for org 1 exists
    await client.query(`
      INSERT INTO organization_settings (organization_id, shift_start, shift_end, flexible, lead_number_sorting_enabled)
      VALUES (1, '11:00', '20:00', false, false)
      ON CONFLICT (organization_id) DO NOTHING;
    `);
    await client.query("COMMIT");
    console.log("Migration successful.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Migration failed:", err);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();
