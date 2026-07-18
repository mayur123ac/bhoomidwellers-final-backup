// scripts/migrate-followups.js
// Run from inside frontend/ folder:
//   node scripts/migrate-followups.js

const { MongoClient } = require("mongodb");
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

// Load .env.local
const envPath = path.join(process.cwd(), ".env.local");
if (!fs.existsSync(envPath)) {
  console.error("ERROR: .env.local not found. Run from inside frontend/");
  process.exit(1);
}

const envVars = {};
fs.readFileSync(envPath, "utf8").split("\n").forEach(function(line) {
  var trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return;
  var eqIndex = trimmed.indexOf("=");
  if (eqIndex === -1) return;
  var key = trimmed.slice(0, eqIndex).trim();
  var val = trimmed.slice(eqIndex + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  envVars[key] = val;
});

var MONGODB_URI  = envVars["MONGODB_URI"];
var DATABASE_URL = envVars["DATABASE_URL"];

if (!MONGODB_URI)  { console.error("ERROR: MONGODB_URI missing");  process.exit(1); }
if (!DATABASE_URL) { console.error("ERROR: DATABASE_URL missing"); process.exit(1); }

var pool = new Pool({ connectionString: DATABASE_URL });

async function migrate() {
  console.log("\nMigrating followup messages: MongoDB → PostgreSQL\n");

  var mongo = new MongoClient(MONGODB_URI);
  await mongo.connect();
  console.log("MongoDB connected");

  var dbName = MONGODB_URI.split("/").pop().split("?")[0];
  console.log("Database: " + dbName);

  var db = mongo.db(dbName);
  var pgClient = await pool.connect();

  try {
    await pgClient.query("BEGIN");

    var followups = await db.collection("followupmessages").find({}).toArray();
    console.log("Found " + followups.length + " followup message(s) in MongoDB\n");

    var migrated = 0;
    var skipped  = 0;

    for (var i = 0; i < followups.length; i++) {
      var f = followups[i];

      // leadId in MongoDB might be a string number like "42"
      // Check if a matching lead exists in PostgreSQL
      var leadCheck = await pgClient.query(
        "SELECT id FROM leads WHERE id::text = $1 LIMIT 1",
        [String(f.leadId)]
      );

      if (leadCheck.rows.length === 0) {
        console.log("  SKIP: No lead found for leadId=" + f.leadId + " (message: " + String(f.message || "").slice(0, 40) + "...)");
        skipped++;
        continue;
      }

      var pgLeadId = leadCheck.rows[0].id;

      await pgClient.query(
        `INSERT INTO follow_ups (lead_id, message, created_by_name, site_visit_date, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          pgLeadId,
          f.message        || "",
          f.salesManagerName || f.createdBy || "Unknown",
          f.siteVisitDate  || null,
          f.createdAt      || new Date(),
        ]
      );

      migrated++;
      console.log("  OK: leadId=" + f.leadId + " by " + (f.salesManagerName || f.createdBy || "Unknown"));
    }

    await pgClient.query("COMMIT");

    console.log("\nMigration complete!");
    console.log("  Migrated : " + migrated);
    console.log("  Skipped  : " + skipped + " (no matching lead in PostgreSQL)");

    if (skipped > 0) {
      console.log("\nNOTE: Skipped messages had leadIds that don't exist in your");
      console.log("PostgreSQL leads table. This is normal if those leads were");
      console.log("never uploaded to PostgreSQL.");
    }

  } catch (err) {
    await pgClient.query("ROLLBACK");
    console.error("\nMigration FAILED - rolled back");
    console.error("Error: " + (err && err.message ? err.message : String(err)));
    process.exit(1);
  } finally {
    pgClient.release();
    await pool.end();
    await mongo.close();
  }
}

migrate();
