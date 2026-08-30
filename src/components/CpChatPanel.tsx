"use client";

import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  IoChatbubbleEllipsesOutline,
  IoSend,
  IoLocationOutline,
  IoCameraOutline,
  IoSearchOutline,
  IoCloseOutline,
  IoWarningOutline,
  IoCalendarOutline,
  IoPersonOutline,
  IoChevronBackOutline,
  IoStarOutline,
  IoStar,
  IoEllipsisHorizontalOutline,
  IoHappyOutline,
  IoAttachOutline,
  IoDocumentTextOutline,
  IoCheckmarkDoneOutline,
  IoCreateOutline,
  IoBusinessOutline,
  IoCheckmarkCircleOutline,
  IoListOutline,
  IoChevronForwardOutline
} from "react-icons/io5";
import BookingApplicationView from "./BookingApplicationView";
import { useCpResource } from "@/lib/hooks/useCpResource";
import {
  CpChatRailSkeleton,
  CpChatThreadSkeleton,
  CpChatDetailsSkeleton,
  CpChatCardListSkeleton,
} from "./cp/CpSkeletons";

/** Who generated a message, resolved server-side from the persisted creator. */
type Sender = {
  role: string;
  name: string;
  /** "Sales Manager · Mayur Acharya" — what is printed above the message. */
  label: string;
  /** neutral | blue | orange | magenta | system */
  tone: string;
  system: boolean;
};

/**
 * One item in the thread. `kind` mirrors cp_chat_messages.message_type; the CRM
 * event kinds are projected by the API from the authoritative tables and carry
 * only the fields a Channel Partner is allowed to see.
 */
type ChatItem = {
  id: string;
  ts: number;
  kind: "text" | "visit" | "customer_update" | "booking_update" | "attachment";
  sender?: Sender;
  mine?: boolean;
  text?: string;
  pending?: boolean;
  source?: string;
  title?: string;
  // customer_update
  customer?: string;
  leadRef?: string;
  status?: string;
  feedback?: string;
  // booking_update
  bookingNo?: string;
  unitConfig?: string;
  building?: string;
  tower?: string;
  wing?: string;
  floor?: string;
  onDate?: string | null;
  // visit
  personMet?: string;
  location?: string;
  gps?: string;
  notes?: string;
  hasPhoto?: boolean;
};

const ts = (v: any) => (v ? new Date(v).getTime() : 0);
const fmtClock = (n: number) =>
  new Date(n).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
const fmtDay = (n: number) => {
  const d = new Date(n), today = new Date();
  const same = d.toDateString() === today.toDateString();
  const yest = new Date(today.getTime() - 864e5).toDateString() === d.toDateString();
  return same ? "Today" : yest ? "Yesterday"
    : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};
const fmtStamp = (v: any) => (v ? `${fmtDay(ts(v))}, ${fmtClock(ts(v))}` : "—");
const initials = (s: string) =>
  (s || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
const fmtDate = (v: any) =>
  v ? new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/**
 * Accent per source, so a Receptionist update and a Sales Manager update are
 * distinguishable at a glance without a badge on every row. The tone arrives
 * from the API alongside the sender, never inferred from the viewer's own role.
 */
const TONES: Record<string, { text: string; dot: string }> = {
  blue: { text: "text-[#0A84FF]", dot: "bg-[#0A84FF]" },
  orange: { text: "text-[#FF9500]", dot: "bg-[#FF9500]" },
  magenta: { text: "text-[#FF3797]", dot: "bg-[#FF3797]" },
  neutral: { text: "text-[#86868B]", dot: "bg-[#86868B]" },
  system: { text: "text-[#86868B]", dot: "bg-[#86868B]" },
};
const toneOf = (s?: Sender) => TONES[s?.tone || "neutral"] || TONES.neutral;

/** One label/value line inside a CRM event card. */
function Row({ label, value, labelCls, valueCls }: {
  label: string; value?: string | null; labelCls: string; valueCls: string;
}) {
  return (
    <div className="flex justify-between items-start gap-3">
      <span className={`text-[12px] flex-shrink-0 ${labelCls}`}>{label}</span>
      <span className={`text-[12px] font-medium text-right break-words ${valueCls}`}>{value || "—"}</span>
    </div>
  );
}

/** The fields of a channel partner the conversation rail actually reads. */
type PartnerRailRow = {
  id: number;
  name?: string;
  company_name?: string;
  phone?: string;
  assigned_sourcing_manager_name?: string;
  updated_at?: string;
  created_at?: string;
};

/** Stable empty list — a `[]` literal would be a new identity every render. */
const NO_PARTNERS: PartnerRailRow[] = [];

/**
 * One item in the thread: a message bubble, or a CRM event card.
 *
 * Split out and memoised. The panel re-renders for plenty of reasons the thread
 * has no stake in — typing in the rail's search box, switching a filter chip,
 * starring a partner, opening the mobile drawer — and each of those was
 * rebuilding all 200 items. Now a render that leaves the messages alone leaves
 * their DOM alone, and an arriving message renders only itself.
 *
 * The disclosure rules are unchanged: every field below still comes from the
 * API's allow-list, and there is still no drill-through to the booking form or
 * the lead record.
 */
const ChatMessage = React.memo(function ChatMessage({
  m, newDay, isDark,
}: { m: ChatItem; newDay: boolean; isDark: boolean }) {
  const bgPanel = isDark ? "bg-[#1C1C1E]" : "bg-[#FFFFFF]";
  const bgSubtle = isDark ? "bg-[#2C2C2E]" : "bg-[#F2F2F7]";
  const borderSubtle = isDark ? "border-[#38383A]" : "border-[#E5E5EA]";
  const textPrimary = isDark ? "text-white" : "text-[#1D1D1F]";
  const textSecondary = isDark ? "text-[#98989D]" : "text-[#86868B]";
  const accentBg = isDark ? "bg-[#FF3797]" : "bg-[#9E217B]";
  const rowStyles = { labelCls: textSecondary, valueCls: textPrimary };

  return (
    <div className="w-full">
      {newDay && (
        <div className="flex justify-center my-6">
          <span className={`text-[11px] font-medium ${textSecondary}`}>
            {fmtDay(m.ts)}
          </span>
        </div>
      )}

      {m.kind === "text" || m.kind === "attachment" ? (
        <div className={`flex w-full ${m.mine ? "justify-end" : "justify-start"} group`}>
          <div className={`max-w-[75%] flex flex-col ${m.mine ? "items-end" : "items-start"}`}>
            {/* Attribution: Role · Employee Name, above every
                incoming message. Suppressed on your own
                messages, where it would only repeat you. */}
            {!m.mine && m.sender?.label && (
              <span className={`text-[11px] font-medium mb-1 px-1 ${toneOf(m.sender).text}`}>
                {m.sender.label}
              </span>
            )}
            <div className={`px-4 py-2.5 flex flex-col relative ${m.mine
              ? `rounded-2xl rounded-tr-sm ${accentBg} text-white`
              : `rounded-2xl rounded-tl-sm ${isDark ? 'bg-[#2C2C2E] text-white' : 'bg-[#E5E5EA] text-[#1D1D1F]'}`
              }`} style={{ opacity: m.pending ? 0.6 : 1 }}>
              <p className="text-[15px] leading-snug whitespace-pre-wrap break-words">
                {m.text}
              </p>
              <div className={`self-end flex items-center gap-1 text-[10px] mt-1 ${m.mine ? 'text-white/70' : textSecondary}`}>
                <span>{m.pending ? "Sending..." : fmtClock(m.ts)}</span>
                {m.mine && !m.pending && <IoCheckmarkDoneOutline size={12} />}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* CRM event card. Every field rendered below comes
           from the API's allow-list — there is no drill-through
           to the full booking form or lead record, because
           those carry phone, PAN, Aadhaar and money. */
        <div className="flex justify-center my-4 w-full">
          <div className={`w-full max-w-sm rounded-2xl p-4 flex flex-col gap-3 shadow-sm border ${bgPanel} ${borderSubtle}`}>
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${bgSubtle} ${toneOf(m.sender).text}`}>
                {m.kind === "visit" ? <IoLocationOutline size={20} /> :
                  m.kind === "booking_update" ? <IoBusinessOutline size={20} /> :
                    <IoDocumentTextOutline size={20} />}
              </div>
              <div className="min-w-0">
                <p className={`text-[14px] font-semibold tracking-tight uppercase ${textPrimary}`}>
                  {m.title || (m.kind === "booking_update" ? "Booking Update" : "Customer Update")}
                </p>
                {m.sender?.label && (
                  <p className={`text-[12px] font-medium truncate ${toneOf(m.sender).text}`}>
                    {m.sender.label}
                  </p>
                )}
                <p className={`text-[11px] ${textSecondary}`}>{fmtStamp(m.ts)}</p>
              </div>
            </div>
            <div className={`p-3 rounded-xl flex flex-col gap-2 ${bgSubtle}`}>
              {m.kind === "visit" && (
                <>
                  <Row label="Met with" value={m.personMet} {...rowStyles} />
                  {m.gps ? (
                    <div className="flex justify-between items-start gap-2">
                      <span className={`text-[12px] ${textSecondary}`}>Location</span>
                      <a href={`https://maps.google.com/?q=${encodeURIComponent(m.gps)}`}
                        target="_blank" rel="noopener noreferrer"
                        className="text-[12px] font-medium text-right text-blue-500 hover:underline">
                        {m.location || "View on map"}
                      </a>
                    </div>
                  ) : (
                    <Row label="Location" value={m.location} {...rowStyles} />
                  )}
                  {m.notes && <Row label="Notes" value={m.notes} {...rowStyles} />}
                </>
              )}

              {/* SITE VISIT UPDATE — customer, lead, status,
                  feedback. No phone, no email, nothing else. */}
              {m.kind === "customer_update" && (
                <>
                  <Row label="Customer" value={m.customer} {...rowStyles} />
                  <Row label="Lead" value={m.leadRef} {...rowStyles} />
                  <Row label="Status" value={m.status} {...rowStyles} />
                  <Row label="Feedback" value={m.feedback} {...rowStyles} />
                </>
              )}

              {/* BOOKING CARD — the approved fields only. */}
              {m.kind === "booking_update" && (
                <>
                  <Row label="Booking ID" value={m.bookingNo} {...rowStyles} />
                  <Row label="Customer" value={m.customer} {...rowStyles} />
                  {m.unitConfig && <Row label="Unit" value={m.unitConfig} {...rowStyles} />}
                  {m.building && <Row label="Building" value={m.building} {...rowStyles} />}
                  {m.tower && <Row label="Tower" value={m.tower} {...rowStyles} />}
                  {m.wing && <Row label="Wing" value={m.wing} {...rowStyles} />}
                  {m.floor && <Row label="Floor" value={m.floor} {...rowStyles} />}
                  {m.status && <Row label="Status" value={m.status} {...rowStyles} />}
                  {m.onDate && <Row label="Date" value={fmtDate(m.onDate)} {...rowStyles} />}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

/**
 * The message composer, with its own draft state.
 *
 * It used to be inline, reading a `draft` held on the panel. Every keystroke
 * therefore re-rendered the panel, and with it the whole thread — up to 200
 * messages and event cards — plus the partner rail and the details column,
 * before the character appeared. Owning the draft here confines a keystroke to
 * this one textarea.
 *
 * `onSend` rejects when the message did not go: the draft is put back so
 * nothing typed is lost, which is what the panel used to do.
 */
const Composer = React.memo(function Composer({
  isDark, onSend,
}: {
  isDark: boolean;
  onSend: (text: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");

  const bgApp = isDark ? "bg-[#000000]" : "bg-[#F5F5F7]";
  const bgPanel = isDark ? "bg-[#1C1C1E]" : "bg-[#FFFFFF]";
  const borderSubtle = isDark ? "border-[#38383A]" : "border-[#E5E5EA]";
  const textPrimary = isDark ? "text-white" : "text-[#1D1D1F]";

  const submit = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft(""); setSending(true); setSendError("");
    try {
      await onSend(text);
    } catch (e: any) {
      setDraft(text);
      setSendError(e?.message || "Message could not be sent.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={`flex-shrink-0 px-4 py-3 md:px-6 md:py-4 z-20 ${bgApp}`}>
      {sendError && (
        <p className="text-[11px] mb-2 text-red-500 font-medium ml-2">{sendError}</p>
      )}
      {/* iMessage style composer pill. No longer gated on the partner
          having an enquiry — messages are partner-scoped now. */}
      <div className={`flex items-end gap-2 rounded-3xl px-3 py-1.5 transition-all border ${bgPanel} ${borderSubtle}`}>
        <textarea
          rows={1} value={draft}
          disabled={sending}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder="iMessage"
          className={`flex-1 bg-transparent outline-none resize-none text-[15px] max-h-24 py-2 disabled:cursor-not-allowed leading-snug ${textPrimary} placeholder:text-[#86868B]`}
        />

        <button onClick={submit} disabled={!draft.trim() || sending}
          className={`flex items-center justify-center w-8 h-8 self-center rounded-full text-white transition-all ${!draft.trim() || sending
            ? "bg-[#D1D1D6] dark:bg-[#38383A]"
            : "bg-[#007AFF] hover:scale-105"
            }`}>
          <IoSend size={14} className="ml-0.5" />
        </button>
      </div>
    </div>
  );
});

function CpChatPanel({
  user, isDark, t, isAdmin = false,
}: { user: any; isDark: boolean; t: any; isAdmin?: boolean }) {
  const [cpId, setCpId] = useState<number | null>(null);
  const [data, setData] = useState<any>(null);
  /** Thread + About, from /chat. Kept separate from `data` so the Enquiries and
   *  Bookings tabs keep reading the overview payload exactly as before. */
  const [chat, setChat] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [listFilter, setListFilter] = useState<"All" | "Unread" | "Favourites">("All");
  const [favourites, setFavourites] = useState<Record<string, boolean>>({});

  const [activeTab, setActiveTab] = useState<"chat" | "visits" | "enquiries" | "bookings">("chat");
  const [rightTab, setRightTab] = useState<"details" | "about">("details");
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  const [pending, setPending] = useState<ChatItem[]>([]);
  const [seen, setSeen] = useState<Record<string, number>>({});
  // viewBooking / viewEnquiry back the Bookings and Enquiries tabs, which are
  // internal CRM views for the signed-in employee. Chat cards no longer open
  // them — an event card carries its approved fields and nothing more.
  const [viewBooking, setViewBooking] = useState<any>(null);
  const [viewEnquiry, setViewEnquiry] = useState<any>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // --- Style Tokens (Apple-inspired) ---
  const bgApp = isDark ? "bg-[#000000]" : "bg-[#F5F5F7]";
  const bgPanel = isDark ? "bg-[#1C1C1E]" : "bg-[#FFFFFF]";
  const bgSubtle = isDark ? "bg-[#2C2C2E]" : "bg-[#F2F2F7]";
  const borderSubtle = isDark ? "border-[#38383A]" : "border-[#E5E5EA]";
  const textPrimary = isDark ? "text-white" : "text-[#1D1D1F]";
  const textSecondary = isDark ? "text-[#98989D]" : "text-[#86868B]";
  // accentBg / rowStyles moved into <ChatMessage>, the only thing that read
  // them, when the thread was split out and memoised.

  // The conversation rail. Cached across mounts, so leaving CP Chat for another
  // view and coming back paints the same list immediately instead of showing
  // "Loading..." for another ~155 ms round trip; it revalidates behind the list
  // and only re-renders if the rows actually changed.
  const {
    data: partners, loading: loadingList, error: listErrorValue,
  } = useCpResource<PartnerRailRow[]>("/api/channel-partners", { initial: NO_PARTNERS });
  const listError = listErrorValue && partners.length === 0 ? listErrorValue : "";

  useEffect(() => {
    try { setSeen(JSON.parse(localStorage.getItem("cpChatSeen") || "{}")); } catch { }
    try { setFavourites(JSON.parse(localStorage.getItem("cpChatFavourites") || "{}")); } catch { }
  }, []);

  const fetchChat = useCallback(async (id: number) => {
    setLoading(true); setError("");
    try {
      const [overviewRes, chatRes] = await Promise.all([
        fetch(`/api/channel-partners/${id}/overview`),
        fetch(`/api/channel-partners/${id}/chat`),
      ]);
      const [overview, thread] = await Promise.all([overviewRes.json(), chatRes.json()]);
      if (!overview.success) throw new Error(overview.message || "Could not load this conversation.");
      if (!thread.success) throw new Error(thread.message || "Could not load this conversation.");
      setData(overview.data);
      setChat(thread.data);
      setPending([]);
    } catch (e: any) {
      setData(null); setChat(null);
      setError(e?.message || "Could not load this conversation.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (cpId == null) return;
    fetchChat(cpId);
    setSeen(prev => {
      const next = { ...prev, [String(cpId)]: Date.now() };
      try { localStorage.setItem("cpChatSeen", JSON.stringify(next)); } catch { }
      return next;
    });
  }, [cpId, fetchChat]);

  const partner = data?.partner;
  const railRow = partners.find(p => p.id === cpId);

  // Memoised: this walks every partner and builds a concatenated lowercase
  // string per row. Unmemoised it re-ran on every render of the panel —
  // including every keystroke in the composer, which has nothing to do with the
  // partner rail.
  const deferredSearch = useDeferredValue(search);
  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    return partners.filter(p => {
      const matchSearch = !q || `${p.name || ""} ${p.company_name || ""} ${p.phone || ""} ${p.assigned_sourcing_manager_name || ""}`
        .toLowerCase().includes(q);

      const lastAt = ts(p.updated_at || p.created_at);
      const unread = lastAt > 0 && lastAt > (seen[String(p.id)] || 0);

      if (listFilter === "Unread") return matchSearch && unread;
      if (listFilter === "Favourites") return matchSearch && !!favourites[String(p.id)];
      return matchSearch;
    });
  }, [partners, deferredSearch, listFilter, seen, favourites]);

  const toggleFavourite = () => {
    if (cpId == null) return;
    setFavourites(prev => {
      const next = { ...prev, [String(cpId)]: !prev[String(cpId)] };
      try { localStorage.setItem("cpChatFavourites", JSON.stringify(next)); } catch { }
      return next;
    });
  };

  /**
   * The thread is assembled server-side now.
   *
   * It used to be built here by walking the overview payload — every enquiry
   * became a "customer" card and every booking a "booking" card, regardless of
   * whether the CRM event had actually happened. The API now projects only
   * events whose event → lead → partner → organization chain it can prove, and
   * strips them to the fields a Channel Partner may see, so the panel renders
   * what it is given rather than deciding for itself.
   */
  // Memoised: copying and re-sorting the whole thread on every render made every
  // composer keystroke O(n log n), and produced a new array identity each time,
  // which is what the scroll-to-bottom effect below keys off.
  const thread: ChatItem[] = useMemo(
    () => [...(chat?.messages || []), ...pending].sort((a: ChatItem, b: ChatItem) => a.ts - b.ts),
    [chat?.messages, pending]
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [thread.length, cpId, activeTab]);

  /**
   * Posts to cp_chat_messages via the CP chat route.
   *
   * Previously this wrote a follow_up against the partner's newest enquiry,
   * which is why the composer was disabled for any partner without a lead. CP
   * messages are partner-scoped now, so every partner can be messaged.
   */
  // Called by <Composer>, which owns the draft. Throws on failure so the
  // composer can put the text back — the same recovery as before, just on the
  // side of the boundary that holds the text.
  const send = useCallback(async (text: string) => {
    if (cpId == null) return;
    const optimistic: ChatItem = {
      id: `p${Date.now()}`, ts: Date.now(), kind: "text",
      sender: { role: "", name: user?.name || "You", label: user?.name || "You", tone: "magenta", system: false },
      mine: true, text, pending: true,
    };
    setPending(p => [...p, optimistic]);
    try {
      const res = await fetch(`/api/channel-partners/${cpId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Send failed.");
      await fetchChat(cpId);
    } catch (e: any) {
      setPending(p => p.filter(m => m.id !== optimistic.id));
      throw new Error(e?.message || "Message could not be sent.");
    }
  }, [cpId, user?.name, fetchChat]);

  // Restrained, subtle colors for avatars
  const getInitialsBg = (name: string) => {
    return isDark ? "bg-[#2C2C2E] text-white" : "bg-[#E5E5EA] text-[#1D1D1F]";
  };

  // Counted in SQL by the chat route, so a partner busier than the thread cap
  // still reports real totals rather than the length of a truncated array.
  const about = chat?.about;
  const totalEnquiries = about?.business?.totalLeads ?? data?.enquiries?.length ?? 0;
  const totalBookings = about?.business?.totalBookings ?? 0;
  const totalVisits = about?.relationship?.totalCpVisits ?? 0;
  const lastActiveStr = about?.business?.lastActivity
    ? fmtStamp(about.business.lastActivity)
    : partner ? fmtStamp(partner.updated_at || partner.created_at) : "—";


  // PERF: this whole tree — two tab buttons, up to eleven profile rows, four
  // stat tiles and three About sections — was built on EVERY render of the
  // panel, including when no partner was selected and the desktop column was
  // not even mounted. Memoised on what it actually reads, so a render that
  // changes none of it reuses the previous elements.
  const rightPanelJSX = useMemo(() => (
    <>
      <div className={`p-4 border-b ${borderSubtle}`}>
        <div className={`flex p-1 rounded-xl w-full ${bgSubtle}`}>
          {[
            { id: "details", label: "Details" },
            { id: "about", label: "About" },
          ].map(tab => (
            <button key={tab.id} onClick={() => setRightTab(tab.id as any)}
              className={`flex-1 py-1.5 text-[13px] font-medium rounded-lg transition-all ${rightTab === tab.id ? `${bgPanel} shadow-sm ${textPrimary}` : `${textSecondary} hover:text-current`}`}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* While the conversation is loading, every field here would read "—" and
          every tile "0", then correct itself — which looks like real values
          changing. The skeleton says "not yet" instead, at the same size. */}
      {loading && !partner ? (
        <CpChatDetailsSkeleton isDark={isDark} />
      ) : rightTab === "details" ? (
        <div className="p-5 space-y-8">
          {/* Partner Profile */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className={`text-sm font-semibold tracking-tight ${textPrimary}`}>Partner Profile</h4>
            </div>
            <div className="space-y-3">
              {[
                { label: "Name", val: partner?.name || "—" },
                { label: "Company", val: partner?.company_name || "—" },
                { label: "Phone", val: partner?.phone || "—" },
                { label: "Email", val: partner?.email || "—" },
                { label: "Manager", val: partner?.assigned_sourcing_manager_name || "—" },
              ].map(item => (
                <div key={item.label} className="flex justify-between items-start gap-4">
                  <span className={`text-[13px] ${textSecondary}`}>{item.label}</span>
                  <span className={`text-[13px] font-medium text-right flex-shrink break-all ${textPrimary}`}>{item.val}</span>
                </div>
              ))}
            </div>
          </div>

          <hr className={borderSubtle} />

          {/* Summary */}
          <div className="space-y-4">
            <h4 className={`text-sm font-semibold tracking-tight ${textPrimary}`}>Activity Summary</h4>
            <div className="grid grid-cols-2 gap-3">
              <div className={`p-3 rounded-xl ${bgSubtle}`}>
                <IoListOutline className={`text-lg mb-2 ${textSecondary}`} />
                <p className={`text-[11px] font-medium uppercase tracking-wider mb-1 ${textSecondary}`}>Enquiries</p>
                <p className={`text-xl font-semibold ${textPrimary}`}>{totalEnquiries}</p>
              </div>
              <div className={`p-3 rounded-xl ${bgSubtle}`}>
                <IoBusinessOutline className={`text-lg mb-2 ${textSecondary}`} />
                <p className={`text-[11px] font-medium uppercase tracking-wider mb-1 ${textSecondary}`}>Bookings</p>
                <p className={`text-xl font-semibold ${textPrimary}`}>{totalBookings}</p>
              </div>
              <div className={`p-3 rounded-xl ${bgSubtle}`}>
                <IoLocationOutline className={`text-lg mb-2 ${textSecondary}`} />
                <p className={`text-[11px] font-medium uppercase tracking-wider mb-1 ${textSecondary}`}>Visits</p>
                <p className={`text-xl font-semibold ${textPrimary}`}>{totalVisits}</p>
              </div>
              <div className={`p-3 rounded-xl ${bgSubtle}`}>
                <IoCheckmarkCircleOutline className={`text-lg mb-2 ${textSecondary}`} />
                <p className={`text-[11px] font-medium uppercase tracking-wider mb-1 ${textSecondary}`}>Last Active</p>
                <p className={`text-[13px] font-medium leading-tight ${textPrimary}`}>{lastActiveStr.split(',')[0]}</p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ABOUT — the partner's own profile and their business record with us.
           Deliberately carries nothing about individual customers: no client
           names, no lead details, no booking values. Only the partner's own
           contact record and counts of their activity. */
        <div className="p-5 space-y-8">
          {!about ? (
            // Reached when the thread loaded but carried no About block —
            // distinct from the panel-wide loading case handled above.
            <p className={`text-[13px] ${textSecondary}`}>Partner details are not available.</p>
          ) : (
            <>
              <section className="space-y-4">
                <h4 className={`text-sm font-semibold tracking-tight ${textPrimary}`}>Partner Profile</h4>
                <div className="space-y-3">
                  {[
                    { label: "Partner Name", val: about.profile.name },
                    { label: "Company", val: about.profile.company },
                    { label: "Contact Person", val: about.profile.contactPerson },
                    { label: "Phone", val: about.profile.phone },
                    { label: "Email", val: about.profile.email },
                    { label: "Address", val: about.profile.address },
                    { label: "City", val: about.profile.city },
                    { label: "PIN", val: about.profile.pin },
                    { label: "Sourcing Manager", val: about.profile.sourcingManager },
                    { label: "Status", val: about.profile.status },
                    { label: "Created On", val: fmtDate(about.profile.createdOn) },
                  ].map(item => (
                    <div key={item.label} className="flex justify-between items-start gap-4">
                      <span className={`text-[13px] flex-shrink-0 ${textSecondary}`}>{item.label}</span>
                      <span className={`text-[13px] font-medium text-right break-words ${textPrimary}`}>
                        {item.val || "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              <hr className={borderSubtle} />

              <section className="space-y-4">
                <h4 className={`text-sm font-semibold tracking-tight ${textPrimary}`}>Business Summary</h4>
                <div className="space-y-3">
                  {[
                    { label: "Total Leads", val: String(about.business.totalLeads) },
                    { label: "Total Site Visits", val: String(about.business.totalSiteVisits) },
                    { label: "Total Bookings", val: String(about.business.totalBookings) },
                    { label: "Last Activity", val: about.business.lastActivity ? fmtStamp(about.business.lastActivity) : "—" },
                    { label: "Last CP Visit", val: about.business.lastCpVisit ? fmtStamp(about.business.lastCpVisit) : "No visit recorded" },
                  ].map(item => (
                    <div key={item.label} className="flex justify-between items-start gap-4">
                      <span className={`text-[13px] flex-shrink-0 ${textSecondary}`}>{item.label}</span>
                      <span className={`text-[13px] font-medium text-right ${textPrimary}`}>{item.val}</span>
                    </div>
                  ))}
                </div>
              </section>

              <hr className={borderSubtle} />

              <section className="space-y-4">
                <h4 className={`text-sm font-semibold tracking-tight ${textPrimary}`}>Relationship</h4>
                <div className="space-y-3">
                  {[
                    { label: "Current Sourcing Manager", val: about.relationship.sourcingManager || "Unassigned" },
                    { label: "Manager Since", val: about.relationship.managerSince ? fmtDate(about.relationship.managerSince) : "—" },
                    { label: "Last Interaction", val: about.relationship.lastInteraction ? fmtStamp(about.relationship.lastInteraction) : "—" },
                    { label: "Next Follow-up", val: about.relationship.nextFollowUp ? fmtDate(about.relationship.nextFollowUp) : "None scheduled" },
                    { label: "Total CP Visits", val: String(about.relationship.totalCpVisits) },
                  ].map(item => (
                    <div key={item.label} className="flex justify-between items-start gap-4">
                      <span className={`text-[13px] flex-shrink-0 ${textSecondary}`}>{item.label}</span>
                      <span className={`text-[13px] font-medium text-right ${textPrimary}`}>{item.val}</span>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      )}
    </>
  ), [
    isDark, rightTab, loading, partner, about,
    totalEnquiries, totalBookings, totalVisits, lastActiveStr,
    // The style tokens below are all derived from isDark, which is already a
    // dependency; listed so the rule can see they are covered.
    borderSubtle, bgSubtle, bgPanel, textPrimary, textSecondary,
  ]);

  return (
    <div className={`h-full flex overflow-hidden font-sans bg-transparent`}>

      {/* ── 1. Partner Rail (Left Sidebar) ── */}
      <div className={`flex-col w-full lg:w-[320px] flex-shrink-0 border-r ${borderSubtle} ${bgApp} ${cpId ? 'hidden lg:flex' : 'flex'}`}>
        <div className="px-5 pt-6 pb-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className={`text-xl font-semibold tracking-tight ${textPrimary}`}>
              Messages
            </h2>
          </div>
          <label className="relative mb-3 block">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <IoSearchOutline className={textSecondary} size={16} />
            </div>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search conversations"
              className={`w-full pl-9 pr-3 py-2 rounded-xl text-[15px] focus:outline-none transition-colors ${bgSubtle} ${textPrimary} placeholder:text-[#86868B]`} />
          </label>
          <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-1 -mx-2 px-2">
            {["All", "Unread", "Favourites"].map(f => (
              <button key={f} onClick={() => setListFilter(f as any)}
                className={`px-3 py-1.5 rounded-full text-[13px] font-medium whitespace-nowrap transition-colors ${listFilter === f ? (isDark ? "bg-[#38383A] text-white" : "bg-[#E5E5EA] text-[#1D1D1F]") : (isDark ? "text-[#98989D] hover:bg-[#2C2C2E]" : "text-[#86868B] hover:bg-[#F2F2F7]")}`}>
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {/* Loading / failed / empty, kept apart. The skeleton draws the same
              48px avatar + two text lines the real rows do, so the rail does
              not resize when the partners arrive. */}
          {loadingList ? (
            <CpChatRailSkeleton isDark={isDark} rows={7} />
          ) : listError ? (
            <p className="p-4 text-[13px] text-center text-red-500">{listError}</p>
          ) : filtered.length === 0 ? (
            <p className={`p-4 text-[13px] text-center ${textSecondary}`}>No matches found.</p>
          ) : filtered.map(p => {
            const active = cpId === p.id;
            const lastAt = ts(p.updated_at || p.created_at);
            const unread = lastAt > 0 && lastAt > (seen[String(p.id)] || 0);

            return (
              <div key={p.id} onClick={() => setCpId(p.id)}
                className={`flex items-center gap-3 px-5 py-3 cursor-pointer transition-colors ${active ? (isDark ? "bg-[#1C1C1E]" : "bg-white") : `hover:${bgSubtle}`}`}>
                <div className={`w-12 h-12 rounded-full flex-shrink-0 flex items-center justify-center text-[15px] font-medium ${getInitialsBg(p.name || "")}`}>
                  {initials(p.name || "")}
                </div>
                <div className="min-w-0 flex-1 border-b pb-3 pt-1 border-transparent" style={{ borderBottomColor: active ? 'transparent' : isDark ? '#38383A' : '#E5E5EA' }}>
                  <div className="flex justify-between items-baseline mb-0.5">
                    <p className={`text-[15px] font-medium truncate ${textPrimary}`}>{p.name}</p>
                    <p className={`text-[13px] flex-shrink-0 ml-2 ${unread && !active ? 'font-medium text-blue-500' : textSecondary}`}>
                      {fmtDay(lastAt) === "Today" ? fmtClock(lastAt) : fmtDay(lastAt).split(',')[0]}
                    </p>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className={`text-[13px] truncate ${textSecondary}`}>
                      {p.company_name || "Independent"}
                    </p>
                    {unread && !active && (
                      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 bg-blue-500`} />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 2. Thread Area (Center) ── */}
      <div className={`flex-1 flex-col min-w-0 relative ${bgPanel} ${!cpId ? 'hidden lg:flex' : 'flex'}`}>
        {cpId == null ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
            <IoChatbubbleEllipsesOutline size={48} className={`mb-4 ${textSecondary}`} />
            <p className={`text-lg font-semibold ${textPrimary}`}>Your Messages</p>
            <p className={`text-[15px] mt-2 max-w-xs ${textSecondary}`}>
              Select a conversation to view messaging and updates.
            </p>
          </div>
        ) : (
          <>
            {/* THREAD HEADER */}
            <div className={`flex-shrink-0 border-b z-10 px-4 py-3 md:px-6 md:py-4 ${bgPanel} ${borderSubtle}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <button onClick={() => setCpId(null)} className={`lg:hidden p-1.5 -ml-2 rounded-full ${textSecondary} active:opacity-50`}>
                    <IoChevronBackOutline size={24} />
                  </button>
                  <div className={`w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-[13px] font-medium ${getInitialsBg(partner?.name || railRow?.name || "")}`}>
                    {initials(partner?.name || railRow?.name || "")}
                  </div>
                  <div className="min-w-0 flex flex-col justify-center">
                    <h3 className={`text-[15px] font-semibold truncate leading-tight ${textPrimary}`}>
                      {partner?.name || railRow?.name || "Channel Partner"}
                    </h3>
                    <p className={`text-[12px] truncate ${textSecondary}`}>
                      {partner?.company_name || railRow?.company_name || "Independent"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <button onClick={toggleFavourite} className={`${textPrimary} transition-colors hover:opacity-70`}>
                    {favourites[String(cpId)] ? <IoStar size={20} className="text-yellow-400" /> : <IoStarOutline size={20} />}
                  </button>
                  <button onClick={() => setMobileDrawerOpen(true)} className={`xl:hidden ${textPrimary} transition-colors hover:opacity-70`}>
                    <IoEllipsisHorizontalOutline size={22} />
                  </button>
                </div>
              </div>

              {/* TABS (Segmented Control Style) */}
              <div className={`flex items-center gap-6 mt-4`}>
                {[
                  { id: "chat", label: "Chat" },
                  { id: "visits", label: `Visits` },
                  { id: "enquiries", label: `Enquiries` },
                  { id: "bookings", label: `Bookings` },
                ].map(tab => (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id as any)}
                    className={`pb-2 text-[13px] font-medium transition-colors relative ${activeTab === tab.id ? textPrimary : textSecondary}`}>
                    {tab.label}
                    {activeTab === tab.id && (
                      <div className={`absolute bottom-0 left-0 right-0 h-[2px] rounded-t-full ${isDark ? 'bg-white' : 'bg-black'}`} />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* THREAD BODY */}
            <div className={`flex-1 overflow-y-auto custom-scrollbar px-4 md:px-6 py-6 ${bgApp}`}>
              {loading ? (
                // Shaped like the tab it is standing in for, rather than three
                // identical bars: a conversation on Chat, cards on the
                // Enquiries and Bookings tabs.
                activeTab === "chat" ? (
                  <CpChatThreadSkeleton isDark={isDark} />
                ) : activeTab === "enquiries" || activeTab === "bookings" ? (
                  <CpChatCardListSkeleton isDark={isDark} rows={4} />
                ) : (
                  <CpChatThreadSkeleton isDark={isDark} />
                )
              ) : error ? (
                <div className={`max-w-sm mx-auto mt-10 rounded-2xl p-5 text-center flex flex-col items-center ${bgPanel}`}>
                  <IoWarningOutline className="text-3xl mb-3 text-red-500" />
                  <p className={`text-[13px] font-medium ${textPrimary}`}>{error}</p>
                  <button onClick={() => fetchChat(cpId)}
                    className="mt-4 text-[13px] font-medium px-4 py-2 rounded-full bg-[#007AFF] text-white hover:opacity-90 transition-opacity">
                    Try Again
                  </button>
                </div>
              ) : activeTab === "chat" ? (
                // CHAT VIEW
                thread.length === 0 ? (
                  <div className="text-center mt-20 flex flex-col items-center gap-2">
                    <p className={`text-[13px] ${textSecondary}`}>This is the beginning of your conversation.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {thread.map((m, i) => {
                      const prev = thread[i - 1];
                      const newDay = !prev || fmtDay(prev.ts) !== fmtDay(m.ts);
                      return <ChatMessage key={m.id} m={m} newDay={newDay} isDark={isDark} />;
                    })}
                    <div ref={endRef} className="h-4" />
                  </div>
                )
              ) : activeTab === "visits" ? (
                <div className="text-center mt-20">
                  <p className={`text-[13px] ${textSecondary}`}>Visit history will appear here.</p>
                </div>
              ) : activeTab === "enquiries" ? (
                <div className="space-y-3">
                  {data?.enquiries?.map((e: any) => (
                    <div key={e.id} className={`p-4 rounded-2xl flex items-center justify-between border shadow-sm cursor-pointer hover:opacity-90 ${bgPanel} ${borderSubtle}`} onClick={() => setViewEnquiry(e)}>
                      <div>
                        <p className={`text-[15px] font-semibold ${textPrimary}`}>{e.client_name}</p>
                        <p className={`text-[13px] mt-1 ${textSecondary}`}>Lead #{e.sr_no || e.id} • {e.status}</p>
                      </div>
                      <IoChevronForwardOutline className={textSecondary} size={20} />
                    </div>
                  ))}
                  {(!data?.enquiries || data.enquiries.length === 0) && (
                    <div className={`text-center mt-20 text-[13px] ${textSecondary}`}>No walk-in enquiries recorded yet.</div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {data?.bookings?.map((b: any) => (
                    <div key={b.id} className={`p-4 rounded-2xl flex items-center justify-between border shadow-sm cursor-pointer hover:opacity-90 ${bgPanel} ${borderSubtle}`} onClick={() => setViewBooking(b)}>
                      <div>
                        <p className={`text-[15px] font-semibold ${textPrimary}`}>Booking {b.booking_number || `BK-${b.id}`}</p>
                        <p className={`text-[13px] mt-1 ${textSecondary}`}>{b.booking_status || "Confirmed"} • {fmtDay(ts(b.booking_date || b.created_at))}</p>
                      </div>
                      <IoChevronForwardOutline className={textSecondary} size={20} />
                    </div>
                  ))}
                  {(!data?.bookings || data.bookings.length === 0) && (
                    <div className={`text-center mt-20 text-[13px] ${textSecondary}`}>No bookings recorded yet.</div>
                  )}
                </div>
              )}
            </div>

            {/* COMPOSER — owns its own draft; see <Composer> above. */}
            {activeTab === "chat" && <Composer isDark={isDark} onSend={send} />}
          </>
        )}
      </div>

      {/* ── 3. Partner Details (Right Sidebar / Desktop) ── */}
      {cpId && (
        <div className={`hidden xl:flex flex-col w-[300px] flex-shrink-0 border-l overflow-y-auto custom-scrollbar ${bgPanel} ${borderSubtle}`}>
          {rightPanelJSX}
        </div>
      )}

      {/* Mobile Drawer (Bottom Sheet) */}
      <AnimatePresence>
        {mobileDrawerOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setMobileDrawerOpen(false)}
              className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm xl:hidden"
            />
            <motion.div
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className={`fixed bottom-0 left-0 right-0 z-[210] h-[85vh] rounded-t-[2.5rem] flex flex-col overflow-hidden shadow-2xl xl:hidden ${bgPanel}`}
            >
              <div className="flex flex-col items-center pt-3 pb-2 px-6">
                <div className="w-12 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600 mb-4" />
                <div className="w-full flex items-center justify-between">
                  <h3 className={`text-lg font-semibold ${textPrimary}`}>Details</h3>
                  <button onClick={() => setMobileDrawerOpen(false)} className={`p-1.5 rounded-full ${bgSubtle} ${textPrimary}`}>
                    <IoCloseOutline size={20} />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar pb-safe">
                {rightPanelJSX}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Modals */}
      <AnimatePresence>
        {viewBooking && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md p-4"
            onClick={() => setViewBooking(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className={`w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-3xl shadow-2xl relative ${bgPanel}`}
              onClick={e => e.stopPropagation()}
            >
              <button
                onClick={() => setViewBooking(null)}
                className={`absolute top-4 right-4 z-[60] p-2 rounded-full ${bgSubtle} ${textPrimary}`}
              >
                <IoCloseOutline size={20} />
              </button>
              <BookingApplicationView
                booking={viewBooking}
                lead={data?.enquiries?.find((e: any) => e.id === viewBooking.lead_id) || {}}
                userRole={user?.role || ""}
                currentUser={user}
                isDark={isDark}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {viewEnquiry && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md p-4"
            onClick={() => setViewEnquiry(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className={`w-full max-w-md p-6 rounded-[2rem] shadow-2xl border ${bgPanel} ${borderSubtle}`}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className={`text-xl font-semibold tracking-tight ${textPrimary}`}>{viewEnquiry.client_name}</h3>
                  <p className={`text-[13px] mt-1 ${textSecondary}`}>Lead #{viewEnquiry.sr_no || viewEnquiry.id}</p>
                </div>
                <button onClick={() => setViewEnquiry(null)} className={`p-1.5 rounded-full ${bgSubtle} ${textPrimary}`}>
                  <IoCloseOutline size={20} />
                </button>
              </div>
              <div className="space-y-4">
                {[
                  { k: "Phone", v: viewEnquiry.client_phone || "—" },
                  { k: "Email", v: viewEnquiry.client_email || "—" },
                  { k: "Configuration", v: viewEnquiry.configuration || "—" },
                  { k: "Budget", v: viewEnquiry.budget || "—" },
                ].map(r => (
                  <div key={r.k} className={`flex items-center justify-between py-3 border-b last:border-0 ${borderSubtle}`}>
                    <span className={`text-[13px] ${textSecondary}`}>{r.k}</span>
                    <span className={`text-[13px] font-medium ${textPrimary}`}>{r.v}</span>
                  </div>
                ))}
                <div className="pt-2 flex justify-between items-center">
                  <span className={`text-[13px] ${textSecondary}`}>Status</span>
                  <span className={`inline-block px-3 py-1 rounded-full text-[11px] font-medium bg-[#007AFF]/10 text-[#007AFF]`}>
                    {viewEnquiry.status || "New"}
                  </span>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
/**
 * Memoised at the boundary — see the note on ChannelPartnerEnquiriesTable.
 * The thread is the most expensive tree in the CRM to rebuild (up to 200
 * messages and event cards), and both hosts re-render around it constantly.
 */
export default React.memo(CpChatPanel);
