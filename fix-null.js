const fs = require('fs');
let content = fs.readFileSync('src/components/BookingFormModal.tsx', 'utf8');

const targetStr = `      const initialForm = defaultForm(lead);
      setForm({ 
        ...initialForm, 
        ...existingBooking, 
        joint_applicants: typeof existingBooking.joint_applicants === 'string' ? JSON.parse(existingBooking.joint_applicants) : (existingBooking.joint_applicants || initialForm.joint_applicants),
        payment_details: typeof existingBooking.payment_details === 'string' ? JSON.parse(existingBooking.payment_details) : (existingBooking.payment_details || initialForm.payment_details)
      });`;

const replaceStr = `      const initialForm = defaultForm(lead);
      const safeBooking: any = {};
      // Remove null values so they don't override initialForm defaults
      Object.keys(existingBooking).forEach(k => {
        if (existingBooking[k] !== null && existingBooking[k] !== undefined) {
          safeBooking[k] = existingBooking[k];
        }
      });
      setForm({ 
        ...initialForm, 
        ...safeBooking, 
        joint_applicants: typeof safeBooking.joint_applicants === 'string' ? JSON.parse(safeBooking.joint_applicants) : (safeBooking.joint_applicants || initialForm.joint_applicants),
        payment_details: typeof safeBooking.payment_details === 'string' ? JSON.parse(safeBooking.payment_details) : (safeBooking.payment_details || initialForm.payment_details)
      });`;

content = content.replace(targetStr, replaceStr);

fs.writeFileSync('src/components/BookingFormModal.tsx', content, 'utf8');
console.log("Fixed BookingFormModal.tsx null mapping");
