const { loadEnvConfig } = require('@next/env');
loadEnvConfig('./');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  try {
    const targetDate = new Date().toISOString().split('T')[0];
    const res = await pool.query(`
      SELECT 
        u.id as user_id,
        CASE 
          WHEN ar.attendance_status IS NOT NULL THEN ar.attendance_status
          WHEN s.is_active THEN 'Pending'
          ELSE 'Absent'
        END as attendance_status
      FROM users u
      JOIN (
        SELECT DISTINCT ON (user_id) * 
        FROM employee_sessions 
        WHERE DATE(session_start AT TIME ZONE 'Asia/Kolkata') = $1
        ORDER BY user_id, session_start DESC
      ) s ON u.id = s.user_id
      LEFT JOIN attendance_records ar ON s.id = ar.login_session_id
    `, [targetDate]);
    console.log(res.rows);
  } finally {
    pool.end();
  }
}
check();
