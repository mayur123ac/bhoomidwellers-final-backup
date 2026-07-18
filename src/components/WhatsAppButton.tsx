// components/WhatsAppButton.tsx
"use client";
import { useState } from "react";

import { emitActivity } from "@/hooks/useActivityTracker";

interface Props {
  lead: { id: number; name: string; phone: string };
  salesManager: { name: string; whatsapp_number: string };
}

export default function WhatsAppButton({ lead, salesManager }: Props) {
  const [message, setMessage] = useState(
    `Hi ${lead.name}, this is ${salesManager.name} from Bhoomi Dwellers. How can I help you today?`
  );
  const [showModal, setShowModal] = useState(false);
  const [sending, setSending] = useState(false);

  // Guard: no phone
  if (!lead.phone) {
    return (
      <button disabled className="bg-gray-300 text-gray-500 px-4 py-2 rounded cursor-not-allowed">
        No Phone
      </button>
    );
  }

  // Guard: no whatsapp number configured
  if (!salesManager.whatsapp_number) {
    return (
      <button
        disabled
        title="Configure your WhatsApp number in Profile Settings"
        className="bg-gray-300 text-gray-500 px-4 py-2 rounded cursor-not-allowed"
      >
        WhatsApp Not Configured
      </button>
    );
  }

  const handleSend = async () => {
    if (sending) return; // debounce
    setSending(true);

    emitActivity({
      type: "WHATSAPP_SENT",
      action: "Sent WhatsApp Message",
      leadId: lead.id,
      leadName: lead.name,
      module: "WhatsApp Modal"
    });

    // 1. Log to DB
    await fetch("/api/whatsapp-logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lead_id:           lead.id,
        sender_name:       salesManager.name,
        sender_number:     salesManager.whatsapp_number,
        recipient_number:  lead.phone,
        message_preview:   message,
      }),
    });

    // 2. Open WhatsApp click-to-chat
    const encoded = encodeURIComponent(message);
    const phone   = lead.phone.replace(/\D/g, ""); // strip non-digits
    window.open(`https://wa.me/${phone}?text=${encoded}`, "_blank");

    setShowModal(false);
    setSending(false);
  };

  return (
    <>
      {/* Button */}
      <button
        onClick={() => {
          setShowModal(true);
          emitActivity({
            type: "LEAD_OPENED",
            action: "Viewing WhatsApp",
            leadId: lead.id,
            leadName: lead.name,
            module: "WhatsApp Modal"
          });
        }}
        className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded flex items-center gap-2"
      >
        <WhatsAppIcon /> Send WhatsApp
      </button>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl w-[480px] overflow-hidden shadow-xl">
            
            {/* Header */}
            <div className="bg-green-50 p-4 border-b border-green-100">
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-lg font-semibold text-green-800 flex items-center gap-2">
                    <WhatsAppIcon /> Send WhatsApp
                  </h2>
                  <p className="text-sm text-gray-500 mt-1">
                    To: <strong>{lead.name}</strong> ({lead.phone})
                  </p>
                </div>
                <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
              </div>

              {/* Sender identity - clearly shown */}
              <div className="mt-3 bg-white border border-green-200 rounded-lg px-3 py-2 text-sm text-green-700">
                📱 Sending from: <strong>{salesManager.name}</strong> (+{salesManager.whatsapp_number})
              </div>
            </div>

            {/* Message */}
            <div className="p-4">
              <label className="text-sm font-medium text-green-700">
                Message (will be logged in CRM timeline)
              </label>
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                rows={5}
                className="mt-2 w-full border border-gray-200 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                placeholder="Type your message here..."
              />
            </div>

            {/* Footer */}
            <div className="px-4 pb-4 flex justify-end gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={sending || !message.trim()}
                className="bg-green-500 hover:bg-green-600 disabled:bg-green-300 text-white px-5 py-2 rounded-lg flex items-center gap-2"
              >
                {sending ? "Opening..." : "Send ✈"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  );
}