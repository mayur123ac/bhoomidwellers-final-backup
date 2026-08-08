// RoleSidebar.test.tsx — the rail must follow the USER, not the route.
//
// The bug these cover: /dashboard/settings mounted the Admin rail for everyone,
// so a Sales Manager opening Settings lost their navigation and got "Quick jump
// / Back to workspace / Settings" instead. The regression would be silent —
// every page still renders, it just renders the wrong shell — so the mapping is
// pinned here rather than left to be noticed by eye.

import { describe, expect, it } from "vitest";
import { railKindForRole, normalizeRoleName } from "./RoleSidebar";
import { SALES_NAV } from "./sales/SalesSidebar";

describe("railKindForRole", () => {
  it("gives a Sales Manager the sales rail, however the role is spelled", () => {
    // The users table holds both "sales_manager" and "Sales Manager", and
    // whichever one a given row has must not decide which sidebar they see.
    for (const spelling of ["Sales Manager", "sales manager", "sales_manager", " SALES_MANAGER "]) {
      expect(railKindForRole(spelling)).toBe("sales");
    }
  });

  it("leaves every other role on the admin rail", () => {
    for (const role of ["admin", "site head", "receptionist", "sourcing manager", "caller"]) {
      expect(railKindForRole(role)).toBe("admin");
    }
  });

  it("falls back to the admin rail for a missing role rather than throwing", () => {
    // Reached only if a session is malformed. A rail is still better than a
    // crashed shell, and middleware has already refused the unauthenticated.
    expect(railKindForRole(null)).toBe("admin");
    expect(railKindForRole(undefined)).toBe("admin");
    expect(normalizeRoleName(undefined)).toBe("");
  });
});

describe("SALES_NAV", () => {
  it("is the Sales Manager sidebar, in order", () => {
    expect(SALES_NAV.map((i) => i.label)).toEqual([
      "Dashboard",
      "Assigned Leads",
      "Closed Leads",
      "Inventory",
      "Site Visits",
      "My Attendance",
      "Bhoomi AI",
      "Settings",
    ]);
  });

  it("pins Settings to the bottom and nothing else", () => {
    expect(SALES_NAV.filter((i) => i.pinned).map((i) => i.id)).toEqual(["settings"]);
  });

  it("carries a Settings item whose id both rails share", () => {
    // SettingsShell passes activeId="settings" for whichever rail it mounts, so
    // the highlight depends on this id matching in both. The admin rail's
    // Settings item uses the same one.
    expect(SALES_NAV.some((i) => i.id === "settings")).toBe(true);
  });
});
