"use client";

interface OnCallBadgeProps {
  leadName: string;
  onClick: () => void; // re-opens the modal
}

export default function OnCallBadge({ leadName, onClick }: OnCallBadgeProps) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/15 hover:bg-green-500/25
                 border border-green-500/40 transition-all duration-200 group"
    >
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400" />
      </span>
      <span className="text-xs font-semibold text-green-400 tracking-wide uppercase">On Call</span>
      <span className="text-xs text-white/40 group-hover:text-white/70 transition-colors ml-1">
        · {leadName}
      </span>
    </button>
  );
}