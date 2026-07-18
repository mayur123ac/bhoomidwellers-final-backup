const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(filePath));
    } else if (filePath.endsWith('.tsx') || filePath.endsWith('.ts')) {
      results.push(filePath);
    }
  });
  return results;
}

const files = walk('d:\\bhoomi-crm\\frontend\\src');
let filesModified = 0;

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  let originalContent = content;

  // Add '#' prefix back to {lead.sr_no
  content = content.replace(/(?<!#)\{lead\.sr_no/g, '#{lead.sr_no');

  // Rename SR. NO. back to LEAD NO.
  content = content.replace(/"SR\. NO\."/g, '"LEAD NO."');
  content = content.replace(/"SR\. NO"/g, '"LEAD NO."');
  content = content.replace(/'SR\. NO\.'/g, "'LEAD NO.'");
  
  // Rename Sr. No. back to Lead No.
  content = content.replace(/"Sr\. No\."/g, '"Lead No."');
  content = content.replace(/"Sr\. No"/g, '"Lead No."');
  content = content.replace(/'Sr\. No\.'/g, "'Lead No.'");

  if (content !== originalContent) {
    fs.writeFileSync(file, content, 'utf8');
    filesModified++;
    console.log(`Updated ${file}`);
  }
}

console.log(`Total files modified: ${filesModified}`);
