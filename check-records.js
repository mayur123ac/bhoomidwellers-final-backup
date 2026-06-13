const { loadEnvConfig } = require('@next/env');
loadEnvConfig('./');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  try {
    const res = await pool.query(`SELECT * FROM attendance_records`);
    console.log("attendance_records:", res.rows);
  } finally {
    pool.end();
  }
}
check();
