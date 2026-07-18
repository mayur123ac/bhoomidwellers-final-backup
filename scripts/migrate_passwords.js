const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function resetPasswords() {
  const client = await pool.connect();
  try {
    console.log("Reverting hashed passwords...");
    
    // Update in DB
    const result = await client.query("UPDATE users SET password = 'password' WHERE password LIKE '$2a$%' OR password LIKE '$2b$%'");

    console.log(`Successfully reverted ${result.rowCount} passwords.`);
  } catch (err) {
    console.error("Revert failed:", err);
  } finally {
    client.release();
    pool.end();
  }
}

resetPasswords();
