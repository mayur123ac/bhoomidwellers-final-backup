// Dry-run: inspect orphan CP-sourced walkin_enquiries and attempt matching
// READ-ONLY — no updates.
const { Pool } = require("pg");

const pool = new Pool({
  connectionString:
    "postgresql://neondb_owner:npg_dLBmKRVy60gY@ep-long-cloud-a1d5t8of-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false },
});

const LABELS = ["channel partner", "cp", "n/a", "na", "", "null"];

async function run() {
  const client = await pool.connect();
  try {
    // --- 1. cp_phone distribution ---
    const phones = await client.query(`
      SELECT cp_phone, COUNT(*)::int AS cnt
      FROM walkin_enquiries
      WHERE TRIM(source) = ANY($1)
        AND channel_partner_id IS NULL
      GROUP BY cp_phone
      ORDER BY cnt DESC
    `, [["Channel Partner", "CP"]]);

    console.log("=== ORPHAN cp_phone VALUES ===");
    phones.rows.forEach((r) =>
      console.log("  " + JSON.stringify(r.cp_phone) + " -> " + r.cnt + " rows")
    );

    // --- 2. cp_name distribution ---
    const names = await client.query(`
      SELECT cp_name, COUNT(*)::int AS cnt
      FROM walkin_enquiries
      WHERE TRIM(source) = ANY($1)
        AND channel_partner_id IS NULL
      GROUP BY cp_name
      ORDER BY cnt DESC
      LIMIT 30
    `, [["Channel Partner", "CP"]]);

    console.log("\n=== ORPHAN cp_name VALUES (top 30) ===");
    names.rows.forEach((r) =>
      console.log("  " + JSON.stringify(r.cp_name) + " -> " + r.cnt + " rows")
    );

    // --- 3. cp_company distribution ---
    const companies = await client.query(`
      SELECT cp_company, COUNT(*)::int AS cnt
      FROM walkin_enquiries
      WHERE TRIM(source) = ANY($1)
        AND channel_partner_id IS NULL
      GROUP BY cp_company
      ORDER BY cnt DESC
      LIMIT 30
    `, [["Channel Partner", "CP"]]);

    console.log("\n=== ORPHAN cp_company VALUES (top 30) ===");
    companies.rows.forEach((r) =>
      console.log("  " + JSON.stringify(r.cp_company) + " -> " + r.cnt + " rows")
    );

    // --- 4. Name-based matching (fallback) ---
    console.log("\n=== NAME-BASED MATCHING (fallback) ===");

    const orphans = await client.query(`
      SELECT
        w.id,
        w.cp_name,
        w.cp_company,
        w.cp_phone,
        w.organization_id,
        BTRIM(REGEXP_REPLACE(
          LOWER(REGEXP_REPLACE(BTRIM(COALESCE(w.cp_name, '')), '\\s+', ' ', 'g')),
          '[[:punct:]]+$', '')) AS norm_name
      FROM walkin_enquiries w
      WHERE TRIM(w.source) = ANY($1)
        AND w.channel_partner_id IS NULL
      ORDER BY w.id
    `, [["Channel Partner", "CP"]]);

    let nameMatchOne = 0;
    let nameMatchMulti = 0;
    let nameMatchNone = 0;
    let nonIdentifying = 0;
    let noName = 0;
    const nameMatchOneDetails = [];
    const nameMatchMultiDetails = [];

    for (const row of orphans.rows) {
      if (!row.norm_name || LABELS.includes(row.norm_name)) {
        if (!row.cp_name || !row.cp_name.trim()) noName++;
        else nonIdentifying++;
        continue;
      }

      const matches = await client.query(`
        SELECT id, name, company_name
        FROM channel_partners
        WHERE BTRIM(REGEXP_REPLACE(
                LOWER(REGEXP_REPLACE(BTRIM(name), '\\s+', ' ', 'g')),
                '[[:punct:]]+$', '')) = $1
          AND organization_id = $2
      `, [row.norm_name, row.organization_id]);

      if (matches.rows.length === 0) {
        nameMatchNone++;
      } else if (matches.rows.length === 1) {
        nameMatchOne++;
        nameMatchOneDetails.push({
          walkin_id: row.id,
          cp_name_enquiry: row.cp_name,
          cp_company_enquiry: row.cp_company,
          cp_id: matches.rows[0].id,
          cp_name_master: matches.rows[0].name,
          cp_company_master: matches.rows[0].company_name,
        });
      } else {
        nameMatchMulti++;
        nameMatchMultiDetails.push({
          walkin_id: row.id,
          cp_name_enquiry: row.cp_name,
          matches: matches.rows.map((m) => ({
            cp_id: m.id,
            name: m.name,
            company: m.company_name,
          })),
        });
      }
    }

    console.log("Total orphans:                  ", orphans.rows.length);
    console.log("No cp_name at all:              ", noName);
    console.log("Non-identifying name (cp, n/a): ", nonIdentifying);
    console.log("Name-matched to exactly ONE CP: ", nameMatchOne);
    console.log("Name-matched to MULTIPLE CPs:   ", nameMatchMulti);
    console.log("Name matched to NO CP:          ", nameMatchNone);

    if (nameMatchOneDetails.length > 0) {
      console.log("\n--- Single name-match details (backfill candidates) ---");
      nameMatchOneDetails.forEach((d) => {
        console.log(
          "  walkin #" + d.walkin_id +
          ': enquiry="' + d.cp_name_enquiry + " / " + d.cp_company_enquiry + '"' +
          " -> CP #" + d.cp_id +
          ' master="' + d.cp_name_master + " / " + d.cp_company_master + '"'
        );
      });
    }

    if (nameMatchMultiDetails.length > 0) {
      console.log("\n--- Multiple name-match details (ambiguous) ---");
      nameMatchMultiDetails.forEach((d) => {
        console.log("  walkin #" + d.walkin_id + ': "' + d.cp_name_enquiry + '"');
        d.matches.forEach((m) => {
          console.log("    -> CP #" + m.cp_id + ' "' + m.name + " / " + m.company + '"');
        });
      });
    }

    // --- 5. Summary ---
    console.log("\n=== BACKFILL SUMMARY ===");
    console.log("Safe to backfill (single name match): ", nameMatchOne);
    console.log("Ambiguous (multiple matches):          ", nameMatchMulti);
    console.log("Cannot match (no name or no CP found): ", noName + nonIdentifying + nameMatchNone);
    console.log("Total:                                 ", orphans.rows.length);

  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
