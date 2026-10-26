/**
 * Budget Normalization — Full Automated Test + Production Migration
 *
 * Phases:
 *   1. Create backup table
 *   2. Run preview (original vs proposed) for every record
 *   3. Execute migration in a transaction
 *   4. Verify all invariants
 *   5. Print approval report — STOP before COMMIT
 *   6. On approval, commit and verify
 *
 * Usage:
 *   node scripts/budget_normalization_test.js preview    — Phase 2 only (read-only)
 *   node scripts/budget_normalization_test.js backup     — Phase 1 only (create backup)
 *   node scripts/budget_normalization_test.js dryrun     — Phase 3-4 in ROLLBACK mode
 *   node scripts/budget_normalization_test.js apply      — Phase 3-6, COMMIT after verification
 */

const { Pool } = require('pg');

const CONN = 'postgresql://neondb_owner:npg_dLBmKRVy60gY@ep-long-cloud-a1d5t8of-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

const pool = new Pool({
  connectionString: CONN,
  ssl: { rejectUnauthorized: false },
  max: 1, // single connection for transaction integrity
});

// ── Canonical format: "N LAKH" or "N CRORE" (uppercase) ──
// Values that should NOT be touched:
const SKIP_VALUES = new Set(['NOT DISCLOSED', 'Pending', 'N/A', '']);

function isAlreadyNormalized(val) {
  if (!val) return true;
  const t = val.trim();
  if (!t) return true;
  if (SKIP_VALUES.has(t) || SKIP_VALUES.has(t.toUpperCase())) return true;
  if (/^\d[\d.,\s\-]*(TO|AND)?[\d.,\s\-]* LAKH$/.test(t)) return true;
  if (/^\d[\d.,\s\-]*(TO|AND)?[\d.,\s\-]* CRORE$/.test(t)) return true;
  return false;
}

// ── The normalization logic (mirrors the SQL exactly) ──
function normalizeBudget(budget, budgetUnit) {
  if (budget === null || budget === undefined) return { budget: null, unit: null, action: 'skip-null' };
  const b = budget.trim();
  if (!b) return { budget: budget, unit: budgetUnit, action: 'skip-empty' };

  const upper = b.toUpperCase();

  // Already NOT DISCLOSED
  if (upper === 'NOT DISCLOSED') return { budget: 'NOT DISCLOSED', unit: null, action: 'skip-sentinel' };
  if (b === 'Pending' || b === 'N/A') return { budget: b, unit: budgetUnit, action: 'skip-sentinel' };

  // Already normalized
  if (/^\d[\d.,\s\-]*(TO|AND)?[\d.,\s\-]* LAKH$/.test(b)) return { budget: b, unit: null, action: 'skip-already' };
  if (/^\d[\d.,\s\-]*(TO|AND)?[\d.,\s\-]* CRORE$/.test(b)) return { budget: b, unit: null, action: 'skip-already' };

  // REVIEW items
  if (/^(OPEN|1\s*BHK|2\s*BHK|3\s*BHK)$/i.test(b)) return { budget: b, unit: budgetUnit, action: 'review' };
  if (/^\d+$/.test(b) && b.length >= 6) return { budget: b, unit: budgetUnit, action: 'review-large-number' };
  if (/^[\d,]+$/.test(b) && b.replace(/,/g, '').length >= 6) return { budget: b, unit: budgetUnit, action: 'review-indian-format' };
  if (/above|plus|below|under/i.test(b)) return { budget: b, unit: budgetUnit, action: 'review-qualifier' };

  // Structured: budget_unit IS NOT NULL
  if (budgetUnit) {
    if (b === '00') return { budget: 'NOT DISCLOSED', unit: null, action: 'placeholder-00' };
    return { budget: b + ' ' + budgetUnit.toUpperCase(), unit: null, action: 'merge-structured' };
  }

  // Legacy lakh variants
  if (/^[\d.,\s\-]+(to|and)?[\d.,\s\-]*(lakh|lakhs|lac|lacs|l)\s*\+?\s*$/i.test(b)) {
    const result = upper
      .replace(/\s*(LAKH|LAKHS|LAC|LACS|L)\s*\+?\s*$/, ' LAKH')
      .replace(/\s+/g, ' ')
      .trim();
    return { budget: result, unit: null, action: 'normalize-lakh' };
  }

  // Legacy crore variants
  if (/^[\d.,\s\-]+(crore|crores|cr)\s*$/i.test(b)) {
    const result = upper
      .replace(/\s*(CRORE|CRORES|CR)\s*$/, ' CRORE')
      .replace(/\s+/g, ' ')
      .trim();
    return { budget: result, unit: null, action: 'normalize-crore' };
  }

  // Standalone number 1-3 digits
  if (/^\d{1,3}(\.\d+)?$/.test(b)) {
    return { budget: b + ' LAKH', unit: null, action: 'standalone-number' };
  }

  // Standalone range
  if (/^\d{1,3}\s*-\s*\d{1,3}$/.test(b)) {
    const result = b.replace(/\s*-\s*/, '-') + ' LAKH';
    return { budget: result, unit: null, action: 'standalone-range' };
  }

  // Typo: "4O Lakh"
  if (/^4O\s+lakh/i.test(b)) {
    return { budget: '40 LAKH', unit: null, action: 'typo-fix' };
  }

  return { budget: b, unit: budgetUnit, action: 'review-unknown' };
}

function normalizeSalesBudget(sb) {
  if (sb === null || sb === undefined) return { value: null, action: 'skip-null' };
  const t = sb.trim();
  if (!t) return { value: sb, action: 'skip-empty' };

  const upper = t.toUpperCase();
  if (upper === 'NOT DISCLOSED') return { value: 'NOT DISCLOSED', action: 'skip-sentinel' };
  // "Not disclose", "not disclosed ", etc.
  if (/^NOT\s+DIS/i.test(t)) return { value: 'NOT DISCLOSED', action: 'normalize-not-disclosed' };
  if (/^\d[\d.,\s\-]*(TO|AND)?[\d.,\s\-]* LAKH$/.test(t)) return { value: t, action: 'skip-already' };
  if (/^\d[\d.,\s\-]*(TO|AND)?[\d.,\s\-]* CRORE$/.test(t)) return { value: t, action: 'skip-already' };

  // Lakh variants
  if (/^[\d.,\s\-]+(to|and)?[\d.,\s\-]*(lakh|lakhs|lac|lacs)\s*\*?\s*$/i.test(t)) {
    const result = upper
      .replace(/\s*(LAKH|LAKHS|LAC|LACS)\s*\*?\s*$/, ' LAKH')
      .replace(/\s+/g, ' ')
      .trim();
    return { value: result, action: 'normalize-lakh' };
  }

  // Crore variants
  if (/^[\d.,\s\-]+(crore|crores|cr)\s*$/i.test(t)) {
    const result = upper
      .replace(/\s*(CRORE|CRORES|CR)\s*$/, ' CRORE')
      .replace(/\s+/g, ' ')
      .trim();
    return { value: result, action: 'normalize-crore' };
  }

  // Standalone number
  if (/^\d{1,3}(\.\d+)?$/.test(t)) {
    return { value: t + ' LAKH', action: 'standalone-number' };
  }

  // Standalone range
  if (/^\d{1,3}\s*(to|-)\s*\d{1,3}$/i.test(t)) {
    const result = t.replace(/\s*(to|-)\s*/i, '-') + ' LAKH';
    return { value: result, action: 'standalone-range' };
  }

  return { value: t, action: 'review-unknown' };
}

// ── SQL Steps (must match the migration file exactly) ──
const MIGRATION_STEPS = [
  // STEP 1b: "00" placeholders → NOT DISCLOSED
  `UPDATE walkin_enquiries
   SET budget = 'NOT DISCLOSED', budget_unit = NULL
   WHERE budget_unit IS NOT NULL AND TRIM(budget) = '00'`,

  // STEP 2: Merge structured records
  `UPDATE walkin_enquiries
   SET budget = TRIM(budget) || ' ' || UPPER(budget_unit), budget_unit = NULL
   WHERE budget_unit IS NOT NULL
     AND TRIM(budget) != '00'
     AND NOT (TRIM(budget) ~ '^\\d+$' AND LENGTH(TRIM(budget)) >= 6)`,

  // STEP 3: Legacy lakh variants
  `UPDATE walkin_enquiries
   SET budget = REGEXP_REPLACE(
                  REGEXP_REPLACE(
                    UPPER(TRIM(budget)),
                    '\\s*(LAKH|LAKHS|LAC|LACS|L)\\s*\\+?\\s*$', ' LAKH'),
                  '\\s+', ' ', 'g')
   WHERE budget_unit IS NULL
     AND TRIM(budget) ~* '^[\\d.,\\s\\-]+(to|and)?[\\d.,\\s\\-]*(lakh|lakhs|lac|lacs|l)\\s*\\+?\\s*$'
     AND UPPER(TRIM(budget)) NOT IN ('NOT DISCLOSED','PENDING','N/A')`,

  // STEP 4: Legacy crore variants
  `UPDATE walkin_enquiries
   SET budget = REGEXP_REPLACE(
                  REGEXP_REPLACE(
                    UPPER(TRIM(budget)),
                    '\\s*(CRORE|CRORES|CR)\\s*$', ' CRORE'),
                  '\\s+', ' ', 'g')
   WHERE budget_unit IS NULL
     AND TRIM(budget) ~* '^[\\d.,\\s\\-]+(crore|crores|cr)\\s*$'`,

  // STEP 5: Standalone numbers → LAKH
  `UPDATE walkin_enquiries
   SET budget = TRIM(budget) || ' LAKH'
   WHERE budget_unit IS NULL
     AND TRIM(budget) ~ '^\\d{1,3}(\\.\\d+)?$'
     AND TRIM(budget) != '00'
     AND budget NOT LIKE '% LAKH'
     AND budget NOT LIKE '% CRORE'`,

  // STEP 6: Standalone ranges → LAKH
  `UPDATE walkin_enquiries
   SET budget = REGEXP_REPLACE(TRIM(budget), '\\s*-\\s*', '-') || ' LAKH'
   WHERE budget_unit IS NULL
     AND TRIM(budget) ~ '^\\d{1,3}\\s*-\\s*\\d{1,3}$'
     AND budget NOT LIKE '% LAKH'`,

  // STEP 7: Typo fix "4O Lakh"
  `UPDATE walkin_enquiries
   SET budget = '40 LAKH'
   WHERE TRIM(budget) ~* '^4O\\s+lakh'`,

  // STEP 8: Trim budget whitespace
  `UPDATE walkin_enquiries
   SET budget = TRIM(budget)
   WHERE budget IS NOT NULL AND budget != TRIM(budget)`,

  // STEP 9: sales_budget NOT DISCLOSED variants
  `UPDATE walkin_enquiries
   SET sales_budget = 'NOT DISCLOSED'
   WHERE sales_budget IS NOT NULL
     AND UPPER(TRIM(sales_budget)) ~ '^NOT\\s+DIS'
     AND TRIM(sales_budget) != 'NOT DISCLOSED'`,

  // STEP 10: sales_budget lakh variants
  `UPDATE walkin_enquiries
   SET sales_budget = REGEXP_REPLACE(
                        REGEXP_REPLACE(
                          UPPER(TRIM(sales_budget)),
                          '\\s*(LAKH|LAKHS|LAC|LACS)\\s*\\*?\\s*$', ' LAKH'),
                        '\\s+', ' ', 'g')
   WHERE sales_budget IS NOT NULL
     AND TRIM(sales_budget) ~* '^[\\d.,\\s\\-]+(to|and)?[\\d.,\\s\\-]*(lakh|lakhs|lac|lacs)\\s*\\*?\\s*$'`,

  // STEP 11: sales_budget crore variants
  `UPDATE walkin_enquiries
   SET sales_budget = REGEXP_REPLACE(
                        REGEXP_REPLACE(
                          UPPER(TRIM(sales_budget)),
                          '\\s*(CRORE|CRORES|CR)\\s*$', ' CRORE'),
                        '\\s+', ' ', 'g')
   WHERE sales_budget IS NOT NULL
     AND TRIM(sales_budget) ~* '^[\\d.,\\s\\-]+(crore|crores|cr)\\s*$'`,

  // STEP 12: sales_budget standalone numbers → LAKH
  `UPDATE walkin_enquiries
   SET sales_budget = TRIM(sales_budget) || ' LAKH'
   WHERE sales_budget IS NOT NULL
     AND TRIM(sales_budget) ~ '^\\d{1,3}(\\.\\d+)?$'
     AND sales_budget NOT LIKE '% LAKH'
     AND sales_budget NOT LIKE '% CRORE'`,

  // STEP 13: sales_budget standalone ranges → LAKH
  `UPDATE walkin_enquiries
   SET sales_budget = REGEXP_REPLACE(TRIM(sales_budget), '\\s*(to|-)\\s*', '-', 'i') || ' LAKH'
   WHERE sales_budget IS NOT NULL
     AND TRIM(sales_budget) ~* '^\\d{1,3}\\s*(to|-)\\s*\\d{1,3}$'
     AND sales_budget NOT LIKE '% LAKH'`,

  // STEP 14: Trim sales_budget whitespace
  `UPDATE walkin_enquiries
   SET sales_budget = TRIM(sales_budget)
   WHERE sales_budget IS NOT NULL AND sales_budget != TRIM(sales_budget)`,
];

// ────────────────────────────────────────────────────────────────────────────
// Phase 1: Backup
// ────────────────────────────────────────────────────────────────────────────
async function createBackup(client) {
  const exists = await client.query(`SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'walkin_enquiries_budget_backup'`);
  if (parseInt(exists.rows[0].count) > 0) {
    const cnt = await client.query('SELECT COUNT(*) FROM walkin_enquiries_budget_backup');
    console.log(`Backup table already exists with ${cnt.rows[0].count} rows`);
    return true;
  }
  console.log('Creating backup table...');
  await client.query(`CREATE TABLE walkin_enquiries_budget_backup AS SELECT id, budget, budget_unit, sales_budget FROM walkin_enquiries`);
  const cnt = await client.query('SELECT COUNT(*) FROM walkin_enquiries_budget_backup');
  console.log(`Backup created: ${cnt.rows[0].count} rows`);
  return true;
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 2: Preview
// ────────────────────────────────────────────────────────────────────────────
async function runPreview(client) {
  const rows = await client.query('SELECT id, budget, budget_unit, sales_budget FROM walkin_enquiries ORDER BY id');

  const changes = { budget: [], salesBudget: [], review: [], skipped: [] };
  let errors = [];

  for (const row of rows.rows) {
    // Budget
    const bn = normalizeBudget(row.budget, row.budget_unit);
    if (bn.action.startsWith('review')) {
      changes.review.push({ id: row.id, col: 'budget', original: row.budget, unit: row.budget_unit, proposed: bn.budget, action: bn.action });
    } else if (bn.budget !== row.budget || bn.unit !== row.budget_unit) {
      changes.budget.push({ id: row.id, original: row.budget, unit: row.budget_unit, proposed: bn.budget, action: bn.action });
    } else {
      changes.skipped.push({ id: row.id, col: 'budget', val: row.budget });
    }

    // Validate: no double unit
    if (bn.budget && /LAKH LAKH|CRORE CRORE/i.test(bn.budget)) {
      errors.push({ id: row.id, msg: `Double unit in budget: ${bn.budget}` });
    }

    // Sales budget
    const sn = normalizeSalesBudget(row.sales_budget);
    if (sn.action.startsWith('review')) {
      changes.review.push({ id: row.id, col: 'sales_budget', original: row.sales_budget, proposed: sn.value, action: sn.action });
    } else if (sn.value !== row.sales_budget) {
      changes.salesBudget.push({ id: row.id, original: row.sales_budget, proposed: sn.value, action: sn.action });
    }

    if (sn.value && /LAKH LAKH|CRORE CRORE/i.test(sn.value)) {
      errors.push({ id: row.id, msg: `Double unit in sales_budget: ${sn.value}` });
    }
  }

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(' PREVIEW SUMMARY');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`Total rows:              ${rows.rows.length}`);
  console.log(`Budget changes:          ${changes.budget.length}`);
  console.log(`Sales_budget changes:    ${changes.salesBudget.length}`);
  console.log(`Review (untouched):      ${changes.review.length}`);
  console.log(`Validation errors:       ${errors.length}`);

  if (errors.length > 0) {
    console.log('\nVALIDATION ERRORS:');
    for (const e of errors) console.log(`  id=${e.id}: ${e.msg}`);
    return { ok: false, errors, changes };
  }

  // Print budget changes grouped by action
  const byAction = {};
  for (const c of changes.budget) {
    if (!byAction[c.action]) byAction[c.action] = [];
    byAction[c.action].push(c);
  }
  console.log('\n── Budget changes by action ──');
  for (const [action, items] of Object.entries(byAction)) {
    console.log(`  ${action}: ${items.length} rows`);
    // Show up to 3 examples
    for (const ex of items.slice(0, 3)) {
      console.log(`    id=${ex.id}: "${ex.original}" (unit=${ex.unit}) → "${ex.proposed}"`);
    }
  }

  const sbByAction = {};
  for (const c of changes.salesBudget) {
    if (!sbByAction[c.action]) sbByAction[c.action] = [];
    sbByAction[c.action].push(c);
  }
  console.log('\n── Sales_budget changes by action ──');
  for (const [action, items] of Object.entries(sbByAction)) {
    console.log(`  ${action}: ${items.length} rows`);
    for (const ex of items.slice(0, 3)) {
      console.log(`    id=${ex.id}: "${ex.original}" → "${ex.proposed}"`);
    }
  }

  console.log('\n── REVIEW items (will NOT be modified) ──');
  for (const r of changes.review) {
    console.log(`  id=${r.id} [${r.col}]: "${r.original}" — ${r.action}`);
  }

  return { ok: true, changes };
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 3-4: Execute migration + verify
// ────────────────────────────────────────────────────────────────────────────
async function executeMigration(client, commit) {
  const mode = commit ? 'APPLY' : 'DRY-RUN';
  console.log(`\n══════════════════════════════════════════════════════════════`);
  console.log(` MIGRATION EXECUTION — ${mode}`);
  console.log(`══════════════════════════════════════════════════════════════`);

  // Snapshot before
  const before = await client.query('SELECT id, budget, budget_unit, sales_budget FROM walkin_enquiries ORDER BY id');
  const beforeMap = new Map(before.rows.map(r => [r.id, r]));

  await client.query('BEGIN');

  let totalAffected = 0;
  for (let i = 0; i < MIGRATION_STEPS.length; i++) {
    const sql = MIGRATION_STEPS[i];
    const label = sql.match(/--\s*STEP\s+\w+/)?.[0] || `Step ${i + 1}`;
    const result = await client.query(sql);
    const rc = result.rowCount;
    totalAffected += rc;
    console.log(`  ${label}: ${rc} rows`);
  }
  console.log(`  Total rows affected: ${totalAffected}`);

  // ── Verification ──
  console.log('\n── Post-migration verification ──');
  let allPassed = true;

  // V1: No budget_unit remaining (except for REVIEW large-number rows)
  const unitLeft = await client.query(`SELECT COUNT(*) FROM walkin_enquiries WHERE budget_unit IS NOT NULL`);
  const unitCount = parseInt(unitLeft.rows[0].count);
  // Only the 2 raw-rupee rows (3600000, 3000000) should keep budget_unit
  if (unitCount > 2) {
    console.log(`  FAIL: ${unitCount} rows still have budget_unit set (expected <=2)`);
    allPassed = false;
  } else {
    console.log(`  PASS: budget_unit remaining: ${unitCount} (expected <=2, these are REVIEW items)`);
  }

  // V2: No un-normalized budget values (except REVIEW items)
  const unnorm = await client.query(`
    SELECT id, budget, budget_unit FROM walkin_enquiries
    WHERE budget IS NOT NULL
      AND TRIM(budget) != ''
      AND UPPER(TRIM(budget)) != 'NOT DISCLOSED'
      AND budget != 'Pending' AND budget != 'N/A'
      AND budget NOT LIKE '% LAKH' AND budget NOT LIKE '% CRORE'
  `);
  const reviewIds = unnorm.rows.map(r => r.id);
  console.log(`  Budget un-normalized remaining: ${unnorm.rows.length} rows (should be REVIEW items)`);
  for (const r of unnorm.rows) {
    console.log(`    id=${r.id}: "${r.budget}" (unit=${r.budget_unit})`);
  }

  // V3: No un-normalized sales_budget
  const unnormSb = await client.query(`
    SELECT id, sales_budget FROM walkin_enquiries
    WHERE sales_budget IS NOT NULL
      AND TRIM(sales_budget) != ''
      AND UPPER(TRIM(sales_budget)) != 'NOT DISCLOSED'
      AND sales_budget NOT LIKE '% LAKH' AND sales_budget NOT LIKE '% CRORE'
  `);
  console.log(`  Sales_budget un-normalized remaining: ${unnormSb.rows.length} rows`);
  for (const r of unnormSb.rows) {
    console.log(`    id=${r.id}: "${r.sales_budget}"`);
  }

  // V4: No double-unit values
  const doubleUnit = await client.query(`
    SELECT id, budget, sales_budget FROM walkin_enquiries
    WHERE budget ~ '(LAKH|CRORE)\\s+(LAKH|CRORE)'
       OR sales_budget ~ '(LAKH|CRORE)\\s+(LAKH|CRORE)'
  `);
  if (doubleUnit.rows.length > 0) {
    console.log(`  FAIL: ${doubleUnit.rows.length} rows have double units!`);
    for (const r of doubleUnit.rows) console.log(`    id=${r.id}: b="${r.budget}" sb="${r.sales_budget}"`);
    allPassed = false;
  } else {
    console.log(`  PASS: No double-unit values`);
  }

  // V5: Total row count unchanged
  const afterCount = await client.query('SELECT COUNT(*) FROM walkin_enquiries');
  if (parseInt(afterCount.rows[0].count) !== before.rows.length) {
    console.log(`  FAIL: Row count changed from ${before.rows.length} to ${afterCount.rows[0].count}`);
    allPassed = false;
  } else {
    console.log(`  PASS: Row count unchanged (${afterCount.rows[0].count})`);
  }

  // V6: NOT DISCLOSED count should be >= before (we add "00" placeholders)
  const ndCount = await client.query(`SELECT COUNT(*) FROM walkin_enquiries WHERE UPPER(TRIM(budget)) = 'NOT DISCLOSED'`);
  console.log(`  NOT DISCLOSED count: ${ndCount.rows[0].count}`);

  // V7: Distribution summary
  const dist = await client.query(`
    SELECT
      CASE
        WHEN budget IS NULL THEN 'NULL'
        WHEN TRIM(budget) = '' THEN 'EMPTY'
        WHEN UPPER(TRIM(budget)) = 'NOT DISCLOSED' THEN 'NOT DISCLOSED'
        WHEN budget = 'Pending' THEN 'Pending'
        WHEN budget = 'N/A' THEN 'N/A'
        WHEN budget LIKE '% LAKH' THEN 'N LAKH'
        WHEN budget LIKE '% CRORE' THEN 'N CRORE'
        ELSE 'OTHER: ' || budget
      END as category,
      COUNT(*) as cnt
    FROM walkin_enquiries GROUP BY category ORDER BY cnt DESC
  `);
  console.log('\n── Budget distribution after migration ──');
  for (const r of dist.rows) console.log(`  ${r.category}: ${r.cnt}`);

  const sdist = await client.query(`
    SELECT
      CASE
        WHEN sales_budget IS NULL THEN 'NULL'
        WHEN TRIM(sales_budget) = '' THEN 'EMPTY'
        WHEN UPPER(TRIM(sales_budget)) = 'NOT DISCLOSED' THEN 'NOT DISCLOSED'
        WHEN sales_budget LIKE '% LAKH' THEN 'N LAKH'
        WHEN sales_budget LIKE '% CRORE' THEN 'N CRORE'
        ELSE 'OTHER: ' || sales_budget
      END as category,
      COUNT(*) as cnt
    FROM walkin_enquiries GROUP BY category ORDER BY cnt DESC
  `);
  console.log('\n── Sales_budget distribution after migration ──');
  for (const r of sdist.rows) console.log(`  ${r.category}: ${r.cnt}`);

  // V8: Cross-check JS normalization vs SQL results
  const after = await client.query('SELECT id, budget, budget_unit, sales_budget FROM walkin_enquiries ORDER BY id');
  let mismatches = 0;
  for (const row of after.rows) {
    const orig = beforeMap.get(row.id);
    if (!orig) continue;
    const jsBudget = normalizeBudget(orig.budget, orig.budget_unit);
    // Only check non-review items
    if (!jsBudget.action.startsWith('review') && !jsBudget.action.startsWith('skip')) {
      if (jsBudget.budget !== row.budget) {
        if (mismatches < 10) {
          console.log(`  MISMATCH id=${row.id}: JS="${jsBudget.budget}" vs SQL="${row.budget}" (orig="${orig.budget}", unit="${orig.budget_unit}")`);
        }
        mismatches++;
      }
    }
  }
  if (mismatches > 0) {
    console.log(`  WARNING: ${mismatches} JS-vs-SQL mismatches (review above)`);
  } else {
    console.log(`\n  PASS: JS normalization matches SQL results for all non-review records`);
  }

  // ── Decision ──
  if (!allPassed) {
    console.log('\n  VERIFICATION FAILED — rolling back');
    await client.query('ROLLBACK');
    return false;
  }

  if (commit) {
    console.log('\n  All checks passed. COMMITTING...');
    await client.query('COMMIT');
    console.log('  COMMITTED successfully.');
    return true;
  } else {
    console.log('\n  All checks passed. Rolling back (dry-run mode).');
    await client.query('ROLLBACK');
    return true;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────────
async function main() {
  const mode = process.argv[2] || 'preview';
  console.log(`Budget Normalization Tool — mode: ${mode}`);
  console.log(`Target: ep-long-cloud (production Neon)`);
  console.log('');

  const client = await pool.connect();

  try {
    if (mode === 'backup') {
      await createBackup(client);
    } else if (mode === 'preview') {
      await runPreview(client);
    } else if (mode === 'dryrun') {
      await createBackup(client);
      const preview = await runPreview(client);
      if (!preview.ok) { console.log('Preview failed — aborting'); return; }
      await executeMigration(client, false);
    } else if (mode === 'apply') {
      await createBackup(client);
      const preview = await runPreview(client);
      if (!preview.ok) { console.log('Preview failed — aborting'); return; }
      const ok = await executeMigration(client, true);
      if (ok) {
        console.log('\n══════════════════════════════════════════════════════════════');
        console.log(' MIGRATION COMPLETE — Production data updated');
        console.log('══════════════════════════════════════════════════════════════');
      }
    } else {
      console.log('Usage: node budget_normalization_test.js [preview|backup|dryrun|apply]');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
