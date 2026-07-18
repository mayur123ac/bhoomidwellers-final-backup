const fs = require('fs');
const path = require('path');

const targetFiles = [
  'src/app/dashboard/page.tsx',
  'src/app/dashboard/employees/page.tsx',
  'src/app/dashboard/sales/page.tsx',
  // receptionist/page.tsx already done
];

for (const relPath of targetFiles) {
  const fullPath = path.join(__dirname, relPath);
  if (!fs.existsSync(fullPath)) continue;

  let content = fs.readFileSync(fullPath, 'utf8');

  // Skip if already injected
  if (content.includes('AttendanceTimerWidget')) {
    console.log(`Skipping ${relPath} - already has AttendanceTimerWidget`);
    continue;
  }

  // 1. Add imports
  const importLines = `
import AttendanceTimerWidget from "@/components/AttendanceTimerWidget";
import { useActivityTracker } from "@/hooks/useActivityTracker";
`;
  
  // Find the last import
  const lastImportIndex = content.lastIndexOf('import ');
  if (lastImportIndex !== -1) {
    const endOfLastImport = content.indexOf('\n', lastImportIndex);
    content = content.slice(0, endOfLastImport + 1) + importLines + content.slice(endOfLastImport + 1);
  }

  // 2. Add useActivityTracker() inside the main export
  content = content.replace(/(export default function [a-zA-Z0-9_]+\(\) \{\s*const [a-zA-Z0-9_]+ = useRouter\(\);)/, '$1\n  useActivityTracker();');

  // 3. Add <AttendanceTimerWidget />
  // We look for the theme toggle button
  const headerToken = '<button onClick={() => setIsDark(!isDark)}';
  if (content.includes(headerToken)) {
    content = content.replace(headerToken, '<AttendanceTimerWidget />\n            ' + headerToken);
  }

  fs.writeFileSync(fullPath, content);
  console.log(`Successfully injected into ${relPath}`);
}
