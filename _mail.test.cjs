// Transport verification.
//
// mayurac123@gmail.com already belongs to user 59 in this CRM, and it is also
// the only address the shared onboarding@resend.dev sender may deliver to. So
// the transport is exercised directly through lib/mailer.ts, and the app path is
// exercised separately with a non-owner address to prove it reports failure
// honestly rather than silently swallowing it.

const ts = require("typescript");
const fs = require("fs");
const crypto = require("crypto");
const { Pool } = require("pg");

// Load .env.local into process.env so the transpiled mailer sees real config.
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}

const src = fs.readFileSync("src/lib/mailer.ts", "utf8");
const out = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
const M = { exports: {} };
new Function("require", "module", "exports", out)(require, M, M.exports);
const { sendMail, activeTransport, isMailConfigured, isUsingSharedResendSender, verifyMailTransport } = M.exports;

const OWNER = "mayurac123@gmail.com";
const p = new Pool({ connectionString: process.env.DATABASE_URL });
const B = "http://localhost:3000";
const SECRET = process.env.SESSION_SECRET;
const b64 = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sign = (pl) => {
  const n = Math.floor(Date.now() / 1000);
  const e = b64(JSON.stringify({ ...pl, iat: n, exp: n + 3600 }));
  return e + "." + b64(crypto.createHmac("sha256", SECRET).update(e).digest());
};

let pass = 0, fail = 0;
const t = (n, c, d = "") => c ? (pass++, console.log("  PASS  " + n)) : (fail++, console.log("  FAIL  " + n + "  " + d));

(async () => {
  console.log("\n-- configuration --");
  t("transport selected is resend", activeTransport() === "resend", activeTransport());
  t("isMailConfigured true", isMailConfigured() === true);
  t("shared-sender limitation detected", isUsingSharedResendSender() === true);

  const v = await verifyMailTransport();
  t("transport verifies", v.ok === true, JSON.stringify(v));
  t("verify warns about the shared sender", Boolean(v.ok && v.warning), JSON.stringify(v).slice(0, 120));

  console.log("\n-- REAL send to the Resend account owner --");
  const ok = await sendMail({ to: OWNER, subject: "Bhoomi CRM — transport verification", text: "This confirms Bhoomi CRM can deliver email via Resend." });
  t("delivered", ok.delivered === true, JSON.stringify(ok));
  t("reports transport=resend", ok.transport === "resend", ok.transport);

  console.log("\n-- send to a NON-owner address --");
  const bad = await sendMail({ to: "someone@bhoomidwellers.in", subject: "should not arrive", text: "x" });
  t("not delivered", bad.delivered === false, JSON.stringify(bad));
  t("error names the real cause", /onboarding@resend\.dev/.test(bad.error || ""), (bad.error || "").slice(0, 160));
  t("error points at the fix", /resend\.com\/domains/.test(bad.error || ""));

  console.log("\n-- app path reports failure honestly --");
  const uid = (await p.query(
    "INSERT INTO users (name,email,password,role,is_active) VALUES ('Mail Path',$1,'TestPw!2345','admin',true) RETURNING id",
    ["mail.path@bhoomidwellers.in"]
  )).rows[0].id;

  const r = await fetch(B + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/121.0.0.0 Safari/537.36", "x-forwarded-for": "203.0.113.5" },
    body: JSON.stringify({ identifier: "mail.path@bhoomidwellers.in", password: "TestPw!2345" }),
  });
  t("login succeeds regardless of mail outcome", r.status === 200, String(r.status));

  await new Promise((x) => setTimeout(x, 6000));
  const rows = (await p.query("SELECT transport,delivered,error FROM email_delivery_attempts WHERE user_id=$1 ORDER BY id", [uid])).rows;
  t("attempt recorded", rows.length > 0, JSON.stringify(rows));
  t("records transport=resend", rows[0] && rows[0].transport === "resend", JSON.stringify(rows[0]));
  t("records delivered=false", rows[0] && rows[0].delivered === false, JSON.stringify(rows[0]));
  t("stores the explanatory error", rows[0] && /resend\.com\/domains/.test(rows[0].error || ""), (rows[0] && rows[0].error || "").slice(0, 120));

  console.log("\n-- OTP is NOT leaked when a transport exists but delivery fails --");
  const H = { cookie: "crm_session=" + sign({ _id: String(uid), name: "Mail Path", email: "mail.path@bhoomidwellers.in", role: "admin", isActive: true }), "content-type": "application/json" };
  const R = "/api/settings/notification-recipients";
  await fetch(B + R, { method: "PATCH", headers: H, body: JSON.stringify({ alternativeEmail: "nobody@bhoomidwellers.in" }) });
  const s = await fetch(B + R + "/verify", { method: "POST", headers: H }).then((x) => x.json());
  t("send reports not delivered", s.delivered === false, JSON.stringify(s).slice(0, 100));
  t("no devOtp returned — an undeliverable address must not be verifiable", s.devOtp === undefined, String(s.devOtp));

  await p.query("DELETE FROM users WHERE id=$1", [uid]);
  console.log("\n" + pass + " passed, " + fail + " failed");
  await p.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("ERR", e.message, e.stack); process.exit(1); });
