// Tests for dedup: merge policy (getMergeFields is the only pure function we can unit-test
// without a database; findCandidates/runDedup require DB queries).
import { describe, it, expect } from "vitest";
import { getMergeFields } from "../dedup";

describe("getMergeFields", () => {
  const baseExisting = {
    id: 1,
    organization_id: "org-1",
    name: "Existing Lead",
    phone: "9876543210",
    email: null,
    address: null,
    occupation: null,
    organization: null,
    budget: "Pending",
    configuration: null,
    purpose: null,
    alt_phone: null,
    source: "Direct Walk-in",
    source_other: null,
    referral_name: null,
    cp_name: null,
    cp_company: null,
    cp_phone: null,
    assigned_to: "Old Manager",
    overseeing_site_head: null,
    status: "Assigned",
    is_global_shared: false,
    channel_partner_id: null,
    external_ref: null,
    feedback: null,
    enquiry_date: "2024-01-01T00:00:00.000Z",
    sr_no: 1,
    import_job_id: null,
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z",
  };

  it("always overwrites assigned_to from job", () => {
    const result = getMergeFields(baseExisting, {}, "New Manager", null);
    expect(result.assigned_to).toBe("New Manager");
  });

  it("always overwrites overseeing_site_head from job", () => {
    const result = getMergeFields(baseExisting, {}, "New Manager", "Site Head A");
    expect(result.overseeing_site_head).toBe("Site Head A");
  });

  it("fills empty fields from incoming data", () => {
    const incoming = {
      alt_phone: "9123456789",
      configuration: "2BHK",
      budget: "50L",
      cp_name: "Partner A",
    };
    const result = getMergeFields(baseExisting, incoming, "Manager", null);
    expect(result.alt_phone).toBe("9123456789");
    expect(result.configuration).toBe("2BHK");
    expect(result.cp_name).toBe("Partner A");
  });

  it("fills budget when existing is 'Pending'", () => {
    const incoming = { budget: "75 Lakhs" };
    const result = getMergeFields(baseExisting, incoming, baseExisting.assigned_to, null);
    expect(result.budget).toBe("75 Lakhs");
  });

  it("does NOT overwrite non-empty existing fields", () => {
    const existing = { ...baseExisting, configuration: "3BHK", alt_phone: "1111111111" };
    const incoming = { configuration: "2BHK", alt_phone: "2222222222" };
    const result = getMergeFields(existing, incoming, existing.assigned_to, null);
    expect(result).not.toHaveProperty("configuration");
    expect(result).not.toHaveProperty("alt_phone");
  });

  it("NEVER includes protected fields", () => {
    const incoming = {
      status: "Lost",
      is_global_shared: true,
      channel_partner_id: 99,
      id: 999,
      organization_id: "hacked-org",
      sr_no: 42,
    };
    const result = getMergeFields(baseExisting, incoming, "Manager", null);
    expect(result).not.toHaveProperty("status");
    expect(result).not.toHaveProperty("is_global_shared");
    expect(result).not.toHaveProperty("channel_partner_id");
    expect(result).not.toHaveProperty("id");
    expect(result).not.toHaveProperty("organization_id");
    expect(result).not.toHaveProperty("sr_no");
  });

  it("does not overwrite existing enquiry_date", () => {
    const incoming = { enquiry_date: "2025-06-01T00:00:00.000Z" };
    const result = getMergeFields(baseExisting, incoming, baseExisting.assigned_to, null);
    expect(result).not.toHaveProperty("enquiry_date");
  });

  it("fills enquiry_date when existing is null", () => {
    const existing = { ...baseExisting, enquiry_date: null };
    const incoming = { enquiry_date: "2025-06-01T00:00:00.000Z" };
    const result = getMergeFields(existing, incoming, existing.assigned_to, null);
    expect(result.enquiry_date).toBe("2025-06-01T00:00:00.000Z");
  });

  it("skips null/empty incoming values", () => {
    const incoming = { alt_phone: null, configuration: "", budget: undefined };
    const result = getMergeFields(baseExisting, incoming, baseExisting.assigned_to, null);
    expect(result).not.toHaveProperty("alt_phone");
    expect(result).not.toHaveProperty("configuration");
    expect(result).not.toHaveProperty("budget");
  });

  it("returns empty object when nothing to update", () => {
    const result = getMergeFields(baseExisting, {}, baseExisting.assigned_to, null);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("treats N/A as empty for fill-if-empty", () => {
    const existing = { ...baseExisting, budget: "N/A" };
    const incoming = { budget: "50 Lakhs" };
    const result = getMergeFields(existing, incoming, existing.assigned_to, null);
    expect(result.budget).toBe("50 Lakhs");
  });
});
