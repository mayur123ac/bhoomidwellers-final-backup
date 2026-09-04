// Stage 2 dry-run: classify name-matched orphans by company confidence
// READ-ONLY — no updates.
const { Pool } = require("pg");

const pool = new Pool({
  connectionString:
    "postgresql://neondb_owner:npg_dLBmKRVy60gY@ep-long-cloud-a1d5t8of-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false },
});

const LABELS = ["channel partner", "cp", "n/a", "na", "", "null"];

function norm(s) {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[^\w\s]/g, "");
}

async function run() {
  const client = await pool.connect();
  try {
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

    const highConfidence = [];
    const companyMismatch = [];
    const ambiguousResolved = [];
    const ambiguousStill = [];

    for (const row of orphans.rows) {
      if (!row.norm_name || LABELS.includes(row.norm_name)) continue;

      const matches = await client.query(`
        SELECT id, name, company_name
        FROM channel_partners
        WHERE BTRIM(REGEXP_REPLACE(
                LOWER(REGEXP_REPLACE(BTRIM(name), '\\s+', ' ', 'g')),
                '[[:punct:]]+$', '')) = $1
          AND organization_id = $2
      `, [row.norm_name, row.organization_id]);

      if (matches.rows.length === 1) {
        const cp = matches.rows[0];
        const enquiryCompany = norm(row.cp_company);
        const masterCompany = norm(cp.company_name);

        // High confidence: company matches OR one side is blank/null
        if (!enquiryCompany || !masterCompany || enquiryCompany === masterCompany) {
          highConfidence.push({
            walkin_id: row.id,
            cp_id: cp.id,
            enquiry: row.cp_name + " / " + (row.cp_company || "NULL"),
            master: cp.name + " / " + (cp.company_name || "NULL"),
            reason: !enquiryCompany || !masterCompany ? "one side blank" : "exact company match",
          });
        } else {
          // Check fuzzy company: one contains the other
          const fuzzy = enquiryCompany.includes(masterCompany) || masterCompany.includes(enquiryCompany);
          highConfidence.push({
            walkin_id: row.id,
            cp_id: cp.id,
            enquiry: row.cp_name + " / " + row.cp_company,
            master: cp.name + " / " + cp.company_name,
            reason: fuzzy ? "fuzzy company match" : null,
          }) && !fuzzy && companyMismatch.push(highConfidence.pop());
        }
      } else if (matches.rows.length > 1) {
        // Try to resolve by company
        const enquiryCompany = norm(row.cp_company);

        if (!enquiryCompany) {
          ambiguousStill.push({
            walkin_id: row.id,
            enquiry: row.cp_name + " / NULL",
            candidates: matches.rows.map((m) => "CP #" + m.id + " " + m.name + " / " + m.company_name),
            reason: "no company to disambiguate",
          });
          continue;
        }

        // Exact company match
        const exactCompany = matches.rows.filter((m) => norm(m.company_name) === enquiryCompany);
        if (exactCompany.length === 1) {
          ambiguousResolved.push({
            walkin_id: row.id,
            cp_id: exactCompany[0].id,
            enquiry: row.cp_name + " / " + row.cp_company,
            master: exactCompany[0].name + " / " + exactCompany[0].company_name,
            reason: "company resolved ambiguity",
          });
          continue;
        }

        // Fuzzy company match (substring)
        const fuzzyCompany = matches.rows.filter((m) => {
          const mc = norm(m.company_name);
          return mc && (enquiryCompany.includes(mc) || mc.includes(enquiryCompany));
        });
        if (fuzzyCompany.length === 1) {
          ambiguousResolved.push({
            walkin_id: row.id,
            cp_id: fuzzyCompany[0].id,
            enquiry: row.cp_name + " / " + row.cp_company,
            master: fuzzyCompany[0].name + " / " + fuzzyCompany[0].company_name,
            reason: "fuzzy company resolved ambiguity",
          });
          continue;
        }

        ambiguousStill.push({
          walkin_id: row.id,
          enquiry: row.cp_name + " / " + (row.cp_company || "NULL"),
          candidates: matches.rows.map((m) => "CP #" + m.id + " " + m.name + " / " + m.company_name),
          reason: exactCompany.length > 1 ? "multiple company matches" : "no company match among candidates",
        });
      }
    }

    // --- Report ---
    console.log("=== STAGE 2: CLASSIFICATION REPORT ===\n");

    console.log("HIGH-CONFIDENCE MATCHES:", highConfidence.length);
    console.log("─".repeat(70));
    highConfidence.forEach((r) => {
      console.log(
        "  walkin #" + r.walkin_id + " -> CP #" + r.cp_id +
        "  [" + r.reason + "]"
      );
      console.log("    enquiry: " + r.enquiry);
      console.log("    master:  " + r.master);
    });

    console.log("\nNAME-ONLY / COMPANY MISMATCH:", companyMismatch.length);
    console.log("─".repeat(70));
    companyMismatch.forEach((r) => {
      console.log("  walkin #" + r.walkin_id + " -> CP #" + r.cp_id);
      console.log("    enquiry: " + r.enquiry);
      console.log("    master:  " + r.master);
    });

    console.log("\nAMBIGUOUS — RESOLVED BY COMPANY:", ambiguousResolved.length);
    console.log("─".repeat(70));
    ambiguousResolved.forEach((r) => {
      console.log(
        "  walkin #" + r.walkin_id + " -> CP #" + r.cp_id +
        "  [" + r.reason + "]"
      );
      console.log("    enquiry: " + r.enquiry);
      console.log("    master:  " + r.master);
    });

    console.log("\nAMBIGUOUS — STILL UNRESOLVED:", ambiguousStill.length);
    console.log("─".repeat(70));
    ambiguousStill.forEach((r) => {
      console.log("  walkin #" + r.walkin_id + ": " + r.enquiry + "  [" + r.reason + "]");
      r.candidates.forEach((c) => console.log("    -> " + c));
    });

    console.log("\n=== SUMMARY ===");
    console.log("High-confidence:              ", highConfidence.length, " IDs: [" + highConfidence.map((r) => r.walkin_id).join(", ") + "]");
    console.log("Company-mismatch:             ", companyMismatch.length, " IDs: [" + companyMismatch.map((r) => r.walkin_id).join(", ") + "]");
    console.log("Ambiguous resolved by company:", ambiguousResolved.length, " IDs: [" + ambiguousResolved.map((r) => r.walkin_id).join(", ") + "]");
    console.log("Still ambiguous:              ", ambiguousStill.length, " IDs: [" + ambiguousStill.map((r) => r.walkin_id).join(", ") + "]");
    console.log("TOTAL BACKFILL-READY:         ", highConfidence.length + ambiguousResolved.length);

  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
