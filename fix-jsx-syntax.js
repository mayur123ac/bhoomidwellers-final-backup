const fs = require('fs');
let content = fs.readFileSync('src/components/ClosedLeadBookingView.tsx', 'utf8');

content = content.replace(
  /\{activeTab === "summary" && \(\s*<BookingApplicationView/g,
  '{activeTab === "summary" && (\n          <>\n          <BookingApplicationView'
);

content = content.replace(
  /onSuccess=\{\(\) => \{\s*setIsEditModalOpen\(false\);\s*if \(onRefetch\) onRefetch\(\);\s*\}\}\s*\/>\s*\)\}/,
  'onSuccess={() => {\n                setIsEditModalOpen(false);\n                if (onRefetch) onRefetch();\n              }}\n            />\n          )}\n          </>'
);

fs.writeFileSync('src/components/ClosedLeadBookingView.tsx', content, 'utf8');
console.log("Fixed JSX syntax in ClosedLeadBookingView.tsx");
