"use client";

import { useCallback, useRef, useState } from "react";
import { FaPhone, FaPlay, FaPause, FaTrash } from "react-icons/fa";
import { getStoredCrmUser } from "@/lib/authSession";
import { useRecordingDeletePermission } from "@/lib/hooks/useRecordingDeletePermission";

interface CallFollowUpData {
  call_session_id?: number;
  duration_seconds?: number;
  recording_r2_key?: string;
  recording_size?: number;
  recording_mime?: string;
  phone_number?: string;
  note?: string;
  recording_deleted?: boolean;
  recording_deleted_by?: string;
  recording_deleted_at?: string;
}

interface Props {
  message: string;
  createdAt?: string;
  textClass?: string;
  /** Called after a successful deletion so the parent can refresh the timeline. */
  onRecordingDeleted?: () => void;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatDateTime(iso: string): { date: string; time: string } {
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
    const time = d.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    return { date, time };
  } catch {
    return { date: "", time: "" };
  }
}

export default function ManualCallBubble({
  message,
  createdAt,
  textClass = "",
  onRecordingDeleted,
}: Props) {
  // Hook must be called unconditionally (before any early return).
  const user = getStoredCrmUser();
  const canDelete = useRecordingDeletePermission(user?.role ?? null);

  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [playError, setPlayError] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);

  let data: CallFollowUpData;
  try {
    data = JSON.parse(message);
  } catch {
    return <p className={`text-sm whitespace-pre-wrap leading-relaxed ${textClass}`}>{message}</p>;
  }

  const hasRecording = !!data.recording_r2_key && !deleted;
  const wasDeleted = data.recording_deleted === true || deleted;
  const sessionId = data.call_session_id;

  const handlePlayPause = useCallback(async () => {
    if (playing && audioRef.current) {
      audioRef.current.pause();
      setPlaying(false);
      return;
    }

    if (audioUrl && audioRef.current) {
      audioRef.current.play();
      setPlaying(true);
      return;
    }

    if (!sessionId) return;
    setLoading(true);
    setPlayError(false);
    try {
      const res = await fetch(`/api/call-recordings/${sessionId}`);
      const json = await res.json();
      if (json.success && json.url) {
        setAudioUrl(json.url);
        const audio = new Audio(json.url);
        audio.addEventListener("ended", () => setPlaying(false));
        audio.addEventListener("error", () => {
          setPlaying(false);
          setPlayError(true);
        });
        audioRef.current = audio;
        audio.play();
        setPlaying(true);
      } else {
        setPlayError(true);
      }
    } catch {
      setPlayError(true);
    } finally {
      setLoading(false);
    }
  }, [playing, audioUrl, sessionId]);

  const handleDelete = async () => {
    if (!sessionId) return;
    setDeleting(true);
    try {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setPlaying(false);

      const res = await fetch(`/api/call-recordings/${sessionId}`, { method: "DELETE" });
      const json = await res.json();
      if (res.ok && json.success) {
        setDeleted(true);
        setShowDeleteConfirm(false);
        setAudioUrl(null);
        onRecordingDeleted?.();
      } else {
        alert(json.message || "Failed to delete recording.");
      }
    } catch {
      alert("Failed to delete recording. Please try again.");
    } finally {
      setDeleting(false);
    }
  };

  const { date, time } = createdAt ? formatDateTime(createdAt) : { date: "", time: "" };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <FaPhone className="text-green-500 text-[10px] flex-shrink-0" />
        <span className={`text-sm font-medium ${textClass}`}>
          Outgoing Call
        </span>
      </div>

      {date && (
        <p className={`text-xs opacity-60 ${textClass}`}>
          {date}{time ? `, ${time}` : ""}
        </p>
      )}

      {(data.duration_seconds != null && data.duration_seconds > 0) && (
        <p className={`text-xs ${textClass}`}>
          Duration: {formatDuration(data.duration_seconds)}
        </p>
      )}

      {hasRecording && !playError && (
        <div className="flex items-center gap-1.5 mt-0.5">
          <button
            type="button"
            onClick={handlePlayPause}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 transition"
          >
            {loading ? (
              <span className="animate-pulse">Loading...</span>
            ) : playing ? (
              <><FaPause className="text-[9px]" /> Pause</>
            ) : (
              <><FaPlay className="text-[9px]" /> Play Recording</>
            )}
          </button>

          {canDelete && (
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold text-red-500 hover:bg-red-50 transition"
              title="Delete recording"
            >
              <FaTrash className="text-[9px]" /> Delete Recording
            </button>
          )}
        </div>
      )}

      {playError && !wasDeleted && (
        <p className={`text-xs text-red-500 mt-0.5 ${textClass}`}>
          Recording unavailable
        </p>
      )}

      {wasDeleted && (
        <p className={`text-xs text-gray-400 italic mt-0.5 ${textClass}`}>
          Recording deleted{data.recording_deleted_by ? ` by ${data.recording_deleted_by}` : ""}
        </p>
      )}

      {data.note && (
        <p className={`text-xs whitespace-pre-wrap leading-relaxed mt-1 ${textClass}`}>{data.note}</p>
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 animate-fadeIn">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden mx-4">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="font-bold text-sm text-gray-900">Delete recording?</h3>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-gray-600 leading-relaxed">
                This will permanently delete this voice recording from cloud storage.
                The follow-up and call history will remain. This action cannot be undone.
              </p>
            </div>
            <div className="flex gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="flex-1 px-3 py-2 text-xs font-bold rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-100 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 px-3 py-2 text-xs font-bold rounded-xl bg-red-600 text-white hover:bg-red-700 transition flex items-center justify-center gap-1.5"
              >
                {deleting ? (
                  <span className="animate-pulse">Deleting...</span>
                ) : (
                  <><FaTrash className="text-[9px]" /> Delete Recording</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
