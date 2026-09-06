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

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

/**
 * Renders a "call" follow-up in the lead timeline.
 *
 * Format:
 *   Outgoing Call
 *   06 Sep 2026
 *   Duration: 08:42
 *   [Play Recording]
 *   Optional note text
 */
export default function ManualCallBubble({ message, createdAt, textClass = "" }: Props) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
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
    try {
      const res = await fetch(`/api/call-recordings/${sessionId}`);
      const json = await res.json();
      if (json.success && json.url) {
        setAudioUrl(json.url);
        const audio = new Audio(json.url);
        audio.addEventListener("ended", () => setPlaying(false));
        audioRef.current = audio;
        audio.play();
        setPlaying(true);
      }
    } catch {
      // Playback unavailable — degrade silently
    } finally {
      setLoading(false);
    }
  }, [playing, audioUrl, sessionId]);

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <FaPhone className="text-green-500 text-[10px] flex-shrink-0" />
        <span className={`text-sm font-medium ${textClass}`}>
          Outgoing Call
        </span>
      </div>

      {createdAt && (
        <p className={`text-xs opacity-60 ${textClass}`}>{formatDate(createdAt)}</p>
      )}

      {(data.duration_seconds != null && data.duration_seconds > 0) && (
        <p className={`text-xs ${textClass}`}>
          Duration: {formatDuration(data.duration_seconds)}
        </p>
      )}

      {hasRecording && (
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

      {data.note && (
        <p className={`text-xs whitespace-pre-wrap leading-relaxed mt-1 ${textClass}`}>{data.note}</p>
      )}
    </div>
  );
}
