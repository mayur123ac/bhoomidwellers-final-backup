const fs = require('fs');

const files = [
  'src/app/dashboard/page.tsx',
  'src/app/dashboard/sales/page.tsx',
  'src/app/dashboard/receptionist/page.tsx'
];

for (const file of files) {
  if (!fs.existsSync(file)) continue;
  let content = fs.readFileSync(file, 'utf8');

  // Fix the broken string
  const replacementText = file.includes("sales") || file.includes("receptionist") ? "t.textMuted" : "theme.textMuted";
  
  content = content.replace(
    /\$\{file\.includes\("sales"\) \|\| file\.includes\("receptionist"\) \? "t\.textMuted" : "theme\.textMuted"\}/g,
    `\${${replacementText}}`
  );

  content = content.replace(
    /className={`px-4 py-3 sm:py-4 whitespace-nowrap text-xs \$\{file\.includes\("sales"\) \|\| file\.includes\("receptionist"\) \? "t\.textMuted" : "theme\.textMuted"\}`}/g,
    `className={\`px-4 py-3 sm:py-4 whitespace-nowrap text-xs \${${replacementText}}\`}`
  );

  fs.writeFileSync(file, content);
}

console.log("Fixed broken template literal.");
