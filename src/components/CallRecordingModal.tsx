"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FaPhone, FaMicrophone, FaUpload, FaCheck, FaTimes, FaFileAudio } from "react-icons/fa";
import CallRecordingPlugin, {
  type CallLogEntry,
  type RecordingInfo,
} from "@/plugins/CallRecordingPlugin";

// Session status values that match the server-side state machine.
type SessionStatus =
  | "initiated"
  | "calling"
  | "completed"
  | "cancelled"
  | "missed"
  | "recording_pending"
  | "recording_detected"
  | "recording_attached"
  | "recording_unavailable"
  | "upload_failed";

// UI state machine — what the modal is showing.
type ModalStep =
  | "DETECTING_CALL"
  | "SEARCHING_RECORDINGS"
  | "NOT_DETECTED"
  | "RECORDING_DETECTED"
  | "MULTIPLE_RECORDINGS"
  | "CONFIRM_ATTACH"
  | "UPLOADING"
  | "UPLOAD_FAILED"
  | "DONE";

interface Props {
  callSessionId: number;
  phoneNumber: string;
  callStartedAt: number; // timestamp ms
  leadId?: number | null;
  onDismiss: () => void;
  onComplete: () => void;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `0:${String(s).padStart(2, "0")}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Update the server-side session status (fire-and-forget). */
function patchStatus(sessionId: number, status: SessionStatus, extra?: Record<string, unknown>) {
  fetch(`/api/call-sessions/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, ...extra }),
  }).catch(() => {});
}

/**
 * Confidence scoring for automatic recording detection.
 *
 * A recording is only auto-suggested when confidence is HIGH based on
 * available metadata. If confidence is ambiguous, the user must choose.
 */
function scoreRecording(
  rec: RecordingInfo,
  callLog: CallLogEntry | null,
  callStartedAt: number
): number {
  let score = 0;

  // Filename contains the phone digits → strong signal
  if (rec.matchReason === "filename_match") score += 50;

  // Timestamp proximity to the call
  const timeDiffMs = Math.abs(rec.dateModified - callStartedAt);
  if (timeDiffMs < 30_000) score += 30;       // within 30s
  else if (timeDiffMs < 120_000) score += 15;  // within 2min
  else if (timeDiffMs < 300_000) score += 5;   // within 5min

  // Duration matches call log duration (within 10s tolerance)
  if (callLog && callLog.duration > 0 && rec.duration > 0) {
    const durationDiff = Math.abs(rec.duration - callLog.duration);
    if (durationDiff <= 10) score += 20;
    else if (durationDiff <= 30) score += 10;
  }

  // Recording was created AFTER the call started (not before)
  if (rec.dateModified >= callStartedAt - 5000) score += 10;

  return score;
}

const HIGH_CONFIDENCE_THRESHOLD = 60;

export default function CallRecordingModal({
  callSessionId,
  phoneNumber,
  callStartedAt,
  onDismiss,
  onComplete,
}: Props) {
  const [step, setStep] = useState<ModalStep>("DETECTING_CALL");
  const [callLog, setCallLog] = useState<CallLogEntry | null>(null);
  const [recordings, setRecordings] = useState<RecordingInfo[]>([]);
  const [selectedRecording, setSelectedRecording] = useState<RecordingInfo | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState("");
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  // ── Step 1: Detect call from CallLog ──────────────────────────────────────
  const detectCall = useCallback(async () => {
    setStep("DETECTING_CALL");
    setError(null);
    patchStatus(callSessionId, "calling");

    try {
      const perms = await CallRecordingPlugin.checkPermissions();
      if (perms.callLog !== "granted") {
        const requested = await CallRecordingPlugin.requestPermissions();
        if (requested.callLog !== "granted") {
          // CallLog permission denied — skip to recording search.
          // The feature remains functional without it.
          if (mounted.current) {
            patchStatus(callSessionId, "recording_pending");
            setStep("SEARCHING_RECORDINGS");
          }
          return;
        }
      }

      const result = await CallRecordingPlugin.getRecentCalls({
        phoneNumber,
        afterTimestamp: callStartedAt - 5000,
        limit: 5,
      });

      if (!mounted.current) return;

      if (result.calls.length > 0) {
        const outgoing = result.calls.find((c) => c.type === "OUTGOING");
        const match = outgoing || result.calls[0];
        setCallLog(match);

        // Sync call log metadata to server
        patchStatus(
          callSessionId,
          match.type === "MISSED" || match.type === "REJECTED" || match.duration === 0
            ? "missed"
            : "recording_pending",
          {
            callLogDuration: match.duration,
            callLogDate: new Date(match.date).toISOString(),
            callLogType: match.type,
          }
        );

        // Missed / rejected / zero-duration: no recording to find
        if (match.type === "MISSED" || match.type === "REJECTED" || match.duration === 0) {
          setStep("NOT_DETECTED");
          return;
        }
      } else {
        // No matching call found in log at all
        patchStatus(callSessionId, "recording_pending");
      }

      setStep("SEARCHING_RECORDINGS");
    } catch (err: any) {
      if (!mounted.current) return;
      console.error("Call detection error:", err);
      patchStatus(callSessionId, "recording_pending");
      setStep("SEARCHING_RECORDINGS");
    }
  }, [callSessionId, phoneNumber, callStartedAt]);

  // ── Step 2: Search for recordings ─────────────────────────────────────────
  const searchRecordings = useCallback(async () => {
    setError(null);
    try {
      const perms = await CallRecordingPlugin.checkPermissions();
      if (perms.audio !== "granted") {
        const requested = await CallRecordingPlugin.requestPermissions();
        if (requested.audio !== "granted") {
          // Audio permission denied — skip to manual picker.
          if (mounted.current) setStep("NOT_DETECTED");
          return;
        }
      }

      const result = await CallRecordingPlugin.findRecordings({
        afterTimestamp: callStartedAt - 5000,
        phoneNumber,
      });

      if (!mounted.current) return;

      if (result.recordings.length === 0) {
        setStep("NOT_DETECTED");
        return;
      }

      // Score each recording for match confidence
      const scored = result.recordings
        .map((rec) => ({ rec, score: scoreRecording(rec, callLog, callStartedAt) }))
        .sort((a, b) => b.score - a.score);

      const topScore = scored[0].score;

      if (scored.length === 1 && topScore >= HIGH_CONFIDENCE_THRESHOLD) {
        // Single high-confidence match → suggest it, but still require confirmation
        setRecordings([scored[0].rec]);
        setSelectedRecording(scored[0].rec);
        patchStatus(callSessionId, "recording_detected");
        setStep("RECORDING_DETECTED");
      } else if (scored.length > 1) {
        // Multiple recordings found — NEVER auto-choose
        setRecordings(scored.map((s) => s.rec));
        setSelectedRecording(null);
        setStep("MULTIPLE_RECORDINGS");
      } else {
        // Single recording but low confidence — do NOT auto-suggest
        setRecordings(scored.map((s) => s.rec));
        setSelectedRecording(null);
        setStep("NOT_DETECTED");
      }
    } catch (err: any) {
      if (!mounted.current) return;
      console.error("Recording search error:", err);
      setStep("NOT_DETECTED");
    }
  }, [callStartedAt, phoneNumber, callLog, callSessionId]);

  // Auto-trigger steps
  useEffect(() => { detectCall(); }, [detectCall]);
  useEffect(() => {
    if (step === "SEARCHING_RECORDINGS") searchRecordings();
  }, [step, searchRecordings]);

  // ── Manual file picker (SAF — no special permissions needed) ──────────────
  const handlePickFile = async () => {
    try {
      const result = await CallRecordingPlugin.pickAudioFile();
      if (result.recording) {
        setSelectedRecording(result.recording);
        setStep("CONFIRM_ATTACH");
      }
      // If null, user cancelled the picker — stay on current step
    } catch (err: any) {
      setError("Failed to open file picker: " + (err?.message || "Unknown error"));
    }
  };

  // ── Upload + finalize ─────────────────────────────────────────────────────
  const handleUpload = async () => {
    if (!selectedRecording) return;
    setStep("UPLOADING");
    setError(null);

    // Pre-validate size
    if (selectedRecording.size > 50 * 1024 * 1024) {
      setError("Recording exceeds 50 MB limit. Please select a smaller file.");
      patchStatus(callSessionId, "upload_failed");
      setStep("UPLOAD_FAILED");
      return;
    }

    try {
      setUploadProgress("Reading file...");
      let fileData;
      try {
        fileData = await CallRecordingPlugin.readFileAsBase64({ uri: selectedRecording.uri });
      } catch (err: any) {
        throw new Error("Could not read the recording file. It may have been moved or deleted.");
      }

      setUploadProgress("Uploading recording...");

      // Convert base64 → Blob
      const binaryStr = atob(fileData.base64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: fileData.mimeType });

      const formData = new FormData();
      formData.append("callSessionId", String(callSessionId));
      formData.append("file", blob, selectedRecording.name || "recording.mp3");
      formData.append("duration", String(selectedRecording.duration || 0));

      const uploadRes = await fetch("/api/call-recordings/upload", {
        method: "POST",
        body: formData,
      });

      if (!uploadRes.ok) {
        const errData = await uploadRes.json().catch(() => null);
        const msg = errData?.message || "Upload failed";
        // Duplicate check
        if (uploadRes.status === 409) {
          throw new Error("A recording is already attached to this call session.");
        }
        throw new Error(msg);
      }

      setUploadProgress("Saving to timeline...");

      const completeRes = await fetch(`/api/call-sessions/${callSessionId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note.trim() || undefined }),
      });

      if (!completeRes.ok) {
        const errData = await completeRes.json().catch(() => null);
        throw new Error(errData?.message || "Failed to save to timeline");
      }

      if (!mounted.current) return;
      setStep("DONE");
      setTimeout(() => { if (mounted.current) onComplete(); }, 1500);
    } catch (err: any) {
      if (!mounted.current) return;
      setError(err?.message || "Upload failed. Please try again.");
      patchStatus(callSessionId, "upload_failed");
      setStep("UPLOAD_FAILED");
    }
  };

  // ── Skip (no recording) ───────────────────────────────────────────────────
  const handleSkip = async () => {
    patchStatus(callSessionId, "recording_unavailable");
    try {
      await fetch(`/api/call-sessions/${callSessionId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note.trim() || undefined }),
      });
    } catch {}
    if (mounted.current) {
      setStep("DONE");
      setTimeout(() => { if (mounted.current) onComplete(); }, 1500);
    }
  };

  // ── Cancel (discard session) ──────────────────────────────────────────────
  const handleCancel = () => {
    patchStatus(callSessionId, "cancelled");
    onDismiss();
  };

  // ── Call info banner (reused across steps) ────────────────────────────────
  const callBanner = callLog && (
    <div className={`p-3 rounded-xl text-left ${
      callLog.type === "MISSED" || callLog.type === "REJECTED"
        ? "bg-yellow-50"
        : "bg-green-50"
    }`}>
      <p className={`text-xs font-bold ${
        callLog.type === "MISSED" || callLog.type === "REJECTED"
          ? "text-yellow-800"
          : "text-green-800"
      }`}>
        {callLog.type === "MISSED" ? "Missed call"
          : callLog.type === "REJECTED" ? "Call rejected"
          : callLog.duration === 0 ? "Call not connected"
          : "Call completed"}
      </p>
      <p className={`text-xs mt-0.5 ${
        callLog.type === "MISSED" || callLog.type === "REJECTED"
          ? "text-yellow-700"
          : "text-green-700"
      }`}>
        {callLog.type} &middot; Duration: {formatDuration(callLog.duration)}
      </p>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center bg-black/60 animate-fadeIn">
      <div className="w-full max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center">
              <FaPhone className="text-green-600 text-sm" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-gray-900">Call Recording</h3>
              <p className="text-xs text-gray-500">{phoneNumber}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition"
          >
            <FaTimes className="text-sm" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">

          {/* ── DETECTING_CALL ──────────────────────────────────────────── */}
          {step === "DETECTING_CALL" && (
            <div className="text-center py-6">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-3 animate-pulse">
                <FaPhone className="text-blue-600" />
              </div>
              <p className="text-sm font-medium text-gray-700">Checking call log...</p>
              <p className="text-xs text-gray-400 mt-1">Looking for your recent call</p>
            </div>
          )}

          {/* ── SEARCHING_RECORDINGS ────────────────────────────────────── */}
          {step === "SEARCHING_RECORDINGS" && (
            <div className="text-center py-4 space-y-3">
              {callBanner}
              <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center mx-auto mb-3 animate-pulse">
                <FaMicrophone className="text-purple-600" />
              </div>
              <p className="text-sm font-medium text-gray-700">Searching for recordings...</p>
              <p className="text-xs text-gray-400 mt-1">Checking device for call recordings</p>
            </div>
          )}

          {/* ── NOT_DETECTED ────────────────────────────────────────────── */}
          {step === "NOT_DETECTED" && (
            <div className="space-y-3">
              {callBanner}
              <div className="p-3 bg-gray-50 rounded-xl text-center">
                <p className="text-sm font-medium text-gray-700">Call recording not detected</p>
                <p className="text-xs text-gray-400 mt-1">
                  Your device may not expose call recordings, or the recorder app stores them in a restricted location.
                </p>
              </div>
              <NoteField note={note} setNote={setNote} />
              {error && <ErrorBanner message={error} />}
              <div className="flex gap-2">
                <button type="button" onClick={handlePickFile}
                  className="flex-1 px-3 py-2.5 text-xs font-bold rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition flex items-center justify-center gap-1.5">
                  <FaFileAudio className="text-[10px]" />
                  Select Call Recording
                </button>
                <button type="button" onClick={handleSkip}
                  className="flex-1 px-3 py-2.5 text-xs font-bold rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 transition">
                  Skip
                </button>
              </div>
            </div>
          )}

          {/* ── RECORDING_DETECTED (single high-confidence match) ──────── */}
          {step === "RECORDING_DETECTED" && selectedRecording && (
            <div className="space-y-3">
              {callBanner}
              <div className="p-3 bg-purple-50 rounded-xl">
                <p className="text-xs font-bold text-purple-800">Call recording detected</p>
                <p className="text-xs text-purple-700 mt-1 break-all">{selectedRecording.name}</p>
                <p className="text-xs text-purple-600 mt-0.5">
                  Duration: {formatDuration(selectedRecording.duration)}
                  {" \u00B7 "}
                  {formatFileSize(selectedRecording.size)}
                  {" \u00B7 "}
                  {selectedRecording.mimeType}
                </p>
              </div>
              <NoteField note={note} setNote={setNote} />
              {error && <ErrorBanner message={error} />}
              <div className="flex gap-2">
                <button type="button" onClick={handleUpload}
                  className="flex-1 px-3 py-2.5 text-xs font-bold rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition flex items-center justify-center gap-1.5">
                  <FaUpload className="text-[10px]" />
                  Attach to CRM
                </button>
                <button type="button" onClick={handlePickFile}
                  className="px-3 py-2.5 text-xs font-bold rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition">
                  Different File
                </button>
                <button type="button" onClick={handleSkip}
                  className="px-3 py-2.5 text-xs font-bold rounded-xl border border-gray-200 text-gray-400 hover:bg-gray-50 transition">
                  Skip
                </button>
              </div>
            </div>
          )}

          {/* ── MULTIPLE_RECORDINGS ─────────────────────────────────────── */}
          {step === "MULTIPLE_RECORDINGS" && (
            <div className="space-y-3">
              {callBanner}
              <div className="p-3 bg-yellow-50 rounded-xl">
                <p className="text-xs font-bold text-yellow-800">Multiple possible recordings found</p>
                <p className="text-xs text-yellow-700 mt-0.5">
                  Select the correct recording for this call.
                </p>
              </div>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {recordings.map((rec, i) => (
                  <button key={i} type="button"
                    onClick={() => { setSelectedRecording(rec); setStep("CONFIRM_ATTACH"); }}
                    className="w-full text-left p-2.5 rounded-lg text-xs bg-gray-50 border border-transparent hover:bg-purple-50 hover:border-purple-200 transition">
                    <span className="font-medium text-gray-800 block truncate">{rec.name}</span>
                    <span className="text-gray-500">
                      Duration: {formatDuration(rec.duration)}
                      {" \u00B7 "}
                      {formatFileSize(rec.size)}
                      {" \u00B7 "}
                      {rec.mimeType}
                    </span>
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={handlePickFile}
                  className="flex-1 px-3 py-2.5 text-xs font-bold rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition flex items-center justify-center gap-1.5">
                  <FaFileAudio className="text-[10px]" />
                  Select Different File
                </button>
                <button type="button" onClick={handleSkip}
                  className="flex-1 px-3 py-2.5 text-xs font-bold rounded-xl border border-gray-200 text-gray-400 hover:bg-gray-50 transition">
                  Skip
                </button>
              </div>
            </div>
          )}

          {/* ── CONFIRM_ATTACH (after manual pick or multi-select) ─────── */}
          {step === "CONFIRM_ATTACH" && selectedRecording && (
            <div className="space-y-3">
              {callBanner}
              <div className="p-3 bg-purple-50 rounded-xl">
                <p className="text-xs font-bold text-purple-800">Selected recording</p>
                <p className="text-xs text-purple-700 mt-1 break-all">{selectedRecording.name}</p>
                <p className="text-xs text-purple-600 mt-0.5">
                  Duration: {formatDuration(selectedRecording.duration)}
                  {" \u00B7 "}
                  {formatFileSize(selectedRecording.size)}
                  {" \u00B7 "}
                  {selectedRecording.mimeType}
                </p>
              </div>
              <NoteField note={note} setNote={setNote} />
              {error && <ErrorBanner message={error} />}
              <div className="flex gap-2">
                <button type="button" onClick={handleUpload}
                  className="flex-1 px-3 py-2.5 text-xs font-bold rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition flex items-center justify-center gap-1.5">
                  <FaUpload className="text-[10px]" />
                  Attach to CRM
                </button>
                <button type="button" onClick={handleSkip}
                  className="flex-1 px-3 py-2.5 text-xs font-bold rounded-xl border border-gray-200 text-gray-400 hover:bg-gray-50 transition">
                  Skip
                </button>
              </div>
            </div>
          )}

          {/* ── UPLOADING ───────────────────────────────────────────────── */}
          {step === "UPLOADING" && (
            <div className="text-center py-6">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-3 animate-pulse">
                <FaUpload className="text-blue-600" />
              </div>
              <p className="text-sm font-medium text-gray-700">{uploadProgress}</p>
            </div>
          )}

          {/* ── UPLOAD_FAILED ───────────────────────────────────────────── */}
          {step === "UPLOAD_FAILED" && (
            <div className="space-y-3">
              {error && <ErrorBanner message={error} />}
              <div className="flex gap-2">
                <button type="button"
                  onClick={() => { setError(null); handleUpload(); }}
                  className="flex-1 px-3 py-2.5 text-xs font-bold rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition">
                  Retry Upload
                </button>
                <button type="button" onClick={handlePickFile}
                  className="flex-1 px-3 py-2.5 text-xs font-bold rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition">
                  Different File
                </button>
                <button type="button" onClick={handleSkip}
                  className="px-3 py-2.5 text-xs font-bold rounded-xl border border-gray-200 text-gray-400 hover:bg-gray-50 transition">
                  Skip
                </button>
              </div>
            </div>
          )}

          {/* ── DONE ────────────────────────────────────────────────────── */}
          {step === "DONE" && (
            <div className="text-center py-6">
              <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
                <FaCheck className="text-green-600" />
              </div>
              <p className="text-sm font-medium text-gray-700">Saved to timeline</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Small helper components ─────────────────────────────────────────────── */

function NoteField({ note, setNote }: { note: string; setNote: (v: string) => void }) {
  return (
    <textarea
      value={note}
      onChange={(e) => setNote(e.target.value)}
      placeholder="Add a note about this call (optional)"
      rows={2}
      className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
    />
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="p-2.5 bg-red-50 rounded-xl">
      <p className="text-xs text-red-700">{message}</p>
    </div>
  );
}
