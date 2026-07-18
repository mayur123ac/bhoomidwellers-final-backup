const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function migrateDatabase() {
  const client = await pool.connect();
  try {
    console.log("Starting Operations Intelligence DB Migration...");

    // Create employee_live_state table
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_live_state (
          user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          current_module VARCHAR(100),
          active_lead_id VARCHAR(50),
          active_lead_name VARCHAR(100),
          current_action VARCHAR(255),
          current_route TEXT,
          last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          idle_duration_seconds INT DEFAULT 0,
          productivity_score INT DEFAULT 0,
          is_idle BOOLEAN DEFAULT FALSE,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("Created employee_live_state table.");

    // Add event_severity to employee_activity_logs if it doesn't exist
    await client.query(`
      ALTER TABLE employee_activity_logs 
      ADD COLUMN IF NOT EXISTS event_severity VARCHAR(20) DEFAULT 'INFO';
    `);
    console.log("Added event_severity to employee_activity_logs.");

    console.log("Migration complete.");
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    client.release();
    pool.end();
  }
}

migrateDatabase();
