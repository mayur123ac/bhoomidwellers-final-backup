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
  const queryText = `
    WITH sorted_leads AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY enquiry_date ASC, created_at ASC, id ASC) as new_sr_no 
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