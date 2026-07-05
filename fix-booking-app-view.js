const fs = require('fs');
let content = fs.readFileSync('src/components/BookingApplicationView.tsx', 'utf8');

// Add currentUser to Props
content = content.replace(
  /export interface BookingApplicationViewProps \{/,
  'export interface BookingApplicationViewProps {\n  currentUser?: any;'
);

content = content.replace(
  /booking, lead, isDark = false, userRole, onEdit, onApprove, onCancel,/,
  'booking, lead, isDark = false, userRole, currentUser, onEdit, onApprove, onCancel,'
);

// Update Edit Button logic
const newEditLogic = `
            {(() => {
              let canEdit = false;
              if (userRole === "admin" || userRole === "site_head") canEdit = true;
              else if (userRole === "sales" && booking?.booking_status !== "Approved") {
                // Check if current user is the owner
                if (currentUser && lead?.assigned_to === currentUser.name) {
                  canEdit = true;
                }
              }
              
              if (canEdit && onEdit) {
                return (
                  <button onClick={onEdit} className={\`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg cursor-pointer transition-colors \${isDark ? "bg-[#9E217B] hover:bg-[#7a1960] text-white" : "bg-[#00AEEF] hover:bg-[#0088bb] text-white"}\`}>
                    <FaEdit className="text-[10px]" /> Edit Booking Form
                  </button>
                );
              }
              return null;
            })()}
`;

// Replace the old edit button logic
content = content.replace(
  /\{\(userRole === "admin" \|\| \(userRole === "sales" && bookingStatus !== "Approved"\)\) && onEdit && \([\s\S]*?<\/button>\s*\)\}/,
  newEditLogic
);

fs.writeFileSync('src/components/BookingApplicationView.tsx', content, 'utf8');
console.log("Updated BookingApplicationView");
