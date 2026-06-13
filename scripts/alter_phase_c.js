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
    console.log("Altering Phase C tables...");
    
    await client.query(`
      ALTER TABLE employee_activity_logs 
      ADD COLUMN IF NOT EXISTS module VARCHAR(255),
      ADD COLUMN IF NOT EXISTS lead_id VARCHAR(255),
      ADD COLUMN IF NOT EXISTS lead_name VARCHAR(255);
    `);

    // Create an index for quick fetching by user_id
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_employee_activity_logs_user_id 
      ON employee_activity_logs(user_id)
    `);

    // Create an index for quick timestamp filtering (using the existing 'timestamp' column)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_employee_activity_logs_timestamp 
      ON employee_activity_logs(timestamp)
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
