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
       FROM organizations o ORDER BY o.created_at LIMIT 2`
  );
  
  const A = orgs.rows[0];
  const cookieA = sign({ _id: String(A.admin.id), name: A.admin.name, email: A.admin.email, role: A.admin.role, isActive: true, org: A.id });

  // Find a project to test DELETE on
  const proj = await db.query(`
    SELECT id, name FROM inventory_projects WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY id LIMIT 1
  `, [A.id]);

  if (proj.rows.length === 0) {
    console.log("No projects found to test.");
    process.exit(0);
  }

  const pId = proj.rows[0].id;
  console.log(`Testing DELETE on project: ${proj.rows[0].name} (ID: ${pId})`);

  const res = await fetch(`http://localhost:3000/api/inventory/projects/${pId}`, {
    method: 'DELETE',
    headers: { cookie: `crm_session=${cookieA}` }
  });

  const body = await res.json();
  console.log('Status:', res.status);
  console.log('Response:', JSON.stringify(body, null, 2));

  await db.end();
}

run();
