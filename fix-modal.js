const fs = require('fs');
let content = fs.readFileSync('src/components/BookingFormModal.tsx', 'utf8');

// Update Props
content = content.replace(
  /export interface BookingFormModalProps \{/,
  'export interface BookingFormModalProps {\n  existingBooking?: any;\n  isEditMode?: boolean;'
);

// Update Component signature
content = content.replace(
  /export default function BookingFormModal\(\{ isOpen, onClose, lead, user, isDark = false, onSuccess \}: BookingFormModalProps\) \{/,
  'export default function BookingFormModal({ isOpen, onClose, lead, user, isDark = false, onSuccess, existingBooking, isEditMode }: BookingFormModalProps) {'
);

// Update Initialization logic in useEffect
content = content.replace(
  /const stored = sessionStorage\.getItem\(key\);\n\s*if \(stored\) \{/,
  `const stored = sessionStorage.getItem(key);
    if (isEditMode && existingBooking) {
      // Map existing DB fields to form state
      const initialForm = defaultForm(lead);
      setForm({ 
        ...initialForm, 
        ...existingBooking, 
        joint_applicants: typeof existingBooking.joint_applicants === 'string' ? JSON.parse(existingBooking.joint_applicants) : (existingBooking.joint_applicants || initialForm.joint_applicants),
        payment_details: typeof existingBooking.payment_details === 'string' ? JSON.parse(existingBooking.payment_details) : (existingBooking.payment_details || initialForm.payment_details)
      });
    } else if (stored) {`
);

// Update handleSubmit to call PUT for Edit Mode
content = content.replace(
  /const res = await fetch\("\/api\/booking-applications", \{ method: "POST", body: formData \}\);/,
  `const res = await fetch(isEditMode ? \`/api/booking-applications/\${existingBooking.id}\` : "/api/booking-applications", { 
        method: isEditMode ? "PUT" : "POST", 
        body: formData 
      });`
);

// We also need to add user_role and user_name to formData for PUT
content = content.replace(
  /if \(form\.internal_notes\) formData\.append\("internal_notes", form\.internal_notes\);/,
  `if (form.internal_notes) formData.append("internal_notes", form.internal_notes);
      
      if (isEditMode && user) {
        formData.append("user_role", user.role?.toLowerCase() || "admin");
        formData.append("user_name", user.name || "Unknown");
      }`
);

// Update success screen text
content = content.replace(
  /<h2>Booking Application Submitted!<\/h2>/g,
  '<h2>{isEditMode ? "Booking Application Updated!" : "Booking Application Submitted!"}</h2>'
);

content = content.replace(
  /<p className=\{`text-sm mb-6 \$\{textMuted\}`\}>\s*The booking application for <strong>\{form\.primary_name\}<\/strong> has been successfully saved\./g,
  '<p className={`text-sm mb-6 ${textMuted}`}>\n                      The booking application for <strong>{form.primary_name}</strong> has been successfully {isEditMode ? "updated" : "saved"}.'
);

// Update submit button text
content = content.replace(
  /\{isSubmitting \? "Saving..." : "Generate Application"\}/g,
  '{isSubmitting ? "Saving..." : (isEditMode ? "Update Booking" : "Generate Application")}'
);

fs.writeFileSync('src/components/BookingFormModal.tsx', content, 'utf8');
console.log("Updated BookingFormModal.tsx");
