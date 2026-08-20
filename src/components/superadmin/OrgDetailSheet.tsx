"use client";

// Organization detail. Read-only in Phase 1, as specified.
//
// One component serves both breakpoints: a right-hand drawer on desktop and a
// bottom sheet on mobile, because they are the same content with a different
// entry animation. Both close on backdrop click and on Escape — a panel that
// traps you is a panel people stop opening.

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { SuperAdminTheme } from "./theme";
import type { OrgRow } from "./mockData";
import { StatusPill, DetailRow, StatTile, fmtDate, fmtRelative, PlaceholderAction } from "./ui";

export default function OrgDetailSheet({
  org, t, onClose,
}: { org: OrgRow | null; t: SuperAdminTheme; onClose: () => void }) {
  useEffect(() => {
    if (!org) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [org, onClose]);

  return (
    <AnimatePresence>
      {org && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[120]"
            style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(2px)" }}
          />

          <motion.aside
            // Slides up on mobile, in from the right on desktop. The transform
            // origin differs per breakpoint, so both are expressed here and the
            // CSS class decides which edge the panel is pinned to.
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ type: "spring", damping: 30, stiffness: 260 }}
            className={[
              "fixed z-[130] flex flex-col overflow-hidden",
              "inset-x-0 bottom-0 max-h-[88vh] rounded-t-[26px]",
              "sm:inset-y-0 sm:right-0 sm:left-auto sm:bottom-auto sm:w-[440px] sm:max-h-none sm:rounded-none sm:rounded-l-[26px]",
            ].join(" ")}
            style={{ background: t.surface, borderLeft: `1px solid ${t.border}` }}
          >
            <div className="flex-shrink-0 px-5 pt-3 pb-4" style={{ borderBottom: `1px solid ${t.border}` }}>
              <div className="sm:hidden flex justify-center pb-3">
                <span className="w-10 h-1 rounded-full" style={{ background: t.borderStrong }} />
              </div>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-[17px] font-semibold tracking-tight leading-snug" style={{ color: t.text }}>
                    {org.name}
                  </h2>
                  <div className="mt-2"><StatusPill status={org.status} t={t} /></div>
                </div>
                <button
                  onClick={onClose}
                  aria-label="Close"
                  className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-colors"
                  style={{ background: t.raised, color: t.textMuted }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-7">
              <section>
                <div className="grid grid-cols-2 gap-3">
                  <StatTile t={t} label="Users" value={org.users} />
                  <StatTile t={t} label="Leads" value={org.leads} />
                  <StatTile t={t} label="Bookings" value={org.bookings} />
                  <StatTile t={t} label="Projects" value={org.projects} />
                </div>
              </section>

              <section>
                <h3 className="text-[12px] font-semibold uppercase tracking-[0.06em] mb-1" style={{ color: t.textMuted }}>
                  Organization
                </h3>
                <div style={{ borderTop: `1px solid ${t.border}` }}>
                  <DetailRow t={t} label="Name" value={org.name} />
                  <DetailRow t={t} label="Organization ID" value={org.id} mono />
                  <DetailRow t={t} label="Status" value={<StatusPill status={org.status} t={t} />} />
                  <DetailRow t={t} label="Created" value={fmtDate(org.createdOn)} />
                  <DetailRow t={t} label="Last Activity" value={fmtRelative(org.lastActivity)} />
                  <DetailRow t={t} label="Admins" value={org.admins} />
                </div>
              </section>

              <section>
                <h3 className="text-[12px] font-semibold uppercase tracking-[0.06em] mb-2" style={{ color: t.textMuted }}>
                  Actions
                </h3>
                <div className="flex flex-wrap gap-2">
                  <PlaceholderAction t={t} label="Suspend organization" />
                  <PlaceholderAction t={t} label="Manage users" />
                  <PlaceholderAction t={t} label="View audit trail" />
                </div>
                <p className="text-[11px] mt-3 leading-relaxed" style={{ color: t.textMuted }}>
                  Read-only in Phase 1. These actions become live once the platform APIs
                  and Super Admin authorization exist.
                </p>
              </section>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
