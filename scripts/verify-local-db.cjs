// scripts/verify-local-db.cjs — read-only check of which database local dev will use.
//
// Reads DATABASE_URL exactly the way Next.js resolves it (real process env wins
// over .env.local), refuses to proceed if it points at the production branch, and
// then confirms the MT-04/MT-05 schema markers are present.
//
// Read-only by construction: it opens a transaction, runs only SELECTs against
// information_schema, and rolls back. Nothing here can write.
//
//   node scripts/verify-local-db.cjs
//
// Exit codes: 0 = correct test branch with the expected schema
//             2 = wrong branch / production / missing schema
//             3 = could not connect or no DATABASE_URL

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const PRODUCTION_ENDPOINTS = ["ep-long-cloud-a1d5t8of", "ep-mute-credit-a1kaw2vj"];
const EXPECTED_TEST_ENDPOINT = "ep-floral-fog-a171dyjy";

// Columns that must exist for the MT-05 application code to run at all.
const REQUIRED_COLUMNS = [
  ["employee_sessions", "organization_id"],
  ["users", "organization_id"],
  ["walkin_enquiries", "organization_id"],
  ["booking_applications", "organization_id"],
  ["roles", "organization_id"],
  ["inventory_projects", "organization_id"],
];

/** Real process env wins, exactly as Next.js treats it. */
function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) {
    return { url: process.env.DATABASE_URL, source: "process environment" };
  }
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) return { url: null, source: "(no .env.local)" };

  // First uncommented DATABASE_URL wins, matching dotenv's behaviour.
  for (const raw of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.replace(/^﻿/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    if (line.slice(0, eq).trim() !== "DATABASE_URL") continue;
    return {
      url: line.slice(eq + 1).trim().replace(/^["']|["']$/g, ""),
      source: ".env.local",
    };
  }
  return { url: null, source: ".env.local (no active DATABASE_URL)" };
}

function endpointOf(hostname) {
  const m = hostname.match(/^(ep-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+)/);
  return m ? m[1] : null;
}

(async () => {
  const { url, source } = resolveDatabaseUrl();
  if (!url) {
    console.error(`FAIL  no DATABASE_URL found (${source})`);
    process.exit(3);
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    console.error("FAIL  DATABASE_URL is not a parsable URL");
    process.exit(3);
  }

  const endpoint = endpointOf(parsed.hostname);
  console.log(`source     ${source}`);
  console.log(`host       ${parsed.hostname}`);
  console.log(`database   ${parsed.pathname.replace(/^\//, "").split("?")[0]}`);
  console.log(`endpoint   ${endpoint ?? "(none — not a Neon host)"}`);

  if (endpoint && PRODUCTION_ENDPOINTS.includes(endpoint)) {
    console.error(`\nFAIL  this is PRODUCTION (${endpoint}). Local development must not use it.`);
    process.exit(2);
  }
  if (endpoint !== EXPECTED_TEST_ENDPOINT) {
    console.error(
      `\nFAIL  expected the MT-05 test branch ${EXPECTED_TEST_ENDPOINT}, got ${endpoint ?? parsed.hostname}.`
    );
    process.exit(2);
  }
  console.log(`verdict    MT-05 TEST BRANCH (not production)\n`);

  const client = new Client({ connectionString: url });
  try {
    await client.connect();
  } catch (err) {
    console.error(`FAIL  could not connect: ${err.message}`);
    process.exit(3);
  }

  try {
    // Read-only by construction, and made explicit so an accidental write fails.
    await client.query("BEGIN READ ONLY");

    const db = (await client.query("SELECT current_database() AS db")).rows[0].db;
    console.log(`current_database()  ${db}`);

    const { rows } = await client.query(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name = 'organization_id'`
    );
    const have = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
    console.log(`tables carrying organization_id  ${rows.length}\n`);

    let missing = 0;
    for (const [t, c] of REQUIRED_COLUMNS) {
      const ok = have.has(`${t}.${c}`);
      if (!ok) missing++;
      console.log(`  ${ok ? "OK  " : "MISS"}  ${t}.${c}`);
    }

    await client.query("ROLLBACK");

    if (missing > 0) {
      console.error(`\nFAIL  ${missing} expected column(s) missing — this is NOT the MT-04/MT-05 database.`);
      console.error("Do not patch the database by hand. Report the branch as incorrect.");
      process.exit(2);
    }
    console.log("\nPASS  local development is pointed at the MT-05 test branch with the expected schema.");
  } finally {
    await client.end();
  }
})();
