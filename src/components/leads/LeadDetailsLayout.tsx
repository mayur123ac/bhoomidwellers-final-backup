"use client";

import type { LeadDetailsTheme } from "./types";

// ---------------------------------------------------------------------------
// LeadDetailsLayout — shared container for every panel's Lead Details view.
//
// Owns: responsive structure, gap, padding, entrance animation.
// Does NOT own: business logic, permissions, data fetching.
//
// Height policy:  content-driven — no forced viewport height.
// ---------------------------------------------------------------------------

interface Props extends LeadDetailsTheme {
  children: React.ReactNode;
  /** Optional className additions (animate-fadeIn, etc.) */
  className?: string;
}

export default function LeadDetailsLayout({ children, className }: Props) {
  return (
    <div className={`ld-layout w-full flex flex-col gap-2 pb-1 ${className ?? ""}`}>
      <style>{`
        @keyframes ld-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
        .ld-layout>*{animation:ld-in 400ms cubic-bezier(.22,1,.36,1) backwards}
        .ld-layout>*:nth-child(1){animation-delay:0ms}
        .ld-layout>*:nth-child(2){animation-delay:70ms}
        .ld-layout>*:nth-child(3){animation-delay:140ms}
        .ld-layout>*:nth-child(4){animation-delay:210ms}
        .ld-layout>*:nth-child(5){animation-delay:280ms}
        .ld-layout>*:nth-child(6){animation-delay:350ms}
        @media (prefers-reduced-motion:reduce){.ld-layout>*{animation:none}}
      `}</style>
      {children}
    </div>
  );
}