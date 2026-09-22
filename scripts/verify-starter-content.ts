/**
 * Phase D — starter-content verification for the verify-dataset skill.
 *
 * The NL/playbook battery never exercises the "Generate Starter ___" buttons, so a
 * dataset can pass every other phase while its knowledge/metrics/funnel/retention/
 * segment generation is broken (how the Credit Risk knowledge failure shipped).
 * This harness closes that gap: for each dataset it asserts the curated files exist
 * and that the seeded content is valid and realistic.
 *
 *   npx tsx scripts/verify-starter-content.ts              # all registered seeded datasets
 *   npx tsx scripts/verify-starter-content.ts hdfc-creditfraud
 *
 * Checks per dataset:
 *   - knowledge.json exists, is an array, >= 10 entries
 *   - metrics.json exists, {metrics:[...]}, and every metric's valueSql executes
 *   - seeder runs and produces exactly 3 funnels (each conversion not null, not ~0%/~100%),
 *     3 retentions (d7 not null), and segments that are all >= 1000 members
 *
 * Exit code is non-zero if any dataset fails — wire into CI / pre-ship.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { executeSQLInternal } from "../src/lib/sql-executor";
import { getSampleWorkspaceSeeder } from "../src/lib/server/sample-workspace-registry";
import { listFunnels } from "../src/lib/server/funnel-repo";
import { listRetentions } from "../src/lib/server/retention-repo";
import { listSegments } from "../src/lib/server/segment-repo";

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

const ALL = [
  "vastu-hfc", "fundsindia", "presto", "quickhelp",
  "healthians", "hdfc-creditfraud", "yesbank-cards", "flipkart-marketplace",
];
const MIN_SEGMENT = 1000;
const MIN_KNOWLEDGE = 10;

async function verify(ds: string): Promise<string[]> {
  const fails: string[] = [];
  const dir = join("data/datasets", ds);

  // 1. knowledge.json
  const kPath = join(dir, "knowledge.json");
  if (!existsSync(kPath)) fails.push("missing knowledge.json");
  else {
    const k = JSON.parse(readFileSync(kPath, "utf8"));
    if (!Array.isArray(k)) fails.push("knowledge.json is not an array");
    else if (k.length < MIN_KNOWLEDGE) fails.push(`knowledge.json has only ${k.length} entries (< ${MIN_KNOWLEDGE})`);
  }

  // 2. metrics.json — every valueSql must execute
  const mPath = join(dir, "metrics.json");
  if (!existsSync(mPath)) fails.push("missing metrics.json");
  else {
    const raw = JSON.parse(readFileSync(mPath, "utf8"));
    const metrics = Array.isArray(raw) ? raw : raw.metrics;
    if (!Array.isArray(metrics) || metrics.length === 0) fails.push("metrics.json has no metrics");
    else for (const m of metrics) {
      const r = await executeSQLInternal(m.valueSql, ds);
      if (r.error) fails.push(`metric ${m.id} valueSql failed: ${r.error.slice(0, 80)}`);
    }
  }

  // 3. seeded funnels / retention / segments
  const seeder = getSampleWorkspaceSeeder(ds);
  if (!seeder) {
    fails.push("no registered seeder (or SEED_SAMPLE_WORKSPACE_CONTENT is off)");
  } else {
    const u = `verify-starter-${ds}`;
    await seeder(u);
    const fns = listFunnels(u, ds), rts = listRetentions(u, ds), segs = listSegments(u, ds);
    if (fns.length !== 3) fails.push(`expected 3 funnels, got ${fns.length}`);
    for (const f of fns) {
      const c = f.overallConversion;
      if (c == null) fails.push(`funnel "${f.name}" conversion is null (broken)`);
      else if (c <= 0.1 || c >= 99.9) fails.push(`funnel "${f.name}" conversion ${c}% looks absurd`);
    }
    if (rts.length !== 3) fails.push(`expected 3 retentions, got ${rts.length}`);
    for (const r of rts) if (r.d7Retention == null) fails.push(`retention "${r.name}" d7 is null (broken)`);
    if (segs.length === 0) fails.push("no segments seeded");
    for (const s of segs) if (s.userCount < MIN_SEGMENT) fails.push(`segment "${s.name}" has ${s.userCount} members (< ${MIN_SEGMENT})`);
  }
  return fails;
}

async function main() {
  const arg = process.argv[2];
  const datasets = arg ? [arg] : ALL;
  let anyFail = false;
  for (const ds of datasets) {
    const fails = await verify(ds);
    if (fails.length === 0) {
      console.log(`✓ ${ds}: PASS`);
    } else {
      anyFail = true;
      console.log(`✗ ${ds}: ${fails.length} issue(s)`);
      for (const f of fails) console.log(`    - ${f}`);
    }
  }
  console.log(anyFail ? "\nFAIL — starter content has issues." : "\nPASS — all starter content is valid.");
  process.exit(anyFail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
