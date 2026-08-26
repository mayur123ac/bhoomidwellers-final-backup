// crmTheme.ts — shared light/dark token set for the role panels.
//
// Extracted verbatim from the Receptionist dashboard, which was the only place
// it lived. The Sourcing Manager panel is a structural sibling of that panel and
// needs the identical tokens; copying ~200 lines of Tailwind strings into a
// second file would guarantee the two drift apart on the first theme tweak.
export function buildTheme(isDark: boolean) {
  return {
    pageWrap: isDark ? "bg-[#0A0A0F] text-white" : "text-[#1A1A1A]",
    mainBg: isDark ? "bg-[#0A0A0F]" : "bg-transparent",
    sidebar: isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-[#1A1A1A] border-[#2A2A2A]",
    header: isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-white border-none",
    headerGlass: isDark ? {} : { boxShadow: "0 1px 0 #9CA3AF, 0 4px 16px rgba(0,174,239,0.06)" },

    // ── Cards (No intense glow in light mode, border changes to Magenta on hover) ──
    card: isDark
      ? "bg-[#121218] border-[#2A2A35] transition-all duration-300 hover:border-[#d4006e]/50 hover:shadow-2xl hover:shadow-[#d4006e]/20"
      : "bg-gradient-to-r from-[#f1f5ff] via-[#eef2ff] to-[#f5f3ff] border-[#9CA3AF] transition-all duration-300 hover:border-[#9E217B] hover:shadow-xl",
    cardGlass: isDark ? {} : { boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,174,239,0.07)" },

    statusLost: isDark ? "text-red-300 border-red-500/30 bg-red-950/30" : "text-red-700 border-red-300 bg-red-50",
    cardLost: isDark
      ? "bg-[#171717] border border-red-900/25 opacity-70 grayscale saturate-50 transition-all duration-300 hover:opacity-90 hover:border-red-500/30"
      : "bg-slate-100 border border-red-200 opacity-75 grayscale saturate-50 transition-all duration-300 hover:opacity-90 hover:border-red-300",
    rowLost: isDark
      ? "bg-[#151515]/80 text-gray-500 opacity-75 grayscale"
      : "bg-slate-100/80 text-slate-500 opacity-80 grayscale",
    tableWrap: isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-white border-[#9CA3AF]",
    tableGlass: isDark ? {} : { boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(158,33,123,0.06), 0 16px 36px rgba(0,0,0,0.09)" },
    tableHead: isDark ? "bg-[#1A1A28]" : "bg-[#F1F5F9]",
    tableRow: isDark ? "hover:bg-[#1C1C2A]" : "hover:bg-[#F8FAFC]",
    tableDivide: isDark ? "divide-[#1E1E2A]" : "divide-[#9CA3AF]",
    tableBorder: isDark ? "border-[#2A2A35]" : "border-[#9CA3AF]",
    inputBg: isDark ? "bg-[#14141B] border-[#2A2A35]" : "bg-white border-[#9CA3AF]",
    modalCard: isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-white border-[#9CA3AF]",
    modalGlass: isDark ? {} : { boxShadow: "0 2px 4px rgba(0,0,0,0.04), 0 8px 24px rgba(0,174,239,0.08), 0 32px 72px rgba(0,0,0,0.16)" },
    modalInner: isDark ? "bg-[#0A0A0F]" : "bg-[#F8FAFC]",
    modalHeader: isDark ? "bg-[#1A1A28]" : "bg-[#F1F5F9]",
    modalBlock: isDark ? "bg-[#14141B] border-[#1E1E2A]" : "bg-white border-[#9CA3AF]",
    modalBlockGl: isDark ? {} : { boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 3px 8px rgba(0,174,239,0.05)" },
    modalInput: isDark ? "bg-[#14141B] border-[#2A2A35]" : "bg-white border-[#9CA3AF]",
    settingsBg: isDark ? "bg-[#14141B] border-[#2A2A35]" : "bg-[#F8FAFC] border-[#9CA3AF]",
    settingsBgGl: isDark ? {} : { boxShadow: "inset 0 1px 3px rgba(0,0,0,0.04)" },
    innerBlock: isDark ? "bg-[#121212] border-[#333]" : "bg-white border-[#D1D5DB]",
    inputInner: isDark ? "bg-[#14141B] border-[#2A2A35]" : "bg-white border-[#9CA3AF]",
    inputFocus: isDark ? "focus:border-[#9E217B]" : "focus:border-[#00AEEF]",
    dropdown: isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-white border-[#9CA3AF]",
    dropdownGlass: isDark ? {} : { boxShadow: "0 2px 4px rgba(0,0,0,0.04), 0 8px 20px rgba(0,174,239,0.08), 0 20px 40px rgba(0,0,0,0.10)" },

    // ── Chat (Gray background, dark border, black text in light mode) ──
    chatArea: isDark ? "bg-[#0A0A0F]" : "bg-[#F1F5F9]",
    chatBubbleAi: isDark ? "bg-[#1A1A28] text-white border border-[#2A2A35]" : "bg-[#F3F4F6] border border-[#CBD5E1] text-gray-900 font-medium shadow-sm",
    chatInput: isDark ? "bg-[#14141B] border-[#2A2A35]" : "bg-[#F3F4F6] border border-[#64748B] hover:border-[#475569] focus-within:bg-white focus-within:border-[#475569] shadow-inner",
    chatPanel: isDark ? "bg-[#121218] border border-[#2A2A35]" : "bg-white border border-gray-200",
    chatPanelGl: isDark ? {} : { boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(158,33,123,0.06), 0 16px 36px rgba(0,0,0,0.09)" },

    fupDefault: isDark ? "bg-[#2a2135] border border-[#4c1d95]" : "bg-indigo-50 border border-indigo-200",
    fupLoan: isDark ? "bg-blue-900/20 border border-blue-600/40" : "bg-blue-50 border border-blue-200",
    fupSalesform: isDark ? "bg-[#222] border border-[#444]" : "bg-white border border-[#D1D5DB]",
    fupClosing: isDark ? "bg-yellow-900/20 border border-yellow-600/40" : "bg-amber-50 border border-amber-300",
    fupTransfer: isDark ? "bg-purple-900/20 border border-purple-600/40" : "bg-purple-50 border border-purple-300",

    text: isDark ? "text-white" : "text-[#1A1A1A]",
    textMuted: isDark ? "text-[#888899]" : "text-[#334155]",
    textFaint: isDark ? "text-[#55556A]" : "text-[#475569]",
    textHeader: isDark ? "text-xs text-[#B0B0C4]" : "text-xs font-bold text-[#334155]",

    navActive: isDark ? "bg-[#1A1A28] text-white" : "bg-[#2A2A2A] text-[#9E217B]",
    navInactive: isDark ? "text-[#888899] hover:bg-[#1A1A28] hover:text-white" : "text-[#9CA3AF] hover:bg-[#2A2A2A] hover:text-white",
    navIndicator: isDark ? "bg-[#9E217B] shadow-[0_0_10px_2px_rgba(158,33,123,0.5)]" : "bg-[#9E217B] shadow-[0_0_8px_rgba(158,33,123,0.4)]",
    toggleWrap: isDark ? "bg-[#1C1C2A] border-[#2A2A38] text-yellow-300" : "bg-[#F1F5F9] border-[#9CA3AF] text-[#1A1A1A]",

    accentText: isDark ? "text-[#d4006e]" : "text-[#00AEEF]",
    accentBg: isDark ? "bg-[#9E217B]/10 text-[#d4006e] border border-[#9E217B]/30" : "bg-[#00AEEF]/10 text-[#00AEEF] border border-[#00AEEF]/30",
    sectionTitle: isDark ? "text-[#d4006e]" : "text-[#9E217B]",
    sectionBorder: isDark ? "border-[#9E217B]/20" : "border-[#9E217B]/25",

    // ── Buttons (Hover Scale & Shadow Pop-out) ──
    btnPrimary: isDark ? "bg-[#9E217B] hover:bg-[#7a1960] text-white shadow-md transition-colors duration-200" : "bg-[#00AEEF] hover:bg-[#0088bb] text-white shadow-sm transition-colors duration-200",
    btnSecondary: isDark ? "bg-blue-700 hover:bg-blue-800 text-white shadow-md transition-colors duration-200" : "bg-[#9E217B] hover:bg-[#7a1960] text-white shadow-sm transition-colors duration-200",
    btnWarning: isDark ? "bg-yellow-600 hover:bg-yellow-700 text-white shadow-md transition-colors duration-200" : "bg-amber-500 hover:bg-amber-600 text-white shadow-sm transition-colors duration-200",
    btnDanger: isDark ? "bg-red-500/10 text-red-500 hover:bg-red-600/20 border border-red-500/30 transition-colors duration-200" : "bg-[#9E217B]/10 text-[#9E217B] hover:bg-[#9E217B]/20 border border-[#9E217B]/30 transition-colors duration-200",
    btnTransfer: isDark ? "bg-purple-600 hover:bg-purple-700 text-white shadow-md transition-colors duration-200" : "bg-purple-600 hover:bg-purple-700 text-white shadow-sm transition-colors duration-200",
    btnClosingBadge: isDark ? "bg-yellow-900/20 border border-yellow-500/40 text-yellow-400" : "bg-amber-50 border border-amber-400/60 text-amber-600",
    scroll: isDark ? "custom-scrollbar" : "custom-scrollbar",
    logoBg: isDark ? "bg-[#9E217B] shadow-lg shadow-[#9E217B]/30" : "bg-[#9E217B] shadow-lg shadow-[#9E217B]/30",

    // ── Stat glow orbs (used by AttendanceView) ──
    statGlow1: isDark ? "bg-[#d4006e]/10" : "bg-[#00AEEF]/10",
    statGlow2: isDark ? "bg-blue-600/10" : "bg-[#9E217B]/10",
    statGlow3: isDark ? "bg-blue-600/10" : "bg-indigo-400/10",
    statGlow4: isDark ? "bg-yellow-500/10" : "bg-amber-400/10",
    statGlow5: isDark ? "bg-green-600/10" : "bg-emerald-400/10",
    selectSmall: isDark ? "bg-[#1A1A28] border-[#2A2A35] text-white" : "bg-white border-[#D1D5DB] text-[#6B7280]",
    chartColors: isDark
      ? ["#d946ef", "#8b5cf6", "#3b82f6", "#0ea5e9", "#6b7280", "#f59e0b", "#10b981"]
      : ["#00AEEF", "#9E217B", "#0077b6", "#d4006e", "#9CA3AF", "#f59e0b", "#10b981"],
    tooltipBg: isDark ? "#1a1a1a" : "rgba(255,255,255,0.98)",
    tooltipColor: isDark ? "#fff" : "#1A1A1A",
    tooltipBorder: isDark ? "1px solid rgba(158,33,123,0.3)" : "1px solid #E5E7EB",
    legendColor: isDark ? "#9ca3af" : "#6B7280",
    exportBtn: isDark ? "border-[#2A2A35] hover:border-[#9E217B] hover:text-[#d4006e] text-[#888899]" : "border-[#9CA3AF] hover:border-[#9E217B] hover:text-[#9E217B] text-[#6B7280]",
    statusAssigned: isDark ? "text-purple-400 border-purple-500/30 bg-purple-500/10" : "text-purple-700 border-purple-300 bg-purple-50",
    statusNew: isDark ? "text-blue-400 border-blue-500/30 bg-blue-500/10" : "text-blue-700 border-blue-300 bg-blue-50",
    statusContacted: isDark ? "text-cyan-400 border-cyan-500/30 bg-cyan-500/10" : "text-cyan-700 border-cyan-300 bg-cyan-50",
    statusInterested: isDark ? "text-green-400 border-green-500/30 bg-green-500/10" : "text-green-700 border-green-300 bg-green-50",
    statusVisit: isDark ? "text-orange-400 border-orange-500/30 bg-orange-500/10" : "text-orange-500 border-orange-400/40 bg-orange-50",
    statusClosing: isDark ? "text-yellow-400 border-yellow-500/40 bg-yellow-500/10" : "text-amber-600 border-amber-400/50 bg-amber-50",
    statusCompleted: isDark ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" : "text-emerald-700 border-emerald-300 bg-emerald-50",
    statusNGD: "bg-[rgba(251,146,60,0.12)] text-[#F97316] border border-[rgba(249,115,22,0.4)]",
    cardNGD: "bg-[rgba(249,115,22,0.06)] border border-[rgba(249,115,22,0.35)] hover:border-[#F97316] shadow-[0_4px_12px_rgba(249,115,22,0.12)] transition-all duration-300 flex flex-col h-full",
    rowNGD: "bg-[rgba(249,115,22,0.03)]",
  };
  const apple = {
    // Backgrounds
    modalBg: isDark ? '#1C1C1E' : '#FFFFFF',
    modalOverlay: 'rgba(0, 0, 0, 0.4)',
    cardBg: isDark ? '#2C2C2E' : '#F5F5F7',
    cardBgHover: isDark ? '#3A3A3C' : '#ECECEE',
    inputBg: isDark ? '#1C1C1E' : '#FFFFFF',
    inputBorder: isDark ? '#3A3A3C' : '#D2D2D7',
    inputBorderFocus: '#0071E3',
    inputBorderError: '#FF3B30',

    // Text
    textPrimary: isDark ? '#F5F5F7' : '#1D1D1F',
    textSecondary: isDark ? '#A1A1A6' : '#6E6E73',
    textTertiary: isDark ? '#636366' : '#86868B',
    textOnAccent: '#FFFFFF',

    // Accent
    accent: '#0071E3',          // Apple Blue
    accentHover: '#0077ED',
    accentLight: isDark ? 'rgba(0,113,227,0.15)' : 'rgba(0,113,227,0.08)',

    // Status
    success: '#34C759',
    successBg: isDark ? 'rgba(52,199,89,0.12)' : 'rgba(52,199,89,0.08)',
    warning: '#FF9F0A',
    warningBg: isDark ? 'rgba(255,159,10,0.12)' : 'rgba(255,159,10,0.08)',
    error: '#FF3B30',
    errorBg: isDark ? 'rgba(255,59,48,0.12)' : 'rgba(255,59,48,0.08)',
    info: '#5856D6',

    // Dividers
    separator: isDark ? '#38383A' : '#D2D2D7',
    separatorLight: isDark ? '#2C2C2E' : '#E8E8ED',
  };
}

export type CrmTheme = ReturnType<typeof buildTheme>;
