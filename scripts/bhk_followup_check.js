const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_dLBmKRVy60gY@ep-long-cloud-a1d5t8of-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
  ssl: { rejectUnauthorized: false }
});

(async () => {
  // Find all follow_ups with Property Type containing lowercase bhk
  const fups = await pool.query(`
    SELECT f.id, f.lead_id,
      substring(f.message from '• Property Type: (.*)') as prop_val
    FROM follow_ups f
    WHERE f.message LIKE '%Property Type%'
      AND f.message ~* 'bhk'
    ORDER BY f.lead_id, f.id DESC
  `);
  console.log('Follow-ups with bhk in Property Type (' + fups.rows.length + ' rows):');
  for (const r of fups.rows) {
    const val = r.prop_val ? r.prop_val.split('\n')[0].trim() : '(no extract)';
    console.log('  fup_id=' + r.id + ' lead_id=' + r.lead_id + ': "' + val + '"');
  }

  // Count: total follow_ups with Property Type
  const total = await pool.query(`
    SELECT COUNT(*) FROM follow_ups WHERE message LIKE '%Property Type%'
  `);
  console.log('\nTotal follow_ups with Property Type:', total.rows[0].count);

  // Those with lowercase bhk in Property Type line
  const lc = await pool.query(`
    SELECT f.id, f.lead_id,
      substring(f.message from '• Property Type: (.*)') as prop_val
    FROM follow_ups f
    WHERE f.message LIKE '%Property Type%'
      AND f.message ~ '• Property Type: .*[a-z].*[Bb][Hh][Kk]'
  `);
  console.log('With non-uppercase bhk in Property Type line:', lc.rows.length);
  for (const r of lc.rows) {
    const val = r.prop_val ? r.prop_val.split('\n')[0].trim() : '(no extract)';
    console.log('  fup_id=' + r.id + ' lead_id=' + r.lead_id + ': "' + val + '"');
  }

  // Check specific leads 619-624 — all follow-ups
  const specific = await pool.query(`
    SELECT f.id, f.lead_id,
      substring(f.message from '• Property Type: (.*)') as prop_val,
      f.created_at
    FROM follow_ups f
    WHERE f.lead_id IN (619, 620, 621, 622, 623, 624)
      AND f.message LIKE '%Property Type%'
    ORDER BY f.lead_id, f.id DESC
  `);
  console.log('\nAll Property Type follow-ups for leads 619-624:');
  for (const r of specific.rows) {
    const val = r.prop_val ? r.prop_val.split('\n')[0].trim() : '(no extract)';
    console.log('  fup_id=' + r.id + ' lead_id=' + r.lead_id + ' (' + r.created_at + '): "' + val + '"');
  }

  // What the UI *actually* displays: propTypeOf prefers propType (from follow-up) over configuration
  // So for leads without a salesform follow-up, it falls back to configuration (which IS normalized)
  // For leads WITH a salesform, it shows the follow-up value (which may be lowercase)

  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
