const fs = require('fs');
const path = require('path');

const filesToFix = [
  "src/app/api/roles/route.ts",
  "src/app/api/settings/account/route.ts",
  "src/app/api/settings/activity-logs/route.ts",
  "src/app/api/settings/deactivate/route.ts",
  "src/app/api/settings/email-change/route.ts",
  "src/app/api/settings/email-verify/route.ts",
  "src/app/api/settings/employees/route.ts",
  "src/app/api/settings/feature-prefs/route.ts",
  "src/app/api/settings/password/route.ts",
  "src/app/api/settings/profile/route.ts",
  "src/app/api/settings/whatsapp-integration/route.ts",
  "src/app/api/settings/workspace/route.ts",
  "src/app/api/users/site-head/route.ts",
  "src/app/api/users/update-whatsapp/route.ts"
];

function addImport(content, importStatement) {
    if (content.includes(importStatement)) return content;
    const importRegex = /^import .+?;/m;
    const match = importRegex.exec(content);
    if (match) {
        return content.replace(importRegex, `${importStatement}\n${match[0]}`);
    }
    return `${importStatement}\n${content}`;
}

function injectOrgIdFetch(content) {
    if (content.includes("const orgId = await getOrganizationId")) return content;
    
    // Inject at the beginning of the POST/GET/PUT function right after gate check
    let newContent = content;
    const handlers = ['export async function GET', 'export async function POST', 'export async function PUT', 'export async function DELETE'];
    
    handlers.forEach(h => {
        const regex = new RegExp(`(${h}[\\s\\S]*?if \\(!gate\\.ok\\) return gate\\.response;)`, 'g');
        if (regex.test(newContent)) {
             newContent = newContent.replace(regex, `$1\n  const orgId = await getOrganizationId();`);
        } else {
            // fallback: find the function start
            const regex2 = new RegExp(`(${h}[^{]*{)`, 'g');
            newContent = newContent.replace(regex2, `$1\n  const orgId = await getOrganizationId();`);
        }
    });
    return newContent;
}

for (const relPath of filesToFix) {
    const filePath = path.join(__dirname, relPath);
    if (!fs.existsSync(filePath)) {
        console.warn(`File not found: ${filePath}`);
        continue;
    }
    
    let content = fs.readFileSync(filePath, 'utf8');
    
    // add import
    content = addImport(content, `import { getOrganizationId } from "@/lib/tenantContext";`);
    
    // add fetch
    content = injectOrgIdFetch(content);
    
    // Specific Replacements
    // Roles
    if (relPath.includes('roles/route.ts')) {
        content = content.replace(/SELECT id, name FROM roles ORDER BY name ASC/g, `SELECT id, name FROM roles WHERE organization_id = $1 ORDER BY name ASC`);
        content = content.replace(/await query\(\s*`SELECT id, name FROM roles WHERE organization_id = \$1 ORDER BY name ASC`\s*\)/g, 
                                  `await query(\`SELECT id, name FROM roles WHERE organization_id = $1 ORDER BY name ASC\`, [orgId])`);
        
        content = content.replace(/SELECT id FROM roles WHERE LOWER\(name\) = LOWER\(\$1\) LIMIT 1/g, 
                                  `SELECT id FROM roles WHERE LOWER(name) = LOWER($1) AND organization_id = $2 LIMIT 1`);
        content = content.replace(/\[role_name\]/g, `[role_name, orgId]`);
        
        content = content.replace(/await query\(\s*`SELECT \* FROM roles`\s*\)/g, `await query(\`SELECT * FROM roles WHERE organization_id = $1\`, [orgId])`);
    }
    
    // Settings account
    if (relPath.includes('settings/account/route.ts')) {
        content = content.replace(/WHERE id = \$1`/g, `WHERE id = $1 AND organization_id = $2\``);
        content = content.replace(/\[gate\.userId\]/g, `[gate.userId, orgId]`);
    }
    
    // Activity logs
    if (relPath.includes('settings/activity-logs/route.ts')) {
        content = content.replace(/WHERE deleted_at IS NULL ORDER BY name/g, `WHERE deleted_at IS NULL AND organization_id = $1 ORDER BY name`);
        content = content.replace(/await query<{ id: number; name: string }>\([\s\S]*?`SELECT id, name FROM users WHERE deleted_at IS NULL AND organization_id = \$1 ORDER BY name`\s*\);/m, 
                                  `await query<{ id: number; name: string }>(\`SELECT id, name FROM users WHERE deleted_at IS NULL AND organization_id = $1 ORDER BY name\`, [orgId]);`);
    }

    // Deactivate
    if (relPath.includes('settings/deactivate/route.ts')) {
        content = content.replace(/WHERE id = \$1 LIMIT 1/g, `WHERE id = $1 AND organization_id = $2 LIMIT 1`);
        content = content.replace(/\[gate\.userId\]/g, `[gate.userId, orgId]`);
        
        content = content.replace(/id <> \$1`/g, `id <> $1 AND organization_id = $2\``);
        // Note: multiple [gate.userId] might have been replaced. That's fine as long as $2 is added.
    }
    
    // Email change
    if (relPath.includes('settings/email-change/route.ts')) {
        content = content.replace(/AND id <> \$2 LIMIT 1/g, `AND id <> $2 AND organization_id = $3 LIMIT 1`);
        content = content.replace(/\[email, gate\.userId\]/g, `[email, gate.userId, orgId]`);
    }
    
    // Email verify
    if (relPath.includes('settings/email-verify/route.ts')) {
        content = content.replace(/AND id <> \$2 LIMIT 1/g, `AND id <> $2 AND organization_id = $3 LIMIT 1`);
        content = content.replace(/\[email, gate\.userId\]/g, `[email, gate.userId, orgId]`);
    }
    
    // Employees
    if (relPath.includes('settings/employees/route.ts')) {
        content = content.replace(/SELECT id, email, name FROM users`/g, `SELECT id, email, name FROM users WHERE organization_id = $1\``);
        content = content.replace(/await query<{ id: number; email: string; name: string }>\([\s\S]*?`SELECT id, email, name FROM users WHERE organization_id = \$1`\s*\);/m,
                                  `await query<{ id: number; email: string; name: string }>(\`SELECT id, email, name FROM users WHERE organization_id = $1\`, [orgId]);`);
        
        content = content.replace(/FROM users`/g, `FROM users WHERE organization_id = $1\``); // Caution here, might hit multiple
        content = content.replace(/FROM users\s+WHERE\s+LOWER\(name\)\s*=\s*LOWER\(\$1\)\s*AND\s*id\s*<>\s*\$2\s*LIMIT\s*1/g, 
                                  `FROM users WHERE LOWER(name) = LOWER($1) AND id <> $2 AND organization_id = $3 LIMIT 1`);
        content = content.replace(/FROM users\s+WHERE\s+LOWER\(email\)\s*=\s*\$1\s*AND\s*id\s*<>\s*\$2\s*LIMIT\s*1/g, 
                                  `FROM users WHERE LOWER(email) = $1 AND id <> $2 AND organization_id = $3 LIMIT 1`);
        content = content.replace(/\[name, id\]/g, `[name, id, orgId]`);
        content = content.replace(/\[email, id\]/g, `[email, id, orgId]`);
        content = content.replace(/\[email\]/g, `[email, orgId]`);
        content = content.replace(/\[username\]/g, `[username, orgId]`);
        content = content.replace(/\[gate.userId\]/g, `[gate.userId, orgId]`);
    }
    
    // Feature prefs
    if (relPath.includes('settings/feature-prefs/route.ts')) {
        content = content.replace(/WHERE id = \$1 LIMIT 1/g, `WHERE id = $1 AND organization_id = $2 LIMIT 1`);
        content = content.replace(/\[gate\.userId\]/g, `[gate.userId, orgId]`);
    }
    
    // Password
    if (relPath.includes('settings/password/route.ts')) {
        content = content.replace(/WHERE id = \$1 LIMIT 1/g, `WHERE id = $1 AND organization_id = $2 LIMIT 1`);
        content = content.replace(/\[gate\.userId\]/g, `[gate.userId, orgId]`);
    }

    // Profile
    if (relPath.includes('settings/profile/route.ts')) {
        content = content.replace(/AND id <> \$2 LIMIT 1/g, `AND id <> $2 AND organization_id = $3 LIMIT 1`);
        content = content.replace(/\[name, gate\.userId\]/g, `[name, gate.userId, orgId]`);
    }

    // Whatsapp Integration
    if (relPath.includes('settings/whatsapp-integration/route.ts')) {
        content = content.replace(/WHERE id = \$1 LIMIT 1/g, `WHERE id = $1 AND organization_id = $2 LIMIT 1`);
        content = content.replace(/\[gate\.userId\]/g, `[gate.userId, orgId]`);
    }
    
    // Workspace
    if (relPath.includes('settings/workspace/route.ts')) {
        content = content.replace(/deleted_at IS NULL AND is_active = true`/g, `deleted_at IS NULL AND is_active = true AND organization_id = $1\``);
    }
    
    // Site head
    if (relPath.includes('users/site-head/route.ts')) {
        content = content.replace(/SELECT \* FROM users`/g, `SELECT * FROM users WHERE organization_id = $1\``);
        content = content.replace(/await query\(`SELECT \* FROM users WHERE organization_id = \$1`\)/g, `await query(\`SELECT * FROM users WHERE organization_id = $1\`, [orgId])`);
    }
    
    // Update whatsapp
    if (relPath.includes('users/update-whatsapp/route.ts')) {
        content = content.replace(/WHERE name = \$1 LIMIT 1/g, `WHERE name = $1 AND organization_id = $2 LIMIT 1`);
        content = content.replace(/\[name\]/g, `[name, orgId]`);
        
        content = content.replace(/WHERE id = \$1 LIMIT 1/g, `WHERE id = $1 AND organization_id = $2 LIMIT 1`);
        content = content.replace(/\[explicitId\]/g, `[explicitId, orgId]`);
    }
    
    fs.writeFileSync(filePath, content);
}
console.log("Done modifying files.");
