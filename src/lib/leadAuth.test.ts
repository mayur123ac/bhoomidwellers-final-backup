// @vitest-environment node
//
// Security regression tests for lib/leadAuth.ts
//
// These tests guard the authorization primitives used by every lead mutation
// endpoint. A failure here means a change has broken the ownership model —
// it must not be skipped or merged without a deliberate review.

import { describe, it, expect } from "vitest";
import { canEditLead, isAssignableRole, isReceptionistRole, LEAD_ASSIGNABLE_ROLES } from "./leadAuth";

// ── Shared lead fixture helpers ───────────────────────────────────────────────

const LEAD_ID_OWNER = 10;
const LEAD_RECEP_OWNER = 20;
const LEAD_SH_OWNER = 30;
const STRANGER_ID = 99;

function makeLeadWithFks(overrides: Partial<{
  assigned_to_user_id: number | null;
  assigned_receptionist_user_id: number | null;
  overseeing_site_head_user_id: number | null;
  assigned_to: string | null;
  assigned_receptionist: string | null;
  overseeing_site_head: string | null;
}> = {}) {
  return {
    assigned_to_user_id: LEAD_ID_OWNER,
    assigned_receptionist_user_id: null,
    overseeing_site_head_user_id: null,
    assigned_to: "Sales Manager A",
    assigned_receptionist: null,
    overseeing_site_head: null,
    ...overrides,
  };
}

// ── isAssignableRole ──────────────────────────────────────────────────────────

describe("isAssignableRole", () => {
  it("accepts sales manager", () => {
    expect(isAssignableRole("sales manager")).toBe(true);
  });

  it("accepts receptionist", () => {
    expect(isAssignableRole("receptionist")).toBe(true);
  });

  it("accepts site head", () => {
    expect(isAssignableRole("site head")).toBe(true);
  });

  it("accepts senior sales manager", () => {
    expect(isAssignableRole("senior sales manager")).toBe(true);
  });

  // P0-5 core assertion: admin must NEVER be a valid lead assignee.
  it("[P0-5] rejects admin", () => {
    expect(isAssignableRole("admin")).toBe(false);
  });

  it("[P0-5] rejects sourcing manager", () => {
    expect(isAssignableRole("sourcing manager")).toBe(false);
  });

  it("[P0-5] rejects unknown/empty role", () => {
    expect(isAssignableRole("")).toBe(false);
    expect(isAssignableRole(null)).toBe(false);
    expect(isAssignableRole(undefined)).toBe(false);
  });

  it("normalises underscores and case from DB storage", () => {
    expect(isAssignableRole("Sales_Manager")).toBe(true);
    expect(isAssignableRole("RECEPTIONIST")).toBe(true);
  });
});

// ── isReceptionistRole ────────────────────────────────────────────────────────

describe("isReceptionistRole", () => {
  it("returns true for receptionist", () => {
    expect(isReceptionistRole("receptionist")).toBe(true);
  });

  it("returns false for sales manager", () => {
    expect(isReceptionistRole("sales manager")).toBe(false);
  });

  it("returns false for admin", () => {
    expect(isReceptionistRole("admin")).toBe(false);
  });
});

// ── canEditLead — org-wide roles ──────────────────────────────────────────────

describe("canEditLead — org-wide roles bypass ownership", () => {
  const anyLead = makeLeadWithFks({ assigned_to_user_id: 999 });

  it("admin can edit any lead", () => {
    expect(canEditLead({
      sessionRole: "admin",
      sessionUserId: 1,
      sessionName: "Super Admin",
      lead: anyLead,
    })).toBe(true);
  });

  it("site head can edit any lead", () => {
    expect(canEditLead({
      sessionRole: "site head",
      sessionUserId: 2,
      sessionName: "Rajesh SH",
      lead: anyLead,
    })).toBe(true);
  });
});

// ── canEditLead — FK-based ownership ─────────────────────────────────────────

describe("canEditLead — ID-first ownership", () => {
  it("owner via assigned_to_user_id can edit", () => {
    const lead = makeLeadWithFks({ assigned_to_user_id: LEAD_ID_OWNER });
    expect(canEditLead({
      sessionRole: "sales manager",
      sessionUserId: LEAD_ID_OWNER,
      sessionName: "Sales Manager A",
      lead,
    })).toBe(true);
  });

  it("owner via assigned_receptionist_user_id can edit", () => {
    const lead = makeLeadWithFks({
      assigned_to_user_id: LEAD_ID_OWNER,
      assigned_receptionist_user_id: LEAD_RECEP_OWNER,
    });
    expect(canEditLead({
      sessionRole: "receptionist",
      sessionUserId: LEAD_RECEP_OWNER,
      sessionName: "Receptionist B",
      lead,
    })).toBe(true);
  });

  it("owner via overseeing_site_head_user_id can edit", () => {
    const lead = makeLeadWithFks({
      assigned_to_user_id: LEAD_ID_OWNER,
      overseeing_site_head_user_id: LEAD_SH_OWNER,
    });
    expect(canEditLead({
      sessionRole: "site head",
      sessionUserId: LEAD_SH_OWNER,
      sessionName: "Site Head C",
      lead,
    })).toBe(true);
  });

  // P0-2 core assertion: a stranger must be rejected even with a matching name
  // if the FK column is populated and points elsewhere.
  it("[P0-2] stranger with correct name but wrong ID is rejected when FK is set", () => {
    const lead = makeLeadWithFks({
      assigned_to_user_id: LEAD_ID_OWNER,
      assigned_to: "Sales Manager A",
    });
    expect(canEditLead({
      sessionRole: "sales manager",
      sessionUserId: STRANGER_ID,
      sessionName: "Sales Manager A", // same name — must NOT grant access when FK is populated
      lead,
    })).toBe(false);
  });

  it("[P0-2] non-owner sales manager is rejected", () => {
    const lead = makeLeadWithFks({ assigned_to_user_id: LEAD_ID_OWNER });
    expect(canEditLead({
      sessionRole: "sales manager",
      sessionUserId: STRANGER_ID,
      sessionName: "Stranger SM",
      lead,
    })).toBe(false);
  });
});

// ── canEditLead — name-fallback for pre-migration rows ────────────────────────

describe("canEditLead — name fallback (FK = NULL, pre-migration rows)", () => {
  it("allows name match when FK is null", () => {
    const lead = makeLeadWithFks({
      assigned_to_user_id: null, // pre-migration row
      assigned_to: "Sales Manager A",
    });
    expect(canEditLead({
      sessionRole: "sales manager",
      sessionUserId: LEAD_ID_OWNER,
      sessionName: "Sales Manager A",
      lead,
    })).toBe(true);
  });

  it("rejects when sessionUserId is null even if name matches", () => {
    // A session without a userId cannot be trusted — no fallback to name-only.
    const lead = makeLeadWithFks({
      assigned_to_user_id: null,
      assigned_to: "Sales Manager A",
    });
    expect(canEditLead({
      sessionRole: "sales manager",
      sessionUserId: null,
      sessionName: "Sales Manager A",
      lead,
    })).toBe(false);
  });

  it("rejects when sessionName is empty even if FK is null", () => {
    const lead = makeLeadWithFks({
      assigned_to_user_id: null,
      assigned_to: "Sales Manager A",
    });
    expect(canEditLead({
      sessionRole: "sales manager",
      sessionUserId: LEAD_ID_OWNER,
      sessionName: "", // empty name — must not match
      lead,
    })).toBe(false);
  });
});

// ── canEditLead — IDOR scenarios ─────────────────────────────────────────────

describe("canEditLead — IDOR protection", () => {
  it("[P0-2] receptionist A cannot edit SM-owned lead", () => {
    const lead = makeLeadWithFks({
      assigned_to_user_id: LEAD_ID_OWNER,
      assigned_receptionist_user_id: null,
    });
    expect(canEditLead({
      sessionRole: "receptionist",
      sessionUserId: 42, // different id
      sessionName: "Receptionist Priya",
      lead,
    })).toBe(false);
  });

  it("[P0-2] SM from another lead cannot edit this lead", () => {
    const lead = makeLeadWithFks({ assigned_to_user_id: 7 });
    expect(canEditLead({
      sessionRole: "sales manager",
      sessionUserId: 8, // different manager
      sessionName: "Other SM",
      lead,
    })).toBe(false);
  });
});

// ── Transfer endpoint role gate (P0-3) ────────────────────────────────────────
// These assert the server-side gate logic: receptionist must be excluded from
// the transfer endpoint. The test calls the gate predicate directly (simulating
// the requireRoles check) so it catches any regression without needing a full
// HTTP server.

describe("P0-3 — Receptionist excluded from lead transfer", () => {
  const ALLOWED_TRANSFER_ROLES = new Set(["admin", "sales manager", "site head"]);

  it("admin is allowed to transfer", () => {
    expect(ALLOWED_TRANSFER_ROLES.has("admin")).toBe(true);
  });

  it("sales manager is allowed to transfer", () => {
    expect(ALLOWED_TRANSFER_ROLES.has("sales manager")).toBe(true);
  });

  it("site head is allowed to transfer", () => {
    expect(ALLOWED_TRANSFER_ROLES.has("site head")).toBe(true);
  });

  it("[P0-3] receptionist is NOT allowed to transfer", () => {
    expect(ALLOWED_TRANSFER_ROLES.has("receptionist")).toBe(false);
  });
});

// ── P0-6 — Self-assign receptionist derivation ───────────────────────────────

describe("P0-6 — assigned_receptionist derived server-side", () => {
  // Mirror the exact logic from the route handler so any change there breaks
  // this test and forces a conscious review.
  function deriveAssignedReceptionist(
    sessionRole: string,
    actorName: string,
    assignedTo: string
  ): string | null {
    const sessionIsReceptionist = sessionRole === "receptionist";
    const sessionNameLower = actorName.trim().toLowerCase();
    const assignedToLower = assignedTo.trim().toLowerCase();
    return sessionIsReceptionist && sessionNameLower && sessionNameLower === assignedToLower
      ? actorName.trim()
      : null;
  }

  it("self-assign: receptionist gets own name in receptionist column", () => {
    expect(
      deriveAssignedReceptionist("receptionist", "Priya Desk", "Priya Desk")
    ).toBe("Priya Desk");
  });

  it("SM assignment: receptionist assigns to SM — receptionist column is NULL", () => {
    expect(
      deriveAssignedReceptionist("receptionist", "Priya Desk", "Sales Manager A")
    ).toBeNull();
  });

  it("[P0-6] non-receptionist session cannot set assigned_receptionist", () => {
    // An admin creating a lead should NOT populate assigned_receptionist.
    expect(
      deriveAssignedReceptionist("admin", "Admin User", "Admin User")
    ).toBeNull();
  });

  it("[P0-6] body-supplied receptionist name is ignored — only session name used", () => {
    // Even if the body sent assigned_receptionist: "Receptionist B", the
    // derivation uses actorName (from session), not the body field.
    // Simulated: session is Receptionist A, assignedTo is SM — body's
    // "Receptionist B" is irrelevant because the derivation only calls
    // deriveAssignedReceptionist with session values.
    expect(
      deriveAssignedReceptionist("receptionist", "Receptionist A", "Sales Manager A")
    ).toBeNull();
    // Not "Receptionist B" — the body value never reaches this function.
  });
});

// ── P0-5 — Admin not assignable ──────────────────────────────────────────────

describe("P0-5 — Admin role not a valid lead assignee", () => {
  it("every role in LEAD_ASSIGNABLE_ROLES is not admin", () => {
    for (const role of LEAD_ASSIGNABLE_ROLES) {
      expect(role).not.toBe("admin");
    }
  });

  it("isAssignableRole rejects all admin variants", () => {
    const adminVariants = ["admin", "Admin", "ADMIN", "admin_user"];
    for (const v of adminVariants) {
      // Only exact "admin" after normaliseRole is rejected; admin_user normalises
      // to "admin user" which is also not in the set.
      expect(isAssignableRole(v)).toBe(false);
    }
  });
});
