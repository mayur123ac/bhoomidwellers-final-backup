const fs = require("fs");
const env = fs.readFileSync(".env.local", "utf8").split("\n").find(line => line.startsWith("DATABASE_URL="));
const url = env ? env.split("=")[1].trim() : "";

const { Client } = require("pg");

const client = new Client({
  connectionString: url,
});

async function run() {
  await client.connect();
  console.log("Connected.");
  try {
    await client.query("ALTER TABLE employee_sessions ADD COLUMN IF NOT EXISTS session_end_reason VARCHAR(50);");
    console.log("Added session_end_reason.");

    await client.query("ALTER TABLE employee_live_state ADD COLUMN IF NOT EXISTS lead_started_at TIMESTAMP;");
    await client.query("ALTER TABLE employee_live_state ADD COLUMN IF NOT EXISTS lead_engagement_duration INTEGER DEFAULT 0;");
    console.log("Added lead_started_at and lead_engagement_duration.");

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
