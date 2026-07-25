"use client";
// components/SelfUploadLeadSheet.tsx
// Sales Manager self-upload entry point. Renders the bulk-import modal in "self" mode
// ONLY when the admin has enabled organization_settings.allow_sm_upload.
import { useEffect, useState } from "react";
import UploadLeadSheet from "./UploadLeadSheet";

interface SelfUploadLeadSheetProps {
  isDark?: boolean;
  onImported?: () => void;
  buttonClassName?: string;
  buttonLabel?: string;
}

export default function SelfUploadLeadSheet({
  isDark = false,
  onImported,
  buttonClassName,
  buttonLabel = "Bulk Import",
}: SelfUploadLeadSheetProps) {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings/sm-upload")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setAllowed(data?.enabled === true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!allowed) return null;

  return (
    <UploadLeadSheet
      mode="self"
      isDark={isDark}
      onImported={onImported}
      buttonClassName={buttonClassName}
      buttonLabel={buttonLabel}
    />
  );
}
