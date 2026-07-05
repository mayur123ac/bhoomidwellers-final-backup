const fs = require('fs');
let content = fs.readFileSync('src/app/api/booking-applications/[id]/route.ts', 'utf8');

content = content.replace(
  /uploadBufferToR2\(buffer, `bookings\/\$\{id\}\/\$\{key\}_\$\{Date.now\(\)\}.\$\{ext\}`,\s*file\.type\)/g,
  'uploadBufferToR2(`bookings/${id}/${key}_${Date.now()}.${ext}`, buffer, file.type)'
);

fs.writeFileSync('src/app/api/booking-applications/[id]/route.ts', content, 'utf8');
console.log("Fixed uploadBufferToR2 call in route.ts");
