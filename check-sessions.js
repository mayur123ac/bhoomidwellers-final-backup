const { loadEnvConfig } = require('@next/env');
loadEnvConfig('./');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  try {
    const sessions = await pool.query(`SELECT id, user_id FROM employee_sessions WHERE is_active = true`);
    console.log("Active sessions:", sessions.rows);
  } finally {
    pool.end();
  }
}
check();
