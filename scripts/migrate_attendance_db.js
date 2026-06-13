const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function migrateDatabase() {
  const client = await pool.connect();
  try {
    console.log("Starting Phase B Database Migration...");

    // Create employee_sessions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_sessions (
          id SERIAL PRIMARY KEY,
          user_id INT REFERENCES users(id) ON DELETE CASCADE,
          session_start TIMESTAMP NOT NULL,
          last_heartbeat TIMESTAMP NOT NULL,
          session_end TIMESTAMP,
          ip_address VARCHAR(45),
          google_verified_email VARCHAR(255),
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("Created/Verified employee_sessions table.");

    // Create employee_activity_logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_activity_logs (
          id SERIAL PRIMARY KEY,
          user_id INT REFERENCES users(id) ON DELETE CASCADE,
          action_type VARCHAR(100) NOT NULL,
          description TEXT,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("Created/Verified employee_activity_logs table.");

    // Create employee_attendance table
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_attendance (
          id SERIAL PRIMARY KEY,
          user_id INT REFERENCES users(id) ON DELETE CASCADE,
          date DATE NOT NULL,
          first_login TIMESTAMP,
          last_logout TIMESTAMP,
          working_hours NUMERIC(5, 2) DEFAULT 0.00,
          status VARCHAR(50) DEFAULT 'Present',
          UNIQUE(user_id, date)
      );
    `);
    console.log("Created/Verified employee_attendance table.");

    console.log("Phase B Migration complete.");
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    client.release();
    pool.end();
  }
}

migrateDatabase();
