const fs = require('fs');
let content = fs.readFileSync('src/app/dashboard/page.tsx', 'utf8');

content = content.replace(
  /currentUser=\{typeof adminUser !== "undefined" \? adminUser : \(typeof user !== "undefined" \? user : null\)\}/g,
  'currentUser={adminUser}'
);

fs.writeFileSync('src/app/dashboard/page.tsx', content, 'utf8');
console.log("Fixed page.tsx currentUser prop");
