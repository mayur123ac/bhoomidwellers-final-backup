import { useState, useCallback, useRef } from "react";
import type { PendingFile } from "@/components/FollowUpAttachmentPicker";
import { validateFiles } from "@/components/FollowUpAttachmentPicker";

/**
 * Hook to manage pending file attachments for follow-up messages.
 *
 * Usage:
 *   1. Call addFiles() when the user selects files
 *   2. Before sending: call snapshotAndClear() to capture + clear
 *   3. After follow-up created: call uploadSnapshot(followUpId)
 *   4. On failure: call restoreSnapshot() to put files back
 */
export function useFollowUpAttachments() {
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const snapshotRef = useRef<PendingFile[]>([]);

  const addFiles = useCallback((files: File[]) => {
    setFileError(null);
    const error = validateFiles(files, pendingFiles.length);
    if (error) {
      setFileError(error);
      return;
    }
    const newPending: PendingFile[] = files.map((f) => ({
      file: f,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    }));
    setPendingFiles((prev) => [...prev, ...newPending]);
  }, [pendingFiles.length]);

  const removeFile = useCallback((id: string) => {
    setPendingFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const snapshotAndClear = useCallback((): boolean => {
    snapshotRef.current = [...pendingFiles];
    setPendingFiles([]);
    setFileError(null);
    return snapshotRef.current.length > 0;
  }, [pendingFiles]);

  /** Restore files from snapshot back into the pending list (for retry on failure). */
  const restoreSnapshot = useCallback(() => {
    if (snapshotRef.current.length > 0) {
      setPendingFiles(snapshotRef.current);
      snapshotRef.current = [];
    }
  }, []);

  const uploadSnapshot = useCallback(
    async (followUpId: number | string): Promise<boolean> => {
      const files = snapshotRef.current;
      if (files.length === 0) return true;
      setUploading(true);
      try {
        const formData = new FormData();
        formData.append("follow_up_id", String(followUpId));
        for (const pf of files) {
          formData.append("files", pf.file);
        }
        const res = await fetch("/api/followups/attachments", {
          method: "POST",
          body: formData,
        });
        const json = await res.json().catch(() => null);
        if (res.ok && json?.success) {
          snapshotRef.current = [];
          return true;
        }
        console.error("Attachment upload failed:", json?.message);
        return false;
      } catch (err) {
        console.error("Attachment upload error:", err);
        return false;
      } finally {
        setUploading(false);
      }
    },
    []
  );

  const clearFiles = useCallback(() => {
    setPendingFiles([]);
    snapshotRef.current = [];
    setFileError(null);
  }, []);

  return {
    pendingFiles,
    uploading,
    fileError,
    addFiles,
    removeFile,
    snapshotAndClear,
    restoreSnapshot,
    uploadSnapshot,
    clearFiles,
  };
}
