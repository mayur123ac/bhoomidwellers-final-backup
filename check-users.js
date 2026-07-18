const { loadEnvConfig } = require('@next/env');
loadEnvConfig('./');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  const res = await pool.query('SELECT column_name FROM information_schema.columns WHERE table_name = \'users\'');
  console.log(res.rows.map(r => r.column_name));
  process.exit(0);
}
check();
