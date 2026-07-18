const fs = require('fs');
const path = require('path');

const targetFiles = [
  "src/app/dashboard/page.tsx",
  "src/app/dashboard/sales/page.tsx",
  "src/app/dashboard/receptionist/page.tsx",
  "src/app/dashboard/employees/page.tsx",
  "src/app/dashboard/caller/page.tsx"
];

targetFiles.forEach(file => {
  const filePath = path.join(__dirname, '..', file);
  if (!fs.existsSync(filePath)) return;

  let content = fs.readFileSync(filePath, 'utf8');
  
  // Regex to remove the entire injected block
  const blockRegex = /\/\/ --- INJECTED GLOBAL TELEMETRY EMITTER ---[\s\S]*?\/\/ ------------------------------------------\n?/g;
  
  if (blockRegex.test(content)) {
    content = content.replace(blockRegex, "");
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Cleaned: ${file}`);
  }
});
