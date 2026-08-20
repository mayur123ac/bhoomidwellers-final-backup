const fs = require('fs');

function fixPatch(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    const regex = /(export async function PATCH[\s\S]*?if \(!gate\.ok\) return gate\.response;)/g;
    
    // Check specifically if PATCH has it
    const patchBlock = content.match(/export async function PATCH[\s\S]*?(export async function|$)/);
    if (patchBlock && patchBlock[0].includes("const orgId = await getOrganizationId();")) {
        console.log('Already fixed PATCH in', filePath);
        return;
    }
    
    if (regex.test(content)) {
        content = content.replace(regex, `$1\n  const orgId = await getOrganizationId();`);
        fs.writeFileSync(filePath, content);
        console.log('Fixed PATCH in', filePath);
    }
}

fixPatch('src/app/api/settings/employees/route.ts');
fixPatch('src/app/api/users/update-whatsapp/route.ts');
