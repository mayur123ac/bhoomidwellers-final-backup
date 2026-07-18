const fs = require('fs');
let content = fs.readFileSync('src/components/BookingApplicationView.tsx', 'utf8');

content = content.replace(
  /interface BookingApplicationViewProps \{/,
  'interface BookingApplicationViewProps {\n  currentUser?: any;'
);

fs.writeFileSync('src/components/BookingApplicationView.tsx', content, 'utf8');
console.log("Fixed BookingApplicationViewProps interface");
