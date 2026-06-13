const { loadEnvConfig } = require('@next/env');
loadEnvConfig('./');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")
  .then(res => {
    console.log(res.rows.map(t => t.table_name).join(', '));
    process.exit(0);
  })
  .catch(console.error);
