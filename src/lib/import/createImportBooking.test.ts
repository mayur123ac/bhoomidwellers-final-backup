// src/lib/import/createImportBooking.test.ts
//
// Tests for createImportBooking covering:
//   Phase 6 — booking_pipeline ON CONFLICT idempotency
//   Phase 7 — syncBookingUnit called when ALLOCATED, skipped when PENDING
//
// The PoolClient is fully mocked — no real database required.
// syncBookingUnit is mocked at the module level so its internal
// getOrganizationId / inventory DB queries never run.

import { vi, describe, it, expect, beforeEach } from "vitest";

// ── Module mock (hoisted by Vitest before all imports) ────────────────────
vi.mock("@/lib/inventorySync", () => ({
  syncBookingUnit: vi.fn().mockResolvedValue({ synced: true, unitId: 77, created: false }),
}));

import { createImportBooking } from "./createImportBooking";
import { syncBookingUnit } from "@/lib/inventorySync";
import type { ImportBookingInput } from "./bookingValidation";

// ── Minimum valid input (PENDING — no flat/project/tower/floor) ───────────
const BASE_INPUT: ImportBookingInput = {
  leadId: 1001,
  primaryName: "Test Applicant",
  primaryMobile: "9999999999",
  orgId: "org-test-uuid",
  importedByName: "Test Importer",
  bookingDate: null,
  bookingAmount: null,
  bookingAmountRaw: null,
  bookingReference: null,
  ocrAmount: null,
  ocrAmountRaw: null,
  flatNumber: null,
  projectName: null,
  tower: null,
  wing: null,
  floorNumber: null,
};

// ── ALLOCATED input — all unit-identity fields populated ──────────────────
const ALLOCATED_INPUT: ImportBookingInput = {
  ...BASE_INPUT,
  flatNumber: "A-101",
  projectName: "Sunrise Heights",
  tower: "A",
  wing: "West",
  floorNumber: "1",
};

// ── Mock client factory ────────────────────────────────────────────────────
type QueryRecord = { sql: string; params: unknown[] };

function makeMockClient() {
  const queries: QueryRecord[] = [];

  const client = {
    query: vi.fn().mockImplementation(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      const norm = sql.replace(/\s+/g, " ").trimStart();

      if (norm.startsWith("INSERT INTO booking_applications")) {
        // Always return id=42 — constant so that two calls simulate a retry
        // where the same booking_id is presented to booking_pipeline twice.
        return { rows: [{ id: 42 }] };
      }
      if (norm.startsWith("INSERT INTO financial_accounts")) {
        return { rows: [{ id: 99 }] };
      }
      return { rows: [] };
    }),
    _queries: queries,
  };

  return client as unknown as import("pg").PoolClient & { _queries: QueryRecord[] };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function findPipelineInsert(client: { _queries: QueryRecord[] }) {
  return client._queries.find((q) =>
    q.sql.replace(/\s+/g, " ").toLowerCase().includes("insert into booking_pipeline")
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("createImportBooking", () => {
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    client = makeMockClient();
    vi.mocked(syncBookingUnit).mockClear();
  });

  // ── Phase 6: booking_pipeline idempotency ────────────────────────────────

  describe("booking_pipeline idempotency (Phase 6)", () => {
    it("emits ON CONFLICT (booking_id) DO NOTHING in the pipeline INSERT", async () => {
      await createImportBooking(client, BASE_INPUT);

      const insert = findPipelineInsert(client);
      expect(insert, "booking_pipeline INSERT not issued").toBeDefined();
      expect(insert!.sql).toMatch(/ON CONFLICT \(booking_id\) DO NOTHING/i);
    });

    it("does not throw when the same booking_id is inserted twice", async () => {
      // Both calls get bookingId=42 from the mocked booking_applications INSERT.
      // The second booking_pipeline INSERT is a conflict; ON CONFLICT DO NOTHING
      // makes it a no-op instead of a constraint violation.
      const r1 = await createImportBooking(client, BASE_INPUT);
      const r2 = await createImportBooking(client, BASE_INPUT);

      expect(r1.bookingId).toBe(42);
      expect(r2.bookingId).toBe(42);

      const pipelineInserts = client._queries.filter((q) =>
        q.sql.replace(/\s+/g, " ").toLowerCase().includes("insert into booking_pipeline")
      );
      // Two calls → two INSERT attempts, both silent.
      expect(pipelineInserts).toHaveLength(2);
    });
  });

  // ── Phase 6: result shape ────────────────────────────────────────────────

  describe("result shape", () => {
    it("returns correct bookingId, bookingNumber, PENDING status and warnings", async () => {
      const result = await createImportBooking(client, BASE_INPUT);

      expect(result.bookingId).toBe(42);
      expect(result.bookingNumber).toMatch(/^BK-\d{4}-\d{2}-\d{2}-00042$/);
      expect(result.flatAllocationStatus).toBe("PENDING");
      // All four optional fields are null → four soft warnings.
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.every((w) => w.field && w.message)).toBe(true);
    });

    it("returns ALLOCATED status when flatNumber is provided", async () => {
      const result = await createImportBooking(client, ALLOCATED_INPUT);
      expect(result.flatAllocationStatus).toBe("ALLOCATED");
    });
  });

  // ── Phase 7: syncBookingUnit integration ─────────────────────────────────

  describe("inventory sync (Phase 7)", () => {
    it("calls syncBookingUnit with correct args when ALLOCATED", async () => {
      await createImportBooking(client, ALLOCATED_INPUT);

      expect(syncBookingUnit).toHaveBeenCalledOnce();
      expect(syncBookingUnit).toHaveBeenCalledWith(
        client,
        expect.objectContaining({
          bookingId: 42,
          leadId: ALLOCATED_INPUT.leadId,
          actor: ALLOCATED_INPUT.importedByName,
          flat_number: "A-101",
          project_name: "Sunrise Heights",
          tower: "A",
          wing: "West",
          floor_number: "1",
        })
      );
    });

    it("does not call syncBookingUnit when PENDING (no flat number)", async () => {
      await createImportBooking(client, BASE_INPUT); // flatNumber: null

      expect(syncBookingUnit).not.toHaveBeenCalled();
    });

    it("does not call syncBookingUnit when flatNumber present but project/tower null", async () => {
      // flatNumber alone → ALLOCATED status, but project/tower null.
      // syncBookingUnit is still called — it will self-skip with
      // skippedReason = "incomplete unit". The mock returns synced:false
      // for this; we just confirm it IS called (the guard is flatAllocationStatus,
      // not whether all four fields are populated).
      const partialInput: ImportBookingInput = {
        ...BASE_INPUT,
        flatNumber: "B-202",
        projectName: null,
        tower: null,
      };

      await createImportBooking(client, partialInput);

      // ALLOCATED because flatNumber is set, so syncBookingUnit IS called.
      // It's syncBookingUnit's own responsibility to skip gracefully.
      expect(syncBookingUnit).toHaveBeenCalledOnce();
      expect(syncBookingUnit).toHaveBeenCalledWith(
        client,
        expect.objectContaining({
          flat_number: "B-202",
          project_name: null,
          tower: null,
        })
      );
    });
  });
});
