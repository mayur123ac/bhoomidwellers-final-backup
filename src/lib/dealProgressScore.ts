// lib/dealProgressScore.ts — Deal Progress Score utility
//
// Score = ROUND((currentOrdinal / totalStages) * 100)
// Temperature classification based on score thresholds.

const TOTAL_STAGES = 6;

export interface DealProgressResult {
  score: number;
  temperature: "cold" | "warm" | "hot" | "booked";
  temperatureLabel: string;
  tracked: boolean;
}

/**
 * Compute the Deal Progress Score from a persisted stage ordinal.
 *
 * Returns `{ tracked: false, score: 0, temperature: "cold" }` when the lead
 * is untracked (no deal stage history). The caller should display "--" in that case.
 */
export function computeDealProgress(
  currentOrdinal: number,
  tracked: boolean,
): DealProgressResult {
  if (!tracked || !Number.isFinite(currentOrdinal) || currentOrdinal < 1) {
    return { score: 0, temperature: "cold", temperatureLabel: "Cold", tracked: false };
  }

  const clamped = Math.min(Math.max(currentOrdinal, 1), TOTAL_STAGES);
  const score = Math.round((clamped / TOTAL_STAGES) * 100);

  let temperature: DealProgressResult["temperature"];
  let temperatureLabel: string;

  if (score >= 100) {
    temperature = "booked";
    temperatureLabel = "Booked";
  } else if (score >= 67) {
    temperature = "hot";
    temperatureLabel = "Hot";
  } else if (score >= 34) {
    temperature = "warm";
    temperatureLabel = "Warm";
  } else {
    temperature = "cold";
    temperatureLabel = "Cold";
  }

  return { score: Math.min(score, 100), temperature, temperatureLabel, tracked: true };
}

/**
 * Color tokens for the score ring and temperature badge.
 * Returns Tailwind-compatible color strings.
 */
export function getScoreColors(temperature: DealProgressResult["temperature"], isDark: boolean) {
  switch (temperature) {
    case "cold":
      return {
        ring: isDark ? "#60A5FA" : "#3B82F6",        // blue-400 / blue-500
        ringTrack: isDark ? "#1E3A5F" : "#DBEAFE",   // dark-blue / blue-100
        badge: isDark ? "bg-blue-500/15 text-blue-400 border-blue-500/30" : "bg-blue-50 text-blue-700 border-blue-200",
        scoreText: isDark ? "text-blue-400" : "text-blue-600",
      };
    case "warm":
      return {
        ring: isDark ? "#FB923C" : "#F97316",        // orange-400 / orange-500
        ringTrack: isDark ? "#4A2C1A" : "#FFF7ED",   // dark-orange / orange-50
        badge: isDark ? "bg-orange-500/15 text-orange-400 border-orange-500/30" : "bg-orange-50 text-orange-700 border-orange-200",
        scoreText: isDark ? "text-orange-400" : "text-orange-600",
      };
    case "hot":
      return {
        ring: isDark ? "#4ADE80" : "#22C55E",        // green-400 / green-500
        ringTrack: isDark ? "#14412A" : "#F0FDF4",   // dark-green / green-50
        badge: isDark ? "bg-green-500/15 text-green-400 border-green-500/30" : "bg-green-50 text-green-700 border-green-200",
        scoreText: isDark ? "text-green-400" : "text-green-600",
      };
    case "booked":
      return {
        ring: isDark ? "#A78BFA" : "#7C3AED",        // violet-400 / violet-600
        ringTrack: isDark ? "#2E1065" : "#F5F3FF",   // dark-violet / violet-50
        badge: isDark ? "bg-violet-500/15 text-violet-400 border-violet-500/30" : "bg-violet-50 text-violet-700 border-violet-200",
        scoreText: isDark ? "text-violet-400" : "text-violet-600",
      };
  }
}
