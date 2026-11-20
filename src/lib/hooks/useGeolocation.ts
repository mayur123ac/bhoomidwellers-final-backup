"use client";

import { useState, useCallback, useRef } from "react";

export type GeoPosition = {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
  /** Human-readable address from reverse geocoding, or null if unavailable. */
  address: string | null;
};

type GeoState = {
  position: GeoPosition | null;
  loading: boolean;
  error: string | null;
};

/**
 * Reverse-geocode coordinates into a human-readable address.
 * Uses OpenStreetMap Nominatim (free, no API key).
 * Returns null on failure — never throws.
 */
async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&zoom=18`,
      { headers: { "Accept-Language": "en" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.address) return data?.display_name?.slice(0, 120) || null;
    const a = data.address;
    // Build a concise address: road/neighbourhood, suburb/city, state
    const parts = [
      a.road || a.neighbourhood || a.hamlet || "",
      a.suburb || a.village || a.town || a.city_district || "",
      a.city || a.county || "",
      a.state || "",
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(", ").slice(0, 120) : (data.display_name?.slice(0, 120) || null);
  } catch {
    return null;
  }
}

/**
 * Hook that requests the browser's current GPS position.
 *
 * Returns the last captured position and a `capture()` function that
 * triggers a fresh geolocation request. Gracefully handles permission
 * denied, timeout, and unavailability.
 *
 * Automatically reverse-geocodes the coordinates into a human-readable
 * address. The address is null while geocoding is in progress and may
 * remain null if the service is unreachable.
 */
export function useGeolocation() {
  const [state, setState] = useState<GeoState>({
    position: null,
    loading: false,
    error: null,
  });
  const watchRef = useRef<number | null>(null);

  const capture = useCallback((): Promise<GeoPosition | null> => {
    if (!navigator.geolocation) {
      setState(s => ({ ...s, error: "Geolocation is not supported by this browser." }));
      return Promise.resolve(null);
    }

    setState(s => ({ ...s, loading: true, error: null }));

    return new Promise<GeoPosition | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const geo: GeoPosition = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            timestamp: pos.timestamp,
            address: null,
          };
          setState({ position: geo, loading: false, error: null });
          resolve(geo);

          // Fire-and-forget reverse geocoding — updates state when done
          reverseGeocode(geo.latitude, geo.longitude).then(addr => {
            if (addr) {
              setState(s => {
                if (!s.position) return s;
                return { ...s, position: { ...s.position, address: addr } };
              });
            }
          });
        },
        (err) => {
          let msg = "Could not get location.";
          if (err.code === err.PERMISSION_DENIED) msg = "Location permission denied.";
          else if (err.code === err.TIMEOUT) msg = "Location request timed out.";
          setState(s => ({ ...s, loading: false, error: msg }));
          resolve(null);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 30000,
        }
      );
    });
  }, []);

  const clear = useCallback(() => {
    if (watchRef.current !== null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
    setState({ position: null, loading: false, error: null });
  }, []);

  return { ...state, capture, clear };
}
