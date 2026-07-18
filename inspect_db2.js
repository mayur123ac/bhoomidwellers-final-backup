const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function run() {
  const followups = await pool.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'follow_ups'
  `);
  console.log("follow_ups columns:", JSON.stringify(followups.rows, null, 2));
  process.exit(0);
}

run().catch(console.error);
