const fs = require('fs');
let content = fs.readFileSync('src/components/BookingFormModal.tsx', 'utf8');

content = content.replace(
  /interface BookingFormModalProps \{/,
  'interface BookingFormModalProps {\n  existingBooking?: any;\n  isEditMode?: boolean;'
);

fs.writeFileSync('src/components/BookingFormModal.tsx', content, 'utf8');
console.log("Fixed BookingFormModalProps interface");
