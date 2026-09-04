// Backfill 33 high-confidence orphan CP-linked leads.
// Sets channel_partner_id on walkin_enquiries where name+company match uniquely.
// Runs in a transaction. Aborts if candidate count !== 33.
const { Pool } = require("pg");

const pool = new Pool({
  connectionString:
    "postgresql://neondb_owner:npg_dLBmKRVy60gY@ep-long-cloud-a1d5t8of-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false },
});

const APPROVED_IDS = [
  18, 26, 36, 37, 42, 67, 72, 73, 75, 76, 77, 85, 93,
  98, 108, 110, 128, 129, 133, 139, 147, 152, 158, 161,
  162, 182, 183, 186, 190, 191, 193, 202, 203,
];

const LABELS = ["channel partner", "cp", "n/a", "na", "", "null"];

function norm(s) {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[^\w\s]/g, "");
}

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── Step 1: Re-derive candidates inside the transaction ──
    const orphans = await client.query(`
      SELECT
        w.id,
        w.cp_name,
        w.cp_company,
        w.organization_id,
        BTRIM(REGEXP_REPLACE(
          LOWER(REGEXP_REPLACE(BTRIM(COALESCE(w.cp_name, '')), '\\s+', ' ', 'g')),
          '[[:punct:]]+$', '')) AS norm_name
      FROM walkin_enquiries w
      WHERE w.id = ANY($1)
        AND TRIM(w.source) = ANY($2)
        AND w.channel_partner_id IS NULL
      ORDER BY w.id
    `, [APPROVED_IDS, ["Channel Partner", "CP"]]);

    const candidates = [];

    for (const row of orphans.rows) {
      if (!row.norm_name || LABELS.includes(row.norm_name)) continue;

      const matches = await client.query(`
        SELECT id, name, company_name, organization_id
        FROM channel_partners
        WHERE BTRIM(REGEXP_REPLACE(
                LOWER(REGEXP_REPLACE(BTRIM(name), '\\s+', ' ', 'g')),
                '[[:punct:]]+$', '')) = $1
          AND organization_id = $2
      `, [row.norm_name, row.organization_id]);

      if (matches.rows.length !== 1) continue;

      const cp = matches.rows[0];
      const enquiryCompany = norm(row.cp_company);
      const masterCompany = norm(cp.company_name);

      // Only high-confidence: exact company match, fuzzy match, or one side blank
      let confident = false;
      if (!enquiryCompany || !masterCompany || enquiryCompany === masterCompany) {
        confident = true;
      } else if (enquiryCompany.includes(masterCompany) || masterCompany.includes(enquiryCompany)) {
        confident = true;
      }

      if (!confident) continue;

      // Org safety check
      if (cp.organization_id !== row.organization_id) {
        console.error("CROSS-ORG VIOLATION: walkin #" + row.id + " org=" + row.organization_id + " vs CP #" + cp.id + " org=" + cp.organization_id);
        await client.query("ROLLBACK");
        process.exit(1);
      }

      candidates.push({ walkin_id: row.id, cp_id: cp.id });
    }

    // ── Step 2: Verify exactly 33 candidates ──
    console.log("Final candidate count:", candidates.length);
    console.log("Expected:             33");
    console.log("Candidate IDs:", candidates.map((c) => c.walkin_id).join(", "));
    console.log("");

    if (candidates.length !== 33) {
      console.error("ABORT: candidate count is not 33. Rolling back.");
      await client.query("ROLLBACK");
      process.exit(1);
    }

    // ── Step 3: Snapshot before-state ──
    const beforeSnap = await client.query(`
      SELECT id, channel_partner_id, cp_name, cp_company, cp_phone
      FROM walkin_enquiries
      WHERE id = ANY($1)
      ORDER BY id
    `, [APPROVED_IDS]);

    // Verify all are NULL before update
    const alreadyLinked = beforeSnap.rows.filter((r) => r.channel_partner_id !== null);
    if (alreadyLinked.length > 0) {
      console.error("ABORT: " + alreadyLinked.length + " rows already have channel_partner_id set.");
      alreadyLinked.forEach((r) => console.error("  walkin #" + r.id + " already has cp_id=" + r.channel_partner_id));
      await client.query("ROLLBACK");
      process.exit(1);
    }

    // ── Step 4: Execute updates ──
    let updated = 0;
    for (const c of candidates) {
      const result = await client.query(`
        UPDATE walkin_enquiries
        SET channel_partner_id = $1
        WHERE id = $2
          AND channel_partner_id IS NULL
      `, [c.cp_id, c.walkin_id]);
      updated += result.rowCount;
    }

    console.log("Rows updated:", updated);

    // ── Step 5: Post-update verification ──
    console.log("\n=== POST-UPDATE VERIFICATION ===");

    // 5a. All 33 now have channel_partner_id
    const afterSnap = await client.query(`
      SELECT w.id, w.channel_partner_id, w.cp_name, w.cp_company, w.cp_phone,
             w.organization_id AS w_org,
             cp.organization_id AS cp_org,
             cp.name AS cp_master_name
      FROM walkin_enquiries w
      LEFT JOIN channel_partners cp ON cp.id = w.channel_partner_id
      WHERE w.id = ANY($1)
      ORDER BY w.id
    `, [APPROVED_IDS]);

    const stillNull = afterSnap.rows.filter((r) => r.channel_partner_id === null);
    console.log("Rows with channel_partner_id set:  ", afterSnap.rows.length - stillNull.length);
    console.log("Rows still NULL:                   ", stillNull.length);

    // 5b. Cross-org check
    const crossOrg = afterSnap.rows.filter((r) => r.w_org !== r.cp_org);
    console.log("Cross-org violations:              ", crossOrg.length);
    if (crossOrg.length > 0) {
      console.error("CROSS-ORG FOUND — ROLLING BACK");
      crossOrg.forEach((r) => console.error("  walkin #" + r.id + " w_org=" + r.w_org + " cp_org=" + r.cp_org));
      await client.query("ROLLBACK");
      process.exit(1);
    }

    // 5c. Verify cp_name/cp_company/cp_phone unchanged
    let fieldsChanged = 0;
    for (let i = 0; i < afterSnap.rows.length; i++) {
      const before = beforeSnap.rows.find((r) => r.id === afterSnap.rows[i].id);
      const after = afterSnap.rows[i];
      if (before.cp_name !== after.cp_name || before.cp_company !== after.cp_company || before.cp_phone !== after.cp_phone) {
        fieldsChanged++;
        console.error("  walkin #" + after.id + ": cp fields changed!");
      }
    }
    console.log("Rows with cp_name/company/phone changed: ", fieldsChanged);

    // 5d. Verify no previously linked rows were changed
    const otherChanged = await client.query(`
      SELECT COUNT(*)::int AS cnt
      FROM walkin_enquiries
      WHERE TRIM(source) = ANY($1)
        AND channel_partner_id IS NOT NULL
        AND id != ALL($2)
    `, [["Channel Partner", "CP"], APPROVED_IDS]);

    // Compare with original 151 linked
    const totalLinkedNow = await client.query(`
      SELECT COUNT(*)::int AS cnt
      FROM walkin_enquiries
      WHERE TRIM(source) = ANY($1)
        AND channel_partner_id IS NOT NULL
    `, [["Channel Partner", "CP"]]);

    console.log("Total linked after backfill:        ", totalLinkedNow.rows[0].cnt, "(was 151, expected 184)");
    console.log("Previously linked unchanged:        ", otherChanged.rows[0].cnt, "(should be 151)");

    // 5e. Final orphan count
    const finalOrphans = await client.query(`
      SELECT COUNT(*)::int AS cnt
      FROM walkin_enquiries
      WHERE TRIM(source) = ANY($1)
        AND channel_partner_id IS NULL
    `, [["Channel Partner", "CP"]]);

    console.log("Final orphan count:                 ", finalOrphans.rows[0].cnt, "(was 129, expected 96)");

    // ── Step 6: Commit ──
    if (fieldsChanged > 0 || crossOrg.length > 0 || stillNull.length > 0) {
      console.error("\nVERIFICATION FAILED — ROLLING BACK");
      await client.query("ROLLBACK");
      process.exit(1);
    }

    await client.query("COMMIT");
    console.log("\nCOMMITTED SUCCESSFULLY.");

    console.log("\n=== FINAL REPORT ===");
    console.log("Rows updated:          33");
    console.log("Rows skipped:          96 (11 mismatch + 4 ambiguous + 81 unmatched)");
    console.log("Cross-org violations:  0");
    console.log("Fields modified:       channel_partner_id ONLY");
    console.log("Final orphan count:   ", finalOrphans.rows[0].cnt);

  } catch (err) {
    console.error("ERROR — ROLLING BACK:", err.message);
    await client.query("ROLLBACK");
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
