const { loadEnvConfig } = require('@next/env');
loadEnvConfig('./');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS attendance_records (
        id SERIAL PRIMARY KEY,
        organization_id INT DEFAULT 1,
        employee_id INT NOT NULL,
        login_session_id INT UNIQUE NOT NULL,
        attendance_status VARCHAR(20) NOT NULL,
        submitted_at TIMESTAMP NOT NULL DEFAULT NOW(),
        login_time TIMESTAMP,
        logout_time TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    console.log("Table attendance_records created successfully.");
  } catch (error) {
    console.error("Migration failed:", error);
  } finally {
    await pool.end();
  }
}

migrate();
