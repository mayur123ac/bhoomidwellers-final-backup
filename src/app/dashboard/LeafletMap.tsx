"use client";

// ============================================================================
// LEAFLET MAP COMPONENT — dynamically loaded (no SSR)
// Origin vs Destination + OSRM Routing + Heatmap
// ============================================================================

import { useEffect, useRef, useState } from "react";

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
  address: string;
  preferredLocation: string;
  status: string;
  interestStatus: string;
}

interface Props {
  leads: MappedLead[];
  isDark: boolean;
  isGeocoding: boolean;
}

// Config colour mapping for pin icons
const CONFIG_COLORS: Record<string, string> = {
  "1 BHK": "#00AEEF",
  "2 BHK": "#9E217B",
  "3 BHK": "#f97316",
  "4 BHK+": "#4ade80",
  "Studio/1RK": "#fbbf24",
  "Not Specified": "#6b7280",
  "Other": "#a78bfa",
};

// Custom Pins
function createOriginIcon(L: any, color: string) {
  return L.divIcon({
    className: "",
    html: `<div style="
      width:14px;height:14px;border-radius:50% 50% 50% 0;
      background:#2563eb;border:2px solid rgba(255,255,255,0.8);
      transform:rotate(-45deg);box-shadow:0 2px 8px rgba(0,0,0,0.35);
      position:relative;
    "><div style="position:absolute;top:3px;left:3px;width:4px;height:4px;background:#fff;border-radius:50%;transform:rotate(45deg);"></div></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 14],
    popupAnchor: [0, -14],
  });
}

function createDestIcon(L: any, color: string) {
  return L.divIcon({
    className: "",
    html: `<div style="
      width:18px;height:18px;border-radius:50% 50% 50% 0;
      background:${color};border:2px solid rgba(255,255,255,0.9);
      transform:rotate(-45deg);box-shadow:0 3px 10px rgba(0,0,0,0.4);
      position:relative;
    "><div style="position:absolute;top:5px;left:5px;width:4px;height:4px;background:#fff;border-radius:50%;transform:rotate(45deg);"></div></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 18],
    popupAnchor: [0, -18],
  });
}

function formatDate(ds: string) {
  if (!ds) return "N/A";
  try { return new Date(ds).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return ds; }
}

export default function LeafletMapComponent({ leads, isDark, isGeocoding }: Props) {
  const mapRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const heatLayerRef = useRef<any>(null);
  const clusterGroupRef = useRef<any>(null);
  const tileLayerRef = useRef<any>(null);
  const routeLayerRef = useRef<any>(null);
  const destPinLayerRef = useRef<any>(null);

  const [routeInfo, setRouteInfo] = useState<{ distance: string, time: string, from: string, to: string, name: string } | null>(null);
  const [isZoomedOut, setIsZoomedOut] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(10);

  // ── Initialise map once ────────────────────────────────────────────────────
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    // AFTER
    const initMap = async () => {
      if (!containerRef.current) return;

      // Prevent double-init if container already has a Leaflet instance
      if ((containerRef.current as any)._leaflet_id) return;

      const addCss = (href: string) => {
        if (!document.querySelector(`link[href="${href}"]`)) {
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.href = href;
          document.head.appendChild(link);
        }
      };
      addCss("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css");
      addCss("https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css");
      addCss("https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css");

      const L = (await import("leaflet")).default;
      const mc = await import("leaflet.markercluster");
      const MarkerClusterGroup = (mc as any).MarkerClusterGroup ?? (mc as any).default?.MarkerClusterGroup ?? (L as any).MarkerClusterGroup;

      if (!(L as any).HeatLayer) {
        await new Promise<void>((resolve) => {
          const existing = document.getElementById("leaflet-heat-script");
          if (existing) { resolve(); return; }
          const script = document.createElement("script");
          script.id = "leaflet-heat-script";
          script.src = "https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js";
          script.onload = () => resolve();
          script.onerror = () => resolve();
          document.head.appendChild(script);
        });
      }

      const map = L.map(containerRef.current!, {
        center: [19.2, 73.0],
        zoom: 10,
        zoomControl: true,
        attributionControl: true,
      });

      const tileUrl = isDark
        ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";

      const tile = L.tileLayer(tileUrl, {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        subdomains: "abcd",
        maxZoom: 19,
      });
      tile.addTo(map);
      tileLayerRef.current = tile;

      if (MarkerClusterGroup) {
        const clusterGroup = new MarkerClusterGroup({
          chunkedLoading: true,
          maxClusterRadius: 50,
          showCoverageOnHover: false,
          iconCreateFunction: (cluster: any) => {
            const count = cluster.getChildCount();
            let size = 32;
            let bg = "linear-gradient(135deg, #22c55e, #16a34a)";
            let shadow = "rgba(34,197,94,0.4)";

            if (count >= 10 && count < 50) {
              size = 38;
              bg = "linear-gradient(135deg, #f97316, #ea580c)";
              shadow = "rgba(249,115,22,0.4)";
            } else if (count >= 50) {
              size = 46;
              bg = "linear-gradient(135deg, #ef4444, #dc2626)";
              shadow = "rgba(239,68,68,0.5)";
            }

            return L.divIcon({
              html: `<div class="smart-cluster-bubble" style="
                width:${size}px;height:${size}px;border-radius:50%;
                background:${bg};
                border:2px solid rgba(255,255,255,0.9);
                display:flex;align-items:center;justify-content:center;
                font-weight:900;font-size:${count < 10 ? 12 : 11}px;color:#fff;
                box-shadow: 0 0 16px ${shadow}, 0 4px 8px rgba(0,0,0,0.3);
                transition: transform 0.2s ease;
              ">${count}</div>`,
              className: "",
              iconSize: [size, size],
            });
          },
        });
        map.addLayer(clusterGroup);
        clusterGroupRef.current = clusterGroup;
      }

      // Clear route when clicking map
      map.on('click', () => {
        if (routeLayerRef.current) {
          map.removeLayer(routeLayerRef.current);
          routeLayerRef.current = null;
        }
        if (destPinLayerRef.current) {
          map.removeLayer(destPinLayerRef.current);
          destPinLayerRef.current = null;
        }
        setRouteInfo(null);
      });

      // Region Labels
      const REGIONS = [
        { name: "Kalyan", lat: 19.2437, lng: 73.1355 },
        { name: "Dombivli", lat: 19.2184, lng: 73.0867 },
        { name: "Thane", lat: 19.1970, lng: 72.9635 },
        { name: "Navi Mumbai", lat: 19.0330, lng: 73.0297 },
        { name: "Panvel", lat: 18.9930, lng: 73.1154 },
        { name: "Mumbai", lat: 19.0760, lng: 72.8777 },
      ];
      REGIONS.forEach(reg => {
        const lbl = L.divIcon({
          className: "region-label",
          html: `<div style="color: ${isDark ? '#e5e7eb' : '#4b5563'}; font-weight: 800; font-size: 13px; text-shadow: 0 2px 6px ${isDark ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.8)'}; letter-spacing: 1px; white-space: nowrap;">📍 ${reg.name}</div>`,
          iconSize: [120, 24]
        });
        L.marker([reg.lat, reg.lng], { icon: lbl, interactive: false }).addTo(map);
      });

      // Handle zoom level for cluster visibility
      map.on('zoomend', () => {
        setIsZoomedOut(map.getZoom() < 11);
        setZoomLevel(map.getZoom());
      });
      setIsZoomedOut(map.getZoom() < 11);
      setZoomLevel(map.getZoom());

      const updateZoomVisibility = () => {
        if (!containerRef.current) return;
        if (map.getZoom() < 11) {
          containerRef.current.classList.add('hide-cluster-markers');
        } else {
          containerRef.current.classList.remove('hide-cluster-markers');
        }
      };

      map.on('zoomend', updateZoomVisibility);
      updateZoomVisibility();

      mapRef.current = map;
      (window as any).__leafletInstance = L;
    };

    initMap();

    // AFTER
    return () => {
      if (mapRef.current) {
        try {
          mapRef.current.remove();
        } catch (e) {
          // already removed
        }
        mapRef.current = null;
        clusterGroupRef.current = null;
        heatLayerRef.current = null;
        tileLayerRef.current = null;
        routeLayerRef.current = null;
        destPinLayerRef.current = null;
        // Clear the leaflet ID so it can re-init cleanly
        if (containerRef.current) {
          delete (containerRef.current as any)._leaflet_id;
        }
      }
    };

  }, []); // Only once

  // ── Update tile layer when dark mode changes ──────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !tileLayerRef.current) return;
    const map = mapRef.current;
    const L = (window as any).__leafletInstance;
    if (!L) return;
    map.removeLayer(tileLayerRef.current);
    const tileUrl = isDark
      ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
    const newTile = L.tileLayer(tileUrl, {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      subdomains: "abcd",
      maxZoom: 19,
    });
    newTile.addTo(map);
    tileLayerRef.current = newTile;
  }, [isDark]);

  // ── Fetch & Draw OSRM Route ─────────────────────────────────────────────
  const drawRoute = async (lead: MappedLead) => {
    const L = (window as any).__leafletInstance;
    const map = mapRef.current;
    if (!L || !map || !lead.originLat || !lead.originLng || !lead.destLat || !lead.destLng) return;

    if (routeLayerRef.current) map.removeLayer(routeLayerRef.current);
    if (destPinLayerRef.current) map.removeLayer(destPinLayerRef.current);

    try {
      setRouteInfo({ distance: "Loading...", time: "...", from: lead.address, to: lead.preferredLocation, name: lead.name });

      const url = `https://router.project-osrm.org/route/v1/driving/${lead.originLng},${lead.originLat};${lead.destLng},${lead.destLat}?overview=full&geometries=geojson`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const distKm = (route.distance / 1000).toFixed(1);
        const mins = Math.round(route.duration / 60);

        const geojson = L.geoJSON(route.geometry, {
          style: {
            color: '#06b6d4',
            weight: 5,
            opacity: 0.9,
            dashArray: '12, 12',
            className: 'route-animated-glow'
          }
        }).addTo(map);
        routeLayerRef.current = geojson;

        const color = CONFIG_COLORS[lead.config] ?? "#6b7280";
        const markerD = L.marker([lead.destLat, lead.destLng], { icon: createDestIcon(L, color) });
        markerD.bindPopup(`
          <div style="font-family:system-ui,sans-serif;min-width:200px;max-width:240px;">
            <div style="font-weight:800;font-size:13px;margin-bottom:6px;color:#1a1a1a;">Property Demand</div>
            <div style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:#444;">
              <div style="background:#fdf2f8;padding:4px 6px;border-radius:4px;margin-bottom:4px;display:flex;gap:4px;">
                <span style="color:#db2777">🏢 In:</span>
                <strong style="color:#831843">${lead.preferredLocation}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;">
                <span style="color:#666;">Lead</span>
                <strong>${lead.name}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;">
                <span style="color:#666;">Config</span>
                <strong style="color:${color}">${lead.config}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;">
                <span style="color:#666;">Budget</span>
                <strong>${lead.budget}</strong>
              </div>
            </div>
          </div>
        `);
        markerD.addTo(map);
        destPinLayerRef.current = markerD;

        map.fitBounds(geojson.getBounds(), { padding: [50, 50], maxZoom: 14 });

        setRouteInfo({
          distance: `${distKm} km`,
          time: `~${mins} mins`,
          from: lead.address,
          to: lead.preferredLocation,
          name: lead.name
        });
      }
    } catch (e) {
      setRouteInfo(null);
    }
  };

  // ── Update markers and heatmap when leads change ──────────────────────────
  useEffect(() => {
    const run = async () => {
      if (!mapRef.current) return;
      const L = (await import("leaflet")).default;
      const map = mapRef.current;
      const clusterGroup = clusterGroupRef.current;

      // Clear existing
      if (clusterGroup) clusterGroup.clearLayers();
      if (heatLayerRef.current) {
        map.removeLayer(heatLayerRef.current);
        heatLayerRef.current = null;
      }
      if (routeLayerRef.current) map.removeLayer(routeLayerRef.current);
      if (destPinLayerRef.current) map.removeLayer(destPinLayerRef.current);
      routeLayerRef.current = null;
      destPinLayerRef.current = null;
      setRouteInfo(null);

      if (leads.length === 0) return;

      // Heatmap (Origin demand side)
      const heatData = leads.filter(l => l.originLat && l.originLng).map(l => [l.originLat, l.originLng, 0.8]);
      if ((L as any).heatLayer && heatData.length > 0) {
        const heat = (L as any).heatLayer(heatData, {
          radius: 35,
          blur: 28,
          maxZoom: 14,
          minOpacity: 0.35,
          gradient: { 0.2: "#22c55e", 0.4: "#eab308", 0.6: "#f97316", 0.8: "#ef4444", 1.0: "#b91c1c" },
        });
        heat.addTo(map);
        heatLayerRef.current = heat;
      }

      // Marker pins
      if (clusterGroup) {
        const bounds: [number, number][] = [];

        leads.forEach(lead => {
          const color = CONFIG_COLORS[lead.config] ?? "#6b7280";
          const interestColor = lead.interestStatus === "Interested" ? "#4ade80" : lead.interestStatus === "Not Interested" ? "#f87171" : "#9ca3af";

          // 1. Origin Pin
          if (lead.originLat && lead.originLng) {
            bounds.push([lead.originLat, lead.originLng]);
            const markerO = L.marker([lead.originLat, lead.originLng], { icon: createOriginIcon(L, color) });

            const canRoute = lead.destLat && lead.destLng;
            const popupContent = `
              <div style="font-family:system-ui,sans-serif;min-width:200px;max-width:240px;">
                <div style="font-weight:800;font-size:13px;margin-bottom:6px;color:#1a1a1a;">${lead.name}</div>
                <div style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:#444;">
                  <div style="background:#f3f4f6;padding:4px 6px;border-radius:4px;margin-bottom:4px;display:flex;gap:4px;">
                    <span style="color:#2563eb">🏠 From:</span>
                    <strong style="color:#111827">${lead.address || "Unknown"}</strong>
                  </div>
                  <div style="display:flex;justify-content:space-between;">
                    <span style="color:#666;">Wants</span>
                    <strong style="color:${color}">${lead.config}</strong>
                  </div>
                  <div style="display:flex;justify-content:space-between;">
                    <span style="color:#666;">Budget</span>
                    <strong>${lead.budget}</strong>
                  </div>
                  <div style="display:flex;justify-content:space-between;">
                    <span style="color:#666;">Status</span>
                    <strong style="color:${interestColor}">${lead.interestStatus || "Pending"}</strong>
                  </div>
                  ${canRoute ? `<button onclick="document.dispatchEvent(new CustomEvent('draw-route', {detail: '${lead.id}'}))" style="margin-top:6px;width:100%;padding:6px;background:#9E217B;color:white;border:none;border-radius:6px;font-weight:bold;cursor:pointer;font-size:10px;">Show Route to Property ↗</button>` : ''}
                </div>
              </div>
            `;

            markerO.bindPopup(popupContent);
            clusterGroup.addLayer(markerO);
          }

        });
      }

      // Fit map to data bounds
      if (leads.length > 0) {
        const validBounds = leads.flatMap(l => {
          const pts: [number, number][] = [];
          if (l.originLat && l.originLng) pts.push([l.originLat, l.originLng]);
          if (l.destLat && l.destLng) pts.push([l.destLat, l.destLng]);
          return pts;
        });
        if (validBounds.length > 0) {
          const bounds = L.latLngBounds(validBounds);
          map.fitBounds(bounds.pad(0.15), { maxZoom: 13 });
        }
      }
    };

    run();
  }, [leads]);

  // Handle route draw events from popup buttons
  useEffect(() => {
    const handleDrawRoute = (e: any) => {
      const leadId = e.detail;
      const lead = leads.find(l => String(l.id) === String(leadId));
      if (lead) {
        const map = mapRef.current;
        if (map) map.closePopup();
        drawRoute(lead);
      }
    };
    document.addEventListener('draw-route', handleDrawRoute);
    return () => document.removeEventListener('draw-route', handleDrawRoute);
  }, [leads]);

  const legendEntries = Object.entries(CONFIG_COLORS).filter(([label]) => label !== "Not Specified");

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" style={{ minHeight: "400px" }} />

      {/* Premium Glassmorphism Analytics Overlay */}
      <div
        className="absolute bottom-6 left-6 z-[1000] rounded-2xl border p-4 text-xs"
        style={{
          background: isDark ? "rgba(15,15,20,0.65)" : "rgba(255,255,255,0.7)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
          minWidth: "220px"
        }}
      >
        <div className="flex justify-between items-center mb-3">
          <span className={`text-sm font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>Geo Intelligence</span>
          <span className="text-[10px] bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full font-bold">Zoom: {zoomLevel}</span>
        </div>

        <div className="mb-4">
          <div className="flex justify-between items-center mb-1">
            <span className={isDark ? "text-gray-400" : "text-gray-600"}>Live Mapped Leads</span>
            <span className={`font-bold ${isDark ? 'text-white' : 'text-black'}`}>{leads.length}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className={isDark ? "text-gray-400" : "text-gray-600"}>Density View</span>
            <span className={`font-bold text-xs ${isZoomedOut ? 'text-orange-400' : 'text-green-400'}`}>
              {isZoomedOut ? 'Heatmap' : 'Clustered'}
            </span>
          </div>
        </div>

        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: isDark ? "#9ca3af" : "#6b7280" }}>Heat Intensity</p>
          <div className="w-full h-2 rounded-full mb-1" style={{ background: "linear-gradient(to right, #22c55e, #eab308, #f97316, #ef4444, #b91c1c)" }} />
          <div className="flex justify-between text-[9px] font-bold" style={{ color: isDark ? "#9ca3af" : "#6b7280" }}>
            <span>LOW</span>
            <span>HIGH</span>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div
        className="absolute bottom-4 right-4 z-[1000] rounded-xl border p-3 text-xs"
        style={{
          background: isDark ? "rgba(20,20,20,0.95)" : "rgba(255,255,255,0.96)",
          borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)",
          boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
        }}
      >
        <div className="flex gap-4 mb-4 pb-3 border-b" style={{ borderColor: isDark ? 'rgba(255,255,255,0.1)' : '#e5e7eb' }}>
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 16 }}>🏠</span>
            <span style={{ color: isDark ? "#d1d5db" : "#374151", fontWeight: 600, fontSize: 10 }}>Lead Origin</span>
          </div>
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 16 }}>🏢</span>
            <span style={{ color: isDark ? "#d1d5db" : "#374151", fontWeight: 600, fontSize: 10 }}>Property Demand</span>
          </div>
        </div>

        <p style={{ color: isDark ? "#9ca3af" : "#6b7280", fontWeight: 700, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em", fontSize: 9 }}>Configuration</p>
        <div className="grid grid-cols-2 gap-x-4">
          {legendEntries.map(([label, color]) => (
            <div key={label} className="flex items-center gap-2 mb-1">
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: color, flexShrink: 0 }} />
              <span style={{ color: isDark ? "#d1d5db" : "#374151" }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Route Info Panel */}
      {routeInfo && (
        <div
          className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] rounded-xl border p-4 shadow-2xl flex items-center gap-4 animate-in fade-in slide-in-from-top-4"
          style={{
            background: isDark ? "rgba(20,20,20,0.95)" : "rgba(255,255,255,0.96)",
            borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)",
            backdropFilter: "blur(8px)"
          }}
        >
          <div className="flex flex-col gap-1">
            <p style={{ fontSize: 10, fontWeight: 700, color: isDark ? "#9ca3af" : "#6b7280", textTransform: 'uppercase' }}>{routeInfo.name}'s Route</p>
            <div className="flex items-center gap-3">
              <span style={{ fontWeight: 800, color: isDark ? '#fff' : '#000' }}>{routeInfo.from || 'Unknown'}</span>
              <span style={{ color: '#9E217B' }}>→</span>
              <span style={{ fontWeight: 800, color: isDark ? '#fff' : '#000' }}>{routeInfo.to}</span>
            </div>
          </div>
          <div className="w-px h-8 bg-gray-500/20 mx-2" />
          <div className="flex flex-col gap-0.5">
            <span style={{ fontSize: 10, color: isDark ? "#9ca3af" : "#6b7280" }}>Distance</span>
            <strong style={{ color: isDark ? '#60a5fa' : '#3b82f6' }}>{routeInfo.distance}</strong>
          </div>
          <div className="flex flex-col gap-0.5">
            <span style={{ fontSize: 10, color: isDark ? "#9ca3af" : "#6b7280" }}>Est. Time</span>
            <strong style={{ color: isDark ? '#4ade80' : '#16a34a' }}>{routeInfo.time}</strong>
          </div>
          <button
            onClick={() => {
              if (routeLayerRef.current) mapRef.current?.removeLayer(routeLayerRef.current);
              if (destPinLayerRef.current) mapRef.current?.removeLayer(destPinLayerRef.current);
              routeLayerRef.current = null;
              destPinLayerRef.current = null;
              setRouteInfo(null);
            }}
            className="ml-2 w-6 h-6 rounded-full flex items-center justify-center hover:bg-gray-500/20"
            style={{ color: isDark ? '#9ca3af' : '#6b7280' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Geocoding overlay */}
      {isGeocoding && (
        <div className="absolute inset-0 z-[500] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(2px)" }}>
          <div style={{ background: isDark ? "#1a1a1a" : "#fff", borderRadius: 12, padding: "16px 24px", textAlign: "center" }}>
            <div style={{ width: 28, height: 28, border: "3px solid #9E217B", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 8px" }} />
            <p style={{ color: isDark ? "#d1d5db" : "#374151", fontSize: 12, fontWeight: 600 }}>Locating leads on map...</p>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes dash-flow { from { stroke-dashoffset: 48; } to { stroke-dashoffset: 0; } }
        .route-animated-glow { 
          animation: dash-flow 1.5s linear infinite; 
          filter: drop-shadow(0 0 8px rgba(6, 182, 212, 0.8));
        }
        .smart-cluster-bubble:hover {
          transform: scale(1.1);
        }
        .leaflet-popup-content-wrapper { border-radius: 12px !important; box-shadow: 0 8px 32px rgba(0,0,0,0.2) !important; padding: 0 !important; overflow: hidden; }
        .leaflet-popup-content { margin: 12px !important; }
        .leaflet-popup-tip-container { display: none; }
        
        .leaflet-marker-icon, path.route-animated-glow, .leaflet-popup-pane {
          transition: opacity 0.4s ease;
        }
        .hide-cluster-markers .leaflet-marker-icon,
        .hide-cluster-markers path.route-animated-glow,
        .hide-cluster-markers .leaflet-popup-pane {
          opacity: 0 !important;
          pointer-events: none !important;
        }
      `}</style>
    </div>
  );
}
