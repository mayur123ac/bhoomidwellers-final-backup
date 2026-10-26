const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_dLBmKRVy60gY@ep-long-cloud-a1d5t8of-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
  ssl: { rejectUnauthorized: false }
});

(async () => {
  // Check follow_ups for Budget field with lowercase unit variants
  const fups = await pool.query(`
    SELECT f.id, f.lead_id,
      substring(f.message from '• Budget: (.*)') as budget_val
    FROM follow_ups f
    WHERE f.message LIKE '%• Budget:%'
    ORDER BY f.lead_id, f.id DESC
  `);

  console.log('Total follow_ups with Budget field:', fups.rows.length);

  // Find those with lowercase unit variants
  let lowercase = [];
  for (const r of fups.rows) {
    if (!r.budget_val) continue;
    const val = r.budget_val.split('\n')[0].trim();
    // Check if it has a unit keyword that's not fully uppercase
    if (/lac|lacs|lakh|lakhs|crore|crores|cr\b/i.test(val) && !/LAKH|CRORE/.test(val)) {
      lowercase.push({ id: r.id, lead_id: r.lead_id, val });
    }
  }

  console.log('With lowercase budget units:', lowercase.length);
  for (const r of lowercase) {
    console.log('  fup_id=' + r.id + ' lead_id=' + r.lead_id + ': "' + r.val + '"');
  }

  // Now trace the rendering path:
  // From earlier analysis, dashboard/page.tsx line 428:
  //   activeBudget = extractField("Budget") !== "Pending" ? extractField("Budget") : formatBudget(lead.budget, lead.budget_unit)
  // And line 441: salesBudget: activeBudget
  //
  // Then Enquiryoverviewsection.tsx line 402: const v = l.salesBudget || l.budget
  //
  // So the UI shows: salesBudget (which is activeBudget from follow-up OR formatBudget)
  // If there's a salesform follow-up with "• Budget: 35lac", the UI shows "35lac"

  // Show some examples of what the UI would display
  console.log('\n--- Sample leads with follow-up budget overriding DB ---');
  // Get leads that have both a follow-up budget AND a DB budget
  const samples = await pool.query(`
    SELECT DISTINCT ON (f.lead_id)
      f.lead_id,
      substring(f.message from '• Budget: (.*)') as fup_budget,
      w.budget as db_budget,
      w.sales_budget as db_sales_budget
    FROM follow_ups f
    JOIN walkin_enquiries w ON w.id = f.lead_id
    WHERE f.message LIKE '%• Budget:%'
    ORDER BY f.lead_id, f.id DESC
    LIMIT 20
  `);
  for (const r of samples.rows) {
    const fupVal = r.fup_budget ? r.fup_budget.split('\n')[0].trim() : null;
    console.log('  lead_id=' + r.lead_id + ': fup="' + fupVal + '" db_budget="' + r.db_budget + '" db_sales_budget="' + r.db_sales_budget + '"');
  }

  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
