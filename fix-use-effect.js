const fs = require('fs');
let content = fs.readFileSync('src/components/ClosedLeadBookingView.tsx', 'utf8');

content = content.replace(
  /import React, \{ useState \} from "react";/,
  'import React, { useState, useEffect } from "react";'
);

fs.writeFileSync('src/components/ClosedLeadBookingView.tsx', content, 'utf8');
console.log("Fixed useEffect import in ClosedLeadBookingView.tsx");
