// lib/db.ts
import { Pool, PoolClient } from "pg";

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // ssl: { rejectUnauthorized: false }, // ← Always ON for Neon
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    pool.on("error", (err) => console.error("[DB] Pool error", err));
  }
  return pool;
}

export async function query<T = any>(
  text: string,
  params?: any[]
): Promise<T[]> {
  const client = await getPool().connect();
  try {
    const result = await client.query(text, params);
    return result.rows as T[];
  } finally {
    client.release();
  }
}

export async function transaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function recalculateSrNos(client?: PoolClient) {
  // Read toggle from organization_settings (default false = off)
  let backdatedMode = false;
  try {
    const settingRows = client
      ? await client.query(
          "SELECT lead_number_sorting_enabled FROM organization_settings WHERE organization_id = 1"
        )
      : await getPool().connect().then(async (c) => {
          const r = await c.query(
            "SELECT lead_number_sorting_enabled FROM organization_settings WHERE organization_id = 1"
          );
          c.release();
          return r;
        });
    backdatedMode = settingRows.rows?.[0]?.lead_number_sorting_enabled === true;
  } catch {
    // If table doesn't have column yet, stay in default mode
    backdatedMode = false;
  }

  // OFF mode: purely chronological by creation date (ignore backdated entry)
  // ON mode: backdated entry takes priority, date_created is fallback
  const orderClause = backdatedMode
    ? `CASE
         WHEN auto_date_enabled = false AND enquiry_date IS NOT NULL
         THEN enquiry_date
         ELSE created_at
       END ASC, created_at ASC, id ASC`
    : `created_at ASC, id ASC`;

  const queryText = `
    WITH sorted_leads AS (
      SELECT id,
        ROW_NUMBER() OVER (ORDER BY ${orderClause}) AS new_sr_no
      FROM walkin_enquiries
    )
    UPDATE walkin_enquiries
    SET sr_no = sorted_leads.new_sr_no
    FROM sorted_leads
    WHERE walkin_enquiries.id = sorted_leads.id
    AND walkin_enquiries.sr_no IS DISTINCT FROM sorted_leads.new_sr_no;
  `;

  if (client) {
    await client.query(queryText);
  } else {
    await query(queryText);
  }
}

if (typeof window === "undefined") {
  setInterval(async () => {
    try {
      await query("SELECT 1");
    } catch {}
  }, 4 * 60 * 1000);
}