// Read-only preview: shows original vs proposed budget for every walkin_enquiries row
const { Pool } = require("pg");
const pool = new Pool({
  connectionString:
    "postgresql://neondb_owner:npg_dLBmKRVy60gY@ep-long-cloud-a1d5t8of-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false },
});

const BUDGET_PREVIEW_SQL = `
SELECT
  id,
  budget        AS orig,
  budget_unit   AS unit,
  CASE
    WHEN budget IS NULL THEN NULL
    WHEN TRIM(budget) = '' THEN budget

    -- Sentinels: Not Disclosed misspellings
    WHEN UPPER(TRIM(budget)) IN (
      'NOT DISCLOSED','NOT DISSCLOSED','NOT DISCOLOSD','NOT DISCOLOSAD',
      'NOT DISCLOSD','NOT DISLOSED','NOT DISCLOSSED','NOT DISCLOSED'
    ) THEN 'Not Disclosed'
    WHEN UPPER(TRIM(budget)) IN ('ND','N D') THEN 'Not Disclosed'
    WHEN TRIM(budget) IN ('Pending', 'N/A') THEN TRIM(budget)

    -- Non-budget text
    WHEN UPPER(TRIM(budget)) IN ('OPEN') THEN 'REVIEW:' || budget
    WHEN UPPER(TRIM(budget)) IN ('1BHK','1 BHK','2BHK','2 BHK','3BHK','3 BHK') THEN 'REVIEW:' || budget

    -- Structured: raw rupee amounts (>=6 digits) with unit
    WHEN budget_unit IS NOT NULL
     AND TRIM(budget) ~ '^\\d+$'
     AND LENGTH(TRIM(budget)) >= 6
    THEN 'REVIEW:' || budget || ' ' || budget_unit

    -- Structured: placeholder "00" -> Not Disclosed
    WHEN budget_unit IS NOT NULL AND TRIM(budget) = '00'
    THEN 'Not Disclosed'

    -- Structured: normal merge
    WHEN budget_unit IS NOT NULL
    THEN TRIM(budget) || ' ' || UPPER(budget_unit)

    -- Legacy: lakh variants
    WHEN budget_unit IS NULL
     AND TRIM(budget) ~* '^[\\d.,\\s\\-]+(to|and)?[\\d.,\\s\\-]*(lakh|lakhs|lac|lacs|l)\\s*\\+?\\s*$'
    THEN REGEXP_REPLACE(
           REGEXP_REPLACE(UPPER(TRIM(budget)), '\\s*(LAKH|LAKHS|LAC|LACS|L)\\s*\\+?\\s*$', ' LAKH'),
           '\\s+', ' ', 'g')

    -- Legacy: crore variants
    WHEN budget_unit IS NULL
     AND TRIM(budget) ~* '^[\\d.,\\s\\-]+(crore|crores|cr)\\s*$'
    THEN REGEXP_REPLACE(
           REGEXP_REPLACE(UPPER(TRIM(budget)), '\\s*(CRORE|CRORES|CR)\\s*$', ' CRORE'),
           '\\s+', ' ', 'g')

    -- Legacy: Indian-format large number
    WHEN budget_unit IS NULL
     AND TRIM(budget) ~ '^[\\d,]+$'
     AND LENGTH(REPLACE(TRIM(budget), ',', '')) >= 6
    THEN 'REVIEW:' || budget

    -- Legacy: standalone number -> LAKH
    WHEN budget_unit IS NULL
     AND TRIM(budget) ~ '^\\d{1,3}(\\.\\d+)?$'
    THEN TRIM(budget) || ' LAKH'

    -- Legacy: standalone range -> LAKH
    WHEN budget_unit IS NULL
     AND TRIM(budget) ~ '^\\d{1,3}\\s*-\\s*\\d{1,3}$'
    THEN REGEXP_REPLACE(TRIM(budget), '\\s*-\\s*', '-') || ' LAKH'

    -- Legacy: "above"/"plus" qualifiers
    WHEN budget_unit IS NULL
     AND TRIM(budget) ~* 'above|plus|below|under'
    THEN 'REVIEW:' || budget

    -- Legacy: typo "4O Lakh"
    WHEN budget_unit IS NULL
     AND TRIM(budget) ~* '^4O\\s+lakh'
    THEN '40 LAKH'

    ELSE 'REVIEW:' || budget
  END AS proposed
FROM walkin_enquiries
ORDER BY id
`;

const SALES_BUDGET_PREVIEW_SQL = `
SELECT
  id,
  sales_budget AS orig,
  CASE
    WHEN sales_budget IS NULL THEN NULL
    WHEN TRIM(sales_budget) = '' THEN sales_budget

    WHEN UPPER(TRIM(sales_budget)) ~ '^NOT\\s+DIS' THEN 'Not Disclosed'

    WHEN TRIM(sales_budget) ~* '^[\\d.,\\s\\-]+(to|and)?[\\d.,\\s\\-]*(lakh|lakhs|lac|lacs)\\s*\\*?\\s*$'
    THEN REGEXP_REPLACE(
           REGEXP_REPLACE(UPPER(TRIM(sales_budget)), '\\s*(LAKH|LAKHS|LAC|LACS)\\s*\\*?\\s*$', ' LAKH'),
           '\\s+', ' ', 'g')

    WHEN TRIM(sales_budget) ~* '^[\\d.,\\s\\-]+(crore|crores|cr)\\s*$'
    THEN REGEXP_REPLACE(
           REGEXP_REPLACE(UPPER(TRIM(sales_budget)), '\\s*(CRORE|CRORES|CR)\\s*$', ' CRORE'),
           '\\s+', ' ', 'g')

    WHEN TRIM(sales_budget) ~ '^\\d{1,3}(\\.\\d+)?$'
    THEN TRIM(sales_budget) || ' LAKH'

    WHEN TRIM(sales_budget) ~* '^\\d{1,3}\\s*(to|-)\\s*\\d{1,3}$'
    THEN REGEXP_REPLACE(TRIM(sales_budget), '\\s*(to|-)\\s*', '-') || ' LAKH'

    ELSE 'REVIEW:' || sales_budget
  END AS proposed
FROM walkin_enquiries
WHERE sales_budget IS NOT NULL
ORDER BY id
`;

(async () => {
  // ── Budget preview ──
  const { rows } = await pool.query(BUDGET_PREVIEW_SQL);

  console.log("=".repeat(100));
  console.log("PREVIEW 2a: walkin_enquiries.budget  (719 rows)");
  console.log("=".repeat(100));
  console.log(
    "id".padEnd(6) +
      "original_budget".padEnd(28) +
      "unit".padEnd(10) +
      "proposed_budget".padEnd(28) +
      "status"
  );
  console.log("-".repeat(100));

  let changed = 0, unchanged = 0, review = 0;
  for (const r of rows) {
    const isReview = r.proposed && r.proposed.startsWith("REVIEW:");
    const isChanged = r.orig !== r.proposed;
    if (isReview) review++;
    if (isChanged) changed++;
    else unchanged++;

    const status = isReview ? "REVIEW" : isChanged ? "CHANGED" : "";
    console.log(
      String(r.id).padEnd(6) +
        String(r.orig || "NULL").padEnd(28) +
        String(r.unit || "NULL").padEnd(10) +
        String(r.proposed || "NULL").padEnd(28) +
        status
    );
  }
  console.log("-".repeat(100));
  console.log(
    `TOTALS: ${rows.length} rows | ${changed} changed | ${unchanged} unchanged | ${review} flagged for review`
  );

  // ── Sales budget preview ──
  const sb = await pool.query(SALES_BUDGET_PREVIEW_SQL);

  console.log("\n" + "=".repeat(90));
  console.log("PREVIEW 2b: walkin_enquiries.sales_budget  (non-NULL only)");
  console.log("=".repeat(90));
  console.log(
    "id".padEnd(6) +
      "original_sales_budget".padEnd(28) +
      "proposed".padEnd(28) +
      "status"
  );
  console.log("-".repeat(90));

  let sChanged = 0, sUnchanged = 0, sReview = 0;
  for (const r of sb.rows) {
    const isReview = r.proposed && r.proposed.startsWith("REVIEW:");
    const isChanged = r.orig !== r.proposed;
    if (isReview) sReview++;
    if (isChanged) sChanged++;
    else sUnchanged++;

    const status = isReview ? "REVIEW" : isChanged ? "CHANGED" : "";
    console.log(
      String(r.id).padEnd(6) +
        String(r.orig || "NULL").padEnd(28) +
        String(r.proposed || "NULL").padEnd(28) +
        status
    );
  }
  console.log("-".repeat(90));
  console.log(
    `TOTALS: ${sb.rows.length} rows | ${sChanged} changed | ${sUnchanged} unchanged | ${sReview} flagged for review`
  );

  await pool.end();
})().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
