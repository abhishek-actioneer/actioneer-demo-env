/**
 * Clears all synthetic workspace content (chats, playbooks, funnels, retentions,
 * segments) from the meta-db so workspaces start as a clean slate. Metrics are
 * NOT touched (they live in data/datasets/<id>/metrics.json, not this db).
 *
 * Run:  npx tsx scripts/clear-workspace-content.ts
 */
import Database from "better-sqlite3";
import { resolve } from "node:path";

const DB_PATH = process.env.SENTINEL_META_DB_PATH?.trim()
  ? resolve(process.env.SENTINEL_META_DB_PATH.trim())
  : resolve(process.cwd(), "data/sentinel-meta.sqlite");

const TABLES = ["conversations", "playbooks", "funnels", "retentions", "segments"];

const db = new Database(DB_PATH);
console.log(`Meta-db: ${DB_PATH}\n`);

const existing = new Set(
  (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(
    (r) => r.name,
  ),
);

let total = 0;
for (const t of TABLES) {
  if (!existing.has(t)) {
    console.log(`${t}: (table not found, skipped)`);
    continue;
  }
  const before = (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  db.prepare(`DELETE FROM ${t}`).run();
  const after = (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  total += before;
  console.log(`${t}: ${before} -> ${after}`);
}

db.close();
console.log(`\nCleared ${total} rows. Metrics untouched.`);
