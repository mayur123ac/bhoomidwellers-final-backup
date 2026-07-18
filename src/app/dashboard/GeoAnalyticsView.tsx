"use client";

// ============================================================================
// GEO ANALYTICS VIEW — Admin Panel Only
// Lead Movement & Route Mapping Upgrade
// ============================================================================

import { useState, useEffect, useRef, useMemo } from "react";
import dynamic from "next/dynamic";

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
      <div className="w-full h-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-[#9E217B] border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-xs">Loading map...</p>
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
    { label: "Top Origin Region", value: analytics.topOrigin, icon: "🏠", color: "text-blue-400" },
    { label: "Top Demand Region", value: analytics.topDest, icon: "🏢", color: "text-[#d946a8]" },
    { label: "Top Migration Flow", value: analytics.topFlow, icon: "↗️", color: "text-orange-400" },
    { label: "Average Budget", value: fmtBudget(analytics.avgBudget), icon: "💰", color: "text-green-400" },
  ];

  return (
    <div className={`flex flex-col h-full overflow-y-auto`}>
      {/* Header strip */}
      <div className={`flex-shrink-0 px-6 py-4 border-b ${theme.tableBorder}`}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-lg">🗺️</span>
          <div>
            <h2 className={`font-bold text-base ${theme.text}`}>Lead Movement & Demand Map</h2>
            <p className={`text-xs ${theme.textFaint}`}>Real-time geographic tracking of lead origin vs. purchase demand</p>
          </div>
          {isGeocoding && (
            <div className="flex items-center gap-2 ml-auto">
              <div className="w-32 h-1.5 rounded-full bg-gray-700 overflow-hidden">
                <div className="h-full bg-[#9E217B] transition-all duration-300 rounded-full" style={{ width: `${geocodeProgress}%` }} />
              </div>
              <span className={`text-xs ${theme.textFaint}`}>Locating leads... {geocodeProgress}%</span>
            </div>
          )}
          {!isGeocoding && mappedLeads.length > 0 && (
            <span className={`ml-auto text-xs px-2 py-1 rounded-full border ${theme.settingsBg} ${theme.textMuted}`}>
              {filteredLeads.length} leads mapped
            </span>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="flex-shrink-0 grid grid-cols-2 lg:grid-cols-4 gap-3 px-6 py-4">
        {summaryCards.map(card => (
          <div key={card.label} className={`rounded-xl border p-4 ${theme.card}`} style={theme.cardGlass}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-base">{card.icon}</span>
              <p className={`text-[10px] uppercase font-bold tracking-wider ${theme.textFaint}`}>{card.label}</p>
            </div>
            <p className={`text-lg font-black truncate ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className={`flex-shrink-0 px-6 pb-3 flex flex-col gap-3`}>
        <div className="flex flex-wrap gap-6">
          {/* Origin filter */}
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold ${theme.textMuted}`}>Lives In:</span>
            <div className="flex flex-wrap gap-1">
              {originOptions.map(opt => (
                <button
                  key={opt}
                  onClick={() => setOriginFilter(opt)}
                  className={`text-[10px] font-bold px-2.5 py-1 rounded-full border transition-all cursor-pointer ${originFilter === opt
                      ? isDark ? "bg-blue-600/20 border-blue-500/60 text-blue-400" : "bg-blue-100 border-blue-400 text-blue-700"
                      : `${theme.settingsBg} ${theme.textMuted}`
                    }`}
                >{opt}</button>
              ))}
            </div>
          </div>

          {/* Dest filter */}
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold ${theme.textMuted}`}>Wants To Buy In:</span>
            <div className="flex flex-wrap gap-1">
              {destOptions.map(opt => (
                <button
                  key={opt}
                  onClick={() => setDestFilter(opt)}
                  className={`text-[10px] font-bold px-2.5 py-1 rounded-full border transition-all cursor-pointer ${destFilter === opt
                      ? isDark ? "bg-[#9E217B]/20 border-[#9E217B]/60 text-[#d946a8]" : "bg-[#9E217B]/15 border-[#9E217B] text-[#9E217B]"
                      : `${theme.settingsBg} ${theme.textMuted}`
                    }`}
                >{opt}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-6">
          {/* Config filter */}
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold ${theme.textMuted}`}>Config:</span>
            <div className="flex flex-wrap gap-1">
              {configOptions.map(opt => (
                <button
                  key={opt}
                  onClick={() => setConfigFilter(opt)}
                  className={`text-[10px] font-bold px-2.5 py-1 rounded-full border transition-all cursor-pointer ${configFilter === opt
                      ? isDark ? "bg-green-600/20 border-green-500/60 text-green-400" : "bg-green-100 border-green-400 text-green-700"
                      : `${theme.settingsBg} ${theme.textMuted}`
                    }`}
                >{opt}</button>
              ))}
            </div>
          </div>
          {/* Budget filter */}
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold ${theme.textMuted}`}>Budget:</span>
            <div className="flex flex-wrap gap-1">
              {budgetOptions.map(opt => (
                <button
                  key={opt}
                  onClick={() => setBudgetFilter(opt)}
                  className={`text-[10px] font-bold px-2.5 py-1 rounded-full border transition-all cursor-pointer ${budgetFilter === opt
                      ? isDark ? "bg-orange-600/20 border-orange-500/60 text-orange-400" : "bg-orange-100 border-orange-400 text-orange-700"
                      : `${theme.settingsBg} ${theme.textMuted}`
                    }`}
                >{opt}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Map Area */}
      <div className="flex-1 px-6 pb-6">
        <div
          className={`w-full rounded-2xl border overflow-hidden relative z-0 ${theme.tableWrap}`}
          style={{ ...theme.tableGlass, height: "calc(100vh - 220px)", minHeight: "75vh" }}
        >
          {filteredLeads.length === 0 && !isGeocoding && (
            <div className={`absolute inset-0 flex flex-col items-center justify-center z-10 ${isDark ? "bg-[#121212]" : "bg-[#F8FAFC]"}`}>
              <span className="text-4xl mb-3">🗺️</span>
              <p className={`font-bold text-sm ${theme.text}`}>No leads match your filters</p>
              <p className={`text-xs mt-1 ${theme.textFaint}`}>
                {mappedLeads.length === 0
                  ? "Leads need address data to appear on the map"
                  : "Try adjusting the filters above"}
              </p>
            </div>
          )}
          <LeafletMapWrapper
            leads={filteredLeads}
            isDark={isDark}
            isGeocoding={isGeocoding}
          />
        </div>
      </div>
    </div>
  );
}
