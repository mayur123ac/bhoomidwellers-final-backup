"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { FaPaperPlane, FaPaperclip, FaClock, FaTimes, FaImage, FaFilePdf, FaFileAlt } from "react-icons/fa";
import type { PendingFile } from "@/components/FollowUpAttachmentPicker";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_FILES = 5;
const ACCEPT = [
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain", "text/csv",
].join(",");

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function iconForType(type: string) {
  if (type.startsWith("image/")) return <FaImage className="text-blue-400 text-[10px]" />;
  if (type === "application/pdf") return <FaFilePdf className="text-red-400 text-[10px]" />;
  return <FaFileAlt className="text-gray-400 text-[10px]" />;
}

interface FollowUpComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (e: React.FormEvent<any>) => void;
  pendingFiles: PendingFile[];
  fileError: string | null;
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (id: string) => void;
  onReminderClick: () => void;
  isDark?: boolean;
  theme: any;
  placeholder?: string;
  /** Variant to match existing size classes */
  size?: "compact" | "normal";
  /** Use headerGlass style */
  headerGlass?: React.CSSProperties;
}

export default function FollowUpComposer({
  value,
  onChange,
  onSubmit,
  pendingFiles,
  fileError,
  onAddFiles,
  onRemoveFile,
  onReminderClick,
  isDark = false,
  theme,
  placeholder = "Add a note...",
  size = "normal",
  headerGlass,
}: FollowUpComposerProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // Auto-resize textarea
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit(e as any);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    if (selected.length > 0) onAddFiles(selected);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) onAddFiles(files);
  }, [onAddFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const isCompact = size === "compact";
  const hasFiles = pendingFiles.length > 0;
  const hasImageFiles = pendingFiles.some(f => f.file.type.startsWith("image/"));
  const imageFiles = pendingFiles.filter(f => f.file.type.startsWith("image/"));
  const docFiles = pendingFiles.filter(f => !f.file.type.startsWith("image/"));

  return (
    <div
      className={`border-t flex-shrink-0 ${isDark ? "border-white/10" : "border-gray-200"}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* Drop overlay */}
      {dragOver && (
        <div className={`px-4 py-3 text-center text-xs font-medium ${
          isDark ? "bg-blue-500/10 text-blue-400" : "bg-blue-50 text-blue-600"
        }`}>
          Drop files here
        </div>
      )}

      {/* Pending files area */}
      {hasFiles && (
        <div className={`px-3 pt-2.5 pb-1 space-y-2 ${
          isDark ? "bg-gray-900/30" : "bg-gray-50/50"
        }`}>
          {/* Image thumbnails */}
          {imageFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {imageFiles.map(pf => (
                <ImageThumb key={pf.id} file={pf} onRemove={onRemoveFile} isDark={isDark} />
              ))}
            </div>
          )}
          {/* Document file cards */}
          {docFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {docFiles.map(pf => (
                <DocCard key={pf.id} file={pf} onRemove={onRemoveFile} isDark={isDark} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Error message */}
      {fileError && (
        <div className="px-3 py-1">
          <p className="text-[10px] text-red-500">{fileError}</p>
        </div>
      )}

      {/* Input row */}
      <form
        onSubmit={onSubmit}
        className={`flex gap-2 items-end ${isCompact ? "p-3" : "p-3 sm:p-4"}`}
        style={headerGlass}
      >
        <textarea
          ref={inputRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          className={`flex-1 resize-none rounded-xl outline-none transition-colors border ${
            isCompact ? "px-3 py-2 text-sm" : "px-3 py-2.5 sm:px-4 sm:py-3 text-xs sm:text-sm"
          } ${theme.inputInner || theme.inputBg || ""} ${theme.text} ${theme.inputFocus}`}
          style={{ maxHeight: 120, minHeight: isCompact ? 36 : 40 }}
        />
        {/* Attach button */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className={`flex-shrink-0 rounded-xl flex items-center justify-center cursor-pointer transition-colors relative ${
            isCompact ? "w-9 h-9" : "w-10 h-10 sm:w-11 sm:h-11"
          } ${isDark
            ? "text-gray-400 hover:text-blue-400 hover:bg-white/5"
            : "text-gray-400 hover:text-blue-600 hover:bg-blue-50"
          }`}
          title="Attach files"
        >
          <FaPaperclip className={isCompact ? "text-xs" : "text-xs sm:text-sm"} />
          {hasFiles && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-blue-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center">
              {pendingFiles.length}
            </span>
          )}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT}
          onChange={handleFileSelect}
          className="hidden"
        />
        {/* Reminder button */}
        <button
          type="button"
          title="Set follow-up reminder"
          onClick={onReminderClick}
          className={`flex-shrink-0 rounded-xl flex items-center justify-center cursor-pointer transition-colors ${
            isCompact ? "w-9 h-9" : "w-10 h-10 sm:w-11 sm:h-11"
          } ${isDark
            ? "text-gray-400 hover:text-purple-400 hover:bg-white/5"
            : "text-gray-400 hover:text-purple-600 hover:bg-purple-50"
          }`}
        >
          <FaClock className={isCompact ? "text-xs" : "text-xs sm:text-sm"} />
        </button>
        {/* Send button */}
        <button
          type="submit"
          className={`flex-shrink-0 text-white rounded-xl flex items-center justify-center cursor-pointer transition-colors shadow-lg ${
            isCompact ? "w-9 h-9" : "w-10 h-10 sm:w-11 sm:h-11"
          } ${isDark ? "bg-[#9E217B] hover:bg-[#b8268f]" : "bg-[#9E217B] hover:bg-[#8a1d6b]"}`}
        >
          <FaPaperPlane className={`ml-[-1px] ${isCompact ? "text-xs" : "text-xs sm:text-sm"}`} />
        </button>
      </form>
    </div>
  );
}

/* ── Image Thumbnail ────────────────────────────────────────────────────── */
function ImageThumb({
  file,
  onRemove,
  isDark,
}: {
  file: PendingFile;
  onRemove: (id: string) => void;
  isDark: boolean;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file.file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file.file]);

  return (
    <div className={`relative group w-16 h-16 rounded-lg overflow-hidden border ${
      isDark ? "border-gray-700 bg-gray-800" : "border-gray-200 bg-gray-100"
    }`}>
      {src && (
        <img src={src} alt={file.file.name} className="w-full h-full object-cover" />
      )}
      <button
        type="button"
        onClick={() => onRemove(file.id)}
        className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/60 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <FaTimes className="text-white text-[7px]" />
      </button>
      <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-1 py-0.5">
        <p className="text-[7px] text-white truncate">{file.file.name}</p>
      </div>
    </div>
  );
}

/* ── Document Card ──────────────────────────────────────────────────────── */
function DocCard({
  file,
  onRemove,
  isDark,
}: {
  file: PendingFile;
  onRemove: (id: string) => void;
  isDark: boolean;
}) {
  return (
    <div className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 group ${
      isDark ? "bg-gray-800 border border-gray-700" : "bg-white border border-gray-200"
    }`}>
      {iconForType(file.file.type)}
      <div className="min-w-0">
        <p className={`text-[10px] font-medium truncate max-w-[120px] ${isDark ? "text-gray-200" : "text-gray-700"}`}>
          {file.file.name}
        </p>
        <p className={`text-[8px] ${isDark ? "text-gray-500" : "text-gray-400"}`}>
          {formatSize(file.file.size)}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onRemove(file.id)}
        className="text-gray-400 hover:text-red-500 ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <FaTimes className="text-[8px]" />
      </button>
    </div>
  );
}
