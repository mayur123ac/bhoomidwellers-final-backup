"use client";

import { useCallback, useRef, useState } from "react";
import { FaPhone, FaPlay, FaPause } from "react-icons/fa";

interface CallFollowUpData {
  call_session_id?: number;
  duration_seconds?: number;
  recording_r2_key?: string;
  recording_size?: number;
  recording_mime?: string;
  phone_number?: string;
  note?: string;
}

interface Props {
  message: string;
  createdAt?: string;
  textClass?: string;
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

/**
 * Renders a "call" follow-up in the lead timeline.
 *
 * Format:
 *   Outgoing Call
 *   06 Sep 2026, 02:15 pm
 *   Duration: 08:42
 *   [Play Recording]   (only when recording_r2_key exists)
 *   Optional note text
 */
export default function ManualCallBubble({ message, createdAt, textClass = "" }: Props) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [playError, setPlayError] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  let data: CallFollowUpData;
  try {
    data = JSON.parse(message);
  } catch {
    return <p className={`text-sm whitespace-pre-wrap leading-relaxed ${textClass}`}>{message}</p>;
  }

  const hasRecording = !!data.recording_r2_key;
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
        <button
          type="button"
          onClick={handlePlayPause}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 mt-0.5 rounded-lg text-xs font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 transition"
        >
          {loading ? (
            <span className="animate-pulse">Loading...</span>
          ) : playing ? (
            <><FaPause className="text-[9px]" /> Pause</>
          ) : (
            <><FaPlay className="text-[9px]" /> Play Recording</>
          )}
        </button>
      )}

      {playError && (
        <p className={`text-xs text-red-500 mt-0.5 ${textClass}`}>
          Recording unavailable
        </p>
      )}

      {data.note && (
        <p className={`text-xs whitespace-pre-wrap leading-relaxed mt-1 ${textClass}`}>{data.note}</p>
      )}
    </div>
  );
}
