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

async function inspect() {
  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'employee_activity_logs'
    `);
    console.log("employee_activity_logs columns:", res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    client.release();
    pool.end();
    process.exit(0);
  }
}

inspect();
