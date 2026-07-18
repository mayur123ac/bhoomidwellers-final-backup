"use client";

import { useState } from "react";

interface CallButtonProps {
  phoneNumber: string;       // E.164 format e.g. "+919876543210"
  label?: string;
}

export default function CallButton({ phoneNumber, label = "Call" }: CallButtonProps) {
  const [status, setStatus] = useState<"idle" | "calling" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const handleCall = async () => {
    setStatus("calling");
    setMessage("");

    try {
      const res = await fetch("/api/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: phoneNumber }),
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus("error");
        setMessage(data.error || "Call failed");
        return;
      }

      setStatus("success");
      setMessage(`Call initiated (SID: ${data.callSid})`);
    } catch {
      setStatus("error");
      setMessage("Network error. Please try again.");
    }
  };

  const buttonStyles: Record<string, string> = {
    idle: "bg-green-600 hover:bg-green-700 text-white",
    calling: "bg-yellow-500 text-white cursor-not-allowed opacity-75",
    success: "bg-blue-600 hover:bg-blue-700 text-white",
    error: "bg-red-600 hover:bg-red-700 text-white",
  };

  const buttonLabels: Record<string, string> = {
    idle: `📞 ${label}`,
    calling: "⏳ Calling...",
    success: "✅ Called",
    error: "❌ Retry",
  };

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={handleCall}
        disabled={status === "calling"}
        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${buttonStyles[status]}`}
      >
        {buttonLabels[status]}
      </button>
      {message && (
        <p className={`text-xs ${status === "error" ? "text-red-500" : "text-gray-500"}`}>
          {message}
        </p>
      )}
    </div>
  );
}