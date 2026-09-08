"use client";

import { useRef, useState } from "react";
import { FaPaperclip, FaTimes, FaFileAlt, FaFilePdf, FaImage } from "react-icons/fa";

/** Client-side allowed types (mirrors server-side ALLOWED_MIME_TYPES). */
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

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_FILES = 5;

export interface PendingFile {
  file: File;
  id: string;
}

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

/** Just the paperclip button. Renders inline in the form bar. */
export function AttachButton({
  onFiles,
  currentCount,
  isDark,
}: {
  onFiles: (files: File[]) => void;
  currentCount: number;
  isDark?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    if (selected.length > 0) onFiles(selected);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={`w-9 h-9 flex-shrink-0 rounded-xl flex items-center justify-center cursor-pointer transition-colors relative ${
          isDark
            ? "text-gray-400 hover:text-blue-400 hover:bg-white/5"
            : "text-gray-400 hover:text-blue-600 hover:bg-blue-50"
        }`}
        title="Attach files"
      >
        <FaPaperclip className="text-xs" />
        {currentCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-blue-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center">
            {currentCount}
          </span>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        onChange={handleChange}
        className="hidden"
      />
    </>
  );
}

/** Pending file list — shown above/below the composer. */
export function PendingFileList({
  files,
  onRemove,
  isDark,
}: {
  files: PendingFile[];
  onRemove: (id: string) => void;
  isDark?: boolean;
}) {
  if (files.length === 0) return null;

  return (
    <div className={`px-3 py-1.5 border-t flex flex-wrap gap-1.5 ${
      isDark ? "border-gray-700 bg-gray-900/50" : "border-gray-100 bg-gray-50"
    }`}>
      {files.map((pf) => (
        <span
          key={pf.id}
          className={`inline-flex items-center gap-1 text-[10px] rounded-lg px-2 py-0.5 ${
            isDark ? "bg-gray-800 text-gray-300" : "bg-white border border-gray-200 text-gray-600"
          }`}
        >
          {iconForType(pf.file.type)}
          <span className="truncate max-w-[120px]">{pf.file.name}</span>
          <span className="opacity-50">{formatSize(pf.file.size)}</span>
          <button
            type="button"
            onClick={() => onRemove(pf.id)}
            className="text-gray-400 hover:text-red-500 ml-0.5"
          >
            <FaTimes className="text-[8px]" />
          </button>
        </span>
      ))}
    </div>
  );
}

/** Validates files client-side. Returns error message or null. */
export function validateFiles(
  newFiles: File[],
  existingCount: number
): string | null {
  const total = existingCount + newFiles.length;
  if (total > MAX_FILES) return `Maximum ${MAX_FILES} files per message.`;
  for (const f of newFiles) {
    if (f.size > MAX_FILE_SIZE) return `"${f.name}" exceeds the 10 MB limit.`;
  }
  return null;
}
