const fs = require('fs');

const targetFiles = [
  'src/app/dashboard/page.tsx',
  'src/app/dashboard/sales/page.tsx',
  'src/app/dashboard/employees/page.tsx'
];

targetFiles.forEach(f => {
  let content = fs.readFileSync(f, 'utf8');
  
  // Find all imports of useActivityTracker
  const importRegex = /import\s+\{\s*useActivityTracker\s*\}\s+from\s+['"]@\/hooks\/useActivityTracker['"];?\r?\n?/g;
  
  // Find all matches
  let matches = [...content.matchAll(importRegex)];
  
  if (matches.length > 1) {
    // Keep the first one, remove the rest
    let newContent = content;
    for (let i = 1; i < matches.length; i++) {
      newContent = newContent.replace(matches[i][0], '');
    }
    content = newContent;
  }
  
  // Do the same for AttendanceTimerWidget
  const widgetRegex = /import\s+AttendanceTimerWidget\s+from\s+['"]@\/components\/AttendanceTimerWidget['"];?\r?\n?/g;
  let widgetMatches = [...content.matchAll(widgetRegex)];
  if (widgetMatches.length > 1) {
    let newContent = content;
    for (let i = 1; i < widgetMatches.length; i++) {
      newContent = newContent.replace(widgetMatches[i][0], '');
    }
    content = newContent;
  }

  fs.writeFileSync(f, content);
  console.log('Cleaned', f);
});
