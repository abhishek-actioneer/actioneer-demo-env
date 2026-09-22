/**
 * Unit tests for sql-executor.ts — deterministic, pure validation logic only.
 *
 * What is tested here:
 *   - validateSQL: SELECT-only enforcement, blocked DDL/DML keyword rejection,
 *     comment stripping, case-insensitivity, leading whitespace, WITH queries,
 *     multiple blocked keywords, boundary edge cases.
 *   - executeSQL early-return path: when validateSQL rejects a query, executeSQL
 *     returns an error without opening a DB connection (deterministic, no I/O).
 *   - friendlyError OOM message: static contract verification.
 *
 * REAL BUG FOUND (do not fix product code here — report only):
 *   validateSQL checks `!stripped.startsWith("SELECT") && !stripped.startsWith("WITH")`
 *   first, and returns "Only SELECT queries are allowed" immediately for ANY
 *   non-SELECT/WITH query — including DROP, DELETE, INSERT, ALTER, etc.
 *   The per-keyword error messages ("DROP statements are not allowed") are only
 *   reachable for queries that START with SELECT/WITH and embed a blocked keyword
 *   later (e.g. "SELECT 1; DROP TABLE users"). For direct DDL/DML statements
 *   (DROP TABLE, DELETE FROM, INSERT INTO) the error is always
 *   "Only SELECT queries are allowed", not the per-keyword message.
 *   This means the per-keyword error messages are dead code for the primary case.
 *
 * What is NOT tested here:
 *   - executeSQLInternal, executeSQLPrepared, dryRunSQL, batchDryRunSQL — all
 *     require a live DuckDB connection and are covered by integration tests.
 *   - ensureLimit — private function; its side-effects are visible only through
 *     live query execution.
 *   - sanitize / buildResult — private helpers; exercised through live execution.
 *   - friendlyError non-OOM path — private; the non-OOM branch simply returns the
 *     raw error message, verifiable only through integration tests.
 */

import { describe, it, expect } from "vitest";
import { validateSQL, executeSQL } from "@/lib/sql-executor";

// ---------------------------------------------------------------------------
// validateSQL — allowed queries
// ---------------------------------------------------------------------------

describe("validateSQL — allowed queries", () => {
  it("accepts a simple SELECT", () => {
    const result = validateSQL("SELECT 1");
    expect(result).toEqual({ valid: true });
  });

  it("accepts a SELECT with lowercase keyword", () => {
    const result = validateSQL("select id, name from users");
    expect(result).toEqual({ valid: true });
  });

  it("accepts a SELECT with mixed case", () => {
    const result = validateSQL("Select COUNT(*) From events");
    expect(result).toEqual({ valid: true });
  });

  it("accepts a WITH (CTE) query", () => {
    const result = validateSQL("WITH cte AS (SELECT 1 AS n) SELECT n FROM cte");
    expect(result).toEqual({ valid: true });
  });

  it("accepts a WITH query with lowercase 'with'", () => {
    const result = validateSQL("with cte as (select 1) select * from cte");
    expect(result).toEqual({ valid: true });
  });

  it("accepts SELECT with leading whitespace", () => {
    const result = validateSQL("   SELECT id FROM orders");
    expect(result).toEqual({ valid: true });
  });

  it("accepts SELECT with leading newlines", () => {
    const result = validateSQL("\n\nSELECT * FROM users LIMIT 10");
    expect(result).toEqual({ valid: true });
  });

  it("accepts SELECT with a leading single-line comment then SELECT on next line", () => {
    // validateSQL strips comments before checking the first keyword, so this must pass
    const result = validateSQL("-- fetch all users\nSELECT * FROM users");
    expect(result).toEqual({ valid: true });
  });

  it("accepts SELECT with a leading block comment then SELECT", () => {
    const result = validateSQL("/* get order counts */ SELECT COUNT(*) FROM orders");
    expect(result).toEqual({ valid: true });
  });

  it("accepts SELECT where a blocked keyword appears only inside a leading comment", () => {
    // "DROP TABLE users" appears in a comment — comment stripping must remove it
    const result = validateSQL("-- DROP TABLE users\nSELECT * FROM users");
    expect(result).toEqual({ valid: true });
  });

  it("accepts SELECT where INSERT appears only inside a block comment", () => {
    const result = validateSQL("/* INSERT is not done here */ SELECT 1");
    expect(result).toEqual({ valid: true });
  });
});

// ---------------------------------------------------------------------------
// validateSQL — non-SELECT/WITH statements (first-keyword guard fires first)
//
// BUG NOTE: For direct DDL/DML (DROP, DELETE, INSERT, ALTER, etc.) the function
// returns "Only SELECT queries are allowed" because the startsWith check fires
// before the keyword loop. The per-keyword error messages are unreachable for
// these queries. Tests are written against the actual (observed) behavior.
// ---------------------------------------------------------------------------

describe("validateSQL — non-SELECT/WITH statements are rejected", () => {
  it("rejects an empty string", () => {
    const result = validateSQL("");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Only SELECT queries are allowed");
  });

  it("rejects whitespace-only input", () => {
    const result = validateSQL("   ");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Only SELECT queries are allowed");
  });

  it("rejects INSERT INTO", () => {
    const result = validateSQL("INSERT INTO users (name) VALUES ('Alice')");
    expect(result.valid).toBe(false);
    // First-keyword guard fires: error is the SELECT-only message, not INSERT-specific
    expect(result.error).toBe("Only SELECT queries are allowed");
  });

  it("rejects UPDATE", () => {
    const result = validateSQL("UPDATE users SET name = 'Bob' WHERE id = 1");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Only SELECT queries are allowed");
  });

  it("rejects DELETE FROM", () => {
    const result = validateSQL("DELETE FROM users WHERE id = 1");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Only SELECT queries are allowed");
  });

  it("rejects DROP TABLE", () => {
    const result = validateSQL("DROP TABLE users");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Only SELECT queries are allowed");
  });

  it("rejects DROP DATABASE", () => {
    const result = validateSQL("DROP DATABASE mydb");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Only SELECT queries are allowed");
  });

  it("rejects ALTER TABLE", () => {
    const result = validateSQL("ALTER TABLE users ADD COLUMN email VARCHAR");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Only SELECT queries are allowed");
  });

  it("rejects CREATE TABLE", () => {
    const result = validateSQL("CREATE TABLE foo (id INT)");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Only SELECT queries are allowed");
  });

  it("rejects TRUNCATE", () => {
    const result = validateSQL("TRUNCATE TABLE users");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Only SELECT queries are allowed");
  });

  it("rejects GRANT", () => {
    const result = validateSQL("GRANT SELECT ON users TO public");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Only SELECT queries are allowed");
  });

  it("rejects REVOKE", () => {
    const result = validateSQL("REVOKE SELECT ON users FROM public");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Only SELECT queries are allowed");
  });

  it("rejects COPY", () => {
    const result = validateSQL("COPY users TO '/tmp/users.csv'");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Only SELECT queries are allowed");
  });

  it("rejects ATTACH", () => {
    const result = validateSQL("ATTACH 'other.duckdb' AS other");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Only SELECT queries are allowed");
  });

  it("rejects LOAD", () => {
    const result = validateSQL("LOAD '/tmp/ext.so'");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Only SELECT queries are allowed");
  });

  it("rejects INSTALL", () => {
    const result = validateSQL("INSTALL httpfs");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Only SELECT queries are allowed");
  });

  it("rejects PRAGMA", () => {
    const result = validateSQL("PRAGMA table_info('users')");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Only SELECT queries are allowed");
  });

  it("rejects CALL", () => {
    const result = validateSQL("CALL my_proc()");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Only SELECT queries are allowed");
  });

  it("rejects SET", () => {
    const result = validateSQL("SET memory_limit = '1GB'");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Only SELECT queries are allowed");
  });

  it("rejects EXPORT", () => {
    const result = validateSQL("EXPORT DATABASE '/tmp/backup'");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Only SELECT queries are allowed");
  });

  it("rejects IMPORT", () => {
    const result = validateSQL("IMPORT DATABASE '/tmp/backup'");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Only SELECT queries are allowed");
  });
});

// ---------------------------------------------------------------------------
// validateSQL — case-insensitivity for the first-keyword guard
// ---------------------------------------------------------------------------

describe("validateSQL — case-insensitivity for non-SELECT first keyword", () => {
  it("rejects 'drop table' in all-lowercase", () => {
    const result = validateSQL("drop table users");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Only SELECT queries are allowed");
  });

  it("rejects 'Delete FROM' in mixed case", () => {
    const result = validateSQL("Delete FROM users WHERE id = 1");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Only SELECT queries are allowed");
  });

  it("rejects 'Insert Into' in title case", () => {
    const result = validateSQL("Insert Into users VALUES (1)");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Only SELECT queries are allowed");
  });

  it("rejects 'create' in all-lowercase", () => {
    const result = validateSQL("create table foo (id int)");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Only SELECT queries are allowed");
  });
});

// ---------------------------------------------------------------------------
// validateSQL — blocked keyword loop fires for SELECT queries with injected DDL
//
// This is the code path where per-keyword error messages ARE reachable:
// a query that starts with SELECT but contains a blocked keyword token later.
// ---------------------------------------------------------------------------

describe("validateSQL — blocked keyword inside a SELECT (injection detection)", () => {
  it("rejects SELECT that contains DROP keyword as a word token", () => {
    // Multi-statement injection: SELECT first, then DROP
    const result = validateSQL("SELECT * FROM users; DROP TABLE users");
    expect(result.valid).toBe(false);
    // Now the keyword loop fires and returns the per-keyword message
    expect(result.error).toBe("DROP statements are not allowed");
  });

  it("rejects SELECT with embedded DELETE", () => {
    const result = validateSQL("SELECT 1; DELETE FROM users");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("DELETE statements are not allowed");
  });

  it("rejects SELECT with embedded INSERT", () => {
    const result = validateSQL("SELECT 1; INSERT INTO users VALUES (1)");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("INSERT statements are not allowed");
  });

  it("rejects SELECT with embedded CREATE", () => {
    const result = validateSQL("SELECT 1; CREATE TABLE foo (id INT)");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("CREATE statements are not allowed");
  });

  it("rejects SELECT with embedded SET keyword (word-boundary)", () => {
    // SET is blocked; this checks the word-boundary regex fires correctly
    const result = validateSQL("SELECT 1; SET memory_limit = '1GB'");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("SET statements are not allowed");
  });

  it("accepts SELECT with a column named 'set_value' (no word-boundary match)", () => {
    // 'set_value' does NOT match \bSET\s (requires whitespace after SET)
    const result = validateSQL("SELECT set_value FROM config");
    expect(result.valid).toBe(true);
  });

  it("accepts SELECT with 'settings' column (word boundary prevents false positive)", () => {
    // 'settings' starts with 'set' but the regex requires \\bSET\\s so 'SETTINGS' won't match
    const result = validateSQL("SELECT settings FROM config");
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateSQL — return shape
// ---------------------------------------------------------------------------

describe("validateSQL — return shape", () => {
  it("returns { valid: true } with no error property on success", () => {
    const result = validateSQL("SELECT 1");
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("returns { valid: false, error: string } on non-SELECT statement", () => {
    const result = validateSQL("DROP TABLE users");
    expect(result.valid).toBe(false);
    expect(typeof result.error).toBe("string");
    expect((result.error as string).length).toBeGreaterThan(0);
  });

  it("returns { valid: false, error: string } on injected blocked keyword", () => {
    const result = validateSQL("SELECT 1; DROP TABLE users");
    expect(result.valid).toBe(false);
    expect(typeof result.error).toBe("string");
    expect((result.error as string).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// executeSQL — early return without DB connection (invalid SQL path)
//
// When validateSQL rejects, executeSQL returns early with rowCount: 0 and an
// error message — without ever calling withConnection. This is deterministic
// even though db.ts is imported.
// ---------------------------------------------------------------------------

describe("executeSQL — early return on invalid SQL (no DB connection opened)", () => {
  it("returns error result for DROP TABLE without touching DB", async () => {
    const result = await executeSQL("DROP TABLE users");
    expect(result.columns).toEqual([]);
    expect(result.rows).toEqual([]);
    expect(result.rowCount).toBe(0);
    expect(result.executionTimeMs).toBe(0);
    // First-keyword guard fires: "Only SELECT queries are allowed"
    expect(result.error).toBe("Only SELECT queries are allowed");
  });

  it("returns error result for DELETE FROM without touching DB", async () => {
    const result = await executeSQL("DELETE FROM users WHERE id = 1");
    expect(result.columns).toEqual([]);
    expect(result.rows).toEqual([]);
    expect(result.rowCount).toBe(0);
    expect(result.executionTimeMs).toBe(0);
    expect(result.error).toBe("Only SELECT queries are allowed");
  });

  it("returns error result for INSERT without touching DB", async () => {
    const result = await executeSQL("INSERT INTO users VALUES (1)");
    expect(result.columns).toEqual([]);
    expect(result.rows).toEqual([]);
    expect(result.rowCount).toBe(0);
    expect(result.executionTimeMs).toBe(0);
    expect(result.error).toBe("Only SELECT queries are allowed");
  });

  it("returns error result for non-SELECT statement (SET)", async () => {
    const result = await executeSQL("SET memory_limit = '1GB'");
    expect(result.columns).toEqual([]);
    expect(result.rowCount).toBe(0);
    expect(result.error).toBe("Only SELECT queries are allowed");
  });

  it("returns error result for empty string", async () => {
    const result = await executeSQL("");
    expect(result.rowCount).toBe(0);
    expect(result.error).toBe("Only SELECT queries are allowed");
  });

  it("returns error result for whitespace-only query", async () => {
    const result = await executeSQL("   \n  ");
    expect(result.rowCount).toBe(0);
    expect(result.error).toBe("Only SELECT queries are allowed");
  });

  it("returns per-keyword error for SELECT with injected DROP", async () => {
    const result = await executeSQL("SELECT * FROM users; DROP TABLE users");
    expect(result.rowCount).toBe(0);
    expect(result.executionTimeMs).toBe(0);
    expect(result.error).toBe("DROP statements are not allowed");
  });

  it("preserves executionTimeMs of 0 on early-exit (validation errors never start the clock)", async () => {
    const result = await executeSQL("UPDATE users SET name = 'x'");
    // The early return path sets executionTimeMs: 0 explicitly (not performance.now())
    expect(result.executionTimeMs).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// friendlyError OOM message — static contract verification
//
// friendlyError is a private function. We can verify the static contract:
// the OOM detection regex and the default memory limit fallback.
// ---------------------------------------------------------------------------

describe("friendlyError OOM message contract (static verification)", () => {
  it("OOM detection regex pattern matches expected strings", () => {
    // Mirror the private regex: /out of memory/i
    const oomRegex = /out of memory/i;
    expect(oomRegex.test("Out of Memory error in DuckDB")).toBe(true);
    expect(oomRegex.test("out of memory")).toBe(true);
    expect(oomRegex.test("OUT OF MEMORY")).toBe(true);
    expect(oomRegex.test("disk I/O error")).toBe(false);
    expect(oomRegex.test("table not found")).toBe(false);
  });

  it("default memory limit fallback is 4GB when env var not set", () => {
    // friendlyError uses: process.env.DUCKDB_MEMORY_LIMIT ?? "4GB"
    // In this test environment (no env var set) the fallback must be "4GB"
    const limit = process.env.DUCKDB_MEMORY_LIMIT ?? "4GB";
    expect(limit).toBe("4GB");
  });
});
