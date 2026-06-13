const fs = require('fs');
let content = fs.readFileSync('d:/bhoomi-crm/frontend/src/app/dashboard/page.tsx', 'utf-8');

const oldFilter = `].filter(item => {
    if (isAdmin) return true;

    // Non-admin roles should only see what's allowed.
    // Site head cannot see caller, employees, or geo analytics panel
    if (isSiteHead && (item.id === "caller" || item.id === "employees" || item.id === "geo")) {
      return false;
    }`;

const newFilter = `].filter(item => {
    if (isAdmin) return item.id !== "attendance";

    // Non-admin roles should only see what's allowed.
    if (isSiteHead) {
      if (["live_activity", "monitoring", "geo", "caller", "employees"].includes(item.id)) return false;
      return true;
    }`;

content = content.replace(oldFilter, newFilter);

const oldRender = `{activeView === "live_activity" && (`;
const newRender = `{activeView === "attendance" && (
            <div className="flex flex-col h-full overflow-hidden">
              <div className="p-4 md:p-8 overflow-y-auto">
                <AttendanceView adminUser={user} isDark={isDark} t={theme} now={currentTime.getTime()} />
              </div>
            </div>
          )}
          {activeView === "live_activity" && (`;

content = content.replace(oldRender, newRender);

fs.writeFileSync('d:/bhoomi-crm/frontend/src/app/dashboard/page.tsx', content);
console.log('Updated');
