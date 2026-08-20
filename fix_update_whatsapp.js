const fs = require('fs');

const path = 'src/app/api/users/update-whatsapp/route.ts';
let content = fs.readFileSync(path, 'utf8');

// Fix resolveTarget signature
content = content.replace(/async function resolveTarget\(\s*session:\s*any,\s*body:\s*any\s*\)/, `async function resolveTarget(session: any, body: any, orgId: string)`);

// Fix resolveTarget call
content = content.replace(/await resolveTarget\(session, body\)/, `await resolveTarget(session, body, orgId)`);

// Fix GET arrays
content = content.replace(/\[askedFor\]/g, `[askedFor, orgId]`);
content = content.replace(/\[selfId\]/g, `[selfId, orgId]`);

// Fix query syntax in line 67 where it's missing AND organization_id = $2
content = content.replace(/WHERE name = \$1`, \[name, orgId\]\);/g, `WHERE name = $1 AND organization_id = $2\`, [name, orgId]);`);

fs.writeFileSync(path, content);
console.log('Fixed update-whatsapp');
