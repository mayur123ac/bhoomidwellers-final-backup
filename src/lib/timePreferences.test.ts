// timePreferences.test.ts — the zone must be the app's, never the machine's.
//
// These pin the two things that break silently. First, every helper has to
// resolve in Asia/Kolkata regardless of the runtime's own zone: the bug this
// prevents is invisible on a developer machine set to IST and appears only on a
// UTC server, which is what Neon runs. Second, the week range has to honour the
// user's chosen start day — the setting exists to move it.

import { describe, expect, it } from "vitest";
import {
  APP_TIMEZONE,
  ALLOWED_TIMEZONES,
  TIMEZONE_LOCKED,
  appDateKey,
  appWeekRange,
  formatAppDate,
  formatAppTime,
  formatAppWeekday,
  isAllowedTimezone,
  isValidWeekStartDay,
} from "./timePreferences";

// 2026-08-09T20:15:00Z is 2026-08-10T01:45 IST — a deliberately chosen instant
// where UTC and IST disagree about which DAY it is.
const LATE_NIGHT = "2026-08-09T20:15:00Z";

describe("the app's zone, not the machine's", () => {
  it("resolves the calendar day in IST, not UTC", () => {
    // toISOString() would say 2026-08-09 here, and every report keyed on it
    // would be a day out for the first 5.5 hours of each day.
    expect(appDateKey(LATE_NIGHT)).toBe("2026-08-10");
    expect(new Date(LATE_NIGHT).toISOString().slice(0, 10)).toBe("2026-08-09");
  });

  it("formats the date and weekday in IST", () => {
    expect(formatAppDate(LATE_NIGHT)).toBe("10 Aug 2026");
    expect(formatAppWeekday(LATE_NIGHT)).toBe("Mon"); // Sunday in UTC
  });

  it("formats the time in IST, with and without seconds", () => {
    expect(formatAppTime("2026-08-09T16:04:07Z")).toBe("9:34 PM");
    expect(formatAppTime("2026-08-09T16:04:07Z", true)).toBe("9:34:07 PM");
  });
});

describe("the timezone lock", () => {
  it("allows only the workspace zone while locked", () => {
    expect(TIMEZONE_LOCKED).toBe(true);
    expect(ALLOWED_TIMEZONES).toEqual([APP_TIMEZONE]);
    expect(isAllowedTimezone("Asia/Kolkata")).toBe(true);
    // A real IANA zone that is nonetheless refused — the point of the lock is
    // that validity is not the test, the allow-list is.
    expect(isAllowedTimezone("America/New_York")).toBe(false);
  });
});

describe("week start", () => {
  it("accepts only the three offered days", () => {
    expect(isValidWeekStartDay(1)).toBe(true);
    expect(isValidWeekStartDay(0)).toBe(true);
    expect(isValidWeekStartDay(6)).toBe(true);
    expect(isValidWeekStartDay(3)).toBe(false);
  });

  it("moves the range with the chosen start day", () => {
    // 2026-08-12 IST is a Wednesday.
    const wed = "2026-08-12T06:00:00Z";
    expect(appWeekRange(wed, 1)).toEqual({ start: "2026-08-10", end: "2026-08-16" });
    expect(appWeekRange(wed, 0)).toEqual({ start: "2026-08-09", end: "2026-08-15" });
    expect(appWeekRange(wed, 6)).toEqual({ start: "2026-08-08", end: "2026-08-14" });
  });

  it("keeps a day that IS the week start in its own week", () => {
    // The off-by-one that a naive (day - start) would produce: Monday must not
    // roll back to the previous Monday.
    expect(appWeekRange("2026-08-10T06:00:00Z", 1).start).toBe("2026-08-10");
  });

  it("uses the IST day, so a late-night instant lands in the right week", () => {
    // 20:15Z Sunday is already Monday in IST, so this belongs to the NEXT week.
    expect(appWeekRange(LATE_NIGHT, 1).start).toBe("2026-08-10");
  });
});
