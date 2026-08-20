// lib/db.ts
import { Pool, PoolClient } from "pg";

let pool: Pool | undefined;

/**
 * Neon endpoints that are PRODUCTION and must never be opened from a developer
 * machine. Endpoint ids only — no credentials, and nothing secret: these are the
 * same identifiers that appear in a Neon dashboard URL.
 *
 * `ep-mute-credit-a1kaw2vj` is a frozen snapshot branch of production and is
 * listed for the same reason.
 */
const PRODUCTION_ENDPOINTS = ["ep-long-cloud-a1d5t8of", "ep-mute-credit-a1kaw2vj"];

/**
 * Refuse to open a production connection from a development process.
 *
 * This exists because a stale `next dev` kept a production DATABASE_URL in
 * memory after .env.local had been corrected, and the mismatch only surfaced as
 * a confusing "column organization_id does not exist" on login — the schema
 * error was the safety net, which is not a safety net at all.
 *
 * It throws BEFORE the Pool is constructed, so no socket is opened. It is scoped
 * to NODE_ENV !== "production" precisely so the deployed application, which is
 * *supposed* to use that endpoint, is unaffected.
 */
function assertNotProductionInDev(connectionString: string | undefined): void {
  if (!connectionString) return;
  if (process.env.NODE_ENV === "production") return;
  if (process.env.ALLOW_PROD_DB_IN_DEV === "1") return; // deliberate, explicit opt-out

  let hostname: string;
  try {
    hostname = new URL(connectionString).hostname;
  } catch {
    return; // not a URL we can reason about; leave it alone
  }

  const hit = PRODUCTION_ENDPOINTS.find((ep) => hostname.startsWith(ep));
  if (!hit) return;

  throw new Error(
    `[DB] Refusing to connect: DATABASE_URL points at the PRODUCTION Neon branch (${hit}) ` +
      `while NODE_ENV is "${process.env.NODE_ENV ?? "development"}". ` +
      `Local development must use the test branch. Fix DATABASE_URL in frontend/.env.local ` +
      `and RESTART the dev server — Next.js reads env once at startup, so editing the file ` +
      `is not enough on its own. ` +
      `Set ALLOW_PROD_DB_IN_DEV=1 only if you genuinely intend to read production.`
  );
}

export function getPool(): Pool {
  if (!pool) {
    assertNotProductionInDev(process.env.DATABASE_URL);
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
    // Imported dynamically: tenantContext imports getPool from this module, so a
    // static import here would close the cycle. This is the only such case.
    const { getOrganizationId } = await import("./tenantContext");
    const organizationId = await getOrganizationId(client);
    const SETTING_SQL =
      "SELECT lead_number_sorting_enabled FROM organization_settings WHERE organization_id = $1";
    const settingRows = client
      ? await client.query(SETTING_SQL, [organizationId])
      : await getPool().connect().then(async (c) => {
          const r = await c.query(SETTING_SQL, [organizationId]);
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

  // MT-05: sr_no is a per-organization sequence. Unscoped, this CTE renumbers
  // every organization's leads in ONE ordering, interleaving two builders'
  // sequences and rewriting rows that do not belong to the caller. The filter is
  // inside the CTE so the ROW_NUMBER() window is computed per organization —
  // filtering after the window would keep the interleaved numbering.
  //
  // Resolved via the same dynamic import used above: tenantContext imports
  // getPool from this module, so a static import would close the cycle.
  const { getOrganizationId: resolveOrg } = await import("./tenantContext");
  const srNoOrgId = await resolveOrg(client);

  const queryText = `
    WITH sorted_leads AS (
      SELECT id,
        ROW_NUMBER() OVER (ORDER BY ${orderClause}) AS new_sr_no
      FROM walkin_enquiries
      WHERE organization_id = $1
    )
    UPDATE walkin_enquiries
    SET sr_no = sorted_leads.new_sr_no
    FROM sorted_leads
    WHERE walkin_enquiries.id = sorted_leads.id
    AND walkin_enquiries.organization_id = $1
    AND walkin_enquiries.sr_no IS DISTINCT FROM sorted_leads.new_sr_no;
  `;

  if (client) {
    await client.query(queryText, [srNoOrgId]);
  } else {
    await query(queryText, [srNoOrgId]);
  }
}

if (typeof window === "undefined") {
  setInterval(async () => {
    try {
      await query("SELECT 1");
    } catch {}
  }, 4 * 60 * 1000);
}