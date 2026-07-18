const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function resetPasswords() {
  const client = await pool.connect();
  try {
    const result = await client.query("UPDATE users SET password = '123456' WHERE password = 'password'");
    console.log(`Successfully reset ${result.rowCount} passwords to '123456'.`);
  } catch (err) {
    console.error("Revert failed:", err);
  } finally {
    client.release();
    pool.end();
  }
}

resetPasswords();
