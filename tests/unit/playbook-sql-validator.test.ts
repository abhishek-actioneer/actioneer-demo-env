import { describe, it, expect } from "vitest";
import { extractTablesFromPlaybookSQL } from "../../src/lib/server/playbook-sql-validator";

describe("extractTablesFromPlaybookSQL — table-function handling", () => {
  // Regression: greedy \w+ used to backtrack past the (?!\s*\() guard, matching a
  // truncated name ("generate_serie") out of "generate_series(", which the missing-table
  // check then rejected — breaking every cohort/window playbook that builds a month spine.
  it("does NOT treat generate_series(...) as a table", () => {
    expect(
      extractTablesFromPlaybookSQL(
        "SELECT m FROM generate_series(DATE '2024-06-01', DATE '2026-05-31', INTERVAL 1 MONTH) AS gs(m)",
      ),
    ).toEqual([]);
  });

  it("does NOT treat range(...)/unnest(...) as tables", () => {
    expect(extractTablesFromPlaybookSQL("SELECT i FROM range(0, 12) AS t(i)")).toEqual([]);
    expect(extractTablesFromPlaybookSQL("SELECT x FROM unnest([1,2,3]) AS t(x)")).toEqual([]);
  });

  it("still extracts real tables in FROM/JOIN, including quoted and schema-qualified", () => {
    expect(
      extractTablesFromPlaybookSQL("FROM orders o JOIN order_items oi ON o.id = oi.order_id"),
    ).toEqual(["orders", "order_items"]);
    expect(extractTablesFromPlaybookSQL('FROM "customers" c')).toEqual(["customers"]);
    expect(extractTablesFromPlaybookSQL("FROM main.sessions s")).toEqual(["sessions"]);
  });

  it("handles a real table joined against a table function in one query", () => {
    const sql =
      "SELECT * FROM generate_series(1, 12) AS m(n) CROSS JOIN orders o WHERE o.month = m.n";
    expect(extractTablesFromPlaybookSQL(sql)).toEqual(["orders"]);
  });

  // Regression: "FROM" inside EXTRACT/SUBSTRING/TRIM/OVERLAY is a keyword arg, not
  // a table source. The extractor used to read the column after it as a table.
  it("does NOT treat the column inside EXTRACT(... FROM col) as a table", () => {
    expect(
      extractTablesFromPlaybookSQL("SELECT EXTRACT(month FROM order_ts) AS m FROM orders"),
    ).toEqual(["orders"]);
    // including when the source is wrapped in a CAST/other function
    expect(
      extractTablesFromPlaybookSQL(
        "SELECT EXTRACT(year FROM CAST(signup_date AS DATE)) AS y FROM customers",
      ),
    ).toEqual(["customers"]);
  });

  it("does NOT treat SUBSTRING/TRIM operands as tables, but still finds the real table", () => {
    expect(
      extractTablesFromPlaybookSQL("SELECT SUBSTRING(name FROM 1 FOR 3) FROM sellers"),
    ).toEqual(["sellers"]);
    expect(
      extractTablesFromPlaybookSQL("SELECT TRIM(BOTH ' ' FROM seller_name) FROM sellers s"),
    ).toEqual(["sellers"]);
  });
});
