const fs = require('fs');
let content = fs.readFileSync('src/app/dashboard/page.tsx', 'utf8');

// 1. Add showBookingView state
content = content.replace(
  /const \[bookingData, setBookingData\] = useState<any>\(null\);/g,
  'const [bookingData, setBookingData] = useState<any>(null);\n  const [showBookingView, setShowBookingView] = useState(false);'
);

// 2. Modify useEffect to fetch for all selected leads
content = content.replace(
  /if \(selectedLead && \(selectedLead\.status === "Closing" \|\| selectedLead\.status === "Closed" \|\| selectedLead\.booking_id\)\) \{\s*fetchBookingForLead\(selectedLead\.id\);\s*\} else \{\s*setBookingData\(null\);\s*\}/g,
  'if (selectedLead) {\n      fetchBookingForLead(selectedLead.id);\n    } else {\n      setBookingData(null);\n      setShowBookingView(false);\n    }'
);

// 3. Modify rendering of ClosedLeadBookingView
content = content.replace(
  /bookingData \? \(\s*<div className="animate-fadeIn w-full h-\[calc\(100vh-130px\)\] overflow-hidden bg-transparent">\s*<ClosedLeadBookingView/g,
  `bookingData && showBookingView ? (
                <div className="animate-fadeIn w-full h-[calc(100vh-130px)] overflow-hidden bg-transparent flex flex-col">
                  <div className="flex items-center p-2 shrink-0 border-b border-white/10 shadow-sm" style={theme.cardGlass}>
                    <button onClick={() => setShowBookingView(false)} className={\`px-4 py-1.5 text-xs font-bold flex items-center gap-1.5 border rounded-lg transition-colors cursor-pointer shadow-sm \${theme.textMuted} \${theme.tableBorder} \${isDark ? "bg-[#222] hover:bg-[#333]" : "bg-white hover:bg-[#F8FAFC]"}\`}>
                      <FaChevronLeft /> Back to Lead Details
                    </button>
                  </div>
                  <div className="flex-1 overflow-hidden">
                  <ClosedLeadBookingView`
);

content = content.replace(
  /userRole=\{adminUser\?\.role\?\.toLowerCase\(\) \|\| "admin"\}\s*\/>\s*<\/div>/g,
  'userRole={adminUser?.role?.toLowerCase() || "admin"}\n                    />\n                  </div>\n                </div>'
);
content = content.replace(
  /userRole="receptionist"\s*\/>\s*<\/div>/g,
  'userRole="receptionist"\n                    />\n                  </div>\n                </div>'
);


// 4. Add the button in the Lead Header right before {isLeadLocked ? (
content = content.replace(
  /<div className="flex gap-2 flex-wrap justify-end">\s*\{isLeadLocked \? \(/g,
  `<div className="flex gap-2 flex-wrap justify-end">
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
console.log("Replacements done.");
