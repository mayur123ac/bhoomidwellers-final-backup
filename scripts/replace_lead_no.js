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

  // Replace #{lead.lead_number || lead.id} -> {lead.sr_no || lead.id}
  content = content.replace(/#\{lead\.lead_number\s*\|\|\s*lead\.id\}/g, '{lead.sr_no || lead.id}');
  
  // Replace #{lead.lead_number || lead.dbId} -> {lead.sr_no || lead.dbId}
  content = content.replace(/#\{lead\.lead_number\s*\|\|\s*lead\.dbId\}/g, '{lead.sr_no || lead.dbId}');

  // Replace "Lead No." -> "Sr. No."
  content = content.replace(/"Lead No\."/g, '"Sr. No."');
  content = content.replace(/"Lead No"/g, '"Sr. No."');
  content = content.replace(/'Lead No\.'/g, "'Sr. No.'");
  
  // Replace "LEAD NO." -> "SR. NO."
  content = content.replace(/"LEAD NO\."/g, '"SR. NO."');
  content = content.replace(/"LEAD NO"/g, '"SR. NO."');
  content = content.replace(/'LEAD NO\.'/g, "'SR. NO.'");

  // Remove other # prefixes before {lead.sr_no
  content = content.replace(/#\{lead\.sr_no/g, '{lead.sr_no');
  
  // Replace any lead.lead_number with lead.sr_no
  content = content.replace(/lead\.lead_number/g, 'lead.sr_no');
  content = content.replace(/l\.lead_number/g, 'l.sr_no');
  content = content.replace(/e\.lead_number/g, 'e.sr_no');

  // Replace Lead #{lead.sr_no... with Lead {lead.sr_no...
  content = content.replace(/Lead #\{lead\.sr_no/g, 'Lead {lead.sr_no');

  if (content !== originalContent) {
    fs.writeFileSync(file, content, 'utf8');
    filesModified++;
    console.log(`Updated ${file}`);
  }
}

console.log(`Total files modified: ${filesModified}`);
