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
    console.log("Migrating Phase C tables...");
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_activity_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        action_type VARCHAR(255) NOT NULL,
        module VARCHAR(255),
        lead_id VARCHAR(255),
        lead_name VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create an index for quick fetching by user_id
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_employee_activity_logs_user_id 
      ON employee_activity_logs(user_id)
    `);

    // Create an index for quick timestamp filtering
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_employee_activity_logs_created_at 
      ON employee_activity_logs(created_at)
    `);

    console.log("Migration Phase C successful!");
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    client.release();
    pool.end();
    process.exit(0);
  }
}

migrate();
