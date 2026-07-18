const { loadEnvConfig } = require('@next/env');
loadEnvConfig('./');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  try {
    const targetUserId = 2; // User 2 is Mayur
    const activeSession = await pool.query(`
        SELECT id, session_start 
        FROM employee_sessions 
        WHERE user_id = $1 AND is_active = true 
        ORDER BY session_start DESC LIMIT 1
    `, [targetUserId]);

    console.log("activeSession rows:", activeSession.rows);
    if (activeSession.rows.length === 0) {
        console.log("No active session found");
        return;
    }
    const sessionIdToUse = activeSession.rows[0].id;
    const loginTime = activeSession.rows[0].session_start;
    
    console.log("Trying to insert attendance for session", sessionIdToUse);
    const result = await pool.query(`
        INSERT INTO attendance_records (organization_id, employee_id, login_session_id, attendance_status, login_time)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (login_session_id) DO NOTHING
        RETURNING id, attendance_status
    `, [1, targetUserId, sessionIdToUse, 'Present', loginTime || new Date()]);

    console.log("Insert result rows:", result.rows);
  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
check();
