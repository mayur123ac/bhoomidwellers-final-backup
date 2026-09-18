"use client";

// ============================================================================
// GEO ANALYTICS VIEW — Admin Panel Only
// Lead Movement & Route Mapping Upgrade (Apple UI/UX Version)
// ============================================================================

import { useState, useEffect, useRef, useMemo } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import { FaHome, FaBuilding, FaLocationArrow, FaRupeeSign, FaMapMarkerAlt, FaSpinner } from "react-icons/fa";

// ─── STATIC MMR GEOCODING TABLE ──────────────────────────────────────────────
const MMR_GEOCODES: Record<string, [number, number]> = {
  // Thane District
  "kalyan": [19.2403, 73.1305],
  "dombivli": [19.2134, 73.0860],
  "dombivali": [19.2134, 73.0860],
  "ambernath": [19.1972, 73.1864],
  "badlapur": [19.1627, 73.2627],
  "ulhasnagar": [19.2183, 73.1570],
  "bhiwandi": [19.2967, 73.0634],
  "titwala": [19.2833, 73.1833],
  "shahad": [19.2500, 73.1500],
  "vithalwadi": [19.2350, 73.1100],
  "manpada": [19.2220, 73.0950],
  "palava": [19.1650, 73.0833],
  "thane": [19.2183, 72.9781],
  "thane west": [19.2500, 72.9500],
  "thane east": [19.2183, 73.0200],
  "ghodbunder": [19.2683, 72.9617],
  "wagle estate": [19.2000, 72.9800],
  "kopri": [19.2050, 73.0100],
  "teen haath naka": [19.1950, 73.0050],
  "majiwada": [19.2200, 72.9950],
  "vartak nagar": [19.2300, 72.9850],
  "kolshet": [19.2583, 72.9717],
  "pokhran": [19.2350, 73.0100],
  "naupada": [19.1950, 72.9750],

  // Navi Mumbai
  "navi mumbai": [19.0368, 73.0158],
  "panvel": [18.9894, 73.1175],
  "kharghar": [19.0456, 73.0696],
  "vashi": [19.0771, 73.0073],
  "nerul": [19.0378, 73.0163],
  "belapur": [19.0221, 73.0390],
  "airoli": [19.1589, 72.9987],
  "ghansoli": [19.1200, 73.0100],
  "koparkhairane": [19.1050, 73.0050],
  "sanpada": [19.0650, 72.9950],
  "seawoods": [19.0200, 73.0250],
  "cbd belapur": [19.0221, 73.0390],
  "kamothe": [19.0000, 73.0933],
  "ulwe": [18.9750, 73.0500],
  "dronagiri": [18.9333, 72.9500],
  "taloja": [19.0333, 73.1167],
  "roadpali": [19.0100, 73.0950],
  "kalamboli": [19.0167, 73.0917],

  // Mumbai
  "mumbai": [19.0760, 72.8777],
  "lower parel": [18.9950, 72.8300],
  "bandra": [19.0596, 72.8295],
  "andheri": [19.1136, 72.8697],
  "borivali": [19.2288, 72.8562],
  "dadar": [19.0176, 72.8562],
  "kurla": [19.0726, 72.8845],
  "ghatkopar": [19.0858, 72.9081],
  "vikhroli": [19.1062, 72.9239],
  "mulund": [19.1750, 72.9600],
  "powai": [19.1197, 72.9051],
  "kandivali": [19.2045, 72.8397],
  "malad": [19.1872, 72.8481],
  "goregaon": [19.1665, 72.8492],
  "jogeshwari": [19.1386, 72.8496],
  "santacruz": [19.0822, 72.8379],
  "vile parle": [19.0991, 72.8467],
  "chembur": [19.0620, 72.8990],
  "wadala": [18.9984, 72.8622],
  "sion": [19.0389, 72.8617],
  "dharavi": [19.0397, 72.8537],
  "matunga": [19.0253, 72.8646],
  "worli": [19.0096, 72.8176],
  "prabhadevi": [19.0104, 72.8262],
  "mahim": [19.0417, 72.8402],
  "khar": [19.0747, 72.8337],
  "juhu": [19.1075, 72.8263],
  "versova": [19.1333, 72.8100],
  "dahisar": [19.2523, 72.8586],

  // Mira-Bhayandar
  "mira road": [19.2862, 72.8710],
  "bhayandar": [19.3000, 72.8550],
  "navghar": [19.3167, 72.8633],

  // Vasai-Virar
  "virar": [19.4663, 72.8113],
  "vasai": [19.3619, 72.8330],
  "nalasopara": [19.4167, 72.8167],
  "boisar": [19.8000, 72.7667],
  "palghar": [19.6967, 72.7645],

  // Pune / Nashik (for wider reach)
  "pune": [18.5204, 73.8567],
  "nashik": [19.9975, 73.7898],
  "lonavala": [18.7481, 73.4072],
  "karjat": [18.9167, 73.3167],

  // Generic fallback for unknown addresses → Mumbai centre
  "maharashtra": [19.0760, 72.8777],
  "india": [20.5937, 78.9629],
};

const POPULAR_LOCATIONS = ["Kalyan", "Dombivali", "Thane", "Navi Mumbai", "Panvel", "Mumbai"];

// ─── BUDGET PARSER ────────────────────────────────────────────────────────────
function parseBudgetLakhs(raw: string): number | null {
  if (!raw || raw === "Pending" || raw === "N/A") return null;
  const s = raw.toLowerCase().replace(/[₹,\s]/g, "");
  const num = parseFloat(s.match(/[\d.]+/)?.[0] ?? "");
  if (isNaN(num)) return null;
  if (s.includes("cr")) return num * 100;
  if (s.includes("l") || s.includes("lac") || s.includes("lakh")) return num;
  if (num >= 100) return num;
  return num;
}

// ─── CONFIG NORMALISER ────────────────────────────────────────────────────────
function normaliseConfig(lead: any): string {
  const raw = (lead.propType || lead.configuration || "").toLowerCase().trim();
  if (!raw || raw === "pending" || raw === "n/a") return "Not Specified";
  if (raw.includes("1bhk") || raw.includes("1 bhk")) return "1 BHK";
  if (raw.includes("2bhk") || raw.includes("2 bhk")) return "2 BHK";
  if (raw.includes("3bhk") || raw.includes("3 bhk")) return "3 BHK";
  if (raw.includes("4bhk") || raw.includes("4 bhk") || raw.includes("5bhk") || raw.includes("5 bhk")) return "4 BHK+";
  if (raw.includes("studio") || raw.includes("1rk") || raw.includes("1 rk")) return "Studio/1RK";
  return "Other";
}

// ─── STATIC GEOCODER ─────────────────────────────────────────────────────────
function geocodeStatic(address: string): { coords: [number, number], region: string } | null {
  if (!address || address === "Pending") return null;
  const lower = address.toLowerCase();
  const sorted = Object.entries(MMR_GEOCODES).sort((a, b) => b[0].length - a[0].length);
  for (const [key, coords] of sorted) {
    if (lower.includes(key)) return { coords, region: key };
  }
  return null;
}

// ─── NOMINATIM FALLBACK ───────────────────────────────────────────────────────
async function geocodeNominatim(address: string): Promise<[number, number] | null> {
  if (!address || address === "Pending") return null;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address + ", Maharashtra, India")}&limit=1`;
    const res = await fetch(url, { headers: { "Accept-Language": "en" } });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.length > 0) {
      return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
    }
  } catch { }
  return null;
}

// ─── TYPES ────────────────────────────────────────────────────────────────────
export interface MappedLead {
  id: string | number;
  name: string;
  originLat: number | null;
  originLng: number | null;
  originRegion: string | null;
  destLat: number | null;
  destLng: number | null;
  destRegion: string | null;
  config: string;
  budget: string;
  budgetLakhs: number | null;
  assignedTo: string;
  createdAt: string;
  address: string;         // source
  preferredLocation: string; // destination
  status: string;
  interestStatus: string;
}

// ─── LEAFLET MAP (dynamically loaded to avoid SSR issues) ────────────────────
const LeafletMapWrapper = dynamic(
  () => import("./LeafletMap").then(m => ({ default: m.default })),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center bg-black/5 dark:bg-white/5 backdrop-blur-md">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-[3px] border-[#8E8E93] border-t-transparent rounded-full animate-spin" />
          <p className="text-[#8E8E93] text-[13px] font-medium tracking-tight">Loading maps engine...</p>
        </div>
      </div>
    ),
  }
);

// ─── THE VIEW COMPONENT ───────────────────────────────────────────────────────
export default function GeoAnalyticsView({
  allLeads,
  theme,
  isDark,
}: {
  allLeads: any[];
  theme: any;
  isDark: boolean;
}) {
  // ── Filters ──
  const [originFilter, setOriginFilter] = useState("All");
  const [destFilter, setDestFilter] = useState("All");
  const [configFilter, setConfigFilter] = useState("All");
  const [budgetFilter, setBudgetFilter] = useState("All");

  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geocodeProgress, setGeocodeProgress] = useState(0);

  // ── Geocoded leads cache ──
  const [mappedLeads, setMappedLeads] = useState<MappedLead[]>([]);
  const geocacheRef = useRef<Map<string, [number, number] | null>>(new Map());
  const hasGeocodedRef = useRef(false);

  // ─── Geocode all leads once ───────────────────────────────────────────────
  useEffect(() => {
    if (hasGeocodedRef.current || allLeads.length === 0) return;
    hasGeocodedRef.current = true;

    const run = async () => {
      setIsGeocoding(true);
      const results: MappedLead[] = [];
      let processed = 0;
      let nominatimQueue: Array<{ lead: any; type: 'origin' | 'dest', addr: string }> = [];

      // Pass 1: Static Geocoding
      for (const lead of allLeads) {
        const addrOrigin = [lead.address, lead.source_other, lead.city, lead.locality].filter(Boolean).join(" ");
        const addrDest = lead.preferredLocation && lead.preferredLocation !== "Pending" ? lead.preferredLocation : "";

        let oLat = null, oLng = null, oRegion = null;
        let dLat = null, dLng = null, dRegion = null;

        if (addrOrigin) {
          const staticO = geocodeStatic(addrOrigin);
          if (staticO) {
            oLat = staticO.coords[0] + (Math.random() - 0.5) * 0.008;
            oLng = staticO.coords[1] + (Math.random() - 0.5) * 0.008;
            oRegion = staticO.region;
          } else if (addrOrigin.length > 3) {
            nominatimQueue.push({ lead, type: 'origin', addr: addrOrigin });
          }
        }

        if (addrDest) {
          const staticD = geocodeStatic(addrDest);
          if (staticD) {
            dLat = staticD.coords[0] + (Math.random() - 0.5) * 0.008;
            dLng = staticD.coords[1] + (Math.random() - 0.5) * 0.008;
            dRegion = staticD.region;
          } else if (addrDest.length > 3) {
            nominatimQueue.push({ lead, type: 'dest', addr: addrDest });
          }
        }

        results.push({
          id: lead.id,
          name: lead.name || "Unknown",
          originLat: oLat,
          originLng: oLng,
          originRegion: oRegion,
          destLat: dLat,
          destLng: dLng,
          destRegion: dRegion,
          config: normaliseConfig(lead),
          budget: lead.salesBudget || lead.budget || "N/A",
          budgetLakhs: parseBudgetLakhs(lead.salesBudget || lead.budget || ""),
          assignedTo: lead.assigned_to || "Unassigned",
          createdAt: lead.created_at || "",
          address: addrOrigin || "N/A",
          preferredLocation: addrDest || "Pending",
          status: lead.status || "Assigned",
          interestStatus: lead.leadInterestStatus || "Pending",
        });

        processed++;
        setGeocodeProgress(Math.round((processed / allLeads.length) * 60));
      }

      // Pass 2: Nominatim (limit to top 20 to avoid rate limit)
      const toNominatim = nominatimQueue.slice(0, 20);
      for (let i = 0; i < toNominatim.length; i++) {
        const { lead, type, addr } = toNominatim[i];
        const key = addr.toLowerCase().trim();

        let coords = geocacheRef.current.get(key);
        if (coords === undefined) {
          const fetchedCoords = await geocodeNominatim(addr);
          geocacheRef.current.set(key, fetchedCoords);
          coords = fetchedCoords;
          await new Promise(r => setTimeout(r, 1100)); // Rate limit 1/sec
        }

        const targetLead = results.find(r => r.id === lead.id);
        if (targetLead && coords) {
          if (type === 'origin') {
            targetLead.originLat = coords[0] + (Math.random() - 0.5) * 0.008;
            targetLead.originLng = coords[1] + (Math.random() - 0.5) * 0.008;
            targetLead.originRegion = "Unknown (Geocoded)";
          } else {
            targetLead.destLat = coords[0] + (Math.random() - 0.5) * 0.008;
            targetLead.destLng = coords[1] + (Math.random() - 0.5) * 0.008;
            targetLead.destRegion = "Unknown (Geocoded)";
          }
        }

        setGeocodeProgress(60 + Math.round(((i + 1) / toNominatim.length) * 40));
      }

      setMappedLeads(results);
      setIsGeocoding(false);
      setGeocodeProgress(100);
    };

    run();
  }, [allLeads]);

  // ─── Apply Filters ────────────────────────────────────────────────────────
  const filteredLeads = useMemo(() => {
    return mappedLeads.filter(lead => {
      // Must have at least one coordinate to be on the map
      if (!lead.originLat && !lead.destLat) return false;

      // Origin Filter
      if (originFilter !== "All") {
        if (!lead.originRegion || !lead.originRegion.toLowerCase().includes(originFilter.toLowerCase())) return false;
      }

      // Dest Filter
      if (destFilter !== "All") {
        if (!lead.destRegion || !lead.destRegion.toLowerCase().includes(destFilter.toLowerCase())) return false;
      }

      // Config filter
      if (configFilter !== "All" && lead.config !== configFilter) return false;

      // Budget filter
      if (budgetFilter !== "All") {
        const b = lead.budgetLakhs;
        if (budgetFilter === "Below 25L" && (b === null || b >= 25)) return false;
        if (budgetFilter === "25L–50L" && (b === null || b < 25 || b >= 50)) return false;
        if (budgetFilter === "50L–1Cr" && (b === null || b < 50 || b >= 100)) return false;
        if (budgetFilter === "1Cr+" && (b === null || b < 100)) return false;
      }

      return true;
    });
  }, [mappedLeads, configFilter, budgetFilter, originFilter, destFilter]);

  // ─── Summary Analytics ────────────────────────────────────────────────────
  const analytics = useMemo(() => {
    if (filteredLeads.length === 0) {
      return { total: 0, topOrigin: "N/A", topDest: "N/A", topFlow: "N/A", topConfig: "N/A", avgBudget: null };
    }

    const countFreq = (arr: (string | null)[]) => {
      const counts: Record<string, number> = {};
      arr.forEach(x => { if (x) counts[x] = (counts[x] || 0) + 1; });
      return Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || [null, 0];
    };

    const toCapital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

    const [topO] = countFreq(filteredLeads.map(l => l.originRegion).filter(x => x && x !== "Unknown (Geocoded)"));
    const [topD] = countFreq(filteredLeads.map(l => l.destRegion).filter(x => x && x !== "Unknown (Geocoded)"));
    const [topC] = countFreq(filteredLeads.map(l => l.config));

    // Migration flows
    const flows = filteredLeads
      .filter(l => l.originRegion && l.destRegion && l.originRegion !== "Unknown (Geocoded)" && l.destRegion !== "Unknown (Geocoded)")
      .map(l => `${toCapital(l.originRegion!)} → ${toCapital(l.destRegion!)}`);
    const [topFlowRaw, flowCount] = countFreq(flows);

    const budgets = filteredLeads.map(l => l.budgetLakhs).filter((b): b is number => b !== null);
    const avgBudget = budgets.length > 0 ? Math.round(budgets.reduce((s, v) => s + v, 0) / budgets.length) : null;

    return {
      total: filteredLeads.length,
      topOrigin: topO ? toCapital(topO) : "N/A",
      topDest: topD ? toCapital(topD) : "N/A",
      topFlow: topFlowRaw ? `${topFlowRaw} (${flowCount})` : "N/A",
      topConfig: topC || "N/A",
      avgBudget
    };
  }, [filteredLeads]);

  const fmtBudget = (n: number | null) =>
    n === null ? "N/A" : n >= 100 ? `₹${(n / 100).toFixed(1)} Cr` : `₹${n}L`;

  const configOptions = ["All", "1 BHK", "2 BHK", "3 BHK", "4 BHK+", "Studio/1RK", "Not Specified", "Other"];
  const budgetOptions = ["All", "Below 25L", "25L–50L", "50L–1Cr", "1Cr+"];
  const originOptions = ["All", ...POPULAR_LOCATIONS];
  const destOptions = ["All", ...POPULAR_LOCATIONS];

  const summaryCards = [
    { label: "Top Origin", value: analytics.topOrigin, icon: <FaHome />, color: isDark ? "text-[#0A84FF]" : "text-[#007AFF]", bg: isDark ? "bg-[#0A84FF]/15" : "bg-[#E5F1FF]" },
    { label: "Top Demand", value: analytics.topDest, icon: <FaBuilding />, color: isDark ? "text-[#BF5AF2]" : "text-[#AF52DE]", bg: isDark ? "bg-[#BF5AF2]/15" : "bg-[#F7EBFC]" },
    { label: "Top Migration Flow", value: analytics.topFlow, icon: <FaLocationArrow />, color: isDark ? "text-[#FF9F0A]" : "text-[#FF9500]", bg: isDark ? "bg-[#FF9F0A]/15" : "bg-[#FFF4E5]" },
    { label: "Average Budget", value: fmtBudget(analytics.avgBudget), icon: <FaRupeeSign />, color: isDark ? "text-[#32D74B]" : "text-[#34C759]", bg: isDark ? "bg-[#32D74B]/15" : "bg-[#EBF9EE]" },
  ];

  return (
    <div className={`flex flex-col h-full overflow-y-auto font-sans antialiased transition-colors duration-300 ${isDark ? "bg-[#000000]" : "bg-[#F2F2F7]"}`}>

      {/* ── Apple-Style Header Area ── */}
      <div className={`flex-shrink-0 pt-6 pb-4 px-6 sm:px-10 border-b ${isDark ? "border-white/10 bg-[#1C1C1E]/80 backdrop-blur-xl" : "border-[#E5E5EA] bg-white/80 backdrop-blur-xl"} sticky top-0 z-20`}>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <h1 className={`text-xl sm:text-2xl font-bold tracking-tight ${isDark ? "text-white" : "text-black"}`}>
              Geo Analytics
            </h1>
            <p className={`text-[13px] font-medium tracking-tight ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
              Lead Movement & Demand Map
            </p>
          </div>

          <div className="flex items-center gap-4">
            {isGeocoding ? (
              <div className="flex items-center gap-3">
                <FaSpinner className={`animate-spin ${isDark ? "text-[#0A84FF]" : "text-[#007AFF]"}`} />
                <div className={`w-[120px] h-1.5 rounded-full overflow-hidden ${isDark ? "bg-[#38383A]" : "bg-[#E5E5EA]"}`}>
                  <div className={`h-full rounded-full transition-all duration-300 ${isDark ? "bg-[#0A84FF]" : "bg-[#007AFF]"}`} style={{ width: `${geocodeProgress}%` }} />
                </div>
                <span className={`text-[12px] font-semibold tracking-tight ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
                  {geocodeProgress}%
                </span>
              </div>
            ) : mappedLeads.length > 0 && (
              <div className={`px-3 py-1.5 rounded-full border text-[12px] font-semibold tracking-wide flex items-center gap-2 ${isDark ? "bg-[#1C1C1E] border-white/10 text-[#EBEBF5]" : "bg-white border-black/5 text-[#333333] shadow-sm"
                }`}>
                <FaMapMarkerAlt className={isDark ? "text-[#32D74B]" : "text-[#34C759]"} />
                {filteredLeads.length} leads mapped
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 sm:px-10 py-6 custom-scrollbar">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: [0.25, 0.1, 0.25, 1] }}
          className="space-y-6 max-w-[1600px] mx-auto"
        >

          {/* ── Summary Cards (iOS Widget Style) ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
            {summaryCards.map(card => (
              <div key={card.label} className={`rounded-[24px] p-5 flex flex-col justify-between h-[130px] transition-transform hover:scale-[1.02] ${isDark ? "bg-[#1C1C1E] shadow-sm border border-white/5" : "bg-white shadow-[0_4px_24px_rgba(0,0,0,0.04)] border border-black/5"}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-[10px] flex items-center justify-center ${card.bg}`}>
                    <span className={`text-[16px] ${card.color}`}>{card.icon}</span>
                  </div>
                  <p className={`text-[11px] uppercase font-bold tracking-wider ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
                    {card.label}
                  </p>
                </div>
                <p className={`text-2xl sm:text-[26px] font-bold tracking-tight truncate mt-auto ${isDark ? "text-white" : "text-black"}`}>
                  {card.value}
                </p>
              </div>
            ))}
          </div>

          {/* ── Filters (Apple-Style Segmented Pills) ── */}
          <div className={`rounded-[24px] p-6 space-y-5 ${isDark ? "bg-[#1C1C1E] shadow-sm border border-white/5" : "bg-white shadow-[0_4px_24px_rgba(0,0,0,0.04)] border border-black/5"}`}>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
              <span className={`text-[13px] font-semibold tracking-tight w-24 shrink-0 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Lives In</span>
              <div className="flex flex-wrap gap-2">
                {originOptions.map(opt => (
                  <button
                    key={`org-${opt}`}
                    onClick={() => setOriginFilter(opt)}
                    className={`px-3.5 py-1.5 rounded-full text-[12px] font-semibold tracking-wide transition-colors ${originFilter === opt
                      ? (isDark ? "bg-[#0A84FF] text-white" : "bg-[#007AFF] text-white")
                      : (isDark ? "bg-[#2C2C2E] text-[#8E8E93] hover:bg-[#3A3A3C] hover:text-white" : "bg-[#F2F2F7] text-[#8E8E93] hover:bg-[#E5E5EA] hover:text-black")
                      }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>

            <div className={`h-[1px] w-full ${isDark ? "bg-[#38383A]" : "bg-[#E5E5EA]"}`} />

            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
              <span className={`text-[13px] font-semibold tracking-tight w-24 shrink-0 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Wants to Buy</span>
              <div className="flex flex-wrap gap-2">
                {destOptions.map(opt => (
                  <button
                    key={`dst-${opt}`}
                    onClick={() => setDestFilter(opt)}
                    className={`px-3.5 py-1.5 rounded-full text-[12px] font-semibold tracking-wide transition-colors ${destFilter === opt
                      ? (isDark ? "bg-[#BF5AF2] text-white" : "bg-[#AF52DE] text-white")
                      : (isDark ? "bg-[#2C2C2E] text-[#8E8E93] hover:bg-[#3A3A3C] hover:text-white" : "bg-[#F2F2F7] text-[#8E8E93] hover:bg-[#E5E5EA] hover:text-black")
                      }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>

            <div className={`h-[1px] w-full ${isDark ? "bg-[#38383A]" : "bg-[#E5E5EA]"}`} />

            <div className="flex flex-col xl:flex-row gap-5 xl:gap-8">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 flex-1">
                <span className={`text-[13px] font-semibold tracking-tight w-24 shrink-0 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Config</span>
                <div className="flex flex-wrap gap-2">
                  {configOptions.map(opt => (
                    <button
                      key={`cfg-${opt}`}
                      onClick={() => setConfigFilter(opt)}
                      className={`px-3.5 py-1.5 rounded-full text-[12px] font-semibold tracking-wide transition-colors ${configFilter === opt
                        ? (isDark ? "bg-[#32D74B] text-white" : "bg-[#34C759] text-white")
                        : (isDark ? "bg-[#2C2C2E] text-[#8E8E93] hover:bg-[#3A3A3C] hover:text-white" : "bg-[#F2F2F7] text-[#8E8E93] hover:bg-[#E5E5EA] hover:text-black")
                        }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 flex-1">
                <span className={`text-[13px] font-semibold tracking-tight w-24 xl:w-auto shrink-0 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Budget</span>
                <div className="flex flex-wrap gap-2">
                  {budgetOptions.map(opt => (
                    <button
                      key={`bdg-${opt}`}
                      onClick={() => setBudgetFilter(opt)}
                      className={`px-3.5 py-1.5 rounded-full text-[12px] font-semibold tracking-wide transition-colors ${budgetFilter === opt
                        ? (isDark ? "bg-[#FF9F0A] text-white" : "bg-[#FF9500] text-white")
                        : (isDark ? "bg-[#2C2C2E] text-[#8E8E93] hover:bg-[#3A3A3C] hover:text-white" : "bg-[#F2F2F7] text-[#8E8E93] hover:bg-[#E5E5EA] hover:text-black")
                        }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ── Map Container ── */}
          <div
            className={`w-full rounded-[24px] overflow-hidden relative z-0 shadow-sm border ${isDark ? "border-white/10" : "border-black/5"}`}
            style={{ height: "calc(100vh - 380px)", minHeight: "500px" }}
          >
            {filteredLeads.length === 0 && !isGeocoding && (
              <div className={`absolute inset-0 flex flex-col items-center justify-center z-10 backdrop-blur-md ${isDark ? "bg-[#1C1C1E]/80" : "bg-white/80"}`}>
                <span className="text-4xl mb-4 opacity-50">🗺️</span>
                <p className={`font-semibold text-[15px] tracking-tight ${isDark ? "text-white" : "text-black"}`}>No leads match your filters</p>
                <p className={`text-[13px] mt-1 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
                  {mappedLeads.length === 0
                    ? "Leads need valid address data to appear on the map."
                    : "Try adjusting the configuration or location filters above."}
                </p>
              </div>
            )}
            <LeafletMapWrapper
              leads={filteredLeads}
              isDark={isDark}
              isGeocoding={isGeocoding}
            />
          </div>

        </motion.div>
      </div>
    </div>
  );
}