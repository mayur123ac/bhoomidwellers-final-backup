// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
}));

import { query } from "@/lib/db";
import { resolvePhones } from "./phoneAccess";

const mockQuery = vi.mocked(query);

describe("resolvePhones LEAD_PHONE ownership policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue([{ can_view_full_phone: false }] as any);
  });

  it("returns full phone for a receptionist's self-assigned lead even when role policy is off", async () => {
    const rows = [
      {
        id: 613,
        phone: "9876548982",
        alt_phone: "7777700000",
        assigned_to_user_id: 8,
        assigned_receptionist_user_id: 8,
        assigned_receptionist: "Singh Saumya",
      },
    ];

    const result = await resolvePhones(
      { _id: "8", name: "Singh Saumya", role: "Receptionist" },
      rows,
      "LEAD_PHONE",
      "org-1",
      ["phone", "alt_phone"]
    );

    expect(result[0].phone).toBe("9876548982");
    expect(result[0].alt_phone).toBe("7777700000");
  });

  it("masks another employee's lead when receptionist policy is off", async () => {
    const rows = [
      {
        id: 700,
        phone: "9876548982",
        alt_phone: "7777700000",
        assigned_to_user_id: 99,
        assigned_receptionist_user_id: 99,
        assigned_receptionist: "Other Receptionist",
      },
    ];

    const result = await resolvePhones(
      { _id: "8", name: "Singh Saumya", role: "Receptionist" },
      rows,
      "LEAD_PHONE",
      "org-1",
      ["phone", "alt_phone"]
    );

    expect(result[0].phone).not.toBe("9876548982");
    expect(result[0].phone).toMatch(/^98.+8982$/);
    expect(result[0].alt_phone).not.toBe("7777700000");
    expect(result[0].alt_phone).toMatch(/^77.+0000$/);
  });

  it("masks another employee's lead for a receptionist even when role policy is on", async () => {
    mockQuery.mockResolvedValue([{ can_view_full_phone: true }] as any);
    const rows = [
      {
        id: 702,
        phone: "9876548982",
        assigned_to_user_id: 99,
        assigned_to: "Sales Manager A",
        assigned_receptionist_user_id: null,
        assigned_receptionist: null,
      },
    ];

    const result = await resolvePhones(
      { _id: "8", name: "Singh Saumya", role: "Receptionist" },
      rows,
      "LEAD_PHONE",
      "org-1",
      ["phone"]
    );

    expect(result[0].phone).not.toBe("9876548982");
    expect(result[0].phone).toMatch(/^98.+8982$/);
  });

  it("does not reveal an unassigned lead when receptionist policy is off", async () => {
    const rows = [
      {
        id: 701,
        phone: "9876548982",
        assigned_to_user_id: null,
        assigned_receptionist_user_id: null,
        assigned_to: null,
        assigned_receptionist: null,
      },
    ];

    const result = await resolvePhones(
      { _id: "8", name: "Singh Saumya", role: "Receptionist" },
      rows,
      "LEAD_PHONE",
      "org-1",
      ["phone"]
    );

    expect(result[0].phone).not.toBe("9876548982");
    expect(result[0].phone).toMatch(/^98.+8982$/);
  });

  it("preserves admin access", async () => {
    const rows = [{ id: 1, phone: "9876548982" }];

    const result = await resolvePhones(
      { _id: "1", name: "Admin", role: "Admin" },
      rows,
      "LEAD_PHONE",
      "org-1",
      ["phone"]
    );

    expect(result).toBe(rows);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
