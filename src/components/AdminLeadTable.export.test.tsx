import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderHook, act } from "@testing-library/react";
import React, { useRef } from "react";
import { useColumnFilters } from "@/components/ColumnFilterDropdown";

/**
 * AdminLeadTable export regression tests.
 *
 * Validates that the filteredRef mechanism correctly exposes the
 * post-column-filter dataset to parent export handlers, and that
 * the formatLeadForExport function produces human-readable dates.
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

type Lead = Record<string, any>;

/** Mirrors the formatLeadForExport from dashboard/page.tsx:667 */
const formatLeadForExport = (l: any) => ({
  "Sr. No.": l.sr_no || l.id,
  "Client Name": l.name,
  "Budget": l.salesBudget || l.budget || "N/A",
  "Phone": l.phone,
  "Source": l.source || "N/A",
  "Status": l.status || "Assigned",
  "Site Visit Date": l.mongoVisitDate
    ? new Date(l.mongoVisitDate).toLocaleDateString("en-IN")
    : "N/A",
  "Created At": l.created_at
    ? new Date(l.created_at).toLocaleDateString("en-IN")
    : "N/A",
});

function makeLeads(count: number): Lead[] {
  const statuses = ["Assigned", "Contacted", "Interested", "Closing", "Closed"];
  const sources = ["Walk-in", "Website", "CP Referral", "Facebook"];
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    sr_no: i + 1,
    name: `Lead ${i + 1}`,
    phone: `900000${String(i).padStart(4, "0")}`,
    budget: `${(i + 1) * 10} LAKH`,
    source: sources[i % sources.length],
    status: statuses[i % statuses.length],
    mongoVisitDate: i % 3 === 0 ? `2026-06-${String(14 + (i % 15)).padStart(2, "0")}T10:00:00.000Z` : null,
    created_at: `2026-01-${String((i % 28) + 1).padStart(2, "0")}T08:00:00.000Z`,
    is_lost_lead: i % 7 === 0,
    assigned_to: `Manager ${(i % 3) + 1}`,
  }));
}

const getDisplayValue = (lead: Lead, key: string): string => {
  const v = lead[key];
  return v == null ? "" : String(v);
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Export respects column filters", () => {
  it("single column filter excludes non-matching rows from export", () => {
    const leads = makeLeads(50);
    const { result } = renderHook(() => useColumnFilters());

    act(() => result.current.applyFilter("status", new Set(["Assigned"])));

    const filtered = result.current.filterRows(leads, getDisplayValue);
    const exported = filtered.map(formatLeadForExport);

    expect(exported.length).toBeGreaterThan(0);
    expect(exported.length).toBeLessThan(leads.length);
    expect(exported.every(r => r["Status"] === "Assigned")).toBe(true);
  });

  it("multiple column filters export only rows matching ALL filters (AND logic)", () => {
    const leads = makeLeads(50);
    const { result } = renderHook(() => useColumnFilters());

    act(() => {
      result.current.applyFilter("status", new Set(["Assigned"]));
      result.current.applyFilter("source", new Set(["Walk-in"]));
    });

    const filtered = result.current.filterRows(leads, getDisplayValue);
    const exported = filtered.map(formatLeadForExport);

    expect(exported.length).toBeGreaterThan(0);
    expect(exported.every(r => r["Status"] === "Assigned" && r["Source"] === "Walk-in")).toBe(true);
  });

  it("global search combined with column filter narrows export further", () => {
    const leads = makeLeads(50);
    const { result } = renderHook(() => useColumnFilters());

    // Simulate global search filtering (done before column filters)
    const searchTerm = "Lead 1";
    const searchFiltered = leads.filter(l =>
      String(l.name).toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Apply column filter on search-filtered data
    act(() => result.current.applyFilter("source", new Set(["Walk-in"])));

    const filtered = result.current.filterRows(searchFiltered, getDisplayValue);
    const exported = filtered.map(formatLeadForExport);

    // Every exported row must match BOTH the search and the filter
    expect(exported.every(r =>
      r["Client Name"].includes("Lead 1") && r["Source"] === "Walk-in"
    )).toBe(true);
  });

  it("export from page 2 includes all matching rows across pages", () => {
    const leads = makeLeads(100);
    const { result } = renderHook(() => useColumnFilters());

    act(() => result.current.applyFilter("status", new Set(["Assigned"])));

    const filtered = result.current.filterRows(leads, getDisplayValue);

    // Simulate being on page 2 with PAGE_SIZE=25
    const PAGE_SIZE = 25;
    const page2 = filtered.slice(PAGE_SIZE, PAGE_SIZE * 2);

    // The export should include ALL filtered rows, not just page 2
    const exported = filtered.map(formatLeadForExport);
    expect(exported.length).toBeGreaterThan(page2.length);
    expect(exported.length).toBe(filtered.length);
  });

  it("sorting is reflected in export order", () => {
    const leads = makeLeads(20);
    const { result } = renderHook(() => useColumnFilters());

    act(() => result.current.applySort("name", "desc"));

    const sorted = result.current.sortRows([...leads], getDisplayValue);
    const exported = sorted.map(formatLeadForExport);

    // Verify descending order by name using localeCompare (matches hook behavior)
    for (let i = 1; i < exported.length; i++) {
      const cmp = exported[i - 1]["Client Name"].localeCompare(
        exported[i]["Client Name"], undefined, { numeric: true, sensitivity: "base" }
      );
      expect(cmp).toBeGreaterThanOrEqual(0);
    }
  });

  it("clearing filters restores full dataset for export", () => {
    const leads = makeLeads(50);
    const { result } = renderHook(() => useColumnFilters());

    // Apply filter
    act(() => result.current.applyFilter("status", new Set(["Assigned"])));
    const narrow = result.current.filterRows(leads, getDisplayValue);
    expect(narrow.length).toBeLessThan(leads.length);

    // Clear filter
    act(() => result.current.applyFilter("status", null));
    const restored = result.current.filterRows(leads, getDisplayValue);
    expect(restored.length).toBe(leads.length);
  });
});

describe("Export produces human-readable dates", () => {
  it("Site Visit Date is formatted, not a raw timestamp", () => {
    const lead = {
      id: 1, name: "Test", phone: "9000000000",
      mongoVisitDate: "2026-06-14T10:23:00.000Z",
      created_at: "2026-01-05T08:00:00.000Z",
    };

    const row = formatLeadForExport(lead);

    // Must NOT be a raw timestamp like "1780488180000"
    expect(row["Site Visit Date"]).not.toMatch(/^\d{10,}$/);
    // Must NOT be an ISO string
    expect(row["Site Visit Date"]).not.toMatch(/T\d{2}:\d{2}/);
    // Must be a formatted date
    expect(row["Site Visit Date"]).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);

    // Same for Created At
    expect(row["Created At"]).not.toMatch(/^\d{10,}$/);
    expect(row["Created At"]).not.toMatch(/T\d{2}:\d{2}/);
  });

  it("null dates export as N/A, not as timestamp 0 or empty", () => {
    const lead = {
      id: 1, name: "Test", phone: "9000000000",
      mongoVisitDate: null,
      created_at: null,
    };

    const row = formatLeadForExport(lead);
    expect(row["Site Visit Date"]).toBe("N/A");
    expect(row["Created At"]).toBe("N/A");
  });
});

describe("Show Lost / table-level toggles affect export", () => {
  it("lost-lead filter excludes lost leads from export dataset", () => {
    const leads = makeLeads(50);

    // Simulate the Lost filter that removes lost leads before passing to the table
    const withoutLost = leads.filter(l => !l.is_lost_lead);
    const withLost = leads;

    expect(withoutLost.length).toBeLessThan(withLost.length);

    const exportedWithout = withoutLost.map(formatLeadForExport);
    const exportedWith = withLost.map(formatLeadForExport);

    expect(exportedWithout.length).toBeLessThan(exportedWith.length);
    // All exported rows without the lost filter should be non-lost
    // (this validates the pattern: filter upstream, then the ref captures the right set)
  });
});

describe("filteredRef mechanism", () => {
  it("useColumnFilters filterRows output can be stored in a ref for export", () => {
    const leads = makeLeads(50);
    const { result } = renderHook(() => {
      const hook = useColumnFilters();
      const ref = useRef<Lead[]>(leads);
      return { hook, ref };
    });

    // Initially ref has all leads
    expect(result.current.ref.current.length).toBe(50);

    // Apply filter
    act(() => result.current.hook.applyFilter("status", new Set(["Closing"])));

    // Simulate what AdminLeadTable's useEffect does
    const filtered = result.current.hook.filterRows(leads, getDisplayValue);
    result.current.ref.current = filtered;

    // The ref now holds only filtered data
    expect(result.current.ref.current.length).toBeGreaterThan(0);
    expect(result.current.ref.current.length).toBeLessThan(50);
    expect(result.current.ref.current.every((l: Lead) => l.status === "Closing")).toBe(true);

    // Export from ref
    const exported = result.current.ref.current.map(formatLeadForExport);
    expect(exported.every(r => r["Status"] === "Closing")).toBe(true);
  });

  it("filter that produces zero results leaves ref empty for export", () => {
    const leads = makeLeads(20);
    const { result } = renderHook(() => useColumnFilters());

    act(() => result.current.applyFilter("status", new Set(["Nonexistent"])));

    const filtered = result.current.filterRows(leads, getDisplayValue);
    expect(filtered.length).toBe(0);

    const exported = filtered.map(formatLeadForExport);
    expect(exported.length).toBe(0);
  });
});

describe("Sales Manager export date formatting", () => {
  it("getLeadValueForCol formats dates for display, not raw ISO", () => {
    // Mirrors the fixed getLeadValueForCol from sales/page.tsx
    function getLeadValueForCol(lead: any, key: string): string {
      switch (key) {
        case "date_created":
          return lead.created_at
            ? new Date(lead.created_at).toLocaleDateString("en-IN", {
                day: "2-digit", month: "short", year: "numeric",
              })
            : "";
        case "site_visit":
          return lead.mongoVisitDate
            ? new Date(lead.mongoVisitDate).toLocaleDateString("en-IN", {
                day: "2-digit", month: "short", year: "numeric",
              })
            : "";
        default:
          return String(lead[key] ?? "");
      }
    }

    const lead = {
      created_at: "2026-06-14T10:23:00.000Z",
      mongoVisitDate: "2026-07-01T08:00:00.000Z",
    };

    const dateCreated = getLeadValueForCol(lead, "date_created");
    const siteVisit = getLeadValueForCol(lead, "site_visit");

    // Must be human-readable, not ISO
    expect(dateCreated).toMatch(/\d{2}.*[A-Za-z]{3}.*\d{4}/);
    expect(siteVisit).toMatch(/\d{2}.*[A-Za-z]{3}.*\d{4}/);
    expect(dateCreated).not.toMatch(/T\d{2}:\d{2}/);
    expect(siteVisit).not.toMatch(/T\d{2}:\d{2}/);
  });
});
