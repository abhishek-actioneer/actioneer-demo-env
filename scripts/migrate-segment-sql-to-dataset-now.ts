/**
 * Migrate existing saved segment SQL to use the synthetic dataset_now anchor.
 *
 * Conservative regex-based rewriter — only touches well-known patterns:
 *   CURRENT_DATE        → (SELECT today FROM dataset_now)
 *   CURRENT_TIMESTAMP   → (SELECT now FROM dataset_now)
 *   now()               → (SELECT now FROM dataset_now)
 *
 * Hardcoded date literals like '2026-02-28' are LEFT ALONE — those are user
 * intent ("the segment of users who booked on Valentine's day 2026") and
 * shouldn't drift.
 *
 * Run: SYNTHETIC_DRY_RUN=1 npx tsx scripts/migrate-segment-sql-to-dataset-now.ts
 *      to preview changes without writing.
 *
 * Usage:
 *   npx tsx scripts/migrate-segment-sql-to-dataset-now.ts                # apply
 *   npx tsx scripts/migrate-segment-sql-to-dataset-now.ts quickhelp      # filter by datasetId
 *   SYNTHETIC_DRY_RUN=1 npx tsx scripts/migrate-segment-sql-to-dataset-now.ts
 */

import { getDb } from "../src/lib/meta-db";

interface Row {
  id: string;
  user_id: string;
  dataset_id: string | null;
  name: string;
  sql: string;
}

function rewrite(sql: string): { sql: string; changed: boolean } {
  let out = sql;
  let changed = false;
  const replacements: { from: RegExp; to: string }[] = [
    { from: /\bCURRENT_TIMESTAMP\b/gi, to: "(SELECT now FROM dataset_now)" },
    { from: /\bCURRENT_DATE\b/gi, to: "(SELECT today FROM dataset_now)" },
    { from: /\bnow\s*\(\s*\)/gi, to: "(SELECT now FROM dataset_now)" },
  ];
  for (const { from, to } of replacements) {
    if (from.test(out)) {
      out = out.replace(from, to);
      changed = true;
    }
  }
  return { sql: out, changed };
}

function main() {
  const datasetFilter = process.argv[2] ?? null;
  const dryRun = process.env.SYNTHETIC_DRY_RUN === "1";

  const db = getDb();
  const rows = (datasetFilter
    ? db.prepare(`SELECT id, user_id, dataset_id, name, sql FROM segments WHERE dataset_id = ?`).all(datasetFilter)
    : db.prepare(`SELECT id, user_id, dataset_id, name, sql FROM segments`).all()) as Row[];

  console.log(`Examining ${rows.length} segment${rows.length === 1 ? "" : "s"}${datasetFilter ? ` (dataset=${datasetFilter})` : ""}${dryRun ? " [DRY RUN]" : ""}`);

  const updateStmt = db.prepare(`UPDATE segments SET sql = ?, updated_at = ? WHERE id = ?`);
  let touched = 0;
  let unchanged = 0;
  const previews: string[] = [];

  for (const row of rows) {
    const { sql: newSql, changed } = rewrite(row.sql);
    if (!changed) {
      unchanged++;
      continue;
    }
    touched++;
    if (previews.length < 5) {
      previews.push(`--- ${row.name} (${row.id}) ---\nBEFORE: ${row.sql.slice(0, 200)}\nAFTER:  ${newSql.slice(0, 200)}`);
    }
    if (!dryRun) {
      updateStmt.run(newSql, new Date().toISOString(), row.id);
    }
  }

  console.log(`\nResults: ${touched} rewritten, ${unchanged} unchanged`);
  if (previews.length > 0) {
    console.log("\nFirst few changes:\n");
    console.log(previews.join("\n\n"));
  }
  if (dryRun) console.log("\n(Dry run — no writes made. Re-run without SYNTHETIC_DRY_RUN=1 to apply.)");
}

main();
