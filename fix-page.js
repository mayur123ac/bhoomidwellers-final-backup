const fs = require('fs');
let content = fs.readFileSync('src/app/dashboard/page.tsx', 'utf8');

content = content.replace(
  /<ClosedLeadBookingView\s+booking=\{bookingData\}\s+lead=\{selectedLead\}\s+isDark=\{isDark\}\s+userRole=\{([^}]+)\}\s+\/>/g,
  '<ClosedLeadBookingView\n                    booking={bookingData}\n                    lead={selectedLead}\n                    isDark={isDark}\n                    userRole={$1}\n                    currentUser={typeof adminUser !== "undefined" ? adminUser : (typeof user !== "undefined" ? user : null)}\n                    onRefetch={fetchBookingForLead}\n                    />'
);

fs.writeFileSync('src/app/dashboard/page.tsx', content, 'utf8');
console.log("Updated page.tsx");
