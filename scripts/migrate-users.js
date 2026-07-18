// scripts/migrate-users.js
// Run from inside frontend/ folder:
//   node scripts/migrate-users.js

const { MongoClient } = require("mongodb");
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

// ── Load .env.local ───────────────────────────────────────────
const envPath = path.join(process.cwd(), ".env.local");

if (!fs.existsSync(envPath)) {
  console.error("ERROR: .env.local not found. Run this from inside the frontend/ folder.");
  process.exit(1);
}

const envVars = {};

fs.readFileSync(envPath, "utf8")
  .split("\n")
  .forEach(function(line) {
    var trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    var eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) return;
    var key = trimmed.slice(0, eqIndex).trim();
    var val = trimmed.slice(eqIndex + 1).trim();
    // Strip surrounding quotes if any
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    envVars[key] = val;
  });

var MONGODB_URI  = envVars["MONGODB_URI"];
var DATABASE_URL = envVars["DATABASE_URL"];

if (!MONGODB_URI) {
  console.error("ERROR: MONGODB_URI not found in .env.local");
  process.exit(1);
}

if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL not found in .env.local");
  process.exit(1);
}

console.log("MONGODB_URI  found: YES");
console.log("DATABASE_URL found: YES");

// ── Run migration ─────────────────────────────────────────────
var pool = new Pool({ connectionString: DATABASE_URL });

async function migrate() {
  console.log("\nStarting migration: MongoDB -> PostgreSQL\n");

  var mongo = new MongoClient(MONGODB_URI);
  await mongo.connect();
  console.log("MongoDB connected OK");

  // Parse DB name from URI: mongodb+srv://user:pass@cluster/DB_NAME?params
  var uriPath = MONGODB_URI.split("/").pop();
  var dbName  = uriPath.split("?")[0];
  console.log("Using MongoDB database: " + dbName);

  var db = mongo.db(dbName);
  var pgClient = await pool.connect();

  try {
    await pgClient.query("BEGIN");

    // ── Roles ─────────────────────────────────────────────────
    console.log("\n[1/2] Migrating roles...");
    var roles = await db.collection("roles").find({}).toArray();
    console.log("  Found " + roles.length + " role(s) in MongoDB");

    for (var i = 0; i < roles.length; i++) {
      var r = roles[i];
      await pgClient.query(
        "INSERT INTO roles (name) VALUES ($1) ON CONFLICT (name) DO NOTHING",
        [r.name]
      );
      console.log("  OK: Role -> " + r.name);
    }

    // ── Users ─────────────────────────────────────────────────
    console.log("\n[2/2] Migrating users...");
    var users = await db.collection("users").find({}).toArray();
    console.log("  Found " + users.length + " user(s) in MongoDB");

    for (var j = 0; j < users.length; j++) {
      var u = users[j];
      var username = u.username || u.email.split("@")[0];

      await pgClient.query(
        "INSERT INTO users (name, username, email, password, role, is_active, created_at) " +
        "VALUES ($1, $2, $3, $4, $5, $6, $7) " +
        "ON CONFLICT (email) DO UPDATE " +
        "SET name = EXCLUDED.name, username = EXCLUDED.username, " +
        "password = EXCLUDED.password, role = EXCLUDED.role, " +
        "is_active = EXCLUDED.is_active",
        [
          u.name      || "Unknown",
          username,
          u.email,
          u.password  || "changeme",
          u.role      || "Employee",
          u.isActive  !== undefined ? u.isActive : true,
          u.createdAt || new Date(),
        ]
      );
      console.log("  OK: User -> " + u.email + " (role: " + u.role + ")");
    }

    await pgClient.query("COMMIT");

    console.log("\nMigration SUCCESS!");
    console.log("---------------------------------------------");
    console.log("Now:");
    console.log("  1. Replace the 3 API route files");
    console.log("  2. Replace lib/db.ts and lib/mongodb.ts");
    console.log("  3. Test the app");
    console.log("  4. Delete lib/models/User.ts and Role.ts");
    console.log("  5. Remove MONGODB_URI from .env.local");
    console.log("---------------------------------------------\n");

  } catch (e) {
    await pgClient.query("ROLLBACK");
    console.error("\nMigration FAILED - rolled back everything");
    console.error("Error message: " + (e && e.message ? e.message : String(e)));
    process.exit(1);
  } finally {
    pgClient.release();
    await pool.end();
    await mongo.close();
  }
}

migrate();
