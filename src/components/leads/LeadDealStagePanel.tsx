"use client";

import DealStageTimeline from "@/components/DealStageTimeline";
import type { LeadDetailsTheme } from "./types";

interface Props extends LeadDetailsTheme {
  leadId: number;
  userRole?: string;
  refreshKey?: number;
}

export default function LeadDealStagePanel({ leadId, isDark, theme, userRole, refreshKey }: Props) {
  return (
    <div className="flex flex-col min-h-full">
      <style>{`
        @keyframes dsp-in{from{opacity:0;transform:translateY(12px) scale(.985)}to{opacity:1;transform:none}}
        .dsp-card{
          animation:dsp-in 450ms cubic-bezier(.22,1,.36,1) backwards;
          transition:box-shadow .3s ease,border-color .3s ease;
        }
        .dsp-card:hover{box-shadow:0 8px 24px rgba(158,33,123,.12);border-color:rgba(158,33,123,.35)}
        @media (prefers-reduced-motion:reduce){.dsp-card{animation:none;transition:none}}
      `}</style>
      <div className={`dsp-card flex-1 rounded-xl p-3 sm:p-4 border ${theme.chatPanel}`} style={theme.chatPanelGl}>
        <DealStageTimeline leadId={leadId} isDark={isDark} theme={theme} userRole={userRole} refreshKey={refreshKey} />
      </div>
    </div>
  );
}