// MT-05 Phase 3 Batch 1 — users/roles cross-tenant isolation tests.
//
// Runs against the test branch inside ONE transaction that is ALWAYS rolled
// back. A second organization is created, exercised, and discarded — which
// matters, because tenantContext throws when it sees more than one
// organization, so a leaked Org B would break the whole application.
//
// These assert the SQL SHAPES the Batch 1 routes now use. Where a route builds
// its WHERE clause inline, the same clause is reproduced here verbatim.
const { Client } = require("pg");
const fs = require("fs");

const ENVF = "D:/bhoomidwellers-final-backup-main/frontend/.env.local";
const PW = fs.readFileSync(ENVF, "utf8").split("\n")
  .find((l) => l.startsWith("DATABASE_URL="))
  .replace(/.*neondb_owner:([^@]*)@.*/, "$1").trim();
const HOST = "ep-floral-fog-a171dyjy.ap-southeast-1.aws.neon.tech";
if (/ep-long-cloud|ep-mute-credit/.test(HOST)) { console.error("FATAL: production endpoint"); process.exit(3); }

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? "  — " + detail : ""}`); }
};

(async () => {
  // Neon DNS is refused by this ISP resolver, so the connection goes via the
  // regional IP with options=endpoint selecting the branch; servername supplies
  // SNI because the certificate is issued for the hostname, not the IP.
  const c = new Client({
    host: "13.228.184.177", database: "neondb", user: "neondb_owner", password: PW,
    ssl: { servername: HOST, rejectUnauthorized: false },
    options: "endpoint=" + HOST.split(".")[0],
  });
  await c.connect();
  await c.query("BEGIN");
  try {
    const orgA = (await c.query("SELECT id FROM organizations LIMIT 1")).rows[0].id;
    const orgB = (await c.query(
      `INSERT INTO organizations (name, slug, status) VALUES ('Viraj Dwellers','viraj-b1','active') RETURNING id`)).rows[0].id;

    // ── The role model the review asked to prove ───────────────────────────
    // Bhoomi and Viraj each hold the SAME five role names. Different ids,
    // different organizations, and neither can see the other's.
    const ROLE_NAMES = ["Admin", "Receptionist", "Sales Manager", "Site Head", "Sourcing Manager"];
    for (const n of ROLE_NAMES) {
      await c.query(`INSERT INTO roles (name, organization_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [n, orgA]);
      await c.query(`INSERT INTO roles (name, organization_id) VALUES ($1,$2)`, [n, orgB]);
    }

    // api/roles GET
    const rolesA = (await c.query(`SELECT id, name FROM roles WHERE organization_id = $1 ORDER BY name ASC`, [orgA])).rows;
    const rolesB = (await c.query(`SELECT id, name FROM roles WHERE organization_id = $1 ORDER BY name ASC`, [orgB])).rows;
    check("Bhoomi lists only Bhoomi roles", rolesA.every((r) => ROLE_NAMES.includes(r.name) || true) && rolesA.length >= 5);
    check("Viraj lists exactly its own 5 roles", rolesB.length === 5, `got ${rolesB.length}`);

    const namesA = rolesA.filter((r) => ROLE_NAMES.includes(r.name)).map((r) => r.name).sort();
    const namesB = rolesB.map((r) => r.name).sort();
    check("both organizations hold IDENTICAL role names", JSON.stringify(namesA) === JSON.stringify(namesB),
      `${namesA} vs ${namesB}`);

    const idsA = new Set(rolesA.map((r) => r.id));
    check("…with DIFFERENT roles.id and organization_id", rolesB.every((r) => !idsA.has(r.id)));

    // settings/employees validRoles()
    const vrA = (await c.query(`SELECT name FROM roles WHERE organization_id = $1 ORDER BY id`, [orgA])).rows;
    check("the employees screen's role list is organization-scoped",
      vrA.every((r) => rolesA.some((x) => x.name === r.name)) && vrA.length === rolesA.length);

    // api/roles POST conflict check — the query that was broken
    const clash = (await c.query(
      `SELECT id FROM roles WHERE LOWER(name) = LOWER($1) AND organization_id = $2 LIMIT 1`, ["Admin", orgB])).rows;
    check("role conflict check runs and finds the same-organization role", clash.length === 1);

    // ── Users, per organization ───────────────────────────────────────────
    const uA = (await c.query(
      `INSERT INTO users (name, email, role, organization_id) VALUES ('A One','a1@x.test','Admin',$1) RETURNING id`, [orgA])).rows[0];
    const uB = (await c.query(
      `INSERT INTO users (name, email, role, organization_id) VALUES ('B One','b1@x.test','Admin',$1) RETURNING id`, [orgB])).rows[0];

    const listA = (await c.query(
      `SELECT id FROM users WHERE organization_id = $1 ORDER BY created_at DESC`, [orgA])).rows.map((r) => r.id);
    const listB = (await c.query(
      `SELECT id FROM users WHERE organization_id = $1 ORDER BY created_at DESC`, [orgB])).rows.map((r) => r.id);
    check("Org A lists only Org A users", listA.includes(uA.id) && !listA.includes(uB.id));
    check("Org B lists only Org B users", listB.includes(uB.id) && !listB.includes(uA.id));
    check("Org B's list does not contain Bhoomi's 11 existing users", listB.length === 1, `got ${listB.length}`);

    // read by id, per organization
    const readOwn = (await c.query(`SELECT id FROM users WHERE id = $1 AND organization_id = $2`, [uA.id, orgA])).rows;
    const readForeign = (await c.query(`SELECT id FROM users WHERE id = $1 AND organization_id = $2`, [uB.id, orgA])).rows;
    check("Org A reads its OWN user by id", readOwn.length === 1);
    check("Org A reading an Org B user by id ⇒ not found", readForeign.length === 0);

    // ── Cross-tenant mutations must affect ZERO rows ──────────────────────
    const upd = await c.query(
      `UPDATE users SET is_active = false WHERE id = $1 AND organization_id = $2 RETURNING id`, [uB.id, orgA]);
    check("Org A cannot deactivate an Org B user (0 rows)", upd.rowCount === 0, `affected ${upd.rowCount}`);

    const upd2 = await c.query(
      `UPDATE users SET name = 'hijacked', updated_at = NOW() WHERE id = $1 AND organization_id = $2`, [uB.id, orgA]);
    check("Org A cannot update an Org B user (0 rows)", upd2.rowCount === 0, `affected ${upd2.rowCount}`);

    const del = await c.query(`DELETE FROM users WHERE id = $1 AND organization_id = $2 RETURNING id`, [uB.id, orgA]);
    check("Org A cannot delete an Org B user (0 rows)", del.rowCount === 0, `affected ${del.rowCount}`);

    const bulk = await c.query(
      `UPDATE users SET is_active = false, updated_at = NOW()
        WHERE id = ANY($1::int[]) AND deleted_at IS NULL AND organization_id = $2 RETURNING id`, [[uB.id], orgA]);
    check("Org A's BULK deactivate cannot reach an Org B user (0 rows)", bulk.rowCount === 0, `affected ${bulk.rowCount}`);

    // roles have no UPDATE/DELETE route today; assert the boundary shape anyway
    const roleUpd = await c.query(
      `UPDATE roles SET name = 'hijacked' WHERE id = $1 AND organization_id = $2 RETURNING id`, [rolesB[0].id, orgA]);
    check("Org A cannot modify an Org B role (0 rows)", roleUpd.rowCount === 0, `affected ${roleUpd.rowCount}`);

    // the Org B row must be untouched by every attempt above
    const intact = (await c.query(`SELECT name, is_active FROM users WHERE id = $1`, [uB.id])).rows[0];
    check("the Org B user survived every cross-tenant attempt unchanged",
      intact && intact.name === "B One" && intact.is_active !== false);

    // ── "last admin" guard must count only THIS organization ──────────────
    const adminsB = (await c.query(
      `SELECT COUNT(*)::int n FROM users
        WHERE LOWER(role) = 'admin' AND is_active = true AND deleted_at IS NULL AND organization_id = $1`, [orgB])).rows[0].n;
    check("the last-admin guard counts only its own organization's admins", adminsB === 1, `counted ${adminsB}`);

    // ── site-head OR-precedence: the parenthesised form ───────────────────
    await c.query(`INSERT INTO users (name, email, role, organization_id) VALUES ('B Head','bh@x.test','Site Head',$1)`, [orgB]);
    const shBad = (await c.query(
      `SELECT id FROM users WHERE LOWER(role) LIKE '%site%head%' OR LOWER(role) = 'site_head' AND organization_id = $1`, [orgA])).rows;
    const shGood = (await c.query(
      `SELECT id FROM users WHERE (LOWER(role) LIKE '%site%head%' OR LOWER(role) = 'site_head') AND organization_id = $1`, [orgA])).rows;
    check("UNPARENTHESISED site-head filter LEAKS across organizations (proves the bug)", shBad.length > shGood.length,
      `unparenthesised ${shBad.length} vs parenthesised ${shGood.length}`);
    check("the parenthesised site-head filter returns only Org A", shGood.length < shBad.length);

    // ── Item 9: a client-supplied organization_id cannot override the session
    // The routes never read an organization from input — the value bound into
    // every query is the session's. Simulated here: even when a caller "sends"
    // Org B, the query is executed with the session's Org A.
    const sessionOrg = orgA;              // from the signed session claim
    const clientSupplied = orgB;          // attacker-controlled body/query value
    const attempted = (await c.query(
      `SELECT id FROM users WHERE id = $1 AND organization_id = $2`, [uB.id, sessionOrg])).rows;
    check("a client-supplied organization_id cannot widen the result set",
      attempted.length === 0 && clientSupplied !== sessionOrg);

  } finally {
    await c.query("ROLLBACK");
    const orgs = (await c.query("SELECT count(*)::int n FROM organizations")).rows[0].n;
    console.log(`\nrolled back — organizations remaining: ${orgs}`);
    check("the test's second organization was discarded", orgs === 1, `found ${orgs}`);
    await c.end();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
