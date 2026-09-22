import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { executeSQLInternal } from "../src/lib/sql-executor";
import { getSampleWorkspaceSeeder } from "../src/lib/server/sample-workspace-registry";
import { listFunnels } from "../src/lib/server/funnel-repo";
import { listRetentions } from "../src/lib/server/retention-repo";
import { listSegments } from "../src/lib/server/segment-repo";
import { getDataset } from "../src/lib/datasets";
import { compileRetentionSQL } from "../src/lib/retention-sql";

function loadEnv(f: string) {
  if (!existsSync(f)) return;
  for (const raw of readFileSync(f, "utf8").split(/\r?\n/)) {
    const l = raw.trim();
    if (!l || l.startsWith("#")) continue;
    const e = l.indexOf("=");
    if (e < 0) continue;
    const k = l.slice(0, e).trim();
    let v = l.slice(e + 1).trim().replace(/^export\s+/, "");
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv(resolve(".env"));
loadEnv(resolve(".env.local"));

const IDS = ["vastu-hfc", "fundsindia", "presto", "quickhelp", "healthians", "hdfc-creditfraud", "yesbank-cards", "flipkart-marketplace"];

async function curve(cfg: any, ds: string): Promise<string> {
  try {
    const sql = compileRetentionSQL(cfg, getDataset(ds));
    if (!sql) return "no-sql";
    const r = await executeSQLInternal(sql, ds);
    if (r.error) return "err:" + r.error.slice(0, 40);
    const coh = new Map<string, number>();
    const ret = new Map<number, number>();
    for (const row of r.rows as any[]) {
      const cd = String(row.cohort_date);
      const b = Number(row.day_bucket);
      if (!coh.has(cd)) coh.set(cd, Number(row.cohort_size) || 0);
      ret.set(b, (ret.get(b) || 0) + (Number(row.retained_users) || 0));
    }
    const tot = [...coh.values()].reduce((a, b) => a + b, 0);
    const buckets = [...ret.keys()].sort((a,b)=>a-b);
    return buckets.slice(0,7).map((b) => `${b}:${(100 * ret.get(b)! / Math.max(tot, 1)).toFixed(0)}%`).join(" ");
  } catch (e) {
    return "threw:" + (e instanceof Error ? e.message.slice(0, 40) : e);
  }
}

async function main() {
  for (const id of IDS) {
    const seeder = getSampleWorkspaceSeeder(id);
    if (!seeder) { console.log(`\n${id}: NO SEEDER`); continue; }
    const u = `final-review-${id}`;
    await seeder(u);
    console.log(`\n========== ${id} ==========`);
    console.log("FUNNELS:");
    for (const f of listFunnels(u, id)) console.log(`  ${String(f.overallConversion).padStart(6)}%  ${f.name}`);
    console.log("RETENTION (curve):");
    for (const r of listRetentions(u, id)) console.log(`  ${(await curve(r.config, id)).padEnd(34)} ${r.name}`);
    const segs = listSegments(u, id);
    console.log(`SEGMENTS: ${segs.length}, min ${Math.min(...segs.map((s) => s.userCount))}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
