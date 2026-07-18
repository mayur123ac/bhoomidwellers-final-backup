const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/app/dashboard/page.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// 1. WhatsApp Modal Open
content = content.replace(
  /onClick=\{\(\) => setIsWaModalOpen\(true\)\}/g,
  'onClick={() => { setIsWaModalOpen(true); emitActivity({type: "FORM_EDIT_STARTED", leadId: selectedLead?.id, leadName: selectedLead?.name, module: "WhatsApp Modal", action: "Opening WhatsApp"}); }}'
);

// 2. WhatsApp Send (handleSendWhatsApp)
content = content.replace(
  /const handleSendWhatsApp = async \(msg: string\) => \{/g,
  `const handleSendWhatsApp = async (msg: string) => {
    emitActivity({type: "WHATSAPP_SENT", leadId: selectedLead?.id, leadName: selectedLead?.name, module: "WhatsApp Modal", action: "Sent WhatsApp Message"});`
);

// 3. Browser Call Button Start
// The browser call buttons currently lack an onClick. Let's find them:
// <button className={`border flex flex-col ...`}><FaMicrophone className="text-lg" /><span className="font-bold text-[10px]">Browser Call</span></button>
content = content.replace(
  /<button className=\{\`border flex flex-col items-center justify-center py-3 rounded-xl transition-all cursor-pointer gap-1/g,
  '<button onClick={() => { emitActivity({type: "CALL_STARTED", leadId: selectedLead?.id, leadName: selectedLead?.name, module: "Calling", action: "Calling Client"}); }} className={`border flex flex-col items-center justify-center py-3 rounded-xl transition-all cursor-pointer gap-1'
);

// Another Browser Call button format inside line 5531
// <button className="bg-blue-600/10 border border-blue-500/30 hover:bg-blue-600 text-blue-400 hover:text-white flex flex-col items-center justify-center py-3 rounded-xl cursor-pointer gap-1"><FaMicrophone className="text-lg" /><span className="font-bold text-[10px]">Browser Call</span></button>
content = content.replace(
  /<button className="bg-blue-600\/10 border border-blue-500\/30 hover:bg-blue-600 text-blue-400 hover:text-white flex flex-col items-center justify-center py-3 rounded-xl cursor-pointer gap-1">/g,
  '<button onClick={() => { emitActivity({type: "CALL_STARTED", leadId: selectedLead?.id, leadName: selectedLead?.name, module: "Calling", action: "Calling Client"}); }} className="bg-blue-600/10 border border-blue-500/30 hover:bg-blue-600 text-blue-400 hover:text-white flex flex-col items-center justify-center py-3 rounded-xl cursor-pointer gap-1">'
);

fs.writeFileSync(filePath, content, 'utf8');
console.log("WhatsApp and Call telemetry added.");
