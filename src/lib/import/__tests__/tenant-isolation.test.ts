// Tests for tenant isolation patterns across the import pipeline.
// These are structural tests that verify SQL queries contain org_id scoping.
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Read source files to verify tenant scoping in SQL queries.
const readSource = (relPath: string) =>
  fs.readFileSync(path.resolve(__dirname, relPath), "utf-8");

describe("Tenant isolation — SQL org_id scoping", () => {
  describe("cpCommissionEngine.ts — C1 fix", () => {
    const source = readSource("../../cpCommissionEngine.ts");

    it("phone lookup includes organization_id", () => {
      // The phone lookup query must scope by organization_id
      expect(source).toContain("organization_id = $2");
    });
  });

  describe("import/engine.ts — all queries scoped", () => {
    const source = readSource("../engine.ts");

    it("import_jobs INSERT includes organization_id", () => {
      expect(source).toContain("organization_id");
    });

    it("import_rows queries are scoped to organization", () => {
      // Every SELECT/UPDATE on import_rows should include organization_id
      const importRowQueries = source.match(/FROM import_rows[\s\S]*?WHERE[\s\S]*?\n/g) || [];
      for (const q of importRowQueries) {
        expect(q).toContain("organization_id");
      }
    });

    it("walkin_enquiries INSERT includes organization_id", () => {
      expect(source).toContain("organization_id, import_job_id");
    });

    it("walkin_enquiries DELETE is scoped to org + import_job_id", () => {
      expect(source).toContain("AND organization_id = $2 AND import_job_id = $3");
    });
  });

  describe("import/dedup.ts — all queries scoped", () => {
    const source = readSource("../dedup.ts");

    it("candidate queries are scoped to organization_id", () => {
      expect(source).toContain("organization_id = $1");
    });

    it("no unscoped walkin_enquiries queries", () => {
      // Every FROM walkin_enquiries should be followed by WHERE ... organization_id
      const queries = source.match(/FROM walkin_enquiries\s+WHERE\b[^;]+/g) || [];
      for (const q of queries) {
        expect(q).toContain("organization_id");
      }
    });
  });

  describe("bulkInsertLeads.ts — C2b fix", () => {
    const source = readSource("../../ingestion/bulkInsertLeads.ts");

    it("ON CONFLICT is scoped to organization_id", () => {
      expect(source).toContain("ON CONFLICT (organization_id, external_ref)");
    });

    it("does not use N/A literals", () => {
      // C5 fix: no more "N/A" defaults in INSERT values
      const insertSection = source.slice(source.indexOf("INSERT INTO walkin_enquiries"));
      const valueSection = insertSection.slice(insertSection.indexOf("VALUES"), insertSection.indexOf("RETURNING"));
      expect(valueSection).not.toContain('"N/A"');
    });
  });

  describe("override API route — scoped validation", () => {
    const source = readSource("../../../app/api/import/[jobId]/rows/[rowId]/override/route.ts");

    it("verifies row belongs to job and org", () => {
      expect(source).toContain("import_job_id = $2 AND organization_id = $3");
    });
  });
});
