const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/app/dashboard/page.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// The main return of AdminAtlasDashboard looks like:
//   return (
//     <div
//       className={`flex h-screen font-sans overflow-hidden relative transition-colors duration-300 ${theme.pageWrap}`}
//       style={{ backgroundImage: isDark ? "radial-gradient(circle at top, #1A1A1A 0%, #000 100%)" : "linear-gradient(135deg, #FDF8F0 0%, #F8FAFC 50%, #FDF8F0 100%)" }}
//     >

content = content.replace(
  /  return \(\n    <div\n      className=\{\`flex h-screen font-sans overflow-hidden relative transition-colors duration-300 \$\{theme\.pageWrap\}\`\}\n      style=\{\{ backgroundImage: isDark \? "radial-gradient\(circle at top, #1A1A1A 0%, #000 100%\)" : "linear-gradient\(135deg, #FDF8F0 0%, #F8FAFC 50%, #FDF8F0 100%\)" \}\}\n    >/,
  `  if (!isMounted) return null;\n\n  return (\n    <div\n      className={\`flex h-screen font-sans overflow-hidden relative transition-colors duration-300 \$\{theme.pageWrap\}\`}\n      style={{ backgroundImage: isDark ? "radial-gradient(circle at top, #1A1A1A 0%, #000 100%)" : "linear-gradient(135deg, #FDF8F0 0%, #F8FAFC 50%, #FDF8F0 100%)" }}\n    >`
);

fs.writeFileSync(filePath, content, 'utf8');
console.log("Hydration early return added.");
