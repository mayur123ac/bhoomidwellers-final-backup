const fs = require('fs');
let content = fs.readFileSync('src/components/ClosedLeadBookingView.tsx', 'utf8');

// Update Props
content = content.replace(
  /export interface ClosedLeadBookingViewProps \{/,
  'export interface ClosedLeadBookingViewProps {\n  currentUser?: any;\n  onRefetch?: () => void;'
);

content = content.replace(
  /export default function ClosedLeadBookingView\(\{/,
  'export default function ClosedLeadBookingView({'
);

content = content.replace(
  /booking, lead, userRole, isDark = false, onEdit, onApprove, onCancel\n\}: ClosedLeadBookingViewProps\) \{/,
  'booking, lead, userRole, currentUser, isDark = false, onEdit, onApprove, onCancel, onRefetch\n}: ClosedLeadBookingViewProps) {'
);

// We need state for EditModal
content = content.replace(
  /const \[activeTab, setActiveTab\] = useState<"summary" \| "payments" \| "documents" \| "timeline" \| "crm">\("summary"\);/,
  `const [activeTab, setActiveTab] = useState<"summary" | "payments" | "documents" | "timeline" | "crm">("summary");
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);`
);

// We need to fetch history
content = content.replace(
  /const renderTimeline = \(\) => \{/,
  `const fetchHistory = async () => {
    if (!booking?.id) return;
    setIsHistoryLoading(true);
    try {
      const res = await fetch(\`/api/booking-applications/\${booking.id}/history\`);
      const json = await res.json();
      if (json.success) setHistory(json.data);
    } catch (e) {
      console.error("Failed to load history", e);
    }
    setIsHistoryLoading(false);
  };

  useEffect(() => {
    if (activeTab === "timeline") {
      fetchHistory();
    }
  }, [activeTab, booking?.id]);

  const renderTimeline = () => {`
);

// Add BookingFormModal import if missing
if (!content.includes('BookingFormModal')) {
  content = content.replace(
    /import BookingApplicationView from "\.\/BookingApplicationView";/,
    'import BookingApplicationView from "./BookingApplicationView";\nimport BookingFormModal from "./BookingFormModal";'
  );
}

// Pass currentUser down and mount BookingFormModal
content = content.replace(
  /<BookingApplicationView\s*booking=\{booking\}\s*lead=\{lead\}\s*isDark=\{isDark\}\s*userRole=\{userRole\}\s*onEdit=\{onEdit\}\s*onApprove=\{onApprove\}\s*onCancel=\{onCancel\}\s*\/>/,
  `<BookingApplicationView
            booking={booking}
            lead={lead}
            isDark={isDark}
            userRole={userRole}
            onEdit={() => setIsEditModalOpen(true)}
            onApprove={onApprove}
            onCancel={onCancel}
          />
          {isEditModalOpen && (
            <BookingFormModal
              isOpen={isEditModalOpen}
              onClose={() => setIsEditModalOpen(false)}
              lead={lead}
              user={currentUser}
              isDark={isDark}
              existingBooking={booking}
              isEditMode={true}
              onSuccess={() => {
                setIsEditModalOpen(false);
                if (onRefetch) onRefetch();
              }}
            />
          )}`
);

// Modify Timeline rendering
content = content.replace(
  /const renderTimeline = \(\) => \{[\s\S]*?(?=const renderCrmDetails = \(\) =>)/,
  `const renderTimeline = () => {
    return (
      <div className="space-y-6">
        <h3 className={\`text-lg font-bold mb-4 \$\{isDark ? "text-white" : "text-gray-800"\}\`}>Timeline & Audit Log</h3>
        {isHistoryLoading ? (
          <p className="text-sm text-gray-500">Loading history...</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-gray-500">No modification history found.</p>
        ) : (
          <div className="space-y-4">
            {history.map((entry, idx) => (
              <div key={idx} className={\`p-4 rounded-xl border \$\{isDark ? "bg-[#222] border-white/10" : "bg-gray-50 border-gray-200"\}\`}>
                <div className="flex items-center justify-between mb-3 border-b pb-2 border-white/10">
                  <div>
                    <span className="font-bold text-sm block">{entry.updated_by}</span>
                    <span className="text-xs text-gray-500 capitalize">{entry.user_role}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-semibold block">{new Date(entry.created_at).toLocaleDateString()}</span>
                    <span className="text-xs text-gray-500">{new Date(entry.created_at).toLocaleTimeString()}</span>
                  </div>
                </div>
                <div className="space-y-2">
                  {Object.keys(entry.changed_fields).map(field => {
                    const changes = entry.changed_fields[field];
                    return (
                      <div key={field} className="grid grid-cols-[120px_1fr] text-sm items-start gap-2">
                        <span className="font-medium text-gray-500 capitalize truncate">{field.replace(/_/g, " ")}:</span>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
                          <span className={\`px-2 py-0.5 rounded text-xs line-through \$\{isDark ? "bg-red-900/30 text-red-400" : "bg-red-100 text-red-600"\}\`}>
                            {typeof changes.old_value === 'object' ? "Updated" : (changes.old_value || "None")}
                          </span>
                          <span className="text-gray-400 hidden sm:inline">→</span>
                          <span className={\`px-2 py-0.5 rounded text-xs \$\{isDark ? "bg-green-900/30 text-green-400" : "bg-green-100 text-green-700"\}\`}>
                            {typeof changes.new_value === 'object' ? "Updated" : (changes.new_value || "None")}
                          </span>
                        </div>
                      </div>
                    );
                  });}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  `
);

fs.writeFileSync('src/components/ClosedLeadBookingView.tsx', content, 'utf8');
console.log("Updated ClosedLeadBookingView");
