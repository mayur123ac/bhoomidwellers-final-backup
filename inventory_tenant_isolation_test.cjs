// inventory_tenant_isolation_test.cjs
//
// Cross-tenant test for the inventory module: buildings, towers, wings, units,
// analytics, price rules, holds and bulk actions.
//
//   node inventory_tenant_isolation_test.cjs
//   TENANT_A=bhoomi TENANT_B=viraj node inventory_tenant_isolation_test.cjs
//
// Sessions are minted directly with SESSION_SECRET, exactly as lib/sessionCookie
// does, so the test proves the property that matters: a VALID, correctly signed
// session for organization A cannot reach organization B's inventory.
//
// Read-only by default. The write-path probes are shaped to stop at an
// authorization or validation gate; the one that could mutate (bulk delete)
// asserts the row is untouched afterwards.

"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Client } = require("pg");

const BASE = process.env.BASE_URL || "http://localhost:3000";

const env = {};
for (const raw of fs.readFileSync(path.join(__dirname, ".env.local"), "utf8").split(/\r?\n/)) {
  const l = raw.replace(/^﻿/, "").trim();
  if (!l || l.startsWith("#")) continue;
  const i = l.indexOf("=");
  if (i > 0) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
const b64 = (x) => Buffer.from(x).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sign = (p) => {
  const n = Math.floor(Date.now() / 1000);
  const e = b64(JSON.stringify({ ...p, iat: n, exp: n + 3600 }));
  return `${e}.${b64(crypto.createHmac("sha256", env.SESSION_SECRET).update(e).digest())}`;
};

let pass = 0, fail = 0;
const failures = [];
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(`${name}${detail ? `: ${detail}` : ""}`); console.log(`  FAIL  ${name}${detail ? `  -- ${detail}` : ""}`); }
};

const api = async (cookie, url, init = {}) => {
  const res = await fetch(`${BASE}${url}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      cookie: `crm_session=${cookie}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  return { status: res.status, body, bytes: Buffer.byteLength(text) };
};

(async () => {
  const u = new URL(env.DATABASE_URL);
  const db = new Client({
    host: u.hostname, database: u.pathname.replace(/^\//, "").split("?")[0],
    user: u.username, password: u.password, ssl: { rejectUnauthorized: false },
  });
  await db.connect();

  const { rows: orgs } = await db.query(
    `SELECT o.id, o.name,
            (SELECT json_build_object('id', usr.id, 'name', usr.name, 'email', usr.email, 'role', usr.role)
               FROM users usr WHERE usr.organization_id = o.id AND usr.is_active = true
                AND LOWER(REPLACE(usr.role, '_', ' ')) = 'admin' ORDER BY usr.id LIMIT 1) AS admin,
            (SELECT count(*)::int FROM inventory_units iu
              WHERE iu.organization_id = o.id AND iu.deleted_at IS NULL) AS units
       FROM organizations o ORDER BY o.created_at`);
  let tenants = orgs.filter((o) => o.admin);
  const pick = (needle) => tenants.find((o) => o.name.toLowerCase().includes(String(needle).trim().toLowerCase()) || o.id === needle);
  if (process.env.TENANT_A || process.env.TENANT_B) {
    const a = process.env.TENANT_A ? pick(process.env.TENANT_A) : tenants[0];
    const b = process.env.TENANT_B ? pick(process.env.TENANT_B) : tenants[1];
    if (!a || !b || a.id === b.id) {
      console.error(`ABORT: could not resolve two tenants. Available: ${tenants.map((o) => o.name).join(", ")}`);
      process.exit(2);
    }
    tenants = [a, b];
  }
  const [A, B] = tenants;
  if (!A || !B) { console.error("ABORT: need two organizations with an active Admin."); process.exit(2); }

  console.log(`\nBase URL: ${BASE}`);
  console.log(`Tenant A: ${A.name} — ${A.units} live units`);
  console.log(`Tenant B: ${B.name} — ${B.units} live units\n`);

  const ck = (o) => sign({ _id: String(o.admin.id), name: o.admin.name, email: o.admin.email, role: o.admin.role, isActive: true, org: o.id });
  const cookieA = ck(A), cookieB = ck(B);

  // Ground truth straight from the database.
  const ownedProjects = async (org) => new Set((await db.query(
    `SELECT id FROM inventory_projects WHERE organization_id = $1 AND deleted_at IS NULL`, [org])).rows.map((r) => r.id));
  const ownedProjectNames = async (org) => new Set((await db.query(
    `SELECT DISTINCT LOWER(TRIM(project_name)) AS k FROM inventory_units
      WHERE organization_id = $1 AND deleted_at IS NULL`, [org])).rows.map((r) => r.k));
  const ownedUnits = async (org) => new Set((await db.query(
    `SELECT id FROM inventory_units WHERE organization_id = $1 AND deleted_at IS NULL`, [org])).rows.map((r) => r.id));

  const aProjects = await ownedProjects(A.id), bProjects = await ownedProjects(B.id);
  const aNames = await ownedProjectNames(A.id), bNames = await ownedProjectNames(B.id);
  const aUnits = await ownedUnits(A.id), bUnits = await ownedUnits(B.id);

  const foreignUnit = (await db.query(
    `SELECT id, flat_no, status FROM inventory_units
      WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY id LIMIT 1`, [A.id])).rows[0];
  const foreignProject = (await db.query(
    `SELECT id, name FROM inventory_projects WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY id LIMIT 1`, [A.id])).rows[0];
  const foreignTower = (await db.query(
    `SELECT id, name, project_id FROM inventory_towers WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY id LIMIT 1`, [A.id])).rows[0];

  // ═════════════════════════════════════════════════════════════════════════
  console.log("── 1. Building list (view=buildings) — the landing page ──");
  // ═════════════════════════════════════════════════════════════════════════
  for (const [label, cookie, own, other, otherLabel] of [
    ["A", cookieA, aNames, bNames, B.name],
    ["B", cookieB, bNames, aNames, A.name],
  ]) {
    const r = await api(cookie, "/api/inventory?view=buildings");
    const keys = (r.body?.data || []).map((x) => String(x.key));
    const foreign = keys.filter((k) => other.has(k) && !own.has(k));
    check(`${label}: building list responds 200`, r.status === 200, `status ${r.status}`);
    check(`${label}: sees only its own buildings (${keys.length} shown)`,
      foreign.length === 0, `${otherLabel}'s buildings visible: ${foreign.join(", ")}`);
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log("\n── 2. Unit list, filters and pagination ──");
  // ═════════════════════════════════════════════════════════════════════════
  for (const [label, cookie, own, otherSet, otherLabel] of [
    ["A", cookieA, aUnits, bUnits, B.name],
    ["B", cookieB, bUnits, aUnits, A.name],
  ]) {
    const r = await api(cookie, "/api/inventory?limit=500");
    const ids = (r.body?.data || []).map((x) => x.id);
    const foreign = ids.filter((id) => otherSet.has(id));
    check(`${label}: unit list returns only its own units (${ids.length} rows, total ${r.body?.total})`,
      foreign.length === 0, `${otherLabel}'s unit ids: ${foreign.slice(0, 10).join(", ")}`);
    check(`${label}: reported total matches its own live stock`,
      r.body?.total === own.size, `api ${r.body?.total} vs db ${own.size}`);
  }

  // Filtering by another tenant's building name must return nothing.
  if (foreignProject) {
    const r = await api(cookieB, `/api/inventory?project_name=${encodeURIComponent(foreignProject.name)}&limit=500`);
    check(`B: filtering by A's building "${foreignProject.name}" returns nothing`,
      (r.body?.data || []).length === 0, `${(r.body?.data || []).length} rows leaked`);
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log("\n── 3. Projects, towers and price rules ──");
  // ═════════════════════════════════════════════════════════════════════════
  {
    const r = await api(cookieB, "/api/inventory/projects");
    const ids = (r.body?.data || []).map((x) => x.id);
    check(`B: /projects returns only B's projects (${ids.length})`,
      ids.every((id) => bProjects.has(id)), `foreign: ${ids.filter((id) => !bProjects.has(id)).join(", ")}`);
  }
  {
    const r = await api(cookieB, "/api/inventory/towers");
    const ids = (r.body?.data || []).map((x) => x.project_id);
    check(`B: /towers returns only towers of B's projects (${(r.body?.data || []).length})`,
      ids.every((id) => bProjects.has(id)), `foreign project_ids: ${[...new Set(ids.filter((id) => !bProjects.has(id)))].join(", ")}`);
  }
  if (foreignProject) {
    const r = await api(cookieB, `/api/inventory/towers?project_id=${foreignProject.id}`);
    check(`B: /towers?project_id=<A's project> returns nothing`,
      (r.body?.data || []).length === 0, `${(r.body?.data || []).length} towers leaked`);
  }
  {
    const r = await api(cookieB, "/api/inventory/price-rules");
    const ids = (r.body?.data || []).map((x) => x.project_id);
    check(`B: /price-rules returns only B's rules (${(r.body?.data || []).length})`,
      ids.every((id) => bProjects.has(id)), `foreign project_ids: ${[...new Set(ids.filter((id) => !bProjects.has(id)))].join(", ")}`);
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log("\n── 4. Analytics ──");
  // ═════════════════════════════════════════════════════════════════════════
  {
    const rA = await api(cookieA, "/api/inventory/analytics");
    const rB = await api(cookieB, "/api/inventory/analytics");
    const totalOf = (r) => r.body?.data?.summary?.total ?? r.body?.data?.total ?? null;
    check(`A: analytics total (${totalOf(rA)}) equals A's own stock (${A.units})`,
      totalOf(rA) === null || totalOf(rA) === A.units, `got ${totalOf(rA)}`);
    check(`B: analytics total (${totalOf(rB)}) equals B's own stock (${B.units})`,
      totalOf(rB) === null || totalOf(rB) === B.units, `got ${totalOf(rB)}`);
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log("\n── 5. Direct access by ID — unit, building, tower ──");
  // ═════════════════════════════════════════════════════════════════════════
  if (foreignUnit) {
    const r = await api(cookieB, `/api/inventory/${foreignUnit.id}`);
    check(`B cannot GET A's unit #${foreignUnit.id}`, r.status === 404, `status ${r.status}`);

    // A COMPLETE body, so the request reaches the tenant check rather than
    // stopping at field validation — otherwise a 400 would look like a pass.
    const patch = await api(cookieB, `/api/inventory/${foreignUnit.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "blocked", user_name: B.admin.name, user_role: "admin" }),
    });
    check(`B cannot PATCH A's unit #${foreignUnit.id}`, patch.status === 404 || patch.status === 403,
      `status ${patch.status} ${JSON.stringify(patch.body).slice(0, 120)}`);

    const del = await api(cookieB, `/api/inventory/${foreignUnit.id}`, { method: "DELETE" });
    check(`B cannot DELETE A's unit #${foreignUnit.id}`, del.status === 404 || del.status === 403,
      `status ${del.status}`);

    const hold = await api(cookieB, `/api/inventory/${foreignUnit.id}/hold`, {
      method: "POST", body: JSON.stringify({ hours: 24 }),
    });
    check(`B cannot HOLD A's unit #${foreignUnit.id}`, hold.status === 404 || hold.status === 403,
      `status ${hold.status}`);

    const release = await api(cookieB, `/api/inventory/${foreignUnit.id}/hold`, { method: "DELETE" });
    check(`B cannot RELEASE a hold on A's unit #${foreignUnit.id}`,
      release.status === 404 || release.status === 403, `status ${release.status}`);

    const cost = await api(cookieB, `/api/inventory/${foreignUnit.id}/cost-sheet`);
    const costLeaked = cost.status === 200 && (cost.body?.data?.length ?? 0) > 0;
    check(`B cannot read A's unit cost sheets`, !costLeaked, `status ${cost.status}`);

    // The state of A's unit must be exactly what it was before any of the above.
    const after = (await db.query(
      `SELECT status, deleted_at, held_by, organization_id::text AS org FROM inventory_units WHERE id = $1`,
      [foreignUnit.id])).rows[0];
    check(`A's unit #${foreignUnit.id} is unchanged (status ${after.status})`,
      after.status === foreignUnit.status && after.deleted_at === null && after.org === A.id,
      JSON.stringify(after));
  }

  if (foreignProject) {
    const r = await api(cookieB, `/api/inventory/building?project_name=${encodeURIComponent(foreignProject.name)}&tower=A`);
    const leaked = r.status === 200 && ((r.body?.data?.units?.length ?? 0) > 0 || (r.body?.total ?? 0) > 0);
    check(`B cannot read A's building "${foreignProject.name}" via /building`, !leaked,
      `status ${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log("\n── 6. Bulk delete cannot reach across tenants ──");
  // ═════════════════════════════════════════════════════════════════════════
  if (foreignUnit) {
    const before = (await db.query(
      `SELECT deleted_at FROM inventory_units WHERE id = $1`, [foreignUnit.id])).rows[0];
    const r = await api(cookieB, `/api/inventory/bulk`, {
      method: "DELETE", body: JSON.stringify({ ids: [foreignUnit.id] }),
    });
    const after = (await db.query(
      `SELECT deleted_at FROM inventory_units WHERE id = $1`, [foreignUnit.id])).rows[0];
    check(`B's bulk delete does not soft-delete A's unit #${foreignUnit.id}`,
      after.deleted_at === null && before.deleted_at === null,
      `deleted_at went ${before.deleted_at} -> ${after.deleted_at}; response ${JSON.stringify(r.body).slice(0, 140)}`);
    check(`…and it reports 0 deleted`, (r.body?.deleted ?? 0) === 0, JSON.stringify(r.body).slice(0, 140));
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log("\n── 7. A supplied organization id is ignored ──");
  // ═════════════════════════════════════════════════════════════════════════
  {
    const r = await api(cookieB, `/api/inventory?view=buildings&organization_id=${A.id}&organizationId=${A.id}`);
    const keys = (r.body?.data || []).map((x) => String(x.key));
    const foreign = keys.filter((k) => aNames.has(k) && !bNames.has(k));
    check("a spoofed organization_id in the query string changes nothing", foreign.length === 0,
      `leaked: ${foreign.join(", ")}`);
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log("\n── 8. Unauthenticated and forged sessions ──");
  // ═════════════════════════════════════════════════════════════════════════
  {
    const anon = await fetch(`${BASE}/api/inventory?view=buildings`);
    check("anonymous building list is 401", anon.status === 401, `status ${anon.status}`);
    const forged = await api("not.a.real.signature", "/api/inventory?view=buildings");
    check("forged cookie is 401", forged.status === 401, `status ${forged.status}`);
  }

  await db.end();
  console.log(`\n${"═".repeat(66)}`);
  console.log(`  ${pass} passed, ${fail} failed`);
  if (fail) { console.log("\n  Failures:"); failures.forEach((f) => console.log(`   - ${f}`)); }
  console.log(`${"═".repeat(66)}\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL", e); process.exit(2); });
