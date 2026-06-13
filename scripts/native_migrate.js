const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const envPath = path.join(__dirname, '..', '.env.local');
const envFile = fs.readFileSync(envPath, 'utf8');

let dbUrl = '';
envFile.split('\n').forEach(line => {
  if (line.startsWith('DATABASE_URL=')) {
    dbUrl = line.split('=')[1].trim().replace(/^"|"$/g, '');
  }
});

const pool = new Pool({ connectionString: dbUrl });

async function migrate() {
  const client = await pool.connect();
  try {
    console.log("Migrating tables...");
    
    // 1. Employee Sessions
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        session_start TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        session_end TIMESTAMP WITH TIME ZONE,
        last_heartbeat TIMESTAMP WITH TIME ZONE,
        ip_address VARCHAR(255),
        device_info VARCHAR(255),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Employee Live State
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_live_state (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        current_module VARCHAR(255),
        active_lead_id INTEGER,
        active_lead_name VARCHAR(255),
        current_action VARCHAR(255),
        last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 3. Employee Attendance
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_attendance (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        first_login TIMESTAMP WITH TIME ZONE,
        last_logout TIMESTAMP WITH TIME ZONE,
        total_active_minutes INTEGER DEFAULT 0,
        status VARCHAR(50) DEFAULT 'Present',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, date)
      )
    `);

    console.log("Migration successful!");
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    client.release();
    pool.end();
    process.exit(0);
  }
}

migrate();
