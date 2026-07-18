const fs = require('fs');
let content = fs.readFileSync('src/app/dashboard/page.tsx', 'utf8');

content = content.replace(
  /onRefetch=\{fetchBookingForLead\}/g,
  'onRefetch={() => { if (selectedLead) fetchBookingForLead(selectedLead.id); }}'
);

fs.writeFileSync('src/app/dashboard/page.tsx', content, 'utf8');
console.log("Fixed page.tsx onRefetch prop");
