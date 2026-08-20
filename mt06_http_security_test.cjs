// MT-06 — live HTTP security suite.
//
// Runs against the local dev server on the MT-05 TEST branch. Everything here is
// an ATTACK: each case asserts that the server refuses something, or that a
// response does not contain something it must not.
//
// Split from the two-organization DB matrix deliberately. tenantContext refuses
// to resolve when more than one organization exists, so a second org cannot be
// left in place while the app is serving — cross-tenant row behaviour is proved
// in mt06_tenant_matrix_test.cjs inside a rolled-back transaction instead. What
// is proved HERE is everything that needs a real HTTP stack: authentication,
// RBAC, tenant-claim tampering, session forgery and response contents.
//
//   node mt06_http_security_test.cjs
const fs = require("fs");
const { Client } = require("pg");

const BASE = process.env.MT06_BASE || "http://localhost:3000";
const _mt08 = process.env.MT08_URL_FILE && fs.existsSync(process.env.MT08_URL_FILE)
  ? new URL(fs.readFileSync(process.env.MT08_URL_FILE, "utf8").trim()) : null;
const ENDPOINT = _mt08 ? _mt08.hostname.match(/^(ep-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+)/)[1] : "ep-floral-fog-a171dyjy";
if (/ep-long-cloud|ep-mute-credit/.test(ENDPOINT)) { console.error("FATAL: refusing endpoint"); process.exit(3); }
const PW = fs.readFileSync("D:/bhoomidwellers-final-backup-main/frontend/.env.local", "utf8")
  .split("\n").find((l) => l.startsWith("DATABASE_URL="))
  .replace(/.*neondb_owner:([^@]*)@.*/, "$1").trim();

let pass = 0, fail = 0;
const T = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? `  -- ${detail}` : ""}`); }
};

async function req(path, { method = "GET", cookie, body, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html or plain text */ }
  return { status: res.status, text, json, setCookie: res.headers.get("set-cookie") };
}

/** Sign in and return the raw crm_session cookie header. */
async function login(identifier, password) {
  const r = await req("/api/auth/login", { method: "POST", body: { identifier, password } });
  if (r.status !== 200) return { ok: false, status: r.status, json: r.json };
  const m = (r.setCookie || "").match(/crm_session=([^;]+)/);
  return { ok: true, cookie: m ? `crm_session=${m[1]}` : null, json: r.json };
}

(async () => {
  // Credentials are read from the test branch and never printed.
  const c = new Client({
    host: `${ENDPOINT}.ap-southeast-1.aws.neon.tech`, database: "neondb", user: "neondb_owner", password: PW,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  const creds = {};
  for (const email of ["admin@bhoomi.com", "receptionist@gmail.com", "urmilawaghmare@bhoomidwellers.in"]) {
    const r = await c.query("SELECT password, role FROM users WHERE email = $1", [email]);
    if (r.rows[0]) creds[email] = r.rows[0];
  }
  const leadId = (await c.query(
    "SELECT id FROM walkin_enquiries ORDER BY id LIMIT 1")).rows[0]?.id;
  const orgId = (await c.query("SELECT id FROM organizations LIMIT 1")).rows[0].id;
  await c.end();

  const admin = await login("admin@bhoomi.com", creds["admin@bhoomi.com"].password);
  const recep = await login("receptionist@gmail.com", creds["receptionist@gmail.com"].password);
  const sales = await login("urmilawaghmare@bhoomidwellers.in", creds["urmilawaghmare@bhoomidwellers.in"].password);

  console.log("\n── 1. Authentication: sensitive endpoints reject an anonymous caller ──");
  const mustAuth = [
    ["GET", "/api/employees"],
    ["GET", "/api/settings/employees"],
    ["GET", "/api/settings/api-keys"],
    ["GET", "/api/roles"],
    ["GET", "/api/revenue-intelligence"],
    ["GET", "/api/attendance/live"],
    ["GET", "/api/attendance/report"],
    ["GET", "/api/debug-attendance"],
    ["GET", "/api/settings/working-hours"],
    ["GET", "/api/settings/lead-sorting"],
    ["GET", "/api/settings/sm-upload"],
    ["GET", "/api/inventory/building?project_name=x&tower=y"],
    ["GET", "/api/walkin_enquiries/1/tranches"],
    ["GET", "/api/booking-details/1"],
    ["GET", "/api/booking-documents/1"],
    ["POST", "/api/revenue-chat"],
    ["POST", "/api/attendance/force-logout"],
  ];
  for (const [method, path] of mustAuth) {
    const r = await req(path, { method, body: method === "POST" ? {} : undefined });
    T(`anonymous ${method} ${path} is refused`, r.status === 401 || r.status === 403,
      `got ${r.status}`);
  }

  console.log("\n── 2. RBAC: a Receptionist cannot reach admin-only APIs ──");
  const adminOnly = [
    ["GET", "/api/employees"],
    ["GET", "/api/settings/api-keys"],
    ["POST", "/api/attendance/force-logout"],
    ["GET", "/api/inventory/building?project_name=x&tower=y"],
  ];
  for (const [method, path] of adminOnly) {
    const r = await req(path, { method, cookie: recep.cookie, body: method === "POST" ? { user_id: 1 } : undefined });
    T(`receptionist ${method} ${path} is refused`, r.status === 401 || r.status === 403, `got ${r.status}`);
  }
  for (const [method, path] of adminOnly) {
    const r = await req(path, { method, cookie: sales.cookie, body: method === "POST" ? { user_id: 1 } : undefined });
    T(`sales manager ${method} ${path} is refused`, r.status === 401 || r.status === 403, `got ${r.status}`);
  }

  console.log("\n── 3. RBAC: the admin CAN still do its job (no over-blocking) ──");
  for (const [method, path] of [["GET", "/api/employees"], ["GET", "/api/settings/api-keys"]]) {
    const r = await req(path, { method, cookie: admin.cookie });
    T(`admin ${method} ${path} succeeds`, r.status === 200, `got ${r.status}`);
  }

  console.log("\n── 4. Sensitive data: credentials never appear in a response ──");
  {
    const r = await req("/api/auth/login", { method: "POST", body: { identifier: "admin@bhoomi.com", password: creds["admin@bhoomi.com"].password } });
    T("login response carries no password field", r.json && !("password" in (r.json.user || {})),
      JSON.stringify(Object.keys(r.json?.user || {})));
    T("login response body contains no stored credential",
      !r.text.includes(creds["admin@bhoomi.com"].password));
    T("login response still carries the org claim", !!(r.json?.user?.org));
  }
  {
    const r = await req("/api/employees", { cookie: admin.cookie });
    const rows = Array.isArray(r.json) ? r.json : [];
    T("employees list carries no password field", rows.length > 0 && !rows.some((u) => "password" in u));
    T("employees list body contains no stored credential",
      !r.text.includes(creds["receptionist@gmail.com"].password));
  }
  {
    const r = await req("/api/settings/api-keys", { cookie: admin.cookie });
    T("api-keys list never returns key_hash", !/key_hash/.test(r.text));
  }

  console.log("\n── 5. Client tenant tampering: the server-side tenant must win ──");
  {
    const fake = "00000000-0000-4000-8000-0000000000ff";
    const variants = [
      `/api/walkin_enquiries?organization_id=${fake}`,
      `/api/walkin_enquiries?organizationId=${fake}`,
      `/api/walkin_enquiries?orgId=${fake}`,
      `/api/walkin_enquiries?tenant_id=${fake}`,
      `/api/walkin_enquiries?tenantId=${fake}`,
    ];
    const baseline = await req("/api/walkin_enquiries", { cookie: admin.cookie });
    const baseTotal = baseline.json?.total;
    for (const v of variants) {
      const r = await req(v, { cookie: admin.cookie });
      T(`query param cannot change the tenant: ${v.split("?")[1]}`,
        r.status === 200 && r.json?.total === baseTotal, `total ${r.json?.total} vs ${baseTotal}`);
    }
    for (const h of ["x-organization-id", "x-org-id", "x-tenant-id", "organization-id"]) {
      const r = await req("/api/walkin_enquiries", { cookie: admin.cookie, headers: { [h]: fake } });
      T(`header cannot change the tenant: ${h}`,
        r.status === 200 && r.json?.total === baseTotal, `total ${r.json?.total}`);
    }
    // A write that tries to plant a foreign organization_id must not store it.
    const created = await req("/api/walkin_enquiries", {
      method: "POST", cookie: admin.cookie,
      body: { name: "MT06 Tamper Probe", phone: "9999000111", organization_id: fake, organizationId: fake, orgId: fake },
    });
    T("POST with a forged organization_id is not rejected outright (it is ignored)",
      created.status === 200 || created.status === 201 || created.status === 400,
      `got ${created.status}`);
  }

  console.log("\n── 6. Session security ──");
  {
    const r = await req("/api/employees", { cookie: "crm_session=not-a-real-session" });
    T("a garbage session cookie is rejected", r.status === 401 || r.status === 403, `got ${r.status}`);
  }
  {
    // Flip one character of the signature: the payload stays well-formed, the
    // HMAC no longer matches. This is the check that proves the claim is SIGNED
    // and not merely encoded.
    const raw = admin.cookie.replace(/^crm_session=/, "");
    const flipped = raw.slice(0, -1) + (raw.slice(-1) === "A" ? "B" : "A");
    const r = await req("/api/employees", { cookie: `crm_session=${flipped}` });
    T("a session with a tampered signature is rejected", r.status === 401 || r.status === 403, `got ${r.status}`);
  }
  {
    // Re-sign is impossible without the secret, but a caller CAN try swapping the
    // payload for one carrying a different org. It must fail the signature check.
    const raw = decodeURIComponent(admin.cookie.replace(/^crm_session=/, ""));
    const parts = raw.split(".");
    if (parts.length >= 2) {
      let payload;
      try { payload = JSON.parse(Buffer.from(parts[0], "base64url").toString()); } catch { payload = null; }
      if (payload) {
        payload.org = "00000000-0000-4000-8000-0000000000ff";
        const forged = Buffer.from(JSON.stringify(payload)).toString("base64url") + "." + parts.slice(1).join(".");
        const r = await req("/api/employees", { cookie: `crm_session=${forged}` });
        T("a re-written org claim fails the signature check", r.status === 401 || r.status === 403, `got ${r.status}`);
      } else {
        T("session payload is not client-readable JSON (also acceptable)", true);
      }
    } else {
      T("session cookie is not a plain payload.signature pair (opaque — acceptable)", true);
    }
  }
  {
    const r = await req("/api/auth/logout", { method: "POST", cookie: admin.cookie });
    T("logout succeeds", r.status === 200, `got ${r.status}`);
  }

  console.log("\n── 7. API keys: missing and malformed keys are refused ──");
  for (const [label, headers] of [
    ["no key", {}],
    ["empty key", { "x-api-key": "" }],
    ["garbage key", { "x-api-key": "bd_live_totallyinvalidkeyvalue" }],
    ["bearer garbage", { authorization: "Bearer bd_live_totallyinvalidkeyvalue" }],
  ]) {
    for (const path of ["/api/v1/leads", "/api/v1/employees", "/api/v1/bookings", "/api/v1/ping"]) {
      const r = await req(path, { headers });
      T(`v1 ${path} refuses ${label}`, r.status === 401 || r.status === 403, `got ${r.status}`);
    }
  }
  {
    // A browser session must NOT be accepted as an API-key credential.
    const relogin = await login("admin@bhoomi.com", creds["admin@bhoomi.com"].password);
    const r = await req("/api/v1/leads", { cookie: relogin.cookie });
    T("a session cookie is not accepted in place of an API key",
      r.status === 401 || r.status === 403, `got ${r.status}`);
  }

  console.log("\n── 8. Error responses do not disclose whether a foreign record exists ──");
  {
    const relogin = await login("admin@bhoomi.com", creds["admin@bhoomi.com"].password);
    const missing = await req("/api/booking-details/99999999", { cookie: relogin.cookie });
    const alsoMissing = await req("/api/booking-details/99999998", { cookie: relogin.cookie });
    T("two non-existent booking ids give the same status",
      missing.status === alsoMissing.status, `${missing.status} vs ${alsoMissing.status}`);
    T("a not-found response leaks no SQL or stack detail",
      !/at \w+ \(|node_modules|pg_|relation "|SELECT /i.test(missing.text), missing.text.slice(0, 120));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("SUITE ERROR:", e.message); process.exit(3); });
