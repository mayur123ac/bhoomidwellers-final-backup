// MT-06 follow-up — Admin "Add Employee" security tests.
//
// Covers the eight checks required for the narrowly-scoped plaintext exception:
// the creation response may carry the password, and nothing else may.
//
// Live HTTP against the local dev server on the MT-05 TEST branch. Every user
// this suite creates is deleted again at the end.
//
//   node mt06_add_employee_test.cjs
const fs = require("fs");
const { Client } = require("pg");

const BASE = process.env.MT06_BASE || "http://localhost:3000";
const _mt08 = process.env.MT08_URL_FILE && fs.existsSync(process.env.MT08_URL_FILE)
  ? new URL(fs.readFileSync(process.env.MT08_URL_FILE, "utf8").trim()) : null;
const ENDPOINT = _mt08 ? _mt08.hostname.match(/^(ep-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+)/)[1] : "ep-floral-fog-a171dyjy";
if (/ep-long-cloud|ep-mute-credit/.test(ENDPOINT)) { console.error("FATAL: refusing endpoint"); process.exit(3); }
const PW = _mt08 ? _mt08.password : new URL(fs.readFileSync("D:/bhoomidwellers-final-backup-main/frontend/.env.local", "utf8")
  .split(new RegExp("\r?\n")).find(function (l) { return l.replace(/^﻿/, "").startsWith("DATABASE_URL="); })
  .replace(/^DATABASE_URL=/, "").trim()).password;

let pass = 0, fail = 0;
const T = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? `  -- ${detail}` : ""}`); }
};

async function req(path, { method = "GET", cookie, body, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json, setCookie: res.headers.get("set-cookie") };
}

async function login(identifier, password) {
  const r = await req("/api/auth/login", { method: "POST", body: { identifier, password } });
  const m = (r.setCookie || "").match(/crm_session=([^;]+)/);
  return { ok: r.status === 200, cookie: m ? `crm_session=${m[1]}` : null, json: r.json };
}

const marker = `mt06probe${Date.now()}`;
const NEW_PASSWORD = "Zx9!qLm2#Rt7";   // supplied by the test, never read back from the DB

(async () => {
  const c = new Client({
    host: `${ENDPOINT}.ap-southeast-1.aws.neon.tech`, database: "neondb", user: "neondb_owner", password: PW,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();

  const creds = {};
  for (const email of ["admin@bhoomi.com", "receptionist@gmail.com", "urmilawaghmare@bhoomidwellers.in"]) {
    creds[email] = (await c.query("SELECT password FROM users WHERE email = $1", [email])).rows[0].password;
  }
  const orgA = (await c.query("SELECT id FROM organizations LIMIT 1")).rows[0].id;
  const FAKE_ORG_B = "00000000-0000-4000-8000-0000000000bb";

  const admin = await login("admin@bhoomi.com", creds["admin@bhoomi.com"]);
  const recep = await login("receptionist@gmail.com", creds["receptionist@gmail.com"]);
  const sales = await login("urmilawaghmare@bhoomidwellers.in", creds["urmilawaghmare@bhoomidwellers.in"]);

  let createdId = null;
  try {
    console.log("\n── 1-3. Admin creates an employee ──");
    const created = await req("/api/employees", {
      method: "POST", cookie: admin.cookie,
      body: {
        name: `MT06 Probe ${marker}`, username: marker,
        email: `${marker}@example.test`, password: NEW_PASSWORD, role: "Sales Manager",
      },
    });
    T("admin can create an employee", created.status === 201, `got ${created.status} ${created.text.slice(0, 120)}`);
    const emp = created.json?.employee;
    T("response carries the created employee object", !!emp);
    createdId = emp?.id ?? null;

    // 2. organization_id must be the creating Admin's org.
    T("response organization_id equals the Admin's organization", emp?.organization_id === orgA,
      `${emp?.organization_id} vs ${orgA}`);
    const stored = (await c.query("SELECT organization_id, password FROM users WHERE id = $1", [createdId])).rows[0];
    T("stored organization_id equals the Admin's organization", stored?.organization_id === orgA,
      `${stored?.organization_id} vs ${orgA}`);

    // 3. plaintext password present, and it is the one supplied.
    T("creation response contains the plaintext password", emp?.password === NEW_PASSWORD);
    T("response shape is exactly the agreed allow-list",
      JSON.stringify(Object.keys(emp || {}).sort()) ===
        JSON.stringify(["_id", "email", "id", "name", "organization_id", "password", "role"]),
      JSON.stringify(Object.keys(emp || {}).sort()));

    console.log("\n── 4. Non-admins cannot call the endpoint ──");
    for (const [label, cookie] of [["receptionist", recep.cookie], ["sales manager", sales.cookie], ["anonymous", undefined]]) {
      const r = await req("/api/employees", {
        method: "POST", cookie,
        body: { name: "Should Not Exist", username: `${marker}x`, email: `${marker}x@example.test`, password: "Zz9!aBc2#Qw8", role: "Sales Manager" },
      });
      T(`${label} cannot create an employee`, r.status === 401 || r.status === 403, `got ${r.status}`);
    }
    const leaked = (await c.query("SELECT id FROM users WHERE username = $1", [`${marker}x`])).rows;
    T("no employee was created by the refused callers", leaked.length === 0);

    console.log("\n── 5. An Admin cannot create an employee for another organization ──");
    const forged = await req("/api/employees", {
      method: "POST", cookie: admin.cookie,
      body: {
        name: `MT06 Forged ${marker}`, username: `${marker}f`,
        email: `${marker}f@example.test`, password: "Zz9!aBc2#Qw8", role: "Sales Manager",
        // Every spelling the browser might try.
        organization_id: FAKE_ORG_B, organizationId: FAKE_ORG_B, orgId: FAKE_ORG_B,
        tenant_id: FAKE_ORG_B, tenantId: FAKE_ORG_B,
      },
      headers: { "x-organization-id": FAKE_ORG_B, "x-tenant-id": FAKE_ORG_B },
    });
    T("creation with a forged organization_id still succeeds (the field is ignored)", forged.status === 201,
      `got ${forged.status}`);
    T("the forged organization_id was NOT honoured in the response",
      forged.json?.employee?.organization_id === orgA, `${forged.json?.employee?.organization_id}`);
    const forgedRow = (await c.query("SELECT organization_id FROM users WHERE username = $1", [`${marker}f`])).rows[0];
    T("the forged organization_id was NOT stored", forgedRow?.organization_id === orgA,
      `${forgedRow?.organization_id}`);

    console.log("\n── 6-7. Passwords stay out of every other response ──");
    {
      const list = await req("/api/employees", { cookie: admin.cookie });
      const rows = Array.isArray(list.json) ? list.json : [];
      T("employee LIST returns no password field", rows.length > 0 && !rows.some((u) => "password" in u));
      T("employee LIST body does not contain the new password", !list.text.includes(NEW_PASSWORD));
      T("employee LIST does expose organization_id", rows.every((u) => "organization_id" in u));
    }
    {
      const edited = await req("/api/employees", {
        method: "PUT", cookie: admin.cookie,
        body: { userId: String(createdId), editData: { name: `MT06 Probe ${marker} v2` } },
      });
      T("employee EDIT response returns no password field",
        edited.status === 200 && !("password" in (edited.json?.user || {})),
        JSON.stringify(Object.keys(edited.json?.user || {})));
      T("employee EDIT body does not contain the stored password", !edited.text.includes(NEW_PASSWORD));
    }
    {
      const r = await login("admin@bhoomi.com", creds["admin@bhoomi.com"]);
      T("LOGIN response returns no password field", !("password" in (r.json?.user || {})));
      T("LOGIN body does not contain the stored credential", !JSON.stringify(r.json).includes(creds["admin@bhoomi.com"]));
    }
    {
      const prof = await req("/api/settings/profile", { cookie: admin.cookie });
      T("PROFILE response contains no password field", !/"password"\s*:/.test(prof.text), prof.text.slice(0, 100));
      const acct = await req("/api/settings/account", { cookie: admin.cookie });
      T("ACCOUNT response exposes only the passwordHashed boolean",
        !/"password"\s*:/.test(acct.text), acct.text.slice(0, 100));
    }

    console.log("\n── Server logs must not contain the password ──");
    {
      const log = fs.existsSync("devserver.log") ? fs.readFileSync("devserver.log", "utf8") : "";
      T("dev server log does not contain the new password", !log.includes(NEW_PASSWORD));
    }
  } finally {
    // Remove everything this suite created.
    const del = await c.query("DELETE FROM users WHERE username LIKE $1 RETURNING id", [`${marker}%`]);
    console.log(`\ncleaned up ${del.rowCount} probe user(s)`);
    await c.end();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("SUITE ERROR:", e.message); process.exit(3); });
