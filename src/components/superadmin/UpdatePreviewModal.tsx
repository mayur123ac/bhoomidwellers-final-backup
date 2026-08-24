"use client";

// components/superadmin/UpdatePreviewModal.tsx — "View": the announcement as a
// CRM user will actually see it.
//
// The brief asks for a preview of exactly how the update will appear. So this
// reproduces the System Updates card from components/CrmUpdatesNotification.tsx
// — same order of elements, same version badge, same Important flag, same
// ticked highlight list — and renders the body through the same UpdateBody
// component that panel uses. Nothing here is a stylised approximation of the
// real thing.
//
// The one honest difference is the unread state: a preview belongs to nobody, so
// there is no reader whose read mark could be shown. It is labelled rather than
// faked.

import type { SuperAdminTheme } from "./theme";
import { tint } from "./theme";
import { Btn, Modal } from "./dialogs";
import UpdateBody from "./UpdateBody";
import { fmtDate } from "./ui";

export interface PreviewUpdate {
  version: string;
  title: string;
  description: string | null;
  type: string | null;
  features: string[];
  isImportant: boolean;
  status: "draft" | "published";
  publishedAt: string | null;
  createdAt: string;
  readCount?: number;
}

export default function UpdatePreviewModal({
  open, t, update, onClose,
}: {
  open: boolean;
  t: SuperAdminTheme;
  update: PreviewUpdate | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open && update !== null}
      t={t}
      title="Update Preview"
      subtitle="Exactly how this appears in every user's System Updates panel."
      onClose={onClose}
      footer={<Btn t={t} tone="quiet" onClick={onClose}>Close</Btn>}
    >
      {update && (
        <div className="space-y-4">
          {/* The card, reproducing the CRM panel's layout. */}
          <div
            className="rounded-2xl p-4"
            style={{
              background: update.isImportant ? tint(t.accent, 0.06) : t.raised,
              border: `1px solid ${update.isImportant ? tint(t.accent, 0.22) : t.border}`,
            }}
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="px-2 py-0.5 rounded text-[10px] font-bold"
                  style={{ color: t.info, background: tint(t.info, 0.14) }}
                >
                  v{update.version.replace(/^v/i, "")}
                </span>
                {update.type && (
                  <span
                    className="px-2 py-0.5 rounded text-[10px] font-semibold"
                    style={{ color: t.textMuted, background: t.surface }}
                  >
                    {update.type}
                  </span>
                )}
                {update.isImportant && (
                  <span className="flex items-center gap-1 text-[10px] font-bold" style={{ color: t.danger }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2 1 21h22L12 2Zm0 6 6.5 11h-13L12 8Zm-1 3v4h2v-4h-2Zm0 5v2h2v-2h-2Z" />
                    </svg>
                    Important
                  </span>
                )}
                {/* Unread dot, as users see it before opening. */}
                <span className="w-2 h-2 rounded-full" style={{ background: t.accent }} />
              </div>
              <span className="text-[10px] whitespace-nowrap" style={{ color: t.textMuted }}>
                {fmtDate(update.publishedAt ?? update.createdAt)}
              </span>
            </div>

            <h4 className="text-[14px] font-bold" style={{ color: t.text }}>{update.title}</h4>

            {update.description?.trim() && (
              <div className="mt-2">
                <UpdateBody t={t} content={update.description} />
              </div>
            )}

            {update.features.length > 0 && (
              <ul className="mt-3 space-y-1">
                {update.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[11px]" style={{ color: t.textMuted }}>
                    <svg
                      width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={t.accent}
                      strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"
                      className="mt-[3px] flex-shrink-0"
                    >
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Facts about the record, kept outside the reproduction so the card
              above stays a faithful preview rather than a card with extras. */}
          <div className="text-[11px] leading-relaxed" style={{ color: t.textMuted }}>
            {update.status === "published" ? (
              <>
                Published {fmtDate(update.publishedAt)}. Read by{" "}
                <strong style={{ color: t.text }}>{update.readCount ?? 0}</strong>{" "}
                {update.readCount === 1 ? "user" : "users"} so far — unread for everyone else.
              </>
            ) : (
              <>This is a draft. No CRM user can see it, and it counts as unread for nobody yet.</>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
