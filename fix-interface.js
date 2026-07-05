const fs = require('fs');
let content = fs.readFileSync('src/components/ClosedLeadBookingView.tsx', 'utf8');

content = content.replace(
  /interface ClosedLeadBookingViewProps \{/,
  'interface ClosedLeadBookingViewProps {\n  currentUser?: any;\n  onRefetch?: () => void;'
);

fs.writeFileSync('src/components/ClosedLeadBookingView.tsx', content, 'utf8');
console.log("Fixed ClosedLeadBookingViewProps interface");
