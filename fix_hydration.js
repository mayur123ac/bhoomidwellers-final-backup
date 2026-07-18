const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/app/dashboard/page.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Fix the useState for isDark and add isMounted
content = content.replace(
  /const \[isDark, setIsDark\] = useState\(\(\) => \{[\s\S]*?\}\);/,
  `const [isDark, setIsDark] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    try {
      if (localStorage.getItem("crm_theme") === "dark") {
        setIsDark(true);
      }
    } catch {}
  }, []);`
);

// 2. Add if (!isMounted) return null; right before the main return of AdminAtlasDashboard
// To find the main return, we'll look for `  return (\n    <div\n      className={\`flex h-screen font-sans`
content = content.replace(
  /  return \(\n    <div\n      className=\{\`flex h-screen font-sans overflow-hidden relative transition-colors \n?duration-300 \$\{theme\.pageWrap\}\`\}/,
  `  if (!isMounted) return null;

  return (
    <div
      className={\`flex h-screen font-sans overflow-hidden relative transition-colors duration-300 \$\{theme.pageWrap\}\`}`
);

fs.writeFileSync(filePath, content, 'utf8');
console.log("Hydration fix applied.");
