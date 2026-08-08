"use client";
// BolnaCallWidget.tsx — the Call button that sits next to a contact.
//
// Two ways to place a call, because Bolna offers two genuinely different things
// and the CRM wants both:
//
//   Phone call   POST /api/bolna/call. Bolna dials the lead's number from the
//                configured caller ID. Nobody's browser is involved; the user
//                clicks and walks away. This is the one that uses the configured
//                phone number.
//
//   Browser call The Web Call SDK connects THIS browser to the agent over
//                WebRTC. The user talks to the agent from their desk — useful
//                for rehearsing a script or checking how the agent sounds
//                before it is pointed at customers. There is no PSTN leg, so
//                the configured phone number is not involved at all.
//
// The browser option only renders when the account has it enabled, since Bolna's
// Web Call SDK is beta and per-account. A button that fails for everyone is
// worse than no button.

import React, { useCallback, useEffect, useState } from "react";
import {
  FaPhoneAlt,
  FaPhoneSlash,
  FaMicrophone,
  FaMicrophoneSlash,
  FaSpinner,
  FaExclamationTriangle,
  FaHeadset,
  FaChevronDown,
} from "react-icons/fa";
import { useBolnaWebCall, type CallState } from "@/lib/hooks/useBolnaWebCall";
import type { BolnaStatusResponse } from "@/types/bolna.types";

interface Props {
  /** walkin_enquiries.id. The server re-reads the phone number from this. */
  leadId?: number | null;
  /** caller_leads.id, for the tele-calling list. */
  callerLeadId?: number | null;
  leadName?: string | null;
  /** Display only — the server never dials what the client sends for a known lead. */
  phone?: string | null;
  /** Extra prompt variables for the agent, e.g. { project: "Bhoomi Heights" }. */
  userData?: Record<string, unknown>;
  compact?: boolean;
  onCallPlaced?: () => void;
}

interface CallRecord {
  id: number;
  status: string;
  channel: string;
  toNumber: string | null;
  durationSeconds: number | null;
  summary: string | null;
  transcript: string | null;
  recordingUrl: string | null;
  errorMessage: string | null;
  createdAt: string;
  initiatedByName: string | null;
}

const STATE_LABEL: Record<CallState, string> = {
  idle: "Ready",
  connecting: "Connecting…",
  ringing: "Ringing…",
  active: "Connected",
  ended: "Call ended",
};

export default function BolnaCallWidget({
  leadId = null,
  callerLeadId = null,
  leadName = null,
  phone = null,
  userData,
  compact = false,
  onCallPlaced,
}: Props) {
  /* Three independent flags from /api/bolna/status, deliberately not collapsed
     into one "ready" boolean — they gate different things:

       configured     credentials are stored and decryptable
       enabled        the BOLNA_ENABLED master switch
       webCallEnabled the browser-calling beta is on for this account

     The first two gate the whole widget. The third gates ONLY the "Talk to
     agent" section: outbound PSTN calling is a server-side dial through Bolna
     and has nothing to do with whether this browser can hold a WebRTC session,
     so letting webCallEnabled hide the outbound button would withhold the one
     capability that actually works today. */
  const [webCallEnabled, setWebCallEnabled] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [dialing, setDialing] = useState(false);
  const [dialError, setDialError] = useState<string | null>(null);
  const [dialMessage, setDialMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<CallRecord[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [webCallOpen, setWebCallOpen] = useState(false);

  const loadHistory = useCallback(async () => {
    if (leadId === null) return;
    try {
      const res = await fetch(`/api/bolna/call?leadId=${leadId}`, { cache: "no-store" });
      const json = await res.json();
      if (json.success) setHistory(json.calls || []);
    } catch {
      // History is supplementary; failing to load it must not disturb the button.
    }
  }, [leadId]);

  const webCall = useBolnaWebCall({
    leadId,
    toNumber: phone,
    userData: { ...(userData ?? {}), ...(leadName ? { name: leadName } : {}) },
    onEnded: () => {
      // The transcript arrives by webhook a few seconds after the call drops, so
      // an immediate refetch would show the row without one. This is a
      // best-effort nudge; the panel is re-openable.
      setTimeout(loadHistory, 4000);
    },
  });

  // The widget asks whether calling is available at all. It reads the public
  // half of the settings — /api/bolna/status returns no credentials, only
  // whether calls can be placed, so a non-admin user can render this.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/bolna/status", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<BolnaStatusResponse>) : null))
      .then((json) => {
        if (cancelled) return;
        setConfigured(Boolean(json?.configured));
        setEnabled(json?.enabled !== false);
        // The field is `webCallEnabled` — matching the route. Reading a name the
        // endpoint does not send (browserCallEnabled) would silently yield
        // undefined → false and hide browser calling forever.
        setWebCallEnabled(Boolean(json?.webCallEnabled));
      })
      .catch(() => {
        if (!cancelled) setConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const placePhoneCall = async () => {
    setDialing(true);
    setDialError(null);
    setDialMessage(null);
    try {
      const res = await fetch("/api/bolna/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, callerLeadId, userData }),
      });
      const json = await res.json();
      if (json.success) {
        setDialMessage(json.message || "Call placed.");
        onCallPlaced?.();
        // Bolna reports queued → initiated → ringing over the following seconds.
        setTimeout(loadHistory, 3000);
      } else {
        setDialError(json.message || "The call could not be placed.");
      }
    } catch {
      setDialError("Could not reach the server to place the call.");
    } finally {
      setDialing(false);
    }
  };

  // Nothing until the status check answers, to avoid a button that flashes in
  // and then vanishes.
  if (configured === null) return null;

  // The only two conditions that hide the whole widget. Note what is NOT here:
  // webCallEnabled. Outbound AI calling works without the browser-calling beta,
  // so it renders below regardless.
  //
  // Rendering nothing rather than a disabled button is deliberate — for the
  // sales staff who are 99% of viewers, an unconfigured integration is not
  // something they can act on, and a permanently dead Call button on every lead
  // trains people to ignore that corner of the screen. The trade-off is that an
  // ADMIN also sees nothing and cannot tell why; the answer for them is
  // Settings → Calling Integration, which states the status explicitly.
  if (!configured || !enabled) return null;

  const inCall = webCall.state === "connecting" || webCall.state === "ringing" || webCall.state === "active";

  return (
    <div className={compact ? "" : "bg-[#1a1a1a] border border-[#333] rounded-xl p-4"}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={placePhoneCall}
          disabled={dialing || inCall}
          title={phone ? `AI agent will call ${phone}` : "AI agent will call this lead"}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold bg-[#9E217B] hover:bg-[#b8268f] text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {dialing ? <FaSpinner className="animate-spin" /> : <FaPhoneAlt />}
          {dialing ? "Placing call…" : "Call with AI agent"}
        </button>

        {webCallEnabled && (
          <button
            onClick={() => setWebCallOpen((v) => !v)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold border border-[#333] text-gray-300 hover:text-white hover:border-[#555] transition-colors"
            title="Talk to the agent from this browser"
          >
            <FaHeadset /> Talk to agent
          </button>
        )}

        {leadId !== null && history.length > 0 && (
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-semibold text-gray-400 hover:text-white transition-colors"
          >
            {history.length} call{history.length === 1 ? "" : "s"}
            <FaChevronDown className={`text-[10px] transition-transform ${historyOpen ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>

      {dialError && <Alert tone="error">{dialError}</Alert>}
      {dialMessage && !dialError && <Alert tone="info">{dialMessage}</Alert>}

      {/* ── Browser call panel ── */}
      {webCallOpen && webCallEnabled && (
        <div className="mt-3 bg-[#151515] border border-[#2a2a2a] rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <StateDot state={webCall.state} />
              <span className="text-sm font-semibold">{STATE_LABEL[webCall.state]}</span>
            </div>
            {webCall.state === "active" && <VolumeMeter level={webCall.volume} />}
          </div>

          <p className="text-[11px] text-gray-500 mb-3">
            Connects your microphone straight to the AI agent so you can hear how it sounds. This does
            not call {leadName || "the lead"}.
          </p>

          <div className="flex items-center gap-2">
            {!inCall ? (
              <button
                // Must be the direct click handler: browsers only allow audio
                // playback that originates from a user gesture, and starting the
                // call from an effect or a promise callback trips
                // `autoplay_blocked`.
                onClick={webCall.start}
                disabled={webCall.starting}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold bg-green-600 hover:bg-green-500 text-white transition-colors disabled:opacity-50"
              >
                {webCall.starting ? <FaSpinner className="animate-spin" /> : <FaPhoneAlt />}
                {webCall.starting ? "Connecting…" : webCall.state === "ended" ? "Call again" : "Start call"}
              </button>
            ) : (
              <>
                <button
                  onClick={webCall.stop}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold bg-red-600 hover:bg-red-500 text-white transition-colors"
                >
                  <FaPhoneSlash /> End call
                </button>
                <button
                  onClick={webCall.toggleMute}
                  disabled={webCall.state !== "active"}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border transition-colors disabled:opacity-40 ${
                    webCall.muted
                      ? "bg-amber-500/15 border-amber-500/40 text-amber-300"
                      : "border-[#333] text-gray-300 hover:border-[#555]"
                  }`}
                >
                  {webCall.muted ? <FaMicrophoneSlash /> : <FaMicrophone />}
                  {webCall.muted ? "Unmute" : "Mute"}
                </button>
              </>
            )}
          </div>

          {/* Inline, directly under the call controls — not a toast. The
              messages name a specific next step (email support, grant the mic,
              set an env var), and a notification that disappears after four
              seconds is the wrong place to put an instruction someone has to
              act on. Reuses the Alert already defined in this file rather than
              introducing new colour classes.

              The Start button stays enabled behind this, so retrying after
              granting microphone permission is one click. */}
          {webCall.error && (
            <Alert tone="error">
              {webCall.error}
              <button
                onClick={webCall.clearError}
                className="ml-2 underline hover:no-underline opacity-70"
              >
                dismiss
              </button>
            </Alert>
          )}
        </div>
      )}

      {/* ── History ── */}
      {historyOpen && (
        <div className="mt-3 space-y-2">
          {history.map((c) => (
            <CallHistoryRow key={c.id} call={c} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── presentational helpers ───────────────────────────────────────────────────

function StateDot({ state }: { state: CallState }) {
  const cls: Record<CallState, string> = {
    idle: "bg-gray-500",
    connecting: "bg-amber-400 animate-pulse",
    ringing: "bg-amber-400 animate-pulse",
    active: "bg-green-400 animate-pulse",
    ended: "bg-gray-600",
  };
  return <span className={`w-2.5 h-2.5 rounded-full ${cls[state]}`} />;
}

/** Twelve bars driven by the SDK's ~10Hz volume-level event. */
function VolumeMeter({ level }: { level: number }) {
  const bars = 12;
  const lit = Math.round(Math.min(Math.max(level, 0), 1) * bars);
  return (
    <div className="flex items-end gap-0.5 h-4" aria-hidden>
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          className={`w-1 rounded-sm transition-all duration-75 ${i < lit ? "bg-green-400" : "bg-[#333]"}`}
          style={{ height: `${25 + (i / bars) * 75}%` }}
        />
      ))}
    </div>
  );
}

function Alert({ tone, children }: { tone: "error" | "info"; children: React.ReactNode }) {
  const cls =
    tone === "error"
      ? "bg-red-900/25 border-red-500/40 text-red-300"
      : "bg-blue-900/20 border-blue-500/40 text-blue-300";
  return (
    <div className={`mt-3 border rounded-lg p-2.5 text-[11px] leading-relaxed flex gap-2 ${cls}`}>
      {tone === "error" && <FaExclamationTriangle className="mt-0.5 flex-shrink-0" />}
      <div className="flex-1">{children}</div>
    </div>
  );
}

function CallHistoryRow({ call }: { call: CallRecord }) {
  const [open, setOpen] = useState(false);

  const statusTone =
    call.status === "completed"
      ? "text-green-400 border-green-500/40 bg-green-500/10"
      : ["failed", "error", "no-answer", "busy", "dial-failed", "mint-failed", "balance-low"].includes(
            call.status
          )
        ? "text-red-400 border-red-500/40 bg-red-500/10"
        : "text-amber-400 border-amber-500/40 bg-amber-500/10";

  const duration =
    call.durationSeconds && call.durationSeconds > 0
      ? `${Math.floor(call.durationSeconds / 60)}m ${call.durationSeconds % 60}s`
      : null;

  return (
    <div className="bg-[#151515] border border-[#2a2a2a] rounded-lg p-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${statusTone}`}>
            {call.status}
          </span>
          <span className="text-[11px] text-gray-500">
            {new Date(call.createdAt).toLocaleString()}
          </span>
          {duration && <span className="text-[11px] text-gray-500">· {duration}</span>}
          {call.channel === "web" && (
            <span className="text-[10px] text-gray-500 border border-[#333] rounded px-1.5">browser</span>
          )}
        </div>

        {(call.summary || call.transcript || call.errorMessage) && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="text-[11px] text-gray-400 hover:text-white underline"
          >
            {open ? "Hide" : "Details"}
          </button>
        )}
      </div>

      {call.summary && !open && (
        <p className="text-[11px] text-gray-400 mt-2 line-clamp-2">{call.summary}</p>
      )}

      {open && (
        <div className="mt-3 space-y-3">
          {call.errorMessage && (
            <div>
              <p className="text-[10px] font-bold text-red-400 uppercase tracking-wide mb-1">Error</p>
              <p className="text-[11px] text-red-300">{call.errorMessage}</p>
            </div>
          )}
          {call.summary && (
            <div>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Summary</p>
              <p className="text-[11px] text-gray-300 leading-relaxed">{call.summary}</p>
            </div>
          )}
          {call.recordingUrl && (
            <div>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">
                Recording
              </p>
              <audio controls src={call.recordingUrl} className="w-full h-8" />
            </div>
          )}
          {call.transcript && (
            <div>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">
                Transcript
              </p>
              <pre className="text-[11px] text-gray-300 leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto bg-black/30 p-2.5 rounded">
                {call.transcript}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
