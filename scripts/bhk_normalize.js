const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_dLBmKRVy60gY@ep-long-cloud-a1d5t8of-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
  ssl: { rejectUnauthorized: false },
  max: 1,
});

const mode = process.argv[2] || 'dryrun'; // dryrun | apply

async function main() {
  console.log(`BHK Casing Normalization — mode: ${mode}`);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Backup
    const backupExists = await client.query(
      "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'bhk_casing_backup'"
    );
    if (parseInt(backupExists.rows[0].count) === 0) {
      await client.query(`
        CREATE TABLE bhk_casing_backup AS
        SELECT 'walkin_enquiries'::text as tbl, id, 'configuration'::text as col, configuration as val
        FROM walkin_enquiries WHERE configuration ~* 'bhk' AND configuration !~ 'BHK'
        UNION ALL
        SELECT 'walkin_enquiries', id, 'property_type', property_type
        FROM walkin_enquiries WHERE property_type ~* 'bhk' AND property_type !~ 'BHK'
        UNION ALL
        SELECT 'booking_applications', id, 'property_type', property_type
        FROM booking_applications WHERE property_type ~* 'bhk' AND property_type !~ 'BHK'
        UNION ALL
        SELECT 'inventory_units', id, 'unit_type', unit_type
        FROM inventory_units WHERE unit_type ~* 'bhk' AND unit_type !~ 'BHK'
      `);
      const bkCnt = await client.query('SELECT COUNT(*) FROM bhk_casing_backup');
      console.log('Backup created:', bkCnt.rows[0].count, 'rows');
    } else {
      const bkCnt = await client.query('SELECT COUNT(*) FROM bhk_casing_backup');
      console.log('Backup already exists:', bkCnt.rows[0].count, 'rows');
    }

    // UPDATE 1: walkin_enquiries.configuration
    const r1 = await client.query(`
      UPDATE walkin_enquiries
      SET configuration = REGEXP_REPLACE(configuration, 'bhk', 'BHK', 'gi')
      WHERE configuration ~* 'bhk' AND configuration !~ 'BHK'
    `);
    console.log('walkin_enquiries.configuration:', r1.rowCount, 'rows');

    // UPDATE 2: walkin_enquiries.property_type
    const r2 = await client.query(`
      UPDATE walkin_enquiries
      SET property_type = REGEXP_REPLACE(property_type, 'bhk', 'BHK', 'gi')
      WHERE property_type ~* 'bhk' AND property_type !~ 'BHK'
    `);
    console.log('walkin_enquiries.property_type:', r2.rowCount, 'rows');

    // UPDATE 3: booking_applications.property_type
    const r3 = await client.query(`
      UPDATE booking_applications
      SET property_type = REGEXP_REPLACE(property_type, 'bhk', 'BHK', 'gi')
      WHERE property_type ~* 'bhk' AND property_type !~ 'BHK'
    `);
    console.log('booking_applications.property_type:', r3.rowCount, 'rows');

    // UPDATE 4: inventory_units.unit_type
    const r4 = await client.query(`
      UPDATE inventory_units
      SET unit_type = REGEXP_REPLACE(unit_type, 'bhk', 'BHK', 'gi')
      WHERE unit_type ~* 'bhk' AND unit_type !~ 'BHK'
    `);
    console.log('inventory_units.unit_type:', r4.rowCount, 'rows');

    const total = r1.rowCount + r2.rowCount + r3.rowCount + r4.rowCount;
    console.log('Total rows updated:', total);

    // Verify: no remaining lowercase bhk
    const checks = [
      { q: "SELECT COUNT(*) FROM walkin_enquiries WHERE configuration ~* 'bhk' AND configuration !~ 'BHK'", label: 'configuration' },
      { q: "SELECT COUNT(*) FROM walkin_enquiries WHERE property_type ~* 'bhk' AND property_type !~ 'BHK'", label: 'property_type' },
      { q: "SELECT COUNT(*) FROM booking_applications WHERE property_type ~* 'bhk' AND property_type !~ 'BHK'", label: 'booking.property_type' },
      { q: "SELECT COUNT(*) FROM inventory_units WHERE unit_type ~* 'bhk' AND unit_type !~ 'BHK'", label: 'inventory.unit_type' },
    ];
    let allClean = true;
    console.log('\nVerification — remaining lowercase bhk:');
    for (const c of checks) {
      const r = await client.query(c.q);
      const n = parseInt(r.rows[0].count);
      console.log(`  ${c.label}: ${n}` + (n === 0 ? ' PASS' : ' FAIL'));
      if (n > 0) allClean = false;
    }

    // Post-update distributions
    const dists = [
      { q: "SELECT configuration as val, COUNT(*) as cnt FROM walkin_enquiries WHERE configuration ~* 'bhk' GROUP BY configuration ORDER BY cnt DESC", label: 'walkin_enquiries.configuration' },
      { q: "SELECT property_type as val, COUNT(*) as cnt FROM walkin_enquiries WHERE property_type ~* 'bhk' GROUP BY property_type ORDER BY cnt DESC", label: 'walkin_enquiries.property_type' },
      { q: "SELECT property_type as val, COUNT(*) as cnt FROM booking_applications WHERE property_type ~* 'bhk' GROUP BY property_type ORDER BY cnt DESC", label: 'booking_applications.property_type' },
      { q: "SELECT unit_type as val, COUNT(*) as cnt FROM inventory_units WHERE unit_type ~* 'bhk' GROUP BY unit_type ORDER BY cnt DESC", label: 'inventory_units.unit_type' },
    ];
    for (const d of dists) {
      const r = await client.query(d.q);
      console.log(`\n${d.label}:`);
      for (const row of r.rows) console.log(`  "${row.val}": ${row.cnt}`);
    }

    if (mode === 'apply' && allClean) {
      await client.query('COMMIT');
      console.log('\nCOMMITTED.');
    } else {
      await client.query('ROLLBACK');
      console.log(`\nROLLED BACK (mode=${mode}, allClean=${allClean}).`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
