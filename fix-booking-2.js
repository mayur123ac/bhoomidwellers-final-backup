const fs = require('fs');
let content = fs.readFileSync('src/app/dashboard/page.tsx', 'utf8');

// Add the button in the Lead Header for AdminSiteHeadView and ReceptionistView (which use gap-3)
content = content.replace(
  /<div className="flex gap-3 flex-wrap justify-end">\s*\{isLeadLocked \? \(/g,
  `<div className="flex gap-3 flex-wrap justify-end">
                        {bookingData ? (
                          <button onClick={() => setShowBookingView(true)} className="font-bold px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5 transition-colors cursor-pointer bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm">
                            <FaEye /> View Booking Form
                          </button>
                        ) : (
                          <button disabled title="Booking Form has not been submitted yet." className="font-bold px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5 transition-colors opacity-50 cursor-not-allowed bg-indigo-400 text-white shadow-sm">
                            <FaEye /> View Booking Form
                          </button>
                        )}
                        {isLeadLocked ? (`
);

fs.writeFileSync('src/app/dashboard/page.tsx', content, 'utf8');
console.log("Replacements done for gap-3 views.");
