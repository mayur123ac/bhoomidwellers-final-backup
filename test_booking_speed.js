const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

const env = {};
const envPath = path.join(process.cwd(), '.env.local');
for (const raw of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const l = raw.replace(/^﻿/, '').trim();
  if (!l || l.startsWith('#')) continue;
  const i = l.indexOf('=');
  if (i > 0) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}

const b64 = (x) => Buffer.from(x).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sign = (p) => {
  const n = Math.floor(Date.now() / 1000);
  const e = b64(JSON.stringify({ ...p, iat: n, exp: n + 3600 }));
  return `${e}.${b64(crypto.createHmac('sha256', env.SESSION_SECRET).update(e).digest())}`;
};

async function run() {
  const u = new URL(env.DATABASE_URL);
  const db = new Client({
    host: u.hostname, database: u.pathname.replace(/^\//, '').split('?')[0],
    user: u.username, password: u.password, ssl: { rejectUnauthorized: false },
  });
  await db.connect();

  const orgs = await db.query(
    `SELECT o.id, o.name,
            (SELECT json_build_object('id', usr.id, 'name', usr.name, 'email', usr.email, 'role', usr.role)
               FROM users usr WHERE usr.organization_id = o.id AND usr.is_active = true
                AND LOWER(REPLACE(usr.role, '_', ' ')) = 'admin' ORDER BY usr.id LIMIT 1) AS admin
       FROM organizations o ORDER BY o.created_at LIMIT 1`
  );
  
  if (orgs.rows.length === 0 || !orgs.rows[0].admin) {
    console.error('No admin found');
    process.exit(1);
  }

  const o = orgs.rows[0];
  const cookie = sign({ _id: String(o.admin.id), name: o.admin.name, email: o.admin.email, role: o.admin.role, isActive: true, org: o.id });

  console.log('Testing GET /api/booking-applications?view=summary');
  const startSummary = Date.now();
  const resSummary = await fetch('http://localhost:3000/api/booking-applications?view=summary', {
    headers: { cookie: `crm_session=${cookie}` }
  });
  const textSummary = await resSummary.text();
  const timeSummary = Date.now() - startSummary;
  console.log(`Summary View: ${timeSummary}ms, Payload size: ${Buffer.byteLength(textSummary)} bytes`);
  
  console.log('Testing GET /api/booking-applications');
  const startFull = Date.now();
  const resFull = await fetch('http://localhost:3000/api/booking-applications', {
    headers: { cookie: `crm_session=${cookie}` }
  });
  const textFull = await resFull.text();
  const timeFull = Date.now() - startFull;
  console.log(`Full View: ${timeFull}ms, Payload size: ${Buffer.byteLength(textFull)} bytes`);

  await db.end();
}

run();
