"use client";
/* ══════════════════════════════════════════════════════════════════════════
   FinancialPositionCard.tsx — the read-only face of the Financial Obligation
   Engine.

   Every number here comes from GET /api/booking-applications/[id]/financial-status.
   Nothing on this screen is re-derived: no summing of payment components, no
   comparing totals, no deciding what is "paid". That arithmetic lives in
   lib/financialObligationEngine.ts and only there — screens computing their own
   answers is the defect this whole engine exists to remove.

   The only arithmetic below is the progress bar's fill percentage, which is
   presentation (pixels), not finance.
   ══════════════════════════════════════════════════════════════════════════ */

import React, { useCallback, useEffect, useState } from "react";
import { FaLock, FaExclamationTriangle, FaInfoCircle } from "react-icons/fa";
import type { FinancialObligation, FinancialSnapshot } from "@/lib/financialObligationEngine";
import { getStoredCrmUser } from "@/lib/authSession";
import TrancheOverrideModal from "@/components/TrancheOverrideModal";

/** Matches the money idiom already used across LoanDealView / LoanDealForm. */
const inr = (n: number) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

export interface FinancialStatusState {
  obligation: FinancialObligation | null;
  snapshot: FinancialSnapshot | null;
  loading: boolean;
  /** Set when the fetch failed. Callers must fail OPEN on this — never block work. */
  error: string | null;
  /** Re-read after something changes the booking's financial position. */
  refetch: () => void;
}

/**
 * Shared fetch for the derived financial state of one booking.
 *
 * Pass `null` for an unsaved booking: there is no booking row yet, so there is
 * nothing to derive and no request is made.
 */
export function useFinancialStatus(bookingId: number | string | null | undefined): FinancialStatusState {
  const [state, setState] = useState<Omit<FinancialStatusState, "refetch">>({
    obligation: null, snapshot: null, loading: !!bookingId, error: null,
  });
  // Bumped to force a re-read; the effect below owns all fetching so there is
  // one code path whether the trigger is mount or an override.
  const [nonce, setNonce] = useState(0);
  const refetch = useCallback(() => setNonce(n => n + 1), []);

  useEffect(() => {
    if (!bookingId) {
      setState({ obligation: null, snapshot: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState(s => ({ ...s, loading: true, error: null }));
    fetch(`/api/booking-applications/${bookingId}/financial-status`)
      .then(async r => {
        const json = await r.json().catch(() => ({}));
        if (!r.ok || !json?.success) throw new Error(json?.error || `HTTP ${r.status}`);
        return json;
      })
      .then(json => {
        if (cancelled) return;
        setState({ obligation: json.obligation, snapshot: json.snapshot, loading: false, error: null });
      })
      .catch(err => {
        if (cancelled) return;
        console.error("[financial-status]", err);
        setState({ obligation: null, snapshot: null, loading: false, error: err?.message || "fetch failed" });
      });
    return () => { cancelled = true; };
  }, [bookingId, nonce]);

  return { ...state, refetch };
}

// ─── Status vocabularies → colour ────────────────────────────────────────────

const OVERALL_BADGE: Record<string, { label: string; cls: string }> = {
  Mismatch: { label: "MISMATCH — Admin Review Required", cls: "text-red-500 border-red-500/40 bg-red-500/10" },
  Overpaid: { label: "OVERPAID", cls: "text-orange-500 border-orange-500/40 bg-orange-500/10" },
  Paid: { label: "FULLY PAID", cls: "text-emerald-500 border-emerald-500/40 bg-emerald-500/10" },
  Partial: { label: "PARTIAL", cls: "text-blue-500 border-blue-500/40 bg-blue-500/10" },
  Pending: { label: "PENDING", cls: "text-gray-500 border-gray-400/40 bg-gray-500/10" },
};

const CHARGE_BADGE: Record<string, string> = {
  Paid: "text-emerald-500 border-emerald-500/40 bg-emerald-500/10",
  Partial: "text-amber-500 border-amber-500/40 bg-amber-500/10",
  Pending: "text-gray-500 border-gray-400/40 bg-gray-500/10",
  Locked: "text-gray-500 border-gray-400/40 bg-gray-500/10",
};

function ChargeBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full border align-middle ${CHARGE_BADGE[status] || CHARGE_BADGE.Pending}`}>
      {status === "Locked" && <FaLock className="text-[7px]" />}
      {status.toUpperCase()}
    </span>
  );
}

/** Roles allowed to override — mirrors OVERRIDE_ROLES on the tranche-override
 *  route. If these two lists drift, the button renders and the POST 403s. */
export function canOverride(role: unknown): boolean {
  const clean = String(role ?? "").trim().toLowerCase().replace(/_/g, " ");
  return clean === "admin" || clean === "superadmin";
}

/**
 * Phase 6. Live for admins, inert for everyone else.
 *
 * Only the disbursement-tranche gate is overridable — it is the one financial
 * action with no other path once a loan breaches its ceiling. Every other
 * correction (reducing OCR, reducing a sanction, unrelated edits) already goes
 * through the normal routes, so there is no general "adjust anything" button
 * here and should not be one.
 */
function RequestAdjustmentButton({ t, isAdmin, onOverride }: { t: any; isAdmin: boolean; onOverride?: () => void }) {
  if (isAdmin && onOverride) {
    return (
      <button
        type="button"
        onClick={onOverride}
        className="text-[10px] font-bold px-2 py-1 rounded-lg border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-colors"
      >
        Admin Override
      </button>
    );
  }
  return (
    <button
      type="button"
      disabled
      title="Contact your admin to approve this adjustment"
      className={`text-[10px] font-bold px-2 py-1 rounded-lg border cursor-not-allowed opacity-60 ${t.tableBorder} ${t.textMuted}`}
    >
      Request Adjustment
    </button>
  );
}

const SEVERITY_STYLE: Record<string, { cls: string; icon: React.ReactNode }> = {
  critical: { cls: "border-red-500/40 bg-red-500/10 text-red-400", icon: <FaExclamationTriangle className="text-[11px] flex-shrink-0 mt-0.5" /> },
  error: { cls: "border-orange-500/40 bg-orange-500/10 text-orange-400", icon: <FaExclamationTriangle className="text-[11px] flex-shrink-0 mt-0.5" /> },
  warning: { cls: "border-yellow-500/40 bg-yellow-500/10 text-yellow-500", icon: <FaInfoCircle className="text-[11px] flex-shrink-0 mt-0.5" /> },
};

const SEVERITY_ORDER = ["critical", "error", "warning"] as const;

/**
 * System-derived, so there is no dismiss: a banner disappears when the numbers
 * stop contradicting each other, not when someone clicks it away.
 */
export function FinancialValidationBanners({
  obligation, t, isAdmin = false, onOverride,
}: { obligation: FinancialObligation; t: any; isAdmin?: boolean; onOverride?: () => void }) {
  const ordered = SEVERITY_ORDER.flatMap(sev => obligation.validationErrors.filter(e => e.severity === sev));
  if (!ordered.length) return null;

  return (
    <div className="space-y-2 mb-5">
      {ordered.map((e, i) => {
        const style = SEVERITY_STYLE[e.severity] || SEVERITY_STYLE.warning;
        const needsAdmin = obligation.requiresAdminOverride.includes(e.code);
        return (
          <div key={`${e.code}-${i}`} className={`rounded-lg border px-3 py-2 text-[11px] flex items-start gap-2 ${style.cls}`}>
            {style.icon}
            <span className="flex-1">
              {e.message}
              {needsAdmin && (
                <span className="inline-flex items-center gap-2 ml-2">
                  <span className="opacity-80">Contact admin to adjust —</span>
                  <RequestAdjustmentButton t={t} isAdmin={isAdmin} onOverride={onOverride} />
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Skeleton({ isDark }: { isDark: boolean }) {
  const bar = isDark ? "bg-gray-700/50" : "bg-gray-200";
  return (
    <div className="rounded-xl border p-4 mb-5 animate-pulse border-gray-500/20">
      <div className={`h-3 w-40 rounded ${bar} mb-4`} />
      <div className={`h-2.5 w-full rounded-full ${bar} mb-3`} />
      <div className={`h-3 w-2/3 rounded ${bar} mb-2`} />
      <div className={`h-3 w-1/2 rounded ${bar}`} />
    </div>
  );
}

interface Props {
  bookingId: number | string | null | undefined;
  isDark?: boolean;
  t: any;
}

export default function FinancialPositionCard({ bookingId, isDark = false, t }: Props) {
  const { obligation, snapshot, loading, error, refetch } = useFinancialStatus(bookingId);
  // Role comes from the stored CRM session rather than a prop: this card is
  // rendered from LoanDealView, which has no `user` in its signature, and
  // threading one through four dashboard call sites to decide a button label
  // would be a lot of churn for a check the server repeats anyway.
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => { setIsAdmin(canOverride(getStoredCrmUser()?.role)); }, []);
  const [showOverride, setShowOverride] = useState(false);
  const [overrideToast, setOverrideToast] = useState<string | null>(null);

  // No booking yet (lead-level draft) — there is no agreement to fund, so the
  // card would have nothing true to say.
  if (!bookingId) return null;
  if (loading) return <Skeleton isDark={isDark} />;
  if (error || !obligation) {
    return (
      <div className={`rounded-xl border p-3 mb-5 text-[11px] ${t.tableBorder} ${t.textMuted}`}>
        Could not load financial position{error ? ` (${error})` : ""}.
      </div>
    );
  }

  const badge = OVERALL_BADGE[obligation.overallStatus] || OVERALL_BADGE.Pending;
  const overfunded = obligation.agreementFunded > obligation.agreementValue;
  const fillPct = obligation.agreementValue > 0
    ? Math.min(100, (obligation.agreementFunded / obligation.agreementValue) * 100)
    : 0;
  const barColour = overfunded
    ? "bg-red-500"
    : obligation.agreementFundingStatus === "Paid" || obligation.agreementFundingStatus === "Locked"
      ? "bg-emerald-500"
      : "bg-[#00AEEF]";

  // totalRemaining is the engine's figure; its sign decides the wording. Not a
  // recalculation — only which label goes next to a number already computed.
  const overpaidBy = obligation.totalRemaining < 0 ? Math.abs(obligation.totalRemaining) : 0;
  const considerationMismatch = obligation.validationErrors.find(e => e.code === "CONSIDERATION_MISMATCH");

  return (
    <>
      <div className={`rounded-xl border p-4 mb-5 ${isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-white border-[#E5E7EB]"}`}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <p className={`crm-eyebrow ${t.textMuted}`}>Financial Position</p>
          <span className={`text-[9px] font-bold px-2 py-1 rounded-full border text-right ${badge.cls}`}>{badge.label}</span>
        </div>

        {/* ── Agreement funding ── */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className={`crm-eyebrow ${t.textMuted}`}>Agreement Funding</span>
            <ChargeBadge status={obligation.agreementFundingStatus} />
          </div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className={`text-sm font-bold ${t.text}`}>{inr(obligation.agreementFunded)}</span>
            <span className={`text-[11px] ${t.textFaint}`}>/ {inr(obligation.agreementValue)}</span>
          </div>
          <div className={`w-full h-2.5 rounded-full overflow-hidden ${isDark ? "bg-gray-700/60" : "bg-gray-200"}`}>
            <div className={`h-full rounded-full transition-all duration-700 ${barColour}`} style={{ width: `${fillPct}%` }} />
          </div>
          {overfunded && (
            <p className="text-[10px] mt-1 font-semibold text-red-500">
              Overfunded by {inr(obligation.agreementFunded - obligation.agreementValue)}
            </p>
          )}
        </div>

        {/* ── Additional charges — never gated by agreement funding ── */}
        <div className={`border-t pt-3 mb-4 ${t.tableBorder}`}>
          <p className={`crm-eyebrow mb-2 ${t.textMuted}`}>
            Additional Charges <span className="font-normal normal-case opacity-70">(separate from agreement)</span>
          </p>
          {/* Per-charge amounts come from the snapshot the endpoint echoes back —
              the obligation carries only the GST figure and the total, and this
              card must never reconstruct the individual numbers itself. */}
          <div className={`flex flex-wrap gap-x-3 gap-y-1.5 text-[11px] ${t.textMuted}`}>
            <span>GST <b className={t.text}>{inr(obligation.gstAmount)}</b> <ChargeBadge status={obligation.gstStatus} /></span>
            <span>Stamp <b className={t.text}>{inr(snapshot?.stampDutyAmount ?? 0)}</b> <ChargeBadge status={obligation.stampDutyStatus} /></span>
            <span>Reg <b className={t.text}>{inr(snapshot?.registrationFee ?? 0)}</b> <ChargeBadge status={obligation.registrationStatus} /></span>
            <span>Legal <b className={t.text}>{inr(snapshot?.legalCharges ?? 0)}</b></span>
            <span>Maint <b className={t.text}>{inr(snapshot?.maintenanceDeposit ?? 0)}</b></span>
            {!!snapshot?.customCharges && <span>Custom <b className={t.text}>{inr(snapshot.customCharges)}</b></span>}
            {!!snapshot?.possessionCharges && <span>Possession <b className={t.text}>{inr(snapshot.possessionCharges)}</b></span>}
          </div>
          <div className="flex items-center justify-between mt-2">
            <span className={`text-[11px] font-semibold ${t.textMuted}`}>Total Additional</span>
            <span className={`text-sm font-bold ${t.text}`}>{inr(obligation.totalAdditionalCharges)}</span>
          </div>
        </div>

        {/* ── Totals ── */}
        <div className={`border-t pt-3 space-y-1.5 ${t.tableBorder}`}>
          <div className="flex items-center justify-between">
            <span className={`text-[11px] ${t.textMuted}`}>Total Customer Liability</span>
            <span className={`text-sm font-bold ${t.text}`}>{inr(obligation.totalCustomerLiability)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className={`text-[11px] ${t.textMuted}`}>Total Paid</span>
            <span className="text-sm font-bold text-emerald-500">{inr(obligation.totalPaid)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className={`text-[11px] font-semibold ${overpaidBy > 0 ? "text-orange-500" : t.textMuted}`}>
              {overpaidBy > 0 ? "Overpaid by" : "Remaining"}
            </span>
            <span className={`text-sm font-extrabold ${overpaidBy > 0 ? "text-orange-500" : t.text}`}>
              {inr(overpaidBy > 0 ? overpaidBy : obligation.totalRemaining)}
            </span>
          </div>
        </div>

        {/* ── Consideration vs agreement — informational, never a gate ── */}
        {considerationMismatch && (
          <p className={`mt-3 text-[10px] flex items-start gap-1.5 ${isDark ? "text-yellow-400" : "text-yellow-600"}`}>
            <span>⚠️</span>
            <span>{considerationMismatch.message} Verify with legal team.</span>
          </p>
        )}
      </div>

      {overrideToast && (
        <div className="mb-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[11px] font-semibold text-emerald-500">
          {overrideToast}
        </div>
      )}

      <FinancialValidationBanners
        obligation={obligation}
        t={t}
        isAdmin={isAdmin}
        onOverride={() => setShowOverride(true)}
      />

      {showOverride && bookingId && (
        <TrancheOverrideModal
          bookingId={bookingId}
          obligation={obligation}
          isDark={isDark}
          t={t}
          onClose={() => setShowOverride(false)}
          onSuccess={({ adjustmentId, trancheId }) => {
            setShowOverride(false);
            setOverrideToast(`Override approved. Tranche #${trancheId} added. Adjustment #${adjustmentId} logged.`);
            // The breach is unchanged by an override, but disbursed totals are —
            // re-read rather than leaving stale figures on screen.
            refetch();
          }}
        />
      )}
    </>
  );
}
