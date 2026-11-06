"use client";

import { useState, useEffect, useCallback } from "react";
import {
  FaUser, FaCoins,
  FaDesktop, FaWhatsapp,
  FaChartBar, FaComments,
} from "react-icons/fa";
import dynamic from "next/dynamic";
import LeadDetailsHeader from "./LeadDetailsHeader";
import type { DealScoreData } from "./LeadDetailsHeader";
import LeadPersonalInfo from "./LeadPersonalInfo";
import LeadDealStagePanel from "./LeadDealStagePanel";
import LeadFollowUpPanel from "./LeadFollowUpPanel";
import type { LeadPermissions, LeadUser, LeadDetailsTheme } from "./types";

const LoanDealView = dynamic(() => import("@/components/LoanDealView"), { ssr: false });
const LoanDealForm = dynamic(() => import("@/components/LoanDealForm"), { ssr: false });
const CallingButtons = dynamic(() => import("@/components/CallingButtons"), { ssr: false });
const BolnaCallWidget = dynamic(() => import("@/components/BolnaCallWidget"), { ssr: false });

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface LeadDetailsPanelProps extends LeadDetailsTheme {
  // Core
  lead: any;
  onLeadUpdate: (updater: (prev: any) => any) => void;
  currentUser: LeadUser;
  permissions: LeadPermissions;

  // Navigation
  onBack: () => void;

  // Data
  followUps: any[];
  bookingData: any;
  loanDealBooking: any;
  loanDealLatest: any;
  attView: any;

  // Callbacks
  onRefetch: () => void;
  onShowToast: (msg: string) => void;
  fetchLoanDealData: (leadId: number | string) => void;
  onSendFollowUp: (e: React.FormEvent<HTMLFormElement>) => void;
  onDeleteFollowUp: (id: string) => void;
  onRetryFollowUp: (msg: any) => void;
  canDeleteFollowUps: boolean;
  deletingFollowUpId: string | null;
  customNote: string;
  setCustomNote: (v: string) => void;

  // Actions
  onOpenBookingView: () => void;
  onOpenBookingForm: () => void;
  onOpenLostModal: () => void;
  onOpenReminderModal: () => void;
  onOpenWhatsApp: () => void;
  onRestore: () => void;
  onReopen: () => void;
  onDeleteLead?: () => void;

  // Sales form
  showSalesForm: boolean;
  setShowSalesForm: (v: boolean) => void;
  salesForm: any;
  setSalesForm: (v: any) => void;
  onSubmitSalesForm: (e: React.FormEvent<HTMLFormElement>) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;

  // Loan form
  showLoanForm: boolean;
  setShowLoanForm: (v: boolean) => void;

  // Optional features
  showBolnaCall?: boolean;
  showCallingButtons?: boolean;
  showExtendedFields?: boolean;

  // Revisit data
  isReturningLead?: boolean;
  showPrevLead?: boolean;
  onTogglePrevLead?: () => void;
  isLoadingRevisit?: boolean;
  revisitHistory?: any;
  renderRevisitPanel?: () => React.ReactNode;

  // Render props
  renderBookingView?: () => React.ReactNode;
  renderAfterPersonalInfo?: () => React.ReactNode;

  formatDate: (d: string) => string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LeadDetailsPanel(props: LeadDetailsPanelProps) {
  const {
    lead, onLeadUpdate, currentUser, permissions,
    isDark, theme, onBack,
    followUps, bookingData, loanDealBooking, loanDealLatest, attView,
    onRefetch, onShowToast, fetchLoanDealData,
    onSendFollowUp, onDeleteFollowUp, onRetryFollowUp,
    canDeleteFollowUps, deletingFollowUpId,
    customNote, setCustomNote,
    onOpenBookingView, onOpenBookingForm,
    onOpenLostModal, onOpenReminderModal, onOpenWhatsApp,
    onRestore, onReopen, onDeleteLead,
    showSalesForm, setShowSalesForm, salesForm, setSalesForm, onSubmitSalesForm, inputRef,
    showLoanForm, setShowLoanForm,
    showBolnaCall, showCallingButtons, showExtendedFields,
    isReturningLead, showPrevLead, onTogglePrevLead, isLoadingRevisit, revisitHistory,
    renderRevisitPanel, renderBookingView, renderAfterPersonalInfo,
    formatDate,
  } = props;

  const [detailTab, setDetailTab] = useState<"personal" | "loan">("personal");
  const [rightPanel, setRightPanel] = useState<"dealstage" | "followups">("dealstage");

  // Derive a refresh signal for DealStageTimeline — increments when follow-ups
  // change (sales form submit, site visit schedule, etc.) so the pipeline re-fetches.
  const dealStageRefreshKey = followUps.length;

  // Fetch deal stage data for the header score ring (reuses existing API endpoint)
  const [dealStageData, setDealStageData] = useState<DealScoreData | null>(null);
  const fetchDealStageScore = useCallback(async () => {
    try {
      const res = await fetch(`/api/leads/${lead.id}/deal-stage`);
      if (!res.ok) return;
      const json = await res.json();
      if (json.success) {
        setDealStageData({ tracked: !!json.tracked, currentOrdinal: json.currentOrdinal ?? 0 });
      }
    } catch { /* header score is non-critical */ }
  }, [lead.id]);

  useEffect(() => {
    fetchDealStageScore();
  }, [fetchDealStageScore, dealStageRefreshKey]);

  const formInput = `w-full text-xs rounded-lg px-3 py-2 ${theme.inputBg} ${theme.inputFocus} ${theme.text} outline-none`;
  const formSelect = `w-full text-xs rounded-lg px-3 py-2 ${theme.inputBg} ${theme.inputFocus} ${theme.text} outline-none`;

  return (
    <div className="flex flex-col gap-2 animate-fadeIn">
      <style>{`
        @keyframes lp-left{from{opacity:0;transform:translateX(-16px)}to{opacity:1;transform:none}}
        @keyframes lp-right{from{opacity:0;transform:translateX(16px)}to{opacity:1;transform:none}}
        @keyframes lp-fade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
        @keyframes lp-pop{from{opacity:0;transform:scale(.85)}to{opacity:1;transform:none}}
        .lp-left{animation:lp-left 450ms cubic-bezier(.22,1,.36,1) 80ms backwards}
        .lp-right{animation:lp-right 450ms cubic-bezier(.22,1,.36,1) 160ms backwards}
        .lp-fade{animation:lp-fade 300ms cubic-bezier(.22,1,.36,1) backwards}
        .lp-actions>button{transition:transform .2s,box-shadow .2s,background-color .2s,color .2s,border-color .2s;animation:lp-pop 350ms cubic-bezier(.34,1.56,.64,1) backwards}
        .lp-actions>button:nth-child(1){animation-delay:250ms}
        .lp-actions>button:nth-child(2){animation-delay:320ms}
        .lp-actions>button:nth-child(3){animation-delay:390ms}
        .lp-actions>button:hover{transform:translateY(-2px);box-shadow:0 4px 10px rgba(0,0,0,.12)}
        .lp-actions>button:active{transform:scale(.95)}
        @media (prefers-reduced-motion:reduce){.lp-left,.lp-right,.lp-fade,.lp-actions>button{animation:none}}
      `}</style>
      {/* ── Unified Header (identity + contact + metadata + actions) ── */}
      <LeadDetailsHeader
        lead={lead}
        permissions={permissions}
        bookingData={bookingData}
        dealStageData={dealStageData}
        isDark={isDark}
        theme={theme}
        onBack={onBack}
        onFillSalesform={() => { setShowSalesForm(true); setShowLoanForm(false); }}
        onTrackLoan={() => { setShowLoanForm(true); setShowSalesForm(false); }}
        onMarkClosing={onOpenBookingForm}
        onOpenLostModal={onOpenLostModal}
        onRestore={onRestore}
        onReopen={onReopen}
        onOpenBookingView={onOpenBookingView}
        onDeleteLead={onDeleteLead}
        onFollowUps={() => setRightPanel(rightPanel === "followups" ? "dealstage" : "followups")}
        followUpCount={followUps.length}
        formatDate={formatDate}
        isReturningLead={isReturningLead}
        showPrevLead={showPrevLead}
        onTogglePrevLead={onTogglePrevLead}
        isLoadingRevisit={isLoadingRevisit}
        revisitHistory={revisitHistory}
      />

      {/* Bolna call widget */}
      {showBolnaCall && (
        <BolnaCallWidget
          leadId={Number(lead.id)}
          leadName={lead.name}
          phone={lead.phone}
          userData={{ project: lead.propType || lead.configuration }}
          compact
        />
      )}

      {/* Mobile revisit toggle */}
      {isReturningLead && onTogglePrevLead && (
        <button
          type="button"
          onClick={onTogglePrevLead}
          disabled={isLoadingRevisit && !revisitHistory}
          className={`sm:hidden flex items-center justify-center gap-1.5 text-[11px] font-semibold px-3 py-2 rounded-lg border transition-colors cursor-pointer w-full disabled:opacity-50 disabled:cursor-wait ${showPrevLead ? "border-[rgba(5,150,105,0.5)] text-[#059669] bg-[rgba(5,150,105,0.10)]" : `${theme.tableBorder} ${theme.textMuted}`
            }`}
        >
          {isLoadingRevisit && !revisitHistory ? "Loading history\u2026" : showPrevLead ? "Hide Previous Lead Data" : "Show Previous Lead Data"}
        </button>
      )}

      {/* Revisit panel */}
      {isReturningLead && showPrevLead && renderRevisitPanel && renderRevisitPanel()}

      {/* ── Two-column layout ───────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row gap-2 lg:h-[calc(100vh-130px)]">

        {/* ── LEFT COLUMN ──────────────────────────────────────── */}
        <div className="lp-left w-full lg:w-[44%] xl:w-[42%] flex flex-col gap-2 lg:h-full lg:min-h-0">

          {showSalesForm ? (
            /* Sales Form */
            <div className={`lp-fade flex-1 lg:min-h-0 overflow-y-auto custom-scrollbar rounded-xl p-3 border ${theme.chatPanel}`} style={theme.chatPanelGl}>
              <div className="flex items-center justify-between mb-3">
                <h3 className={`text-xs font-bold ${theme.text}`}>Fill Sales Data</h3>
                <button onClick={() => setShowSalesForm(false)} className={`text-[10px] cursor-pointer ${theme.textMuted}`}>Cancel</button>
              </div>
              <form onSubmit={onSubmitSalesForm} className="flex flex-col gap-2.5">
                <div>
                  <label className={`block text-[10px] font-bold mb-1 ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>Property Type *</label>
                  <select required value={salesForm.propertyType} onChange={(e) => setSalesForm({ ...salesForm, propertyType: e.target.value })} className={formSelect}>
                    <option value="" disabled>Select Type</option>
                    <option>1 BHK</option><option>2 BHK</option><option>3 BHK</option><option>4 BHK</option><option>5 BHK</option>
                    <option>Row House</option><option>Penthouse</option><option>Duplex</option><option>Villa</option><option>Plot</option>
                    <option>Commercial</option><option>Shop</option><option>Office</option><option>Other</option>
                  </select>
                </div>
                <div>
                  <label className={`block text-[10px] font-bold mb-1 ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>Location *</label>
                  <input required value={salesForm.location} onChange={(e) => setSalesForm({ ...salesForm, location: e.target.value })} className={formInput} placeholder="Location" />
                </div>
                <div>
                  <label className={`block text-[10px] font-bold mb-1 ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>Budget *</label>
                  <input required value={salesForm.budget} onChange={(e) => setSalesForm({ ...salesForm, budget: e.target.value })} className={formInput} placeholder="Budget" />
                </div>
                <div>
                  <label className={`block text-[10px] font-bold mb-1 ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>Type of Use *</label>
                  <select required value={salesForm.useType} onChange={(e) => setSalesForm({ ...salesForm, useType: e.target.value })} className={formSelect}>
                    <option value="" disabled>Select Type</option><option>Self-use</option><option>Investment</option>
                  </select>
                </div>
                <div>
                  <label className={`block text-[10px] font-bold mb-1 ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>Planning to Buy *</label>
                  <select required value={salesForm.purchaseDate} onChange={(e) => setSalesForm({ ...salesForm, purchaseDate: e.target.value })} className={formSelect}>
                    <option value="" disabled>Select Option</option><option>Immediately</option><option>Within 3 months</option><option>3-6 months</option><option>After 6 months</option><option>Just looking</option>
                  </select>
                </div>
                <div>
                  <label className={`block text-[10px] font-bold mb-1 ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>Loan Required? *</label>
                  <select required value={salesForm.loanPlanned} onChange={(e) => setSalesForm({ ...salesForm, loanPlanned: e.target.value })} className={formSelect}>
                    <option value="" disabled>Select Option</option><option>Yes</option><option>No</option><option>Not Sure</option>
                  </select>
                </div>
                <div className={`border-t pt-2 ${theme.tableBorder}`}>
                  <label className={`block text-xs font-bold mb-1 ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>Lead Interest Status *</label>
                  <select required value={salesForm.leadStatus} onChange={(e) => setSalesForm({ ...salesForm, leadStatus: e.target.value })} className={formSelect}>
                    <option value="" disabled>Select Status</option><option>Interested</option><option>Not Interested</option><option>NON GENUINE DEMAND (NGD)</option>
                  </select>
                </div>
                <div className={`border-t pt-2 ${theme.tableBorder}`}>
                  <label className="text-xs text-orange-400 font-bold mb-1 block">Schedule a Site Visit?</label>
                  <input ref={inputRef} type="datetime-local" value={salesForm.siteVisit} onChange={(e) => setSalesForm({ ...salesForm, siteVisit: e.target.value })} onClick={() => inputRef?.current?.showPicker()} className={`${formInput} focus:border-orange-500`} />
                </div>
                <button type="submit" className={`mt-auto w-full font-bold py-2.5 rounded-xl transition-colors text-xs ${theme.btnPrimary}`}>Submit Salesform</button>
              </form>
            </div>
          ) : showLoanForm ? (
            /* Loan Form */
            <LoanDealForm
              lead={lead}
              booking={loanDealBooking}
              loanUpdate={loanDealLatest}
              user={currentUser}
              isDark={isDark}
              t={theme}
              onCancel={() => setShowLoanForm(false)}
              onSuccess={() => {
                setShowLoanForm(false);
                onShowToast(`Loan & deal data saved for ${lead.name}`);
                fetchLoanDealData(lead.id);
                onRefetch();
              }}
            />
          ) : (
            /* Normal view: tabs + content + calling buttons */
            <div className="flex flex-col animate-fadeIn gap-2 lg:flex-1 lg:min-h-0">
              {/* Left column tabs */}
              <div className={`flex items-center gap-1 border p-0.5 rounded-lg flex-shrink-0 ${theme.tableWrap}`}>
                <button
                  onClick={() => setDetailTab("personal")}
                  className={`flex-1 py-1.5 text-[11px] sm:text-xs font-bold rounded-md transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${detailTab === "personal" ? theme.btnPrimary : `${theme.textMuted} hover:opacity-80`
                    }`}
                >
                  <FaUser className="text-[9px]" /> Personal Info
                </button>
                <button
                  onClick={() => setDetailTab("loan")}
                  className={`flex-1 py-1.5 text-[11px] sm:text-xs font-bold rounded-md transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${detailTab === "loan" ? theme.btnSecondary : `${theme.textMuted} hover:opacity-80`
                    }`}
                >
                  <FaCoins className="text-[9px]" /> Loan Tracking
                </button>
              </div>

              {/* Tab content */}
              {/* Tab content */}
              <div key={detailTab} className={`lp-fade flex-1 min-h-[300px] lg:min-h-0 overflow-y-auto custom-scrollbar rounded-xl p-3 shadow-lg border ${theme.chatPanel}`} style={theme.chatPanelGl}>
                {detailTab === "personal" ? (
                  <LeadPersonalInfo
                    lead={lead}
                    permissions={permissions}
                    loanDealLatest={loanDealLatest}
                    isDark={isDark}
                    theme={theme}
                    onLeadUpdate={onLeadUpdate}
                    onShowToast={onShowToast}
                    showExtendedFields={showExtendedFields}
                    renderAfterPersonalInfo={renderAfterPersonalInfo}
                  />
                ) : (
                  <LoanDealView lead={lead} booking={loanDealBooking} loanUpdate={loanDealLatest} isDark={isDark} t={theme} />
                )}
              </div>

              {/* Calling action buttons — compact row */}
              <div className="lp-actions grid grid-cols-4 gap-1.5 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => { if (lead.phone) window.open(`tel:${lead.phone}`); }}
                  title="Browser Call"
                  aria-label="Browser Call"
                  className={`flex flex-col items-center justify-center rounded-lg border py-2 gap-0.5 transition-colors cursor-pointer text-[10px] ${isDark
                    ? "bg-purple-600/10 border-purple-500/30 hover:bg-purple-600 text-purple-400 hover:text-white"
                    : "bg-purple-600/10 border-purple-500/30 hover:bg-purple-600 text-purple-700 hover:text-white"
                    }`}
                >
                  <FaDesktop className="text-sm" />
                  <span className="font-bold">Browser</span>
                </button>
                {permissions.canWhatsApp && (
                  <button
                    type="button"
                    onClick={onOpenWhatsApp}
                    title="WhatsApp"
                    aria-label="WhatsApp"
                    className={`flex flex-col items-center justify-center rounded-lg border py-2 gap-0.5 transition-colors cursor-pointer text-[10px] ${isDark
                      ? "bg-green-600/10 border-green-500/30 hover:bg-green-600 text-green-400 hover:text-white"
                      : "bg-green-600/10 border-green-500/30 hover:bg-green-600 text-green-700 hover:text-white"
                      }`}
                  >
                    <FaWhatsapp className="text-sm" />
                    <span className="font-bold">WhatsApp</span>
                  </button>
                )}
                {showCallingButtons && (
                  <CallingButtons leadId={lead.id} phone={lead.phone} leadName={lead.name} isDark={isDark} />
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── RIGHT COLUMN ─────────────────────────────────────── */}
        <div className="lp-right w-full lg:w-[56%] xl:w-[58%] flex flex-col gap-2 lg:h-full lg:min-h-0">
          {/* Right column tabs */}
          {/* <div className={`flex items-center gap-1 border p-0.5 rounded-lg flex-shrink-0 ${theme.tableWrap}`}>
            <button
              onClick={() => setRightPanel("dealstage")}
              className={`flex-1 py-1.5 text-[11px] sm:text-xs font-bold rounded-md transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${rightPanel === "dealstage" ? theme.btnPrimary : `${theme.textMuted} hover:opacity-80`
                }`}
            >
              <FaChartBar className="text-[9px]" /> Deal Stage
            </button>
            <button
              onClick={() => setRightPanel("followups")}
              className={`flex-1 py-1.5 text-[11px] sm:text-xs font-bold rounded-md transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${rightPanel === "followups" ? theme.btnSecondary : `${theme.textMuted} hover:opacity-80`
                }`}
            >
              <FaComments className="text-[9px]" /> Follow-ups
              {followUps.length > 0 && (
                <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-bold ${isDark ? "bg-[#9E217B]/30 text-[#d946a8]" : "bg-[#9E217B]/10 text-[#9E217B]"
                  }`}>
                  {followUps.length}
                </span>
              )}
            </button>
          </div> */}

          {/* Right column content */}
          <div key={rightPanel} className="lp-fade flex-1 min-h-[500px] lg:min-h-full overflow-y-auto custom-scrollbar">
            {rightPanel === "followups" ? (
              <LeadFollowUpPanel
                lead={lead}
                followUps={followUps}
                customNote={customNote}
                setCustomNote={setCustomNote}
                onSendNote={onSendFollowUp}
                onDeleteFollowUp={onDeleteFollowUp}
                onRetryFollowUp={onRetryFollowUp}
                canDeleteFollowUps={canDeleteFollowUps}
                deletingFollowUpId={deletingFollowUpId}
                attView={attView}
                onRefetch={onRefetch}
                onReminderClick={onOpenReminderModal}
                isDark={isDark}
                theme={theme}
                formatDate={formatDate}
                onClose={() => setRightPanel("dealstage")}
              />
            ) : (
              <LeadDealStagePanel
                leadId={Number(lead.id)}
                isDark={isDark}
                theme={theme}
                userRole={currentUser.role}
                refreshKey={dealStageRefreshKey}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
