"use client";

import { useState } from "react";
import { LogOut, X } from "lucide-react";

type LogoutConfirmDialogProps = {
  open: boolean;
  isDark?: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export default function LogoutConfirmDialog({
  open,
  isDark = false,
  onClose,
  onConfirm,
}: LogoutConfirmDialogProps) {
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  if (!open) return null;

  const handleConfirm = () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    onConfirm();
  };

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/75 p-4 sm:p-6 animate-fadeIn"
      style={{ backdropFilter: "blur(8px)" }}
      onClick={(e) => { if (e.target === e.currentTarget && !isLoggingOut) onClose(); }}
    >
      <div
        className={`w-full mt-10 max-w-sm overflow-hidden rounded-xl border shadow-2xl ${isDark ? "border-[#2a2a2a] bg-[#171717] text-white" : "border-gray-200 bg-white text-[#1A1A1A]"
          }`}
      >
        {/* Header */}
        <div
          className={`flex items-start justify-between gap-4 border-b p-5 ${isDark ? "border-[#2a2a2a] bg-[#1f1f1f]" : "border-gray-100 bg-gray-50"
            }`}
        >
          <div className="flex gap-3">
            <div className={`mt-0.5 rounded-lg p-2 ${isDark ? "bg-white/5 text-gray-300" : "bg-gray-100 text-gray-600"}`}>
              <LogOut className="h-5 w-5" />
            </div>
            <div>
              <h2 className={`text-base font-black ${isDark ? "text-white" : "text-[#1A1A1A]"}`}>
                Are you sure you want to exit?
              </h2>
              <p className={`mt-1 text-xs font-medium ${isDark ? "text-gray-400" : "text-gray-500"}`}>
                You&apos;ll be logged out of your account.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isLoggingOut}
            className={`rounded-lg p-2 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${isDark ? "text-gray-400 hover:bg-white/5 hover:text-white" : "text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              }`}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Footer */}
        <div className={`flex flex-col-reverse gap-3 p-5 sm:flex-row sm:justify-end ${isDark ? "bg-[#151515]" : "bg-white"}`}>
          <button
            type="button"
            onClick={onClose}
            disabled={isLoggingOut}
            className={`rounded-lg px-4 py-2.5 text-sm font-bold transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${isDark ? "text-gray-300 hover:bg-white/5 hover:text-white" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              }`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isLoggingOut}
            className={`inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-black text-white transition-colors disabled:cursor-not-allowed cursor-pointer  disabled:opacity-70 ${isDark ? "bg-red-600 hover:bg-red-500" : "bg-red-600 hover:bg-red-500"
              }`}
          >
            <LogOut className="h-4 w-4" />
            {isLoggingOut ? "Logging out..." : "Yes, Log Out"}
          </button>
        </div>
      </div>
    </div>
  );
}
