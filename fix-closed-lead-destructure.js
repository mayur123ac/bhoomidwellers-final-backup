const fs = require('fs');
let content = fs.readFileSync('src/components/ClosedLeadBookingView.tsx', 'utf8');

content = content.replace(
  /booking, lead, userRole, isDark = false, onEdit, onApprove, onCancel/,
  'booking, lead, userRole, isDark = false, onEdit, onApprove, onCancel, currentUser, onRefetch'
);

fs.writeFileSync('src/components/ClosedLeadBookingView.tsx', content, 'utf8');
console.log("Fixed ClosedLeadBookingView.tsx destructuring");
