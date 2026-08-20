const fs = require('fs');
const path = require('path');

const readPathsFile = path.join(__dirname, 'read_paths.md');
if (!fs.existsSync(readPathsFile)) {
    console.error("read_paths.md not found");
    process.exit(1);
}

const content = fs.readFileSync(readPathsFile, 'utf8');
const lines = content.split('\n');

const batch1Files = [
    'src/app/api/auth/',
    'src/app/api/users/',
    'src/app/api/settings/',
    'src/app/api/roles/',
    'src/lib/serverAuth.ts',
    'src/lib/user.ts',
    'src/lib/tenantContext.ts',
    'src/lib/admin-ai/rbac.ts'
].map(p => p.replace(/\//g, '\\'));

let currentFile = '';
let inBatch1 = false;
let mappings = [];

for (const line of lines) {
    if (line.startsWith('## ')) {
        currentFile = line.substring(3).trim();
        inBatch1 = batch1Files.some(bf => currentFile.includes(bf));
    } else if (inBatch1 && line.startsWith('- Line ')) {
        const query = line.match(/`([^`]+)`/);
        if (query && (query[1].match(/users/i) || query[1].match(/roles/i))) {
             mappings.push({
                 file: currentFile,
                 query: query[1].substring(0, 80).replace(/\r?\n/g, ' '),
             });
        }
    }
}

let md = '# Batch 1: Users, Roles, Authentication Audit Classification\n\n';
md += '| File | Query | Table | Classification | Required Action |\n';
md += '|---|---|---|---|---|\n';

for (const m of mappings) {
    let table = m.query.match(/roles/i) ? 'roles' : 'users';
    let cls = 'TENANT-SCOPED';
    let action = 'Append `organization_id = $orgId`';

    if (m.query.match(/users\s+u\s+WHERE/i)) {
        action = 'Append `u.organization_id = $orgId`';
    }

    if (m.query.match(/organization_id/i)) {
         cls = 'ALREADY SAFE';
         action = 'None';
    }

    if (m.file.includes('auth\\login') || m.file.includes('auth\\signup') || m.file.includes('emailRouting')) {
         cls = 'AUTH/SYSTEM';
         action = 'REVIEW (Likely requires no changes or special handling)';
    }

    md += `| ${m.file} | \`${m.query}\` | ${table} | ${cls} | ${action} |\n`;
}

fs.writeFileSync(path.join(__dirname, 'batch1_audit.md'), md);
console.log(`Generated batch1_audit.md with ${mappings.length} queries.`);
