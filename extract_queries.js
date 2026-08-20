const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function findQueries(dir) {
  let results = [];
  const files = fs.readdirSync(dir);
  
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      results = results.concat(findQueries(fullPath));
    } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');
      
      let fileMatches = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.match(/SELECT\s/i) || line.match(/(?<!\w)query\(/) || line.match(/\.query\(/)) {
          fileMatches.push({ line: i + 1, content: line.trim() });
        }
      }
      if (fileMatches.length > 0) {
        results.push({ file: fullPath, matches: fileMatches });
      }
    }
  }
  return results;
}

const dir = path.join(__dirname, 'src');
const queries = findQueries(dir);

let md = '# Read Path Audit\n\n';
let count = 0;

for (const q of queries) {
  const relPath = path.relative(__dirname, q.file);
  md += `## ${relPath}\n`;
  for (const match of q.matches) {
    md += `- Line ${match.line}: \`${match.content.substring(0, 150)}\`\n`;
    count++;
  }
  md += '\n';
}

md += `\nTotal files: ${queries.length}\n`;
md += `Total queries: ${count}\n`;

fs.writeFileSync(path.join(__dirname, 'read_paths.md'), md);
console.log(`Saved audit to read_paths.md (Found ${count} queries in ${queries.length} files)`);
