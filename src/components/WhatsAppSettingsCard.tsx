"use client";
// WhatsAppSettingsCard.tsx — the WhatsApp number field on the Settings tab.
//
// Extracted from the Receptionist dashboard so the Sourcing Manager panel's
// Settings tab uses the same component rather than a second copy of the same
// fetch + optimistic-update logic.
import React, { useState } from "react";
import { FaWhatsapp } from "react-icons/fa";

interface Props {
  user: any;
  setUser: any;
  isDark: boolean;
  t: any;
}

export default function WhatsAppSettingsCard({ user, setUser, isDark, t }: Props) {
  const [input, setInput] = useState(user.whatsapp_number || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    if (!input.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/users/update-whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: user.name, whatsapp_number: input.trim() }),
      });
      const json = await res.json();
      if (json.success) {
        setUser((prev: any) => ({ ...prev, whatsapp_number: input.trim() }));
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      }
    } catch { }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <p className={`text-xs ${t.textFaint}`}>
        This number is used when logging WhatsApp messages to the CRM timeline.
        Include country code without the <code>+</code> sign.
      </p>
      <div className="flex gap-3 items-center">
        <div className="flex-1">
          <label className={`block text-xs mb-1.5 font-medium ${t.textFaint}`}>
            WhatsApp Number (with country code)
          </label>
          <input
            type="tel"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="e.g. 919876543210"
            className={`w-full rounded-lg p-3 text-sm outline-none transition-colors border ${isDark
              ? "bg-[#14141B] border-[#2A2A35] text-white focus:border-[#9E217B]"
              : "bg-white border-[#9CA3AF] text-[#1A1A1A] focus:border-[#00AEEF]"
              }`}
          />
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !input.trim()}
          className={`mt-5 px-5 py-3 rounded-lg font-bold text-sm transition-all ${saved
            ? "bg-green-600 text-white"
            : saving || !input.trim()
              ? "opacity-50 cursor-not-allowed bg-gray-400 text-white"
              : (isDark
                ? "bg-[#9E217B] hover:bg-[#b8268f] text-white"
                : "bg-[#00AEEF] hover:bg-[#0099d4] text-white")
            }`}
        >
          {saved ? "✓ Saved" : saving ? "Saving..." : "Save"}
        </button>
      </div>
      {user.whatsapp_number && (
        <p className={`text-xs flex items-center gap-1.5 ${isDark ? "text-green-400" : "text-green-600"}`}>
          <FaWhatsapp /> Active: +{user.whatsapp_number}
        </p>
      )}
    </div>
  );
}
