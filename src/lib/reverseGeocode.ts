// lib/reverseGeocode.ts — GPS coordinates → human-readable place name.
//
// Uses OpenStreetMap Nominatim, which is free and requires no API key.
// The project already uses OpenStreetMap tiles (LeafletMap.tsx), so this
// is consistent with the existing stack.
//
// ── Usage policy ──────────────────────────────────────────────────────────
// Nominatim's usage policy asks for at most 1 request per second and a
// meaningful User-Agent. This is called once per login (not per page load),
// so the rate is well within limits — a company would need 3,600 logins
// per hour to hit 1 req/s.
//
// ── Failure is not fatal ──────────────────────────────────────────────────
// GPS is mandatory for login. Reverse geocoding is enrichment. A Nominatim
// outage must never block a sign-in. Every caller wraps this in a catch.

import { query } from "@/lib/db";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";
const TIMEOUT_MS = 5_000;

interface NominatimResponse {
  address?: {
    neighbourhood?: string;
    suburb?: string;
    city?: string;
    town?: string;
    village?: string;
    county?: string;
    state_district?: string;
    state?: string;
    country?: string;
    road?: string;
  };
  display_name?: string;
}

/**
 * Reverse-geocode a coordinate pair into the most precise human-readable
 * location the provider can return.
 *
 * Returns a string like "Manpada, Thane, Maharashtra, India" or null
 * on failure. Never throws.
 *
 * Uses zoom=18 (street/building level) to get locality/neighbourhood
 * detail that zoom=10 (city level) would omit.
 */
export async function reverseGeocode(
  latitude: number,
  longitude: number
): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(
      `${NOMINATIM_URL}?lat=${latitude}&lon=${longitude}&format=json&zoom=18&addressdetails=1`,
      {
        headers: {
          "User-Agent": "BhoomiDwellersCRM/1.0 (login-location-enrichment)",
          Accept: "application/json",
        },
        signal: controller.signal,
      }
    );

    clearTimeout(timer);

    if (!res.ok) return null;

    const data: NominatimResponse = await res.json();
    if (!data.address) return null;

    const a = data.address;

    // Build the most detailed hierarchy available.
    // Locality: neighbourhood/suburb (the most specific populated-place name).
    // City: city/town/village (the settlement).
    // De-duplicate: if suburb and city are the same string, skip the repetition.
    const locality = a.neighbourhood || a.suburb || null;
    const city = a.city || a.town || a.village || null;
    const state = a.state || null;
    const country = a.country || null;

    const parts: string[] = [];
    if (locality) parts.push(locality);
    if (city && city !== locality) parts.push(city);
    if (state && state !== city) parts.push(state);
    if (country) parts.push(country);

    if (parts.length > 0) return parts.join(", ");

    // Fallback: trim display_name to 4 meaningful segments.
    if (data.display_name) {
      const segments = data.display_name.split(",").map((s) => s.trim()).filter(Boolean);
      return segments.slice(0, 4).join(", ") || null;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve and persist the location name (and accuracy) for a login session.
 *
 * Fire-and-forget: called without await from the login route. A failure
 * here never surfaces as a login error. The UPDATE is scoped to the
 * specific session row by id.
 */
export async function enrichSessionLocation(
  sessionId: number,
  latitude: number,
  longitude: number,
  accuracy?: number | null,
): Promise<void> {
  try {
    const name = await reverseGeocode(latitude, longitude);

    // Always store accuracy even if geocoding failed.
    if (!name && accuracy == null) return;

    await query(
      `UPDATE employee_sessions
          SET login_location_name = COALESCE($1, login_location_name),
              login_location_accuracy = COALESCE($2, login_location_accuracy)
        WHERE id = $3`,
      [name ? name.slice(0, 255) : null, accuracy ?? null, sessionId]
    );
  } catch (err) {
    console.error(
      "[reverseGeocode] could not enrich session location:",
      err instanceof Error ? err.message : String(err)
    );
  }
}
