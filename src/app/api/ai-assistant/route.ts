import { NextResponse } from "next/server";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────
interface Lead {
  id: number | string;
  name: string;
  phone?: string;
  salesBudget?: string;
  budget?: string;
  leadInterestStatus?: string;
  loanPlanned?: string;
  loanStatus?: string;
  loanAmtReq?: string;
  loanAmtApp?: string;
  mongoVisitDate?: string;
  planningPurchase?: string;
  useType?: string;
  propType?: string;
  config?: string;
  source?: string;
  location?: string;
  area?: string;
  assignedTo?: string;
  assigned_to?: string;
  createdAt?: string;
  created_at?: string;
  followUps?: Array<{ message?: string; note?: string }>;
  follow_ups?: Array<{ message?: string; note?: string }>;
}

interface AnalysisResult {
  score: number;
  priority: "Very High" | "High" | "Medium" | "Low";
  suggestions: string[];
  flags: string[];
}


// ─────────────────────────────────────────────────────────────────────────────
// HELPERS — Indian currency parsing
// ─────────────────────────────────────────────────────────────────────────────
function parseBudget(raw?: string): number | null {
  if (!raw) return null;
  const s = String(raw).replace(/,/g, "").toLowerCase().trim();
  const num = parseFloat(s);
  if (isNaN(num)) return null;
  if (s.includes("cr")) return num * 10_000_000;
  if (s.includes("l") || s.includes("lac") || s.includes("lakh")) return num * 100_000;
  if (s.includes("k")) return num * 1_000;
  return num;
}

function formatBudget(raw?: string): string {
  const val = parseBudget(raw);
  if (!val) return raw || "N/A";
  if (val >= 10_000_000) return `₹${(val / 10_000_000).toFixed(2)} Cr`;
  if (val >= 100_000) return `₹${(val / 100_000).toFixed(1)} L`;
  return `₹${val.toLocaleString("en-IN")}`;
}

// FIX: formatNumber converts a raw computed number to a budget string
// without relying on suffix hints — avoids passing plain floats to formatBudget
function formatNumber(val: number): string {
  if (val >= 10_000_000) return `₹${(val / 10_000_000).toFixed(2)} Cr`;
  if (val >= 100_000) return `₹${(val / 100_000).toFixed(1)} L`;
  return `₹${val.toLocaleString("en-IN")}`;
}

function daysBetween(a?: string, b?: string): number | null {
  if (!a || !b) return null;
  const diff = new Date(b).getTime() - new Date(a).getTime();
  return Math.round(diff / (1000 * 60 * 60 * 24));
}

function fmt(ds?: string): string {
  if (!ds) return "Not scheduled";
  try {
    return new Date(ds).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return ds;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE LEAD SCORER
// ─────────────────────────────────────────────────────────────────────────────
function analyzeLead(lead: Lead): AnalysisResult {
  const suggestions: string[] = [];
  const flags: string[] = [];
  let score = 0;

  const interest = (lead.leadInterestStatus || "").toLowerCase();
  const loanPlanned = (lead.loanPlanned || "").toLowerCase();
  const loanStatus = (lead.loanStatus || "").toLowerCase();
  const planning = (lead.planningPurchase || "").toLowerCase();
  const useType = (lead.useType || "").toLowerCase();
  const source = lead.source || "";
  const budget = parseBudget(lead.salesBudget || lead.budget);
  const followUpCount = (lead.followUps || lead.follow_ups || []).length;
  const createdAt = lead.createdAt || lead.created_at;

  // ── Interest status ──
  if (interest === "interested") {
    score += 40;
    suggestions.push("Actively interested — call within the next 2 hours.");
  } else if (interest === "maybe") {
    score += 20;
    suggestions.push("Undecided — send a video walkthrough and schedule a site visit.");
  } else if (interest === "not interested") {
    score -= 10;
    suggestions.push("Marked not interested — one final personalised pitch, then archive.");
    flags.push("⚠️ Not Interested");
  }

  // ── Loan ──
  if (loanPlanned === "yes") {
    score += 15;
    if (loanStatus === "approved") {
      score += 25;
      suggestions.push("🏦 Loan APPROVED — schedule closing meeting immediately. This is a hot deal.");
      flags.push("🔥 Loan Approved");
    } else if (loanStatus === "in progress") {
      score += 10;
      suggestions.push("Loan in progress — follow up on pending docs with the bank agent.");
    } else if (loanStatus === "rejected") {
      score -= 5;
      suggestions.push("Loan rejected — suggest co-applicant or alternative NBFC/HFC.");
      flags.push("⚠️ Loan Rejected");
    } else {
      suggestions.push("Loan needed but not yet tracked — initiate bank discussion in next call.");
    }
  } else if (loanPlanned === "no") {
    score += 10;
    suggestions.push("Cash buyer — skip finance friction, focus on unit selection.");
    flags.push("💰 Cash Buyer");
  } else if (loanPlanned === "not sure") {
    suggestions.push("Loan undecided — connect to loan agent for a free eligibility check.");
  }

  // ── Site Visit ──
  if (lead.mongoVisitDate) {
    score += 20;
    const daysAway = daysBetween(new Date().toISOString(), lead.mongoVisitDate);
    if (daysAway !== null && daysAway <= 2) {
      suggestions.push(
        `🗓️ Site visit in ${daysAway <= 0 ? "TODAY/TOMORROW" : daysAway + " days"} — confirm attendance now.`
      );
      flags.push("🗓️ Visit Imminent");
    } else {
      suggestions.push(
        "Site visit scheduled — confirm 24 hours before and prepare highlights sheet."
      );
    }
  } else if (interest === "interested") {
    suggestions.push("No site visit yet — propose 2–3 date slots via WhatsApp immediately.");
    flags.push("📍 No Visit Booked");
  }

  // ── Purchase timeline ──
  if (planning.includes("immediate")) {
    score += 15;
    suggestions.push("Immediate buyer — fast-track docs, RERA copy, and floor plan.");
    flags.push("⚡ Immediate Buyer");
  } else if (planning.includes("3 month") || planning.includes("3month")) {
    score += 8;
    suggestions.push("3-month timeline — send fortnightly project updates to stay top-of-mind.");
  } else if (planning.includes("6 month") || planning.includes("6month")) {
    score += 3;
    suggestions.push("6-month timeline — low urgency. Add to drip campaign.");
  }

  // ── Budget tier ──
  if (budget !== null) {
    if (budget >= 10_000_000) {
      score += 10;
      flags.push("💎 Premium Buyer (1Cr+)");
    } else if (budget >= 5_000_000) {
      score += 6;
    } else if (budget < 2_000_000) {
      flags.push("⚡ Affordable Segment");
    }
  }

  // ── Use type ──
  if (useType.includes("invest")) {
    suggestions.push(
      "Investor — lead with rental yield, appreciation data, and RERA certificate."
    );
  } else if (useType.includes("self") || useType.includes("personal")) {
    suggestions.push(
      "Self-use — emphasise lifestyle, schools, hospitals, and amenity proximity."
    );
  }

  // ── Follow-up engagement ──
  if (followUpCount === 0 && interest === "interested") {
    suggestions.push("No follow-ups logged yet — add the first call note immediately.");
    flags.push("📞 Never Followed Up");
  } else if (followUpCount >= 5) {
    score += 5;
    suggestions.push(
      `${followUpCount} follow-ups logged — high engagement. Push for site visit decision.`
    );
  }

  // ── Lead age ──
  if (createdAt) {
    const age = daysBetween(createdAt, new Date().toISOString());
    if (age !== null && age > 30 && interest === "interested") {
      flags.push(`⏰ ${age}d old — stale`);
      suggestions.push(`Lead is ${age} days old without closure — re-engage with a fresh offer.`);
    }
  }

  // ── Source-specific tactics ──
  const sourceTips: Record<string, string> = {
    "Channel Partner":
      "CP lead — keep the partner updated to maintain the relationship & referral pipeline.",
    Facebook: "Facebook lead — nurture with video walkthroughs and 'limited unit' urgency.",
    Instagram:
      "Instagram lead — visual buyer, send high-quality renders and reel walkthroughs.",
    Website:
      "Website lead — actively comparing. Share detailed brochure + pricing immediately.",
    Referral:
      "Referral lead — high trust baseline. Fast-track and deliver a VIP experience.",
    "99acres":
      "99acres lead — price-sensitive comparison shopper. Lead with value proposition.",
    MagicBricks:
      "MagicBricks lead — high intent but high comparison. Differentiate on amenities.",
    "Walk-in": "Walk-in lead — already visited! Strike while interest is hot.",
  };
  if (sourceTips[source]) suggestions.push(sourceTips[source]);

  const clamped = Math.min(Math.max(score, 0), 100);
  const priority: AnalysisResult["priority"] =
    clamped >= 70
      ? "Very High"
      : clamped >= 50
        ? "High"
        : clamped >= 30
          ? "Medium"
          : "Low";

  return { score: clamped, priority, suggestions, flags };
}

// ─────────────────────────────────────────────────────────────────────────────
// ANALYTICS ENGINE — pre-computed stats (never rely on LLM for numbers)
// ─────────────────────────────────────────────────────────────────────────────
function buildAnalytics(leads: Lead[]) {
  const total = leads.length;
  const interested = leads.filter(
    (l) => (l.leadInterestStatus || "").toLowerCase() === "interested"
  );
  const notInterested = leads.filter(
    (l) => (l.leadInterestStatus || "").toLowerCase() === "not interested"
  );
  const maybe = leads.filter(
    (l) => (l.leadInterestStatus || "").toLowerCase() === "maybe"
  );
  const withVisit = leads.filter((l) => l.mongoVisitDate);
  const loanActive = leads.filter(
    (l) => (l.loanPlanned || "").toLowerCase() === "yes"
  );
  const loanApproved = leads.filter(
    (l) => (l.loanStatus || "").toLowerCase() === "approved"
  );
  const cashBuyers = leads.filter(
    (l) => (l.loanPlanned || "").toLowerCase() === "no"
  );
  const noFollowUp = leads.filter(
    (l) =>
      (l.leadInterestStatus || "").toLowerCase() === "interested" &&
      (l.followUps || l.follow_ups || []).length === 0
  );

  // Scored & sorted
  const scored = leads
    .map((l) => ({ lead: l, analysis: analyzeLead(l) }))
    .sort((a, b) => b.analysis.score - a.analysis.score);
  const highPriority = scored.filter((x) => x.analysis.score >= 50);
  const veryHigh = scored.filter((x) => x.analysis.priority === "Very High");

  // Budget stats — work with raw numbers, use formatNumber for display
  const budgets = leads
    .map((l) => parseBudget(l.salesBudget || l.budget))
    .filter((v): v is number => v !== null);
  const avgBudget = budgets.length
    ? budgets.reduce((sum, b) => sum + b, 0) / budgets.length
    : null;
  const maxBudget = budgets.length ? Math.max(...budgets) : null;

  // Config demand
  const configMap: Record<string, number> = {};
  leads.forEach((l) => {
    const cfg = (l.config || l.propType || "Unknown").trim();
    if (cfg && cfg !== "Pending") configMap[cfg] = (configMap[cfg] || 0) + 1;
  });
  const topConfigs = Object.entries(configMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  // Location demand
  const locationMap: Record<string, number> = {};
  leads.forEach((l) => {
    const loc = (l.location || l.area || "").trim();
    if (loc) locationMap[loc] = (locationMap[loc] || 0) + 1;
  });
  const topLocations = Object.entries(locationMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  // Source distribution
  const sourceMap: Record<string, number> = {};
  leads.forEach((l) => {
    const src = l.source || "Unknown";
    sourceMap[src] = (sourceMap[src] || 0) + 1;
  });
  const topSources = Object.entries(sourceMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  // Pipeline velocity (creation → visit date, in days)
  const velocities = leads
    .filter((l) => l.mongoVisitDate && (l.createdAt || l.created_at))
    .map((l) => daysBetween(l.createdAt || l.created_at, l.mongoVisitDate))
    .filter((v): v is number => v !== null && v > 0);
  const avgVelocity = velocities.length
    ? Math.round(velocities.reduce((sum, v) => sum + v, 0) / velocities.length)
    : null;

  // Site visit ratio
  const visitRatio = total > 0 ? ((withVisit.length / total) * 100).toFixed(1) : "0";

  // Conversion rate (interested / total)
  const conversionRate =
    total > 0 ? ((interested.length / total) * 100).toFixed(1) : "0";

  // Upcoming visits (next 7 days)
  const today = new Date();
  const upcomingVisits = withVisit.filter((l) => {
    const diff = daysBetween(today.toISOString(), l.mongoVisitDate);
    return diff !== null && diff >= 0 && diff <= 7;
  });

  return {
    total,
    interested,
    notInterested,
    maybe,
    withVisit,
    loanActive,
    loanApproved,
    cashBuyers,
    noFollowUp,
    scored,
    highPriority,
    veryHigh,
    avgBudget,
    maxBudget,
    configMap,
    topConfigs,
    topLocations,
    topSources,
    avgVelocity,
    visitRatio,
    conversionRate,
    upcomingVisits,
  };
}

type Analytics = ReturnType<typeof buildAnalytics>;

// ─────────────────────────────────────────────────────────────────────────────
// INTENT CLASSIFIER
// ─────────────────────────────────────────────────────────────────────────────
type Intent =
  | "greeting"
  | "overview"
  | "priority"
  | "loan"
  | "visit"
  | "lost_analysis"
  | "config_demand"
  | "location_demand"
  | "source_analysis"
  | "velocity"
  | "no_followup"
  | "budget"
  | "suggest"
  | "lead_lookup"
  | "help";

function classifyIntent(query: string): Intent {
  const q = query.toLowerCase();

  // FIX: help check added before other patterns to ensure it triggers
  if (/\bhelp\b|what can you do|commands|capabilities/.test(q)) return "help";

  if (/^(hi|hello|hey|good\s?(morning|evening|afternoon)|what'?s up|howdy)/.test(q))
    return "greeting";

  if (
    /overview|summary|report|analysis|dashboard|stats|analytics|breakdown|pipeline/.test(q)
  )
    return "overview";

  if (/priority|hot|best lead|top lead|rank|urgent|critical|fire/.test(q))
    return "priority";

  if (/loan|bank|finance|emi|mortgage|hdfc|sbi|nbfc|approved|rejected/.test(q))
    return "loan";

  if (/visit|site|scheduled|upcoming|appointment/.test(q)) return "visit";

  if (/lost|drop|churned|not interested|dead lead|archive|why losing/.test(q))
    return "lost_analysis";

  if (/config|bhk|1bhk|2bhk|3bhk|unit type|flat type|villa|studio/.test(q))
    return "config_demand";

  if (/location|area|locality|zone|where|preferred area|micro market/.test(q))
    return "location_demand";

  if (
    /source|channel|facebook|instagram|referral|website|99acres|where coming from/.test(q)
  )
    return "source_analysis";

  if (/velocity|speed|how long|days? to|pipeline speed|closure time/.test(q))
    return "velocity";

  if (/no follow.?up|not called|pending call|never called|missed call|forgot/.test(q))
    return "no_followup";

  if (/budget|spending|afford|price range|how much|average budget/.test(q))
    return "budget";

  if (
    /suggest|advice|recommend|what should|next step|what to do|help me|strategy/.test(q)
  )
    return "suggest";

  if (/total|how many|count/.test(q)) return "overview";

  return "lead_lookup";
}

// ─────────────────────────────────────────────────────────────────────────────
// FUZZY LEAD MATCHER
// ─────────────────────────────────────────────────────────────────────────────
function findLead(query: string, leads: Lead[]): Lead | null {
  const q = query.toLowerCase();

  // Exact ID match
  const idMatch = q.match(/#?(\d+)/);
  if (idMatch) {
    const found = leads.find((l) => String(l.id) === idMatch[1]);
    if (found) return found;
  }

  // Full name match
  const byName = leads.find((l) => q.includes((l.name || "").toLowerCase()));
  if (byName) return byName;

  // First name match
  const byFirstName = leads.find((l) => {
    const first = (l.name || "").toLowerCase().split(" ")[0];
    return first.length > 2 && q.includes(first);
  });

  return byFirstName || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// RESPONSE FORMATTERS
// ─────────────────────────────────────────────────────────────────────────────
function scoreBar(score: number): string {
  const filled = Math.round(score / 10);
  return "█".repeat(filled) + "░".repeat(10 - filled) + ` ${score}/100`;
}

function priorityEmoji(p: string): string {
  const map: Record<string, string> = {
    "Very High": "🔴",
    High: "🟠",
    Medium: "🟡",
    Low: "🔵",
  };
  return map[p] ?? "⚪";
}

// ─────────────────────────────────────────────────────────────────────────────
// HANDLERS — one function per intent
// ─────────────────────────────────────────────────────────────────────────────
function handleGreeting(a: Analytics): string {
  const topLead = a.scored[0];
  const urgentVisits = a.upcomingVisits.length;
  const loanCloseable = a.loanApproved.length;
  const unworked = a.noFollowUp.length;

  let r = `Good day! Here's your morning brief:\n\n`;
  r += `📊 **Pipeline Snapshot**\n`;
  r += `• ${a.total} total leads | ${a.interested.length} interested (${a.conversionRate}% conversion)\n`;
  r += `• ${a.highPriority.length} high-priority leads need your attention\n`;
  r += `• Site visit ratio: ${a.visitRatio}%\n\n`;

  if (urgentVisits > 0) {
    r += `🗓️ **${urgentVisits} site visit(s) in the next 7 days** — confirm attendance now.\n\n`;
  }

  if (loanCloseable > 0) {
    r += `🏦 **${loanCloseable} lead(s) with loan APPROVED** — these are ready to close.\n\n`;
  }

  if (unworked > 0) {
    r += `📞 **${unworked} interested lead(s) have ZERO follow-ups logged** — call them today.\n\n`;
  }

  if (topLead) {
    r += `⚡ **Your #1 lead right now:** ${topLead.lead.name} (#${topLead.lead.id})\n`;
    r += `   Score: ${scoreBar(topLead.analysis.score)} | ${priorityEmoji(topLead.analysis.priority)} ${topLead.analysis.priority}\n`;
    if (topLead.analysis.flags.length)
      r += `   Flags: ${topLead.analysis.flags.join(" | ")}\n`;
  }

  return r;
}

function handleOverview(a: Analytics): string {
  let r = `📊 **Complete Pipeline Overview**\n`;
  r += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  r += `**Lead Health**\n`;
  r += `• Total Leads: ${a.total}\n`;
  r += `• ✅ Interested: ${a.interested.length} (${a.conversionRate}%)\n`;
  r += `• 🤔 Maybe: ${a.maybe.length}\n`;
  r += `• ❌ Not Interested: ${a.notInterested.length}\n\n`;

  r += `**Site Visits**\n`;
  r += `• Scheduled: ${a.withVisit.length} (${a.visitRatio}% ratio)\n`;
  r += `• Upcoming in 7 days: ${a.upcomingVisits.length}\n`;
  if (a.avgVelocity !== null) r += `• Avg days lead→visit: ${a.avgVelocity}d\n`;
  r += `\n`;

  r += `**Finance**\n`;
  r += `• Loan Active: ${a.loanActive.length}\n`;
  r += `• Loan Approved: ${a.loanApproved.length} 🔥\n`;
  r += `• Cash Buyers: ${a.cashBuyers.length}\n\n`;

  // FIX: use formatNumber() instead of formatBudget(String(number))
  if (a.avgBudget !== null) {
    r += `**Budget**\n`;
    r += `• Average Budget: ${formatNumber(a.avgBudget)}\n`;
    if (a.maxBudget !== null) r += `• Highest Budget: ${formatNumber(a.maxBudget)}\n`;
    r += `\n`;
  }

  if (a.topConfigs.length) {
    r += `**Configuration Demand**\n`;
    // FIX: denominator is total all-config leads, not just top-4 slice
    const totalCfgLeads = Object.values(a.configMap).reduce((sum, v) => sum + v, 0);
    const denominator = totalCfgLeads > 0 ? totalCfgLeads : 1;
    a.topConfigs.forEach(([cfg, cnt]) => {
      r += `• ${cfg}: ${cnt} leads (${((cnt / denominator) * 100).toFixed(0)}%)\n`;
    });
    r += `\n`;
  }

  r += `**Priority Breakdown**\n`;
  r += `• 🔴 Very High: ${a.veryHigh.length}\n`;
  r += `• 🟠 High: ${a.highPriority.filter((x) => x.analysis.priority === "High").length}\n`;
  r += `• 🟡 Medium: ${a.scored.filter((x) => x.analysis.priority === "Medium").length}\n`;
  r += `• 🔵 Low: ${a.scored.filter((x) => x.analysis.priority === "Low").length}\n\n`;

  if (a.highPriority.length) {
    r += `**Top 3 Leads to Act On Now**\n`;
    a.highPriority.slice(0, 3).forEach((x, i) => {
      r += `${i + 1}. ${x.lead.name} (#${x.lead.id}) — ${priorityEmoji(x.analysis.priority)} ${x.analysis.priority} | ${scoreBar(x.analysis.score)}\n`;
    });
  }

  return r;
}

function handlePriority(a: Analytics): string {
  if (!a.scored.length) return "No leads to rank right now.";

  let r = `🔥 **Top Priority Leads — Ranked by AI Score**\n`;
  r += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  a.scored.slice(0, 7).forEach(({ lead: l, analysis: an }, i) => {
    r += `**${i + 1}. ${l.name}** (#${l.id})\n`;
    r += `   ${scoreBar(an.score)} | ${priorityEmoji(an.priority)} ${an.priority}\n`;
    r += `   Budget: ${formatBudget(l.salesBudget || l.budget)} | Interest: ${l.leadInterestStatus || "Pending"}\n`;
    if (l.mongoVisitDate) r += `   🗓️ Visit: ${fmt(l.mongoVisitDate)}\n`;
    if (l.loanStatus && l.loanStatus !== "N/A")
      r += `   🏦 Loan: ${l.loanPlanned} (${l.loanStatus})\n`;
    if (an.flags.length) r += `   Flags: ${an.flags.join(" | ")}\n`;
    if (an.suggestions.length) r += `   → ${an.suggestions[0]}\n`;
    r += `\n`;
  });

  return r;
}

function handleLoan(leads: Lead[]): string {
  const loanLeads = leads.filter(
    (l) =>
      (l.loanPlanned || "").toLowerCase() === "yes" ||
      ((l.loanStatus || "") !== "" && l.loanStatus !== "N/A")
  );

  if (!loanLeads.length)
    return "No leads with active loan tracking found. Ask callers to log loan status in their follow-up notes.";

  const approved = loanLeads.filter(
    (l) => (l.loanStatus || "").toLowerCase() === "approved"
  );
  const inProgress = loanLeads.filter(
    (l) => (l.loanStatus || "").toLowerCase() === "in progress"
  );
  const rejected = loanLeads.filter(
    (l) => (l.loanStatus || "").toLowerCase() === "rejected"
  );
  const untracked = loanLeads.filter((l) => !l.loanStatus || l.loanStatus === "N/A");

  let r = `🏦 **Loan Pipeline Summary**\n`;
  r += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  r += `• Total loan-tracked: ${loanLeads.length}\n`;
  r += `• ✅ Approved: ${approved.length}\n`;
  r += `• 🔄 In Progress: ${inProgress.length}\n`;
  r += `• ❌ Rejected: ${rejected.length}\n`;
  r += `• ❓ Status Unknown: ${untracked.length}\n\n`;

  if (approved.length) {
    r += `**🔥 APPROVED — Close These Now**\n`;
    approved.forEach((l) => {
      r += `• ${l.name} (#${l.id})`;
      if (l.loanAmtApp) r += ` — Approved: ${formatBudget(l.loanAmtApp)}`;
      r += `\n`;
    });
    r += `\n`;
  }

  if (inProgress.length) {
    r += `**🔄 In Progress — Follow Up on Docs**\n`;
    inProgress.forEach((l) => {
      r += `• ${l.name} (#${l.id})`;
      if (l.loanAmtReq) r += ` — Requested: ${formatBudget(l.loanAmtReq)}`;
      r += `\n`;
    });
    r += `\n`;
  }

  if (rejected.length) {
    r += `**⚠️ Rejected — Recovery Strategy**\n`;
    rejected.forEach((l) => {
      r += `• ${l.name} (#${l.id}) — Suggest co-applicant or NBFC/HFC alternative\n`;
    });
  }

  return r;
}

function handleVisit(leads: Lead[]): string {
  const visitLeads = leads
    .filter((l) => l.mongoVisitDate)
    .sort(
      (a, b) =>
        new Date(a.mongoVisitDate!).getTime() - new Date(b.mongoVisitDate!).getTime()
    );

  if (!visitLeads.length)
    return "No site visits are currently scheduled.\n\nFor every 'Interested' lead without a visit booked, send them 2–3 WhatsApp date options today.";

  const today = new Date();
  const overdue = visitLeads.filter((l) => new Date(l.mongoVisitDate!) < today);
  const upcoming = visitLeads.filter((l) => new Date(l.mongoVisitDate!) >= today);

  let r = `🗓️ **Site Visit Schedule**\n`;
  r += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (overdue.length) {
    r += `**⚠️ Overdue Visits (${overdue.length}) — Follow Up Now**\n`;
    overdue.forEach((l) => {
      r += `• ${l.name} (#${l.id}) — was ${fmt(l.mongoVisitDate)} | ${l.leadInterestStatus || "Pending"}\n`;
    });
    r += `\n`;
  }

  if (upcoming.length) {
    r += `**✅ Upcoming Visits (${upcoming.length})**\n`;
    upcoming.forEach((l) => {
      const days = daysBetween(today.toISOString(), l.mongoVisitDate);
      const urgency = days !== null && days <= 2 ? " ⚡ CONFIRM NOW" : "";
      r += `• ${l.name} (#${l.id}) — ${fmt(l.mongoVisitDate)}${urgency}\n`;
      r += `  Budget: ${formatBudget(l.salesBudget || l.budget)} | ${l.leadInterestStatus || "Pending"}\n`;
    });
  }

  return r;
}

function handleLostAnalysis(a: Analytics, leads: Lead[]): string {
  const lost = a.notInterested;
  if (!lost.length) return "No leads marked 'Not Interested' yet. Great retention!";

  const lostBySource: Record<string, number> = {};
  lost.forEach((l) => {
    const src = l.source || "Unknown";
    lostBySource[src] = (lostBySource[src] || 0) + 1;
  });

  const lostBudgets = lost
    .map((l) => parseBudget(l.salesBudget || l.budget))
    .filter((v): v is number => v !== null);

  // FIX: use formatNumber for computed number values
  const avgLostBudget = lostBudgets.length
    ? lostBudgets.reduce((sum, b) => sum + b, 0) / lostBudgets.length
    : null;

  const lostWithNoVisit = lost.filter((l) => !l.mongoVisitDate).length;
  const lostWithNoFollowUp = lost.filter(
    (l) => (l.followUps || l.follow_ups || []).length === 0
  ).length;

  const totalLeads = leads.length > 0 ? leads.length : 1; // FIX: guard against divide-by-zero

  let r = `📉 **Lost Lead Analysis — Root Cause Report**\n`;
  r += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  r += `**Summary**\n`;
  r += `• Total lost: ${lost.length} (${((lost.length / totalLeads) * 100).toFixed(1)}% of pipeline)\n`;
  if (avgLostBudget !== null)
    r += `• Avg lost budget: ${formatNumber(avgLostBudget)}\n`;
  r += `\n`;

  r += `**Root Cause Patterns**\n`;
  if (lostWithNoVisit > 0) {
    const pct = lost.length > 0 ? ((lostWithNoVisit / lost.length) * 100).toFixed(0) : "0";
    r += `• ${lostWithNoVisit} lost leads (${pct}%) **never visited the site** — no experience = no conviction.\n`;
  }
  if (lostWithNoFollowUp > 0) {
    r += `• ${lostWithNoFollowUp} lost leads received **zero follow-up** — dropped due to neglect, not disinterest.\n`;
  }

  r += `\n**Lost by Source**\n`;
  Object.entries(lostBySource)
    .sort((x, y) => y[1] - x[1])
    .forEach(([src, cnt]) => {
      const pct = lost.length > 0 ? ((cnt / lost.length) * 100).toFixed(0) : "0";
      r += `• ${src}: ${cnt} lost (${pct}%)\n`;
    });

  r += `\n**Recovery Strategies**\n`;
  r += `1. Re-engage leads who never got a site visit — offer a "VIP private viewing".\n`;
  r += `2. For leads lost after budget discussion — introduce flexible payment plans upfront next time.\n`;
  r += `3. ${lostBySource["Facebook"]
    ? `${lostBySource["Facebook"]} Facebook leads lost — these need more nurturing.`
    : "Ensure each source gets a tailored pitch."
    }\n`;

  return r;
}

function handleConfigDemand(a: Analytics): string {
  if (!a.topConfigs.length) return "No property type / configuration data logged yet.";

  // FIX: use total across ALL configs for accurate percentages
  const totalCfgLeads = Object.values(a.configMap).reduce((sum, v) => sum + v, 0);
  const denominator = totalCfgLeads > 0 ? totalCfgLeads : 1;

  let r = `🏗️ **Configuration & Property Type Demand**\n`;
  r += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  a.topConfigs.forEach(([cfg, cnt]) => {
    const pct = ((cnt / denominator) * 100).toFixed(0);
    const bar = "▓".repeat(Math.round(Number(pct) / 10)).padEnd(10, "░");
    r += `${bar} ${cfg}: ${cnt} leads (${pct}%)\n`;
  });

  r += `\n**Inventory Alignment Tips**\n`;
  const top = a.topConfigs[0];
  if (top) r += `• Push ${top[0]} inventory hardest — highest demand at ${top[1]} leads.\n`;
  r += `• Ensure site visits show unit types matching the lead's preference.\n`;

  return r;
}

function handleLocationDemand(a: Analytics): string {
  if (!a.topLocations.length)
    return "No location preference data logged yet. Ask callers to record preferred micro-markets.";

  let r = `📍 **Location & Area Preference Report**\n`;
  r += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  a.topLocations.forEach(([loc, cnt], i) => {
    r += `${i + 1}. ${loc}: ${cnt} lead${cnt > 1 ? "s" : ""}\n`;
  });

  r += `\n**Action:**\n`;
  r += `• Focus site visit scheduling in top-demand micro-markets first.\n`;
  r += `• Use location preference in WhatsApp follow-ups to personalise the pitch.\n`;

  return r;
}

function handleSourceAnalysis(a: Analytics): string {
  if (!a.topSources.length) return "No source data available.";

  const intBySource: Record<string, number> = {};
  a.interested.forEach((l) => {
    const src = l.source || "Unknown";
    intBySource[src] = (intBySource[src] || 0) + 1;
  });

  let r = `📣 **Lead Source Analysis**\n`;
  r += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  a.topSources.forEach(([src, cnt]) => {
    const intCount = intBySource[src] || 0;
    const conv = ((intCount / (cnt || 1)) * 100).toFixed(0); // FIX: guard divide-by-zero
    r += `• **${src}**: ${cnt} leads | ${intCount} interested (${conv}% conversion)\n`;
  });

  r += `\n**Insight:**\n`;

  // FIX: renamed sort callback params from (a,b) to (x,y) to avoid shadowing outer `a: Analytics`
  const bestSource = a.topSources
    .map(([src, cnt]) => ({ src, conv: (intBySource[src] || 0) / (cnt || 1) }))
    .sort((x, y) => y.conv - x.conv)[0];

  if (bestSource)
    r += `• 🏆 Best converting source: **${bestSource.src}** (${(bestSource.conv * 100).toFixed(0)}%)\n`;

  return r;
}

function handleNoFollowUp(a: Analytics): string {
  if (!a.noFollowUp.length)
    return "✅ All interested leads have at least one follow-up logged. Great discipline!";

  let r = `📞 **Interested Leads With Zero Follow-ups (${a.noFollowUp.length})**\n`;
  r += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  r += `These leads showed interest but no one has called them yet.\n\n`;

  a.noFollowUp.slice(0, 10).forEach((l, i) => {
    const age = daysBetween(l.createdAt || l.created_at, new Date().toISOString());
    r += `${i + 1}. **${l.name}** (#${l.id})`;
    if (age !== null) r += ` — ${age}d old`;
    r += `\n`;
    r += `   Budget: ${formatBudget(l.salesBudget || l.budget)} | Source: ${l.source || "N/A"}\n`;
  });

  r += `\n⚡ **Action:** Call these leads today. Each day without contact reduces closure probability by ~8%.`;
  return r;
}

function handleBudget(leads: Lead[]): string {
  const budgets = leads
    .map((l) => ({ lead: l, val: parseBudget(l.salesBudget || l.budget) }))
    .filter((x): x is { lead: Lead; val: number } => x.val !== null);

  if (!budgets.length) return "No budget data logged yet.";

  const vals = budgets.map((x) => x.val);
  const avg = vals.reduce((sum, v) => sum + v, 0) / vals.length;
  const max = Math.max(...vals);
  const min = Math.min(...vals);

  const tiers = {
    premium: budgets.filter((x) => x.val >= 10_000_000),
    mid: budgets.filter((x) => x.val >= 5_000_000 && x.val < 10_000_000),
    affordable: budgets.filter((x) => x.val < 5_000_000),
  };

  let r = `💰 **Budget Intelligence Report**\n`;
  r += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  // FIX: use formatNumber() for all computed numeric budget values
  r += `• Average Budget: **${formatNumber(avg)}**\n`;
  r += `• Highest Budget: ${formatNumber(max)}\n`;
  r += `• Lowest Budget: ${formatNumber(min)}\n\n`;

  r += `**Tier Breakdown**\n`;
  r += `• 💎 Premium (1Cr+): ${tiers.premium.length} leads\n`;
  r += `• 🏠 Mid-range (50L–1Cr): ${tiers.mid.length} leads\n`;
  r += `• ⚡ Affordable (<50L): ${tiers.affordable.length} leads\n\n`;

  if (tiers.premium.length) {
    r += `**Top Budget Leads**\n`;
    tiers.premium
      .sort((x, y) => y.val - x.val) // FIX: sort descending so highest budget is first
      .slice(0, 3)
      .forEach((x) => {
        r += `• ${x.lead.name} (#${x.lead.id}) — ${formatBudget(x.lead.salesBudget || x.lead.budget)}\n`;
      });
  }

  return r;
}

function handleVelocity(a: Analytics): string {
  let r = `⚡ **Pipeline Velocity Report**\n`;
  r += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (a.avgVelocity !== null) {
    r += `• Average days from lead entry → site visit: **${a.avgVelocity} days**\n`;
    if (a.avgVelocity > 14)
      r += `• ⚠️ ${a.avgVelocity} days is too slow. Industry benchmark is 7–10 days.\n`;
    else r += `• ✅ Good velocity. Maintain this cadence.\n`;
  } else {
    r += `• Not enough visit data to calculate velocity yet.\n`;
  }

  r += `\n• Site Visit Ratio: ${a.visitRatio}% (${a.withVisit.length} of ${a.total} leads)\n`;
  r += `• Upcoming visits (7 days): ${a.upcomingVisits.length}\n\n`;

  if (Number(a.visitRatio) < 20)
    r += `⚠️ Site visit ratio below 20% is a pipeline health risk. Focus on converting 'Interested' leads into site bookings.\n`;

  return r;
}

function handleSuggest(a: Analytics): string {
  const top = a.scored[0];
  if (!top) return "No leads available for recommendation.";

  const l = top.lead;
  const an = top.analysis;

  let r = `🧠 **AI Recommendation — What To Do Right Now**\n`;
  r += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  r += `Your highest-value lead to act on: **${l.name}** (#${l.id})\n`;
  r += `Score: ${scoreBar(an.score)} | ${priorityEmoji(an.priority)} ${an.priority}\n\n`;

  r += `**Lead Snapshot**\n`;
  r += `• Budget: ${formatBudget(l.salesBudget || l.budget)}\n`;
  r += `• Interest: ${l.leadInterestStatus || "Pending"}\n`;
  r += `• Loan: ${l.loanPlanned || "Not confirmed"}${l.loanStatus && l.loanStatus !== "N/A" ? ` (${l.loanStatus})` : ""
    }\n`;
  r += `• Site Visit: ${fmt(l.mongoVisitDate)}\n\n`;

  r += `**Recommended Actions**\n`;
  an.suggestions.slice(0, 5).forEach((s, i) => {
    r += `${i + 1}. ${s}\n`;
  });

  if (a.noFollowUp.length > 0) {
    r += `\n📞 **Also Urgent:** ${a.noFollowUp.length} interested lead(s) have never been called.`;
  }

  if (a.upcomingVisits.length > 0) {
    r += `\n🗓️ **Also Urgent:** ${a.upcomingVisits.length} site visit(s) in the next 7 days need confirmation.`;
  }

  return r;
}

function handleLeadLookup(lead: Lead): string {
  const an = analyzeLead(lead);
  const followUps = lead.followUps || lead.follow_ups || [];
  const lastFu = followUps[followUps.length - 1];

  let r = `👤 **Lead Profile: ${lead.name}** (#${lead.id})\n`;
  r += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  r += `**AI Score:** ${scoreBar(an.score)} | ${priorityEmoji(an.priority)} ${an.priority}\n`;
  if (an.flags.length) r += `**Flags:** ${an.flags.join(" | ")}\n`;
  r += `\n`;

  r += `**Contact & Source**\n`;
  r += `• Phone: ${lead.phone || "N/A"}\n`;
  r += `• Source: ${lead.source || "Unknown"}\n`;
  r += `• Assigned To: ${lead.assignedTo || lead.assigned_to || "Unassigned"}\n\n`;

  r += `**Purchase Profile**\n`;
  r += `• Budget: ${formatBudget(lead.salesBudget || lead.budget)}\n`;
  r += `• Property Type: ${lead.propType || lead.config || "Not specified"}\n`;
  r += `• Use Type: ${lead.useType || "Not specified"}\n`;
  r += `• Purchase Timeline: ${lead.planningPurchase || "Not specified"}\n`;
  r += `• Interest Status: ${lead.leadInterestStatus || "Not assessed"}\n\n`;

  r += `**Finance**\n`;
  r += `• Loan Planned: ${lead.loanPlanned || "Not confirmed"}\n`;
  if (lead.loanStatus && lead.loanStatus !== "N/A") {
    r += `• Loan Status: ${lead.loanStatus}\n`;
    if (lead.loanAmtReq) r += `• Amount Requested: ${formatBudget(lead.loanAmtReq)}\n`;
    if (lead.loanAmtApp) r += `• Amount Approved: ${formatBudget(lead.loanAmtApp)}\n`;
  }
  r += `\n`;

  r += `**Site Visit:** ${fmt(lead.mongoVisitDate)}\n`;
  r += `**Follow-ups logged:** ${followUps.length}\n`;
  if (lastFu) r += `**Last note:** "${lastFu.message || lastFu.note || "—"}"\n`;
  r += `\n`;

  r += `**Recommended Actions**\n`;
  an.suggestions.slice(0, 5).forEach((s, i) => {
    r += `${i + 1}. ${s}\n`;
  });

  r += `\n[Click here to manage Lead #${lead.id}](/dashboard/leads?id=${lead.id})`;

  return r;
}

function handleHelp(): string {
  return (
    `🤖 **Bhoomi AI — What I Can Help You With**\n\n` +
    `**Analytics & Reports**\n` +
    `• "overview" or "pipeline summary" — full stats dashboard\n` +
    `• "budget report" — average, tier breakdown, top spenders\n` +
    `• "config demand" — which BHK types are most requested\n` +
    `• "location demand" — top preferred areas\n` +
    `• "source analysis" — which channel converts best\n` +
    `• "pipeline velocity" — how fast leads reach site visits\n\n` +
    `**Priority & Actions**\n` +
    `• "show hot leads" — top ranked leads with scores\n` +
    `• "suggest what I should do" — AI-powered next action\n` +
    `• "who has no follow-up?" — unworked interested leads\n\n` +
    `**Finance & Visits**\n` +
    `• "loan summary" — approved, in-progress, rejected\n` +
    `• "site visits" — upcoming and overdue visits\n\n` +
    `**Lead Intelligence**\n` +
    `• "analyze lost leads" — root cause of drop-offs\n` +
    `• Type any **lead name or #ID** for a full breakdown`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE HANDLER
export async function POST(req: Request) {
  try {
    const body = await req.json();
    console.log("Body keys:", Object.keys(body));
    console.log("Query:", body.query);
    console.log("Leads type:", typeof body.leads, Array.isArray(body.leads));
    console.log("Leads count:", body.leads?.length);
    // ... rest of handler

    const query = (body.query || "").trim();
    const leads: Lead[] = body.leads || [];

    if (!leads.length) {
      return NextResponse.json({
        response:
          "No lead data found. Please make sure your leads are synced and try again.",
      });
    }

    const analytics = buildAnalytics(leads);
    const intent = classifyIntent(query);

    // Lead lookup — always try first for explicit name/ID mentions
    // FIX: also attempt lookup for any intent so named leads always resolve
    if (intent === "lead_lookup" || /\#?\d{1,6}/.test(query)) {
      const lead = findLead(query, leads);
      if (lead) {
        return NextResponse.json({ response: handleLeadLookup(lead) });
      }
      // Fall through to help if no lead matched and intent is lead_lookup
      if (intent === "lead_lookup") {
        return NextResponse.json({ response: handleHelp() });
      }
    }

    const responses: Record<Intent, () => string> = {
      greeting: () => handleGreeting(analytics),
      overview: () => handleOverview(analytics),
      priority: () => handlePriority(analytics),
      loan: () => handleLoan(leads),
      visit: () => handleVisit(leads),
      lost_analysis: () => handleLostAnalysis(analytics, leads),
      config_demand: () => handleConfigDemand(analytics),
      location_demand: () => handleLocationDemand(analytics),
      source_analysis: () => handleSourceAnalysis(analytics),
      no_followup: () => handleNoFollowUp(analytics),
      budget: () => handleBudget(leads),
      velocity: () => handleVelocity(analytics),
      suggest: () => handleSuggest(analytics),
      lead_lookup: () => handleHelp(),
      help: () => handleHelp(),
    };

    const handler = responses[intent] ?? responses.help;
    return NextResponse.json({ response: handler() });
  } catch (err) {
    console.error("Bhoomi AI error:", err);
    return NextResponse.json(
      { response: "Something went wrong on my end. Please try again." },
      { status: 500 }
    );
  }
}