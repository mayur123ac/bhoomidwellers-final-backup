const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/app/dashboard/LiveActivityView.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Add `now`, `expandedRows`, `historyCache` state
content = content.replace(
  /const \[globalAnalytics, setGlobalAnalytics\] = useState<any>\(null\);/,
  `const [globalAnalytics, setGlobalAnalytics] = useState<any>(null);
  const [now, setNow] = useState(Date.now());
  const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({});
  const [historyCache, setHistoryCache] = useState<Record<number, any[]>>({});

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const getLiveTimer = (start: string, end: string, isActive: boolean) => {
    if (!start) return "Frozen";
    const startTime = new Date(start).getTime();
    const endTime = isActive ? now : (end ? new Date(end).getTime() : startTime);
    const diff = Math.max(0, Math.floor((endTime - startTime) / 1000));
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    const s = diff % 60;
    return \`\${String(h).padStart(2, '0')}h \${String(m).padStart(2, '0')}m \${String(s).padStart(2, '0')}s\`;
  };

  const getWorkingHours = (start: string, end: string, isActive: boolean) => {
    if (!start) return "-";
    const startTime = new Date(start).getTime();
    const endTime = isActive ? now : (end ? new Date(end).getTime() : startTime);
    const diff = Math.max(0, Math.floor((endTime - startTime) / 1000));
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    return \`\${String(h).padStart(2, '0')}h \${String(m).padStart(2, '0')}m\`;
  };

  const toggleRow = async (e: React.MouseEvent, s: any) => {
    e.stopPropagation();
    setSelectedUser(s);
    const isExpanded = !!expandedRows[s.user_id];
    setExpandedRows(prev => ({...prev, [s.user_id]: !isExpanded}));

    if (!isExpanded && !historyCache[s.user_id]) {
      try {
        const res = await fetch(\`/api/attendance/session-history?userId=\${s.user_id}\`);
        const data = await res.json();
        if (data.success) {
          setHistoryCache(prev => ({...prev, [s.user_id]: data.sessions}));
        }
      } catch (err) {
        console.error(err);
      }
    }
  };`
);

// 2. Change Table Headers
content = content.replace(
  /<th className="px-3 py-2 font-bold">Login Time<\/th>\s*<th className="px-3 py-2 font-bold">Session<\/th>/,
  `<th className="px-3 py-2 font-bold">Login Time</th>
                  <th className="px-3 py-2 font-bold">Logout Time</th>
                  <th className="px-3 py-2 font-bold">Live Session Timer</th>
                  <th className="px-3 py-2 font-bold">Working Hours</th>`
);

// 3. Change Table Body `sessions.map`
const oldMap = `sessions.map((s, i) => (
                    <tr key={i} className={\`cursor-pointer transition-colors \${selectedUser?.user_id === s.user_id ? 'bg-[#9E217B]/10' : theme.tableRow}\`} onClick={() => setSelectedUser(s)}>
                      <td className={\`px-3 py-2.5 border-b \${theme.tableBorder} relative\`}>
                        {/* Heat Indicator Border */}
                        {s.status === 'ACTIVE' && <div className="absolute left-0 top-0 bottom-0 w-1 bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" />}
                        {s.status === 'IDLE' && <div className="absolute left-0 top-0 bottom-0 w-1 bg-yellow-500" />}
                        {s.status === 'OFFLINE' && <div className="absolute left-0 top-0 bottom-0 w-1 bg-gray-500" />}
                        
                        {s.status === 'ACTIVE' && <span className="font-black text-green-500">🟢 ACTIVE</span>}
                        {s.status === 'IDLE' && <span className="font-bold text-yellow-500">🟡 IDLE</span>}
                        {s.status === 'OFFLINE' && <span className="font-bold text-gray-500">⚪ OFFLINE</span>}
                      </td>
                      <td className={\`px-3 py-2.5 border-b font-bold \${theme.text} \${theme.tableBorder}\`}>{s.name}</td>
                      <td className={\`px-3 py-2.5 border-b \${theme.textMuted} \${theme.tableBorder}\`}>{s.current_module || '-'}</td>
                      <td className={\`px-3 py-2.5 border-b font-medium text-[#9E217B] \${theme.tableBorder}\`}>{s.active_lead_id ? \`\${s.active_lead_name || 'Lead'} (\${s.active_lead_id})\` : '-'}</td>
                      <td className={\`px-3 py-2.5 border-b \${theme.textMuted} \${theme.tableBorder}\`}>{s.current_action || '-'}</td>
                      <td className={\`px-3 py-2.5 border-b \${theme.textMuted} \${theme.tableBorder}\`}>{new Date(s.session_start).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                      <td className={\`px-3 py-2.5 border-b \${theme.textMuted} \${theme.tableBorder}\`}>{new Date(s.session_start).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
                      <td className={\`px-3 py-2.5 border-b font-mono \${theme.textMuted} \${theme.tableBorder}\`}>{formatDuration(s.session_duration_seconds)}</td>
                      <td className={\`px-3 py-2.5 border-b \${theme.tableBorder}\`}>
                        {s.idle_duration_seconds > 1800 ? (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-red-500/10 text-red-500 border border-red-500/20">⚠ Long Idle</span>
                        ) : <span className={theme.textFaint}>-</span>}
                      </td>
                    </tr>
                  ))`;

// Wait, the formatting in the file may differ slightly. Let me use a robust regex instead for the <tbody> mapping block.
const tbodyRegex = /sessions\.map\(\(s, i\) => \([\s\S]*?<\/tr>\s*\)\)/;

const newTbody = `sessions.map((s, i) => (
                    <React.Fragment key={i}>
                      <tr className={\`cursor-pointer transition-colors \${selectedUser?.user_id === s.user_id ? 'bg-[#9E217B]/10' : theme.tableRow}\`} onClick={(e) => toggleRow(e, s)}>
                        <td className={\`px-3 py-2.5 border-b \${theme.tableBorder} relative\`}>
                          {/* Heat Indicator Border */}
                          {s.status === 'ACTIVE' && <div className="absolute left-0 top-0 bottom-0 w-1 bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" />}
                          {s.status === 'IDLE' && <div className="absolute left-0 top-0 bottom-0 w-1 bg-yellow-500" />}
                          {s.status === 'OFFLINE' && <div className="absolute left-0 top-0 bottom-0 w-1 bg-gray-500" />}
                          
                          {s.status === 'ACTIVE' && <span className="font-black text-green-500">🟢 ACTIVE</span>}
                          {s.status === 'IDLE' && <span className="font-bold text-yellow-500">🟡 IDLE</span>}
                          {s.status === 'OFFLINE' && <span className="font-bold text-gray-500">⚪ OFFLINE</span>}
                        </td>
                        <td className={\`px-3 py-2.5 border-b font-bold \${theme.text} \${theme.tableBorder}\`}>{s.name}</td>
                        <td className={\`px-3 py-2.5 border-b \${theme.textMuted} \${theme.tableBorder}\`}>{s.current_module || '-'}</td>
                        <td className={\`px-3 py-2.5 border-b font-medium text-[#9E217B] \${theme.tableBorder}\`}>{s.active_lead_id ? \`\${s.active_lead_name || 'Lead'} (\${s.active_lead_id})\` : '-'}</td>
                        <td className={\`px-3 py-2.5 border-b \${theme.textMuted} \${theme.tableBorder}\`}>{s.current_action || '-'}</td>
                        <td className={\`px-3 py-2.5 border-b \${theme.textMuted} \${theme.tableBorder}\`}>{new Date(s.session_start).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}</td>
                        <td className={\`px-3 py-2.5 border-b \${theme.textMuted} \${theme.tableBorder}\`}>{new Date(s.session_start).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
                        <td className={\`px-3 py-2.5 border-b font-bold \${s.session_is_active ? 'text-green-500' : theme.textMuted} \${theme.tableBorder}\`}>
                          {s.session_is_active ? "Active Session" : (s.session_end ? new Date(s.session_end).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : "N/A")}
                        </td>
                        <td className={\`px-3 py-2.5 border-b font-mono \${s.status === 'OFFLINE' ? theme.textFaint : theme.textMuted} \${theme.tableBorder}\`}>
                          {s.status === 'OFFLINE' ? "Frozen" : getLiveTimer(s.session_start, s.session_end, s.session_is_active)}
                        </td>
                        <td className={\`px-3 py-2.5 border-b font-mono font-bold \${theme.text} \${theme.tableBorder}\`}>
                          {getWorkingHours(s.session_start, s.session_end, s.session_is_active)}
                        </td>
                        <td className={\`px-3 py-2.5 border-b \${theme.tableBorder}\`}>
                          {s.idle_duration_seconds > 1800 ? (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-red-500/10 text-red-500 border border-red-500/20">⚠ Long Idle</span>
                          ) : <span className={theme.textFaint}>-</span>}
                        </td>
                      </tr>
                      {expandedRows[s.user_id] && (
                        <tr>
                          <td colSpan={11} className={\`p-4 border-b \${theme.tableBorder} bg-black/5 dark:bg-white/5\`}>
                            <div className="mb-2 flex items-center gap-2">
                              <span className={\`text-xs font-black uppercase \${theme.text}\`}>▼ Session History</span>
                              <span className={\`text-[10px] \${theme.textMuted}\`}>Today</span>
                            </div>
                            {historyCache[s.user_id] ? (
                              <div className="space-y-3 pl-4 border-l-2 border-[#9E217B]/20">
                                {historyCache[s.user_id].map((h: any, hIdx: number) => (
                                  <div key={hIdx} className="text-[11px]">
                                    <p className={\`font-bold \${theme.text}\`}>• {new Date(h.session_start).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                                    <div className="grid grid-cols-4 gap-4 mt-1 ml-3">
                                      <div><span className={theme.textMuted}>Login:</span> <span className={theme.text}>{new Date(h.session_start).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span></div>
                                      <div><span className={theme.textMuted}>Logout:</span> <span className={\`font-bold \${h.is_active ? 'text-green-500' : theme.text}\`}>{h.is_active ? "Active Session" : (h.session_end ? new Date(h.session_end).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : "N/A")}</span></div>
                                      <div><span className={theme.textMuted}>Duration:</span> <span className={\`font-mono \${theme.text}\`}>{getWorkingHours(h.session_start, h.session_end, h.is_active)}</span></div>
                                      <div><span className={theme.textMuted}>Device:</span> <span className={theme.text}>{h.device_info || '-'}</span></div>
                                      <div className="col-span-4"><span className={theme.textMuted}>IP:</span> <span className={theme.text}>{h.ip_address || '-'}</span></div>
                                    </div>
                                  </div>
                                ))}
                                {historyCache[s.user_id].length === 0 && <p className={theme.textMuted}>No sessions found.</p>}
                              </div>
                            ) : (
                              <p className={\`text-xs \${theme.textMuted}\`}>Loading sessions...</p>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))`;

content = content.replace(tbodyRegex, newTbody);

fs.writeFileSync(filePath, content, 'utf8');
console.log("Successfully rewrote LiveActivityView.tsx grid logic!");
