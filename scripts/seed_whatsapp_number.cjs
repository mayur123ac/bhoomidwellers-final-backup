// scripts/seed_whatsapp_number.cjs — map the configured WhatsApp business number
// to an organization.
//
// The webhook cannot attribute an inbound message without this row. See the
// header of whatsapp_conversations_2026-08-24.sql for why the mapping exists at
// all rather than being derived.
//
//   node scripts/seed_whatsapp_number.cjs <organization-slug> [--display +91…]
//
// Reads WHATSAPP_PHONE_NUMBER_ID from .env.local. Idempotent: re-running with the
// same slug updates the label and display number; re-running with a DIFFERENT
// slug is refused, because silently repointing a live number at another tenant
// would hand one company's conversations to another.

const fs = require("fs");
const path = require("path");
const dns = require("dns");
const { Client } = require("pg");

const ENV_PATH = path.join(__dirname, "..", ".env.local");

function readEnv(name) {
  // Real process env wins, exactly as Next.js resolves it.
  if (process.env[name]) return process.env[name].trim();
  const raw = fs.readFileSync(ENV_PATH, "utf8");
  const m = new RegExp(`^\\s*${name}\\s*=\\s*(.+)$`, "m").exec(raw);
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
}

const slug = process.argv[2];
if (!slug || slug.startsWith("--")) {
  console.error("usage: node scripts/seed_whatsapp_number.cjs <organization-slug> [--display +91…]");
  process.exit(1);
}
const displayIdx = process.argv.indexOf("--display");
const display = displayIdx > -1 ? process.argv[displayIdx + 1] : null;

const phoneNumberId = readEnv("WHATSAPP_PHONE_NUMBER_ID");
if (!phoneNumberId) {
  console.error("WHATSAPP_PHONE_NUMBER_ID is not set in .env.local.");
  process.exit(2);
}
const url = readEnv("DATABASE_URL");
if (!url) { console.error("DATABASE_URL is not set."); process.exit(2); }

const resolver = new dns.Resolver();
resolver.setServers(["8.8.8.8", "1.1.1.1"]);
function lookup(h, o, cb) {
  if (typeof o === "function") { cb = o; o = {}; }
  dns.lookup(h, o, (e, a, f) =>
    e
      ? resolver.resolve4(h, (e2, ad) =>
          e2 || !ad || !ad.length
            ? cb(e)
            : o && o.all
              ? cb(null, ad.map((x) => ({ address: x, family: 4 })))
              : cb(null, ad[0], 4))
      : cb(null, a, f));
}

(async () => {
  const c = new Client({ connectionString: url, lookup });
  await c.connect();
  try {
    const org = await c.query(`SELECT id, name FROM public.organizations WHERE slug = $1`, [slug]);
    if (org.rows.length === 0) {
      const all = await c.query(`SELECT slug FROM public.organizations ORDER BY created_at`);
      console.error(`No organization with slug "${slug}". Known: ${all.rows.map((r) => r.slug).join(", ")}`);
      process.exit(3);
    }
    const { id: orgId, name: orgName } = org.rows[0];

    const existing = await c.query(
      `SELECT b.organization_id, o.slug
         FROM public.whatsapp_business_numbers b
         JOIN public.organizations o ON o.id = b.organization_id
        WHERE b.phone_number_id = $1`,
      [phoneNumberId]
    );

    if (existing.rows.length > 0 && existing.rows[0].organization_id !== orgId) {
      console.error(
        `REFUSING: phone_number_id ${phoneNumberId} is already mapped to "${existing.rows[0].slug}".\n` +
          `Repointing it would route that tenant's live conversations to "${slug}".\n` +
          `Delete the row deliberately if that is genuinely intended.`
      );
      process.exit(4);
    }

    await c.query(
      `INSERT INTO public.whatsapp_business_numbers
         (phone_number_id, organization_id, display_phone_number, label)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (phone_number_id) DO UPDATE
         SET display_phone_number = COALESCE(EXCLUDED.display_phone_number,
                                             whatsapp_business_numbers.display_phone_number),
             label      = EXCLUDED.label,
             updated_at = now()`,
      [phoneNumberId, orgId, display, `Seeded ${new Date().toISOString().slice(0, 10)}`]
    );

    console.log(`Mapped phone_number_id ${phoneNumberId} → ${orgName} (${slug}).`);
  } finally {
    await c.end();
  }
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
