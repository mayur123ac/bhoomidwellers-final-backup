// Runs one .sql file from scripts/migrations against DATABASE_URL in .env.local.
//
//   node scripts/run_sql_migration.js 2026-07-29_cp_sourcing_manager_ownership.sql
//
// The migration files here manage their own BEGIN/COMMIT, so this deliberately
// does not wrap them in another transaction.
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/run_sql_migration.js <file.sql>');
  process.exit(1);
}

const envFile = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
let dbUrl = '';
for (const line of envFile.split('\n')) {
  const trimmed = line.trim();
  // Commented-out DATABASE_URL lines (the Neon fallback) must not win.
  if (trimmed.startsWith('DATABASE_URL=')) dbUrl = trimmed.slice('DATABASE_URL='.length).trim().replace(/^"|"$/g, '');
}
if (!dbUrl) { console.error('No DATABASE_URL found in .env.local'); process.exit(1); }

const sqlPath = path.isAbsolute(file) ? file : path.join(__dirname, 'migrations', file);
const sql = fs.readFileSync(sqlPath, 'utf8');

const pool = new Pool({ connectionString: dbUrl });
(async () => {
  const client = await pool.connect();
  try {
    console.log(`Running ${path.basename(sqlPath)} against ${dbUrl.replace(/:[^:@]+@/, ':****@')}`);
    await client.query(sql);
    console.log('OK');
  } catch (err) {
    console.error('FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
