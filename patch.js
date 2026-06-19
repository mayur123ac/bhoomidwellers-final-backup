const fs = require('fs');
let c = fs.readFileSync('src/app/dashboard/page.tsx', 'utf8');

c = c.replace(
  /const prefillSalesForm = \(\) => \{\n\s*if \(!selectedLead\) return;\n\s*const sf = currentLeadFollowUps\.filter\(\(f: any\) => f\.message\?\.includes\("Detailed Salesform Submitted"\)\);\n\s*if \(sf\.length === 0\) return;\n\s*const msg = sf\[sf\.length - 1\]\.message;/g,
  `const prefillSalesForm = (targetLead?: any) => {\n    const l = targetLead || selectedLead;\n    if (!l) return;\n    const fups = followUps.filter((f: any) => String(f.leadId) === String(l.id));\n    const sf = fups.filter((f: any) => f.message?.includes("Detailed Salesform Submitted"));\n    if (sf.length === 0) return;\n    const msg = sf[sf.length - 1].message;`
);

c = c.replace(
  /const prefillSalesForm = \(\) => \{\n\s*const sf = currentFollowUps\.filter\(\(f: any\) => f\.message\?\.includes\("Detailed Salesform Submitted"\)\);\n\s*if \(sf\.length === 0\) return;\n\s*const msg = sf\[sf\.length - 1\]\.message;/g,
  `const prefillSalesForm = (targetLead?: any) => {\n    const l = targetLead || selectedLead;\n    if (!l) return;\n    const fups = followUps.filter((f: any) => String(f.leadId) === String(l.id));\n    const sf = fups.filter((f: any) => f.message?.includes("Detailed Salesform Submitted"));\n    if (sf.length === 0) return;\n    const msg = sf[sf.length - 1].message;`
);

fs.writeFileSync('src/app/dashboard/page.tsx', c);
