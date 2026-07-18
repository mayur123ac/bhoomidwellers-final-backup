const fs = require('fs');
const path = require('path');

const targetFiles = [
  'src/app/dashboard/page.tsx',
  'src/app/dashboard/employees/page.tsx',
  'src/app/dashboard/sales/page.tsx',
];

for (const relPath of targetFiles) {
  const fullPath = path.join(__dirname, relPath);
  if (!fs.existsSync(fullPath)) continue;

  let content = fs.readFileSync(fullPath, 'utf8');

  // Count occurrences of import { useActivityTracker }
  const searchStr = 'import { useActivityTracker } from "@/hooks/useActivityTracker";';
  
  if (content.split(searchStr).length - 1 > 1) {
    // Replace the first occurrence
    content = content.replace(searchStr + '\n', '');
    fs.writeFileSync(fullPath, content);
    console.log(`Fixed duplicates in ${relPath}`);
  }
}
