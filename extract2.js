const fs = require('fs');
const content = fs.readFileSync('d:/bhoomi-crm/frontend/src/app/dashboard/sales/page.tsx', 'utf-8');
const funcStartIdx = content.indexOf('function AttendanceView({');

const bodyStartStr = '}) {';
let bodyStartIdx = content.indexOf(bodyStartStr, funcStartIdx);
if (bodyStartIdx === -1) {
    console.error('bodyStartStr not found');
    process.exit(1);
}

let openBraces = 0;
let endIdx = -1;
for (let i = bodyStartIdx + 3; i < content.length; i++) {
  if (content[i] === '{') openBraces++;
  else if (content[i] === '}') {
    openBraces--;
    if (openBraces === 0) {
      endIdx = i + 1;
      break;
    }
  }
}

const fullFunc = content.substring(funcStartIdx, endIdx);

const imports = `"use client";
import React, { useState, useEffect } from "react";
import { useShiftTiming } from "@/hooks/useShiftTiming";
import AttendanceTimerWidget from "@/components/AttendanceTimerWidget";
import { FaClock, FaCalendarAlt, FaCheckCircle, FaTimesCircle, FaMapMarkerAlt, FaFileExcel, FaTimes, FaCog } from "react-icons/fa";

export type ThemeTokens = Record<string, string | any>;

export default ` + fullFunc.replace('ReturnType<typeof buildTheme>', 'ThemeTokens');

fs.writeFileSync('d:/bhoomi-crm/frontend/src/components/AttendanceView.tsx', imports);
console.log('Success');
