const fs = require('fs');
const readline = require('readline');
const path = require('path');

const logPath = `C:/Users/Mayur/.gemini/antigravity-ide/brain/1612c459-a1ed-4acd-9090-038018ed8bdd/.system_generated/logs/transcript.jsonl`;

async function findError() {
  const fileStream = fs.createReadStream(logPath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let foundError = false;
  for await (const line of rl) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.content && parsed.content.includes("Error updating working hours")) {
         if (parsed.type !== 'VIEW_FILE' && parsed.type !== 'PLANNER_RESPONSE') {
            console.log(parsed.content);
            foundError = true;
         }
      }
    } catch(e) {}
  }
}
findError();
