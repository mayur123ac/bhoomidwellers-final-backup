const fs = require('fs');
const logPath = 'C:/Users/Mayur/.gemini/antigravity-ide/brain/7f95345c-b5ff-426c-90d9-a3f6b52cbdee/.system_generated/logs/transcript.jsonl';
const content = fs.readFileSync(logPath, 'utf8');

const lines = content.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('SiteVisitOverview')) {
    console.log(`Line ${i} contains SiteVisitOverview`);
    try {
      const obj = JSON.parse(lines[i]);
      if (obj.tool_calls) {
        obj.tool_calls.forEach(tc => console.log('Tool call:', tc.function.name));
      }
      if (obj.type === 'TOOL_RESPONSE') {
        const text = JSON.stringify(obj.content).substring(0, 200);
        console.log('Tool response:', text);
      }
    } catch(e) {}
  }
}
