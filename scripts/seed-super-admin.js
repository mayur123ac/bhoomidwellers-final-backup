// scripts/seed-super-admin.js — creates (or repairs) the initial Super Admin.
//
//   node scripts/seed-super-admin.js
//
// ── Credentials never live in this file ─────────────────────────────────────
// They are read from the environment, so nothing secret is committed:
//
//   SUPERADMIN_EMAIL     required
//   SUPERADMIN_PASSWORD  required
//   SUPERADMIN_NAME      optional, defaults to "Super Admin"
//
// Put them in frontend/.env.local (already git-ignored) or export them for one
// invocation. The script never prints the password, and never writes it
// anywhere but the hashed column.
//
// ── What it creates ─────────────────────────────────────────────────────────
// A single row in the existing `users` table:
//
//   role            = 'super_admin'
//   organization_id = NULL          ← this is what makes it platform level
//
// No new table and no new authentication system. lib/superAdmin.ts requires BOTH
// of those conditions, and every tenant query filters `organization_id = $1`,
// so a NULL organization keeps this account out of every tenant's data by
// construction rather than by a rule someone has to remember.
//
// ── Password storage ────────────────────────────────────────────────────────
// Hashed with scrypt in the exact format lib/passwords.ts writes and verifies:
//
//   scrypt$<N>$<r>$<p>$<salt-hex>$<hash-hex>
//
// The parameters below are copied from that module and MUST stay in step with
// it. They are not merely asserted to match — scripts/verify-super-admin.js
// signs in through the real /api/auth/login route, which is the only proof that
// the two agree.
//
// Re-running is safe: an existing platform account is updated in place (password
// reset, reactivated) rather than duplicated.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { promisify } = require("util");
const { Pool } = require("pg");

const scrypt = promisify(crypto.scrypt);

// ── Must mirror lib/passwords.ts ──
const SCHEME = "scrypt";
const N = 65536;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const MAX_MEM = 128 * N * BLOCK_SIZE * 2;

async function hashPassword(plain) {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const derived = await scrypt(plain.normalize("NFKC"), salt, KEY_LENGTH, {
    N, r: BLOCK_SIZE, p: PARALLELISM, maxmem: MAX_MEM,
  });
  return [SCHEME, N, BLOCK_SIZE, PARALLELISM, salt.toString("hex"), derived.toString("hex")].join("$");
}

/** Reads .env.local without adding a dotenv dependency. */
function loadEnvLocal() {
  const file = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^"|"$/g, "");
  }
  return out;
}

(async () => {
  const env = { ...loadEnvLocal(), ...process.env };

  const email = (env.SUPERADMIN_EMAIL || "").trim().toLowerCase();
  const password = env.SUPERADMIN_PASSWORD || "";
  const name = (env.SUPERADMIN_NAME || "Super Admin").trim();

  if (!email || !password) {
    console.error(
      "Missing credentials.\n\n" +
      "Set these in frontend/.env.local (git-ignored) or in the environment:\n" +
      "  SUPERADMIN_EMAIL=platform@example.com\n" +
      "  SUPERADMIN_PASSWORD=<a strong password>\n" +
      "  SUPERADMIN_NAME=Super Admin        # optional\n\n" +
      "Nothing was written."
    );
    process.exit(1);
  }
  if (password.length < 12) {
    console.error("Refusing to seed: SUPERADMIN_PASSWORD is shorter than 12 characters.");
    process.exit(1);
  }

  const dbUrl = env.DATABASE_URL;
  if (!dbUrl) { console.error("No DATABASE_URL."); process.exit(1); }

  const isProd = dbUrl.includes("ep-long-cloud");
  // Seeding production is a deliberate act, not something that happens because
  // the shell happened to have a production URL loaded.
  if (isProd && env.SEED_TARGET !== "production") {
    console.error(
      "DATABASE_URL points at the PRODUCTION branch (ep-long-cloud).\n" +
      "Re-run with SEED_TARGET=production if that is genuinely intended.\n" +
      "Nothing was written."
    );
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dbUrl });
  const client = await pool.connect();
  try {
    console.log(`Target: ${dbUrl.replace(/:[^:@]+@/, ":****@")}`);

    await client.query("BEGIN");

    // A platform account must not collide with a tenant user on the same email:
    // the login route resolves by email OR name, so two matching rows would make
    // which account you get depend on row order.
    const clash = await client.query(
      `SELECT id, organization_id, role FROM users
        WHERE (LOWER(email) = $1 OR LOWER(name) = LOWER($2))
          AND organization_id IS NOT NULL
          AND deleted_at IS NULL`,
      [email, name]
    );
    if (clash.rows.length > 0) {
      throw new Error(
        `A tenant user already uses that email or name (users.id=${clash.rows[0].id}). ` +
        `Choose a different SUPERADMIN_EMAIL/SUPERADMIN_NAME.`
      );
    }

    const hashed = await hashPassword(password);

    const existing = await client.query(
      `SELECT id FROM users
        WHERE LOWER(email) = $1 AND organization_id IS NULL
        LIMIT 1`,
      [email]
    );

    let id, action;
    if (existing.rows.length > 0) {
      const r = await client.query(
        `UPDATE users
            SET name = $2, password = $3, role = 'super_admin',
                is_active = true, deleted_at = NULL,
                organization_id = NULL, updated_at = now(),
                password_changed_at = now()
          WHERE id = $1
        RETURNING id`,
        [existing.rows[0].id, name, hashed]
      );
      id = r.rows[0].id; action = "updated";
    } else {
      const r = await client.query(
        `INSERT INTO users (name, email, password, role, is_active, organization_id, created_at, updated_at)
         VALUES ($1, $2, $3, 'super_admin', true, NULL, now(), now())
         RETURNING id`,
        [name, email, hashed]
      );
      id = r.rows[0].id; action = "created";
    }

    await client.query("COMMIT");

    // Deliberately no password, and no hash, in the output.
    console.log(`Super Admin ${action}: users.id=${id}, email=${email}, role=super_admin, organization_id=NULL`);
    console.log("Password stored as a scrypt hash. It is not printed and not retrievable.");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Seed failed:", err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
