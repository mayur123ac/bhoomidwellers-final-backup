const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function run() {
  const res = await pool.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public'
  `);
  console.log(JSON.stringify(res.rows, null, 2));

  // Also get columns for 'leads'
  const leads = await pool.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'leads'
  `);
  console.log("Leads columns:", JSON.stringify(leads.rows, null, 2));

  const users = await pool.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'users'
  `);
  console.log("Users columns:", JSON.stringify(users.rows, null, 2));
  
  // Foreign keys
  const fks = await pool.query(`
    SELECT
      tc.table_name, kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name,
      rc.delete_rule
    FROM
      information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      JOIN information_schema.referential_constraints AS rc
        ON rc.constraint_name = tc.constraint_name
    WHERE constraint_type = 'FOREIGN KEY';
  `);
  console.log("Foreign keys:", JSON.stringify(fks.rows, null, 2));

  process.exit(0);
}

run().catch(console.error);
