"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Device, Call } from "@twilio/voice-sdk";

// ─── Types ───────────────────────────────────────────────────────────────────
type CallState = "select" | "active" | "ended";

interface CallModalProps {
  leadName: string;
  phone: string;
  altPhone?: string;
  isVisible: boolean;
  onHide: () => void;   // minimise → show ON CALL badge
  onClose: () => void;  // fully close
}

// ─── CSS Animations (injected once) ──────────────────────────────────────────
const STYLE = `
@keyframes ripple {
  0%   { transform: scale(1);   opacity: .6; }
  100% { transform: scale(2.2); opacity: 0;  }
}
@keyframes wave {
  0%,100% { transform: scaleY(1);   }
  50%      { transform: scaleY(1.8);}
}
.ripple-ring {
  animation: ripple 1.4s ease-out infinite;
}
.ripple-ring-2 {
  animation: ripple 1.4s ease-out infinite .5s;
}
.wave-bar { animation: wave .8s ease-in-out infinite; }
.wave-bar:nth-child(2) { animation-delay:.1s; }
.wave-bar:nth-child(3) { animation-delay:.2s; }
.wave-bar:nth-child(4) { animation-delay:.3s; }
.wave-bar:nth-child(5) { animation-delay:.4s; }
`;

// ─── Sub-components ───────────────────────────────────────────────────────────

function WaveForm() {
  return (
    <div className="flex items-center gap-[3px] h-6">
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} className="wave-bar w-[3px] h-3 rounded-full bg-teal-400 opacity-80" />
      ))}
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .map(w => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="relative flex items-center justify-center">
      <div className="ripple-ring absolute w-20 h-20 rounded-full bg-teal-400/20" />
      <div className="ripple-ring-2 absolute w-20 h-20 rounded-full bg-teal-400/10" />
      <div className="relative z-10 w-16 h-16 rounded-full bg-gradient-to-br from-teal-400 to-cyan-600 flex items-center justify-center text-white text-xl font-bold shadow-lg">
        {initials}
      </div>
    </div>
  );
}

function CtrlBtn({
  icon, label, active, disabled, danger, onClick,
}: {
  icon: string;
  label: string;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-center gap-1 group disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <div
        className={`w-12 h-12 rounded-full flex items-center justify-center text-xl transition-all duration-200
          ${danger
            ? "bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/40 text-white"
            : active
            ? "bg-teal-500/20 text-teal-400 ring-1 ring-teal-400"
            : "bg-white/10 hover:bg-white/20 text-white/80"
          }`}
      >
        {icon}
      </div>
      <span className="text-[10px] text-white/50 group-hover:text-white/80 transition-colors">
        {label}
      </span>
    </button>
  );
}

// ─── Normalize Indian phone numbers ──────────────────────────────────────────
function normalizePhone(num: string): string {
  let n = num.replace(/\s+/g, "").replace(/^0+/, "");
  if (!n.startsWith("+")) {
    n = "+91" + n.replace(/^91/, "");
  }
  return n;
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function CallModal({
  leadName,
  phone,
  altPhone,
  isVisible,
  onHide,
  onClose,
}: CallModalProps) {
  const [state, setState]       = useState<CallState>("select");
  const [muted, setMuted]       = useState(false);
  const [speaker, setSpeaker]   = useState(false);
  const [seconds, setSeconds]   = useState(0);
  const [selectedPhone, setSelectedPhone] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Twilio state
  const [device, setDevice] = useState<Device | null>(null);
  const [activeCall, setActiveCall] = useState<Call | null>(null);
  const [deviceError, setDeviceError] = useState("");
  const [isInitializing, setIsInitializing] = useState(false);

  // Inject keyframes once
  useEffect(() => {
    if (document.getElementById("call-modal-styles")) return;
    const tag = document.createElement("style");
    tag.id = "call-modal-styles";
    tag.textContent = STYLE;
    document.head.appendChild(tag);
  }, []);

  // Fetch token & Setup Twilio Device
  useEffect(() => {
    if (!isVisible) return;
    
    let isMounted = true;
    let newDevice: Device | null = null;
    
    const initTwilio = async () => {
      setIsInitializing(true);
      setDeviceError("");
      try {
        const res = await fetch("/api/token");
        const data = await res.json();
        if (!data.token) throw new Error(data.error || "Failed to fetch token");
        
        if (!isMounted) return;
        newDevice = new Device(data.token);
        
        newDevice.on("error", (err) => {
          console.error("Twilio Device Error:", err);
          if (isMounted) setDeviceError(err.message);
        });

        if (isMounted) setDevice(newDevice);
      } catch (err: any) {
        console.error("Token fetch error:", err);
        if (isMounted) setDeviceError(err.message);
      } finally {
        if (isMounted) setIsInitializing(false);
      }
    };
    
    initTwilio();
    
    return () => {
      isMounted = false;
      if (newDevice) {
        newDevice.destroy();
      }
    };
  }, [isVisible]);

  // Handle Mute
  useEffect(() => {
    if (activeCall) {
      activeCall.mute(muted);
    }
  }, [muted, activeCall]);

  // ── Timer ──
  const startTimer = useCallback(() => {
    setSeconds(0);
    timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  // ── Call handler — connects via Twilio WebRTC ──
  const handleSelectNumber = async (num: string) => {
    const normalized = normalizePhone(num);
    setSelectedPhone(normalized);
    
    if (!device) {
       alert(deviceError || "Twilio is still connecting or failed to connect.");
       return;
    }
    
    setState("active");
    startTimer();
    
    try {
      const call = await device.connect({ params: { To: normalized } });
      setActiveCall(call);
      
      call.on("disconnect", () => {
        stopTimer();
        setState("ended");
        setActiveCall(null);
      });

      call.on("error", (error: any) => {
        console.error("Twilio Call Error:", error);
        alert("Call error: " + error.message);
        stopTimer();
        setState("ended");
        setActiveCall(null);
      });

    } catch (err: any) {
      console.error("Call connection error:", err);
      alert("Could not start call: " + err.message);
      stopTimer();
      setState("ended");
    }
  };

  // ── End call ──
  const handleEndCall = () => {
    if (activeCall) {
      activeCall.disconnect();
    }
    stopTimer();
    setState("ended");
    setActiveCall(null);
  };

  // ── Full close & reset ──
  const handleClose = () => {
    if (activeCall) {
      activeCall.disconnect();
    }
    stopTimer();
    setState("select");
    setSeconds(0);
    setMuted(false);
    setSpeaker(false);
    setSelectedPhone("");
    setActiveCall(null);
    onClose();
  };

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className="relative w-[340px] rounded-3xl overflow-hidden shadow-2xl"
        style={{
          background: "linear-gradient(145deg, #0f1923 0%, #111c28 60%, #0d1f2d 100%)",
        }}
      >
        {/* ── Header bar ── */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
            <span className="text-[11px] font-medium text-teal-400 tracking-widest uppercase">
              {state === "select"
                ? "Ready"
                : state === "active"
                ? "On Call"
                : "Call Ended"}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onHide}
              className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 text-white/60 text-xs flex items-center justify-center transition-all"
              title="Minimise"
            >
              —
            </button>
            <button
              onClick={handleClose}
              className="w-7 h-7 rounded-full bg-white/10 hover:bg-red-500/60 text-white/60 text-xs flex items-center justify-center transition-all"
              title="Close"
            >
              ✕
            </button>
          </div>
        </div>

        {/* ── Lead info ── */}
        <div className="flex flex-col items-center pt-4 pb-6 px-6">
          <Avatar name={leadName} />
          <h2 className="mt-4 text-lg font-bold text-white tracking-tight">{leadName}</h2>
          <p className="text-sm text-white/50 mt-0.5">{selectedPhone || phone}</p>

          {/* ── STATE: select ── */}
          {state === "select" && (
            <div className="w-full mt-6 space-y-3">
              <p className="text-center text-xs text-white/40 uppercase tracking-widest mb-1">
                Choose number to call
              </p>

              <button
                onClick={() => handleSelectNumber(phone)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-white/8 hover:bg-teal-500/20 border border-white/10 hover:border-teal-400/50 transition-all group"
              >
                <span className="text-lg">📞</span>
                <div className="text-left">
                  <p className="text-[10px] text-white/40 uppercase tracking-wider">Primary</p>
                  <p className="text-sm font-medium text-white group-hover:text-teal-300 transition-colors">
                    {phone}
                  </p>
                </div>
              </button>

              {altPhone && (
                <button
                  onClick={() => handleSelectNumber(altPhone)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-white/8 hover:bg-teal-500/20 border border-white/10 hover:border-teal-400/50 transition-all group"
                >
                  <span className="text-lg">📱</span>
                  <div className="text-left">
                    <p className="text-[10px] text-white/40 uppercase tracking-wider">Alt Number</p>
                    <p className="text-sm font-medium text-white group-hover:text-teal-300 transition-colors">
                      {altPhone}
                    </p>
                  </div>
                </button>
              )}

              <button
                onClick={handleClose}
                className="w-full py-2.5 rounded-2xl text-white/40 text-sm hover:text-white/70 transition-colors"
              >
                Cancel
              </button>
            </div>
          )}

          {/* ── STATE: active ── */}
          {state === "active" && (
            <div className="w-full mt-5 flex flex-col items-center gap-5">
              <WaveForm />
              <div className="font-mono text-3xl font-light text-white tracking-widest">
                {fmt(seconds)}
              </div>
              <div className="flex justify-center gap-8 mt-1">
                <CtrlBtn
                  icon={muted ? "🔇" : "🎙️"}
                  label="Mute"
                  active={muted}
                  onClick={() => setMuted(m => !m)}
                />
                <CtrlBtn
                  icon="🔊"
                  label="Speaker"
                  active={speaker}
                  onClick={() => setSpeaker(s => !s)}
                />
                <CtrlBtn icon="✕" label="End" danger onClick={handleEndCall} />
              </div>
            </div>
          )}

          {/* ── STATE: ended ── */}
          {state === "ended" && (
            <div className="w-full mt-5 flex flex-col items-center gap-4">
              <p className="text-red-400 font-medium text-sm">Call Ended</p>
              <p className="font-mono text-2xl text-white/60">{fmt(seconds)}</p>
              <div className="w-full space-y-2 mt-2">
                <button className="w-full py-2.5 rounded-2xl bg-teal-500/20 hover:bg-teal-500/30 text-teal-300 text-sm font-medium border border-teal-500/30 transition-all">
                  📝 Add Follow-up Note
                </button>
                <div className="flex gap-2">
                  <button className="flex-1 py-2.5 rounded-2xl bg-green-500/20 hover:bg-green-500/30 text-green-300 text-xs font-medium border border-green-500/30 transition-all">
                    ✅ Interested
                  </button>
                  <button className="flex-1 py-2.5 rounded-2xl bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-medium border border-red-500/20 transition-all">
                    ❌ Not Interested
                  </button>
                </div>
                <button
                  onClick={handleClose}
                  className="w-full py-2 text-white/30 text-xs hover:text-white/60 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}