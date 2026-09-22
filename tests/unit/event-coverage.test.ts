/**
 * Event/table coverage test.
 *
 * Three sets of assertions per static dataset (presto, vastu-hfc, fundsindia):
 *
 * 1. EVENTS-TABLE COVERAGE
 *    Every EventDefinition.table in events[] must appear in schemaContext as a
 *    declared TABLE or VIEW. The schemaContext is the authoritative LLM schema
 *    reference, so any table the event catalog queries must be documented there.
 *
 * 2. SETUP-SQL COMPLETENESS
 *    Every table/view created by viewSQL or summaryTableSQL must be declared in
 *    schemaContext. If we create a view but don't document it, SQL generation
 *    will silently miss it.
 *
 * 3. NO DUPLICATE EVENT IDs
 *    Event IDs must be unique within each dataset.
 *
 * No DB connections are opened — pure config/schema consistency.
 */

import { describe, it, expect } from "vitest";
import { prestoDataset } from "@/lib/datasets/presto";
import { vastuHfcDataset } from "@/lib/datasets/vastu-hfc";
import { fundsindiaDataset } from "@/lib/datasets/fundsindia";
import type { DatasetConfig } from "@/lib/datasets/types";

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * Pull every TABLE / VIEW name out of a schemaContext string.
 * Matches lines of the form:
 *   "TABLE: foo_bar"  /  "TABLE: foo_bar (~N rows ...)"
 *   "VIEW: foo_bar"   /  "VIEW: foo_bar (~N rows, ...)"
 *
 * Handles optional leading whitespace and optional inline comments after
 * the identifier.
 */
function extractSchemaTableNames(schemaContext: string): Set<string> {
  const names = new Set<string>();
  for (const line of schemaContext.split("\n")) {
    const m = line.match(/^\s*(?:TABLE|VIEW):\s*([a-z_][a-z0-9_]*)/i);
    if (m) names.add(m[1].toLowerCase());
  }
  return names;
}

/**
 * Extract CREATE OR REPLACE VIEW/TABLE names from a list of SQL strings.
 * These are the tables/views that the dataset actually creates.
 */
function extractSetupSqlTableNames(sqlStatements: string[]): Set<string> {
  const names = new Set<string>();
  for (const sql of sqlStatements) {
    // "CREATE OR REPLACE VIEW foo_bar AS ..."
    // "CREATE OR REPLACE TABLE foo_bar AS ..."
    const m = sql.match(/CREATE\s+OR\s+REPLACE\s+(?:VIEW|TABLE)\s+([a-z_][a-z0-9_]*)/i);
    if (m) names.add(m[1].toLowerCase());
  }
  return names;
}

/**
 * Get setup SQL statements. viewSQL is a function that returns strings.
 * We pass a dummy dataDir since we only need the CREATE statement names.
 */
function getSetupSqlStatements(ds: DatasetConfig): string[] {
  const stmts: string[] = [];
  if (ds.viewSQL) {
    stmts.push(...ds.viewSQL("dummy_data_dir"));
  }
  if (ds.summaryTableSQL) {
    stmts.push(...ds.summaryTableSQL);
  }
  return stmts;
}

/**
 * Extract all .table references from events[].
 */
function extractEventTableRefs(ds: DatasetConfig): Set<string> {
  const refs = new Set<string>();
  for (const ev of ds.events ?? []) {
    refs.add(ev.table.toLowerCase());
  }
  return refs;
}

// ── datasets under test ──────────────────────────────────────────────────────

const STATIC_DATASETS: DatasetConfig[] = [
  prestoDataset,
  vastuHfcDataset,
  fundsindiaDataset,
];

// ── Test Suite 1: events[].table → schemaContext ─────────────────────────────

describe("event-coverage: events[].table fields resolve to tables declared in schemaContext", () => {
  for (const ds of STATIC_DATASETS) {
    it(`[${ds.id}] all event table references are documented in schemaContext`, () => {
      const definedInSchema = extractSchemaTableNames(ds.schemaContext);
      const eventTableRefs = extractEventTableRefs(ds);

      const dangling: string[] = [];
      for (const ref of eventTableRefs) {
        if (!definedInSchema.has(ref)) {
          dangling.push(ref);
        }
      }
      dangling.sort();

      expect(
        dangling,
        `Dataset "${ds.id}" has events[] referencing tables not documented in schemaContext: ${dangling.join(", ")}`,
      ).toEqual([]);
    });
  }
});

// ── Test Suite 2: setup SQL tables → schemaContext ───────────────────────────

/**
 * Every table/view created by viewSQL or summaryTableSQL should be declared in
 * schemaContext so the LLM can query it. Missing entries mean the SQL generator
 * cannot produce correct queries against those objects.
 *
 * Exception: "raw_*" tables/views are intentionally omitted from schemaContext
 * in some datasets because they are considered internal implementation details
 * that the LLM should avoid querying directly (it's directed to use the
 * denormalized views instead). We skip raw_ names from this check.
 */
describe("event-coverage: viewSQL/summaryTableSQL objects are documented in schemaContext", () => {
  for (const ds of STATIC_DATASETS) {
    it(`[${ds.id}] all created views/tables appear in schemaContext`, () => {
      const definedInSchema = extractSchemaTableNames(ds.schemaContext);
      const setupNames = extractSetupSqlTableNames(getSetupSqlStatements(ds));

      const dangling: string[] = [];
      for (const name of setupNames) {
        // Skip raw_ tables — these are intentionally internal in some datasets
        if (name.startsWith("raw_")) continue;
        if (!definedInSchema.has(name)) {
          dangling.push(name);
        }
      }
      dangling.sort();

      expect(
        dangling,
        `Dataset "${ds.id}" creates tables/views not documented in schemaContext: ${dangling.join(", ")}`,
      ).toEqual([]);
    });
  }
});

// ── Test Suite 3: no duplicate event IDs ─────────────────────────────────────

describe("event-coverage: no duplicate event IDs within a dataset", () => {
  for (const ds of STATIC_DATASETS) {
    it(`[${ds.id}] event IDs are unique`, () => {
      const events = ds.events ?? [];
      const seen = new Set<string>();
      const duplicates: string[] = [];
      for (const ev of events) {
        if (seen.has(ev.id)) duplicates.push(ev.id);
        seen.add(ev.id);
      }
      expect(
        duplicates,
        `Dataset "${ds.id}" has duplicate event IDs: ${duplicates.join(", ")}`,
      ).toEqual([]);
    });
  }
});

// ── Test Suite 4: schemaContext declares a primary table ─────────────────────

describe("event-coverage: dataset primaryTable is declared in schemaContext", () => {
  for (const ds of STATIC_DATASETS) {
    it(`[${ds.id}] primaryTable "${ds.primaryTable}" appears in schemaContext`, () => {
      const definedInSchema = extractSchemaTableNames(ds.schemaContext);
      expect(
        definedInSchema.has(ds.primaryTable.toLowerCase()),
        `Dataset "${ds.id}" primaryTable "${ds.primaryTable}" not found in schemaContext`,
      ).toBe(true);
    });
  }
});
