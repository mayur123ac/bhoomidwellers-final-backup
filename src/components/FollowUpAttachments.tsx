"use client";

import { useCallback, useEffect, useState } from "react";
import { FaFileAlt, FaFilePdf, FaImage, FaDownload, FaTrash, FaExternalLinkAlt } from "react-icons/fa";
import { getStoredCrmUser } from "@/lib/authSession";

interface Attachment {
  id: number;
  follow_up_id: number;
  file_name: string;
  mime_type: string;
  file_size: number;
}

interface Props {
  followUpId: number;
  /** Pre-fetched attachments from the parent (to avoid per-bubble fetches). */
  attachments?: Attachment[];
  textClass?: string;
  /** Called after a deletion so the parent can refresh. */
  onDeleted?: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function iconForMime(mime: string) {
  if (mime.startsWith("image/")) return <FaImage className="text-blue-500 text-xs flex-shrink-0" />;
  if (mime === "application/pdf") return <FaFilePdf className="text-red-500 text-xs flex-shrink-0" />;
  return <FaFileAlt className="text-gray-500 text-xs flex-shrink-0" />;
}

export default function FollowUpAttachments({
  followUpId,
  attachments: prefetched,
  textClass = "",
  onDeleted,
}: Props) {
  const user = getStoredCrmUser();
  const isAdmin = (user?.role || "").trim().toLowerCase().replace(/_/g, " ") === "admin";

  const [attachments, setAttachments] = useState<Attachment[]>(prefetched ?? []);
  const [loading, setLoading] = useState(!prefetched);
  const [downloading, setDownloading] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Attachment | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Cache presigned URLs for image previews: { [attachmentId]: url }
  const [imageUrls, setImageUrls] = useState<Record<number, string>>({});

  // If no prefetched data, fetch for this follow-up
  useEffect(() => {
    if (prefetched) {
      setAttachments(prefetched);
      setLoading(false);
      return;
    }
    fetch("/api/followups/attachments/by-follow-ups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ follow_up_ids: [followUpId] }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (j.success) setAttachments(j.data ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [followUpId, prefetched]);

  // Fetch presigned URLs for image attachments (for thumbnail previews)
  useEffect(() => {
    const images = attachments.filter(a => a.mime_type.startsWith("image/"));
    if (images.length === 0) return;
    images.forEach(att => {
      if (imageUrls[att.id]) return; // already cached
      fetch(`/api/followups/attachments/${att.id}`)
        .then(r => r.json())
        .then(j => {
          if (j.success && j.url) {
            setImageUrls(prev => ({ ...prev, [att.id]: j.url }));
          }
        })
        .catch(() => {});
    });
  }, [attachments]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDownload = useCallback(async (att: Attachment) => {
    setDownloading(att.id);
    try {
      // Use cached URL if available
      let url = imageUrls[att.id];
      if (!url) {
        const res = await fetch(`/api/followups/attachments/${att.id}`);
        const json = await res.json();
        if (json.success && json.url) url = json.url;
      }
      if (url) {
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        if (!att.mime_type.startsWith("image/")) {
          a.download = att.file_name;
        }
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } catch {
      // silently fail
    } finally {
      setDownloading(null);
    }
  }, [imageUrls]);

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/followups/attachments/${confirmDelete.id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setAttachments((prev) => prev.filter((a) => a.id !== confirmDelete.id));
        setConfirmDelete(null);
        onDeleted?.();
      } else {
        alert(json.message || "Failed to delete attachment.");
      }
    } catch {
      alert("Failed to delete attachment.");
    } finally {
      setDeleting(false);
    }
  };

  if (loading || attachments.length === 0) return null;

  const imageAtts = attachments.filter(a => a.mime_type.startsWith("image/"));
  const docAtts = attachments.filter(a => !a.mime_type.startsWith("image/"));

  return (
    <>
      <div className="mt-1.5 space-y-1.5">
        {/* Image thumbnails grid */}
        {imageAtts.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {imageAtts.map(att => (
              <div key={att.id} className="relative group">
                <button
                  type="button"
                  onClick={() => handleDownload(att)}
                  disabled={downloading === att.id}
                  className="block w-20 h-20 rounded-lg overflow-hidden border border-gray-200/50 hover:border-blue-400 transition-colors bg-gray-100"
                  title={`${att.file_name} (${formatSize(att.file_size)})`}
                >
                  {imageUrls[att.id] ? (
                    <img
                      src={imageUrls[att.id]}
                      alt={att.file_name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <FaImage className="text-gray-300 text-lg" />
                    </div>
                  )}
                  {downloading === att.id && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-lg">
                      <span className="text-white text-[8px] animate-pulse">Opening...</span>
                    </div>
                  )}
                </button>
                {/* Overlay with name */}
                <div className="absolute bottom-0 left-0 right-0 bg-black/50 rounded-b-lg px-1 py-0.5 pointer-events-none">
                  <p className="text-[7px] text-white truncate">{att.file_name}</p>
                </div>
                {/* Delete button */}
                <button
                  type="button"
                  onClick={() => setConfirmDelete(att)}
                  className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/60 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Delete attachment"
                >
                  <FaTrash className="text-white text-[6px]" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Document file cards */}
        {docAtts.map((att) => (
          <div
            key={att.id}
            className="flex items-center gap-2 group"
          >
            {iconForMime(att.mime_type)}
            <button
              type="button"
              onClick={() => handleDownload(att)}
              disabled={downloading === att.id}
              className={`text-xs font-medium underline underline-offset-2 hover:opacity-80 transition truncate max-w-[200px] ${textClass}`}
              title={`${att.file_name} (${formatSize(att.file_size)})`}
            >
              {downloading === att.id ? "Opening..." : att.file_name}
            </button>
            <span className={`text-[10px] opacity-50 ${textClass}`}>
              {formatSize(att.file_size)}
            </span>
            <button
              type="button"
              onClick={() => setConfirmDelete(att)}
              className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition ml-auto"
              title="Delete attachment"
            >
              <FaTrash className="text-[9px]" />
            </button>
          </div>
        ))}
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 animate-fadeIn">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden mx-4">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="font-bold text-sm text-gray-900">Delete attachment?</h3>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-gray-600 leading-relaxed">
                This will permanently delete <strong>{confirmDelete.file_name}</strong> from
                cloud storage. The follow-up message will remain. This action cannot be undone.
              </p>
            </div>
            <div className="flex gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
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
                  <><FaTrash className="text-[9px]" /> Delete</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
