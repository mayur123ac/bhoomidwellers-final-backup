"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  IoCameraOutline,
  IoCloseOutline,
  IoCameraReverseOutline,
  IoCheckmarkOutline,
  IoRefreshOutline,
  IoLocationOutline,
  IoPersonOutline,
  IoCalendarOutline,
  IoTimeOutline,
} from "react-icons/io5";
import { useGeolocation, type GeoPosition } from "@/lib/hooks/useGeolocation";

export type CaptureResult = {
  /** Original un-watermarked image file. */
  originalFile: File;
  /** Watermarked image file with metadata overlay baked in. */
  watermarkedFile: File;
  previewUrl: string;
  location: GeoPosition | null;
  /** IST-formatted capture timestamp string for display. */
  captureTimestampISO: string;
  employeeName: string;
};

/** Format a Date to IST date string: "20 Nov 2026" */
function fmtDateIST(d: Date): string {
  return d.toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

/** Format a Date to IST time string: "11:45:32 AM IST" */
function fmtTimeIST(d: Date): string {
  return d.toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: true, timeZone: "Asia/Kolkata",
  }) + " IST";
}

/**
 * Draws a professional watermark overlay on a canvas.
 * Returns a Blob of the watermarked JPEG.
 */
function generateWatermark(
  originalCanvas: HTMLCanvasElement,
  employeeName: string,
  locationText: string,
  captureDate: Date,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    const w = originalCanvas.width;
    const h = originalCanvas.height;

    const wmCanvas = document.createElement("canvas");
    wmCanvas.width = w;
    wmCanvas.height = h;
    const ctx = wmCanvas.getContext("2d");
    if (!ctx) { resolve(null); return; }

    // Draw original image
    ctx.drawImage(originalCanvas, 0, 0);

    // Calculate responsive font size (scales with image width)
    const baseFontSize = Math.max(14, Math.min(w * 0.022, 28));
    const lineHeight = baseFontSize * 1.55;
    const iconSize = baseFontSize * 0.85;
    const padding = baseFontSize * 1.2;
    const iconTextGap = baseFontSize * 0.5;

    const dateStr = fmtDateIST(captureDate);
    const timeStr = fmtTimeIST(captureDate);

    // 4 lines of metadata
    const lines = [
      { icon: "person", text: `Captured by: ${employeeName}` },
      { icon: "location", text: `Location: ${locationText}` },
      { icon: "calendar", text: `Date: ${dateStr}` },
      { icon: "time", text: `Time: ${timeStr}` },
    ];

    const overlayHeight = padding * 2 + lines.length * lineHeight;
    const overlayY = h - overlayHeight;

    // Semi-transparent dark background
    ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
    ctx.fillRect(0, overlayY, w, overlayHeight);

    // Thin accent line at top of overlay
    ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
    ctx.fillRect(0, overlayY, w, 1);

    ctx.textBaseline = "middle";

    for (let i = 0; i < lines.length; i++) {
      const lineY = overlayY + padding + i * lineHeight + lineHeight / 2;
      const iconX = padding;
      const textX = padding + iconSize + iconTextGap;

      // Draw icon circle
      ctx.beginPath();
      ctx.arc(iconX + iconSize / 2, lineY, iconSize / 2 + 2, 0, Math.PI * 2);
      ctx.fillStyle = iconColorForType(lines[i].icon);
      ctx.fill();

      // Draw icon symbol (simplified)
      ctx.fillStyle = "#FFFFFF";
      ctx.font = `${iconSize}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(iconSymbol(lines[i].icon), iconX + iconSize / 2, lineY + 1);

      // Draw text
      ctx.fillStyle = "#FFFFFF";
      ctx.font = `${i === 0 ? "600" : "400"} ${baseFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.textAlign = "left";
      ctx.fillText(lines[i].text, textX, lineY);
    }

    wmCanvas.toBlob(
      (blob) => resolve(blob),
      "image/jpeg",
      0.92
    );
  });
}

function iconColorForType(type: string): string {
  switch (type) {
    case "person": return "rgba(255, 55, 151, 0.8)";   // magenta
    case "location": return "rgba(52, 199, 89, 0.8)";   // green
    case "calendar": return "rgba(0, 122, 255, 0.8)";   // blue
    case "time": return "rgba(255, 149, 0, 0.8)";       // orange
    default: return "rgba(255, 255, 255, 0.3)";
  }
}

/** Simple single-character symbols that render reliably on all canvas implementations. */
function iconSymbol(type: string): string {
  switch (type) {
    case "person": return "\u{2022}";      // bullet (person)
    case "location": return "\u{25CF}";    // filled circle (location)
    case "calendar": return "\u{25A0}";    // filled square (calendar)
    case "time": return "\u{25C6}";        // filled diamond (time)
    default: return "\u{2022}";
  }
}

/**
 * Full-screen camera capture overlay with automatic watermarking.
 *
 * Captures a photo, records the exact shutter-press timestamp, overlays
 * employee name + GPS location + date/time as a professional watermark,
 * and returns both the original and watermarked files.
 */
export default function CpCameraCapture({
  isDark,
  employeeName,
  onCapture,
  onClose,
}: {
  isDark: boolean;
  /** Authenticated employee's full name — displayed in watermark. */
  employeeName: string;
  onCapture: (result: CaptureResult) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [facingMode, setFacingMode] = useState<"user" | "environment">("environment");
  const [captured, setCaptured] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [watermarkedUrl, setWatermarkedUrl] = useState<string | null>(null);
  const [watermarkedBlob, setWatermarkedBlob] = useState<Blob | null>(null);
  const [captureTime, setCaptureTime] = useState<Date | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const [generating, setGenerating] = useState(false);

  const geo = useGeolocation();

  // Start camera
  const startCamera = useCallback(async (facing: "user" | "environment") => {
    setStarting(true);
    setCameraError(null);

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (err: any) {
      if (err.name === "NotAllowedError") {
        setCameraError("Camera permission denied.");
      } else if (err.name === "NotFoundError") {
        setCameraError("No camera found on this device.");
      } else {
        setCameraError("Could not start camera.");
      }
    } finally {
      setStarting(false);
    }
  }, []);

  useEffect(() => {
    startCamera(facingMode);
    // Capture location in parallel with camera startup
    geo.capture();

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchCamera = useCallback(() => {
    const next = facingMode === "user" ? "environment" : "user";
    setFacingMode(next);
    setCaptured(null);
    setCapturedBlob(null);
    setWatermarkedUrl(null);
    setWatermarkedBlob(null);
    setCaptureTime(null);
    startCamera(next);
  }, [facingMode, startCamera]);

  const takePhoto = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    // Record the EXACT moment of shutter press
    const shutterTime = new Date();
    setCaptureTime(shutterTime);

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (facingMode === "user") {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0);

    // Generate original blob
    canvas.toBlob(
      async (blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        setCaptured(url);
        setCapturedBlob(blob);

        // Generate watermarked version
        setGenerating(true);
        const locationText = geo.position?.address
          || (geo.position
            ? `${geo.position.latitude.toFixed(5)}, ${geo.position.longitude.toFixed(5)}`
            : "Unavailable");

        const wmBlob = await generateWatermark(canvas, employeeName, locationText, shutterTime);
        if (wmBlob) {
          const wmUrl = URL.createObjectURL(wmBlob);
          setWatermarkedUrl(wmUrl);
          setWatermarkedBlob(wmBlob);
        }
        setGenerating(false);
      },
      "image/jpeg",
      0.92
    );
  }, [facingMode, geo.position, employeeName]);

  const retake = useCallback(() => {
    if (captured) URL.revokeObjectURL(captured);
    if (watermarkedUrl) URL.revokeObjectURL(watermarkedUrl);
    setCaptured(null);
    setCapturedBlob(null);
    setWatermarkedUrl(null);
    setWatermarkedBlob(null);
    setCaptureTime(null);
    // Re-fetch GPS for the new photo
    geo.capture();
  }, [captured, watermarkedUrl, geo]);

  const confirm = useCallback(() => {
    if (!capturedBlob || !captureTime) return;
    const ts = captureTime.getTime();
    const originalFile = new File([capturedBlob], `capture_${ts}.jpg`, { type: "image/jpeg" });
    const wmFile = watermarkedBlob
      ? new File([watermarkedBlob], `capture_${ts}_wm.jpg`, { type: "image/jpeg" })
      : originalFile; // fallback if watermark generation failed

    onCapture({
      originalFile,
      watermarkedFile: wmFile,
      previewUrl: watermarkedUrl || captured || "",
      location: geo.position,
      captureTimestampISO: captureTime.toISOString(),
      employeeName,
    });
  }, [capturedBlob, watermarkedBlob, captured, watermarkedUrl, captureTime, geo.position, employeeName, onCapture]);

  // Build location display text
  const locationDisplay = geo.position?.address
    || (geo.position ? `${geo.position.latitude.toFixed(5)}, ${geo.position.longitude.toFixed(5)}` : null);

  return (
    <div className="fixed inset-0 z-[400] bg-black flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/80 z-10">
        <button
          onClick={onClose}
          className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors"
        >
          <IoCloseOutline size={24} />
        </button>

        <div className="flex items-center gap-2">
          {/* Employee badge */}
          <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/10 text-white/80 text-[11px] font-medium max-w-[140px] truncate">
            <IoPersonOutline size={11} className="flex-shrink-0" />
            <span className="truncate">{employeeName}</span>
          </div>

          {/* GPS status */}
          {geo.position && (
            <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-green-500/20 text-green-400 text-[11px] font-medium">
              <IoLocationOutline size={12} />
              GPS
            </div>
          )}
          {geo.loading && (
            <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-yellow-500/20 text-yellow-400 text-[11px] font-medium">
              <IoLocationOutline size={12} />
              Locating...
            </div>
          )}
          {geo.error && !geo.position && (
            <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-500/20 text-red-400 text-[11px] font-medium">
              <IoLocationOutline size={12} />
              No GPS
            </div>
          )}
        </div>

        <button
          onClick={switchCamera}
          className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors"
        >
          <IoCameraReverseOutline size={22} />
        </button>
      </div>

      {/* Camera / Preview area */}
      <div className="flex-1 relative overflow-hidden bg-black flex items-center justify-center">
        {cameraError ? (
          <div className="text-center px-6">
            <IoCameraOutline size={48} className="text-white/40 mx-auto mb-4" />
            <p className="text-white/80 text-[15px] font-medium">{cameraError}</p>
            <button
              onClick={() => startCamera(facingMode)}
              className="mt-4 px-4 py-2 rounded-full bg-white/10 text-white text-[13px] font-medium hover:bg-white/20"
            >
              Try Again
            </button>
          </div>
        ) : captured ? (
          <>
            {/* Show watermarked preview if available, otherwise original */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={watermarkedUrl || captured}
              alt="Captured"
              className="w-full h-full object-contain"
            />
            {generating && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span className="text-white/70 text-[12px]">Generating watermark...</span>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover ${facingMode === "user" ? "scale-x-[-1]" : ""}`}
            />
            {starting && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              </div>
            )}

            {/* Live metadata bar on camera view */}
            <div className="absolute bottom-0 left-0 right-0 px-4 py-3 bg-gradient-to-t from-black/60 to-transparent">
              <div className="flex items-center gap-4 text-white/60 text-[11px]">
                <div className="flex items-center gap-1">
                  <IoPersonOutline size={11} />
                  <span className="truncate max-w-[100px]">{employeeName}</span>
                </div>
                {locationDisplay && (
                  <div className="flex items-center gap-1 truncate">
                    <IoLocationOutline size={11} className="flex-shrink-0" />
                    <span className="truncate max-w-[180px]">{locationDisplay}</span>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* Metadata card below preview (when captured) */}
        {captured && captureTime && !generating && (
          <div className="absolute bottom-0 left-0 right-0 bg-black/70 backdrop-blur-sm px-4 py-3">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-white/90 text-[12px]">
                <IoPersonOutline size={13} className="text-[#FF3797] flex-shrink-0" />
                <span className="font-medium">Captured by: {employeeName}</span>
              </div>
              <div className="flex items-center gap-2 text-white/90 text-[12px]">
                <IoLocationOutline size={13} className="text-green-400 flex-shrink-0" />
                <span className="truncate">
                  Location: {geo.loading
                    ? "Resolving..."
                    : locationDisplay || "Unavailable"
                  }
                </span>
              </div>
              <div className="flex items-center gap-2 text-white/90 text-[12px]">
                <IoCalendarOutline size={13} className="text-blue-400 flex-shrink-0" />
                <span>Date: {fmtDateIST(captureTime)}</span>
              </div>
              <div className="flex items-center gap-2 text-white/90 text-[12px]">
                <IoTimeOutline size={13} className="text-orange-400 flex-shrink-0" />
                <span>Time: {fmtTimeIST(captureTime)}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div className="flex items-center justify-center gap-8 py-6 bg-black/80">
        {captured ? (
          <>
            <button onClick={retake} className="flex flex-col items-center gap-1">
              <div className="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors">
                <IoRefreshOutline size={28} />
              </div>
              <span className="text-white/60 text-[11px]">Retake</span>
            </button>
            <button
              onClick={confirm}
              disabled={generating}
              className="flex flex-col items-center gap-1"
            >
              <div className={`w-14 h-14 rounded-full flex items-center justify-center text-white transition-colors ${generating ? "bg-green-500/40" : "bg-green-500 hover:bg-green-600"}`}>
                <IoCheckmarkOutline size={28} />
              </div>
              <span className="text-white/60 text-[11px]">{generating ? "Wait..." : "Send"}</span>
            </button>
          </>
        ) : (
          <button
            onClick={takePhoto}
            disabled={starting || !!cameraError}
            className="w-[72px] h-[72px] rounded-full border-4 border-white flex items-center justify-center disabled:opacity-30 transition-opacity active:scale-95"
          >
            <div className="w-[60px] h-[60px] rounded-full bg-white" />
          </button>
        )}
      </div>

      {/* Hidden canvas for capture */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
