/**
 * verify-dataset.ts — reusable dataset cohesion verifier (drives the verify-dataset skill).
 *
 * Phases:
 *   0  Build the DuckDB (first query) + introspect column types (boolean parsing).
 *   A  Auto-generated STRUCTURAL battery from the live schema — table counts,
 *      boolean-type checks, low-cardinality group-bys, and foreign-key joins.
 *      No LLM; this is the deterministic "shouldn't break" floor.
 *   B  Natural-language queries at L1/L2/L3 complexity through the real
 *      generateQueries → executeSQL pipeline. Surfaces missing/stale events and
 *      schema-context gaps.
 *   C  Complex PLAYBOOK generations through the real runPlaybookGeneration core
 *      (outline → detail → SQL validate/repair). Catches dry-run / repair failures.
 *
 * Per-dataset prompts + playbooks live in scripts/verify-specs/<datasetId>.ts.
 *
 * Usage:
 *   npx tsx scripts/verify-dataset.ts <datasetId> [--sample] [--no-llm]
 *       [--prompts=N] [--playbooks=M] [--nl-concurrency=4] [--pb-concurrency=3]
 *   --sample : quick smoke (5 NL per tier + 2 playbooks) to prove the mechanism.
 *
 * Requires (Phases B/C): OPENAI_API_KEY in .env.local
 */
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { executeSQL } from "../src/lib/sql-executor";
import { generateQueries } from "../src/lib/sql-generator";
import { runPlaybookGeneration } from "../src/app/api/playbook/create/route";
import { getDataset } from "../src/lib/datasets";

export interface VerifySpec {
  datasetId: string;
  label: string;
  /** Optional hand-written structural SQL (added to the auto-generated battery). */
  structural?: { label: string; sql: string }[];
  L1: string[];
  L2: string[];
  L3: string[];
  playbooks: string[];
}

// ── args ──
const args = process.argv.slice(2);
const datasetId = args.find((a) => !a.startsWith("--"));
if (!datasetId) { console.error("usage: verify-dataset <datasetId> [--sample] [--no-llm] [--prompts=N] [--playbooks=M]"); process.exit(2); }
const flag = (name: string) => args.includes(`--${name}`);
const num = (name: string, d: number) => { const v = args.find((a) => a.startsWith(`--${name}=`)); return v ? Number(v.split("=")[1]) : d; };
const SAMPLE = flag("sample");
const NO_LLM = flag("no-llm");
const NL_CONC = num("nl-concurrency", 4);
const PB_CONC = num("pb-concurrency", 3);

function loadEnvFile(p: string) {
  if (!existsSync(p)) return;
  for (const raw of readFileSync(p, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^export\s+/, "").replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
}
loadEnvFile(resolve(".env"));
loadEnvFile(resolve(".env.local"));

interface Rec { phase: string; tier?: string; label: string; detail: string; sql?: string }
const fails: Rec[] = [];
const warns: Rec[] = [];

async function pMap<T>(items: T[], conc: number, fn: (x: T, i: number) => Promise<void>) {
  let idx = 0;
  const workers = Array.from({ length: Math.min(conc, items.length) }, async () => {
    while (idx < items.length) { const i = idx++; await fn(items[i], i); }
  });
  await Promise.all(workers);
}

// ── Phase A: auto-generate a structural battery from the live schema ──
async function buildStructuralBattery(ds: ReturnType<typeof getDataset>): Promise<{ label: string; sql: string }[]> {
  const battery: { label: string; sql: string }[] = [];
  const cols = await executeSQL(
    "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema='main' ORDER BY 1,2",
    ds.id,
  );
  if (cols.error) return battery;
  const byTable = new Map<string, { col: string; type: string }[]>();
  for (const r of cols.rows) {
    const t = String(r.table_name);
    if (t.startsWith("raw_") || t.startsWith("sentinel_")) continue;
    if (!byTable.has(t)) byTable.set(t, []);
    byTable.get(t)!.push({ col: String(r.column_name), type: String(r.data_type).toUpperCase() });
  }
  const tables = [...byTable.keys()];
  // 1. row counts
  for (const t of tables) battery.push({ label: `count ${t}`, sql: `SELECT COUNT(*) n FROM ${t}` });
  // 2. boolean-type assertions (catch '= TRUE' breakage)
  for (const [t, cs] of byTable) for (const c of cs) {
    if (c.col.endsWith("_flag") && c.type !== "BOOLEAN")
      battery.push({ label: `bool-type ${t}.${c.col}`, sql: `SELECT COUNT(*) n FROM ${t} WHERE ${c.col} = TRUE` });
    else if (c.type === "BOOLEAN")
      battery.push({ label: `bool ${t}.${c.col}`, sql: `SELECT ${c.col}, COUNT(*) n FROM ${t} GROUP BY 1` });
  }
  // 3. low-cardinality group-bys on the primary table
  const pt = ds.primaryTable;
  for (const c of byTable.get(pt) ?? []) {
    if (c.type.includes("VARCHAR") || c.type.includes("CHAR")) {
      const d = await executeSQL(`SELECT COUNT(DISTINCT ${c.col}) d FROM ${pt}`, ds.id);
      const dc = Number(d.rows?.[0]?.d ?? 999);
      if (!d.error && dc > 0 && dc <= 40) battery.push({ label: `group ${pt} by ${c.col}`, sql: `SELECT ${c.col}, COUNT(*) n FROM ${pt} GROUP BY 1 ORDER BY 2 DESC` });
    }
  }
  // 4. foreign-key joins: *_id columns shared across tables
  const idLocations = new Map<string, string[]>();
  for (const [t, cs] of byTable) for (const c of cs) if (c.col.endsWith("_id")) {
    if (!idLocations.has(c.col)) idLocations.set(c.col, []);
    idLocations.get(c.col)!.push(t);
  }
  for (const [idc, ts] of idLocations) {
    if (ts.length < 2) continue;
    // join the primary table to one other table that shares this id
    const other = ts.find((t) => t !== pt);
    if (ts.includes(pt) && other)
      battery.push({ label: `join ${pt}⋈${other} on ${idc}`, sql: `SELECT COUNT(*) n FROM ${pt} a JOIN ${other} b ON a.${idc} = b.${idc}` });
  }
  return battery;
}

async function runSql(sql: string, label: string, phase: string, tier?: string) {
  try {
    const res = await executeSQL(sql, datasetId!);
    if (res.error) fails.push({ phase, tier, label, detail: res.error, sql });
    else if (res.rowCount === 0) warns.push({ phase, tier, label, detail: "0 rows", sql });
  } catch (e) { fails.push({ phase, tier, label, detail: String(e), sql }); }
}

async function runNL(prompt: string, tier: string) {
  try {
    const queries = await generateQueries(prompt, "quick", datasetId!);
    if (!queries.length) { warns.push({ phase: "B", tier, label: prompt, detail: "no SQL generated" }); return; }
    for (const q of queries) {
      const res = await executeSQL(q.sql, datasetId!);
      if (res.error) fails.push({ phase: "B", tier, label: prompt, detail: res.error, sql: q.sql });
      else if (res.rowCount === 0) warns.push({ phase: "B", tier, label: prompt, detail: "0 rows", sql: q.sql });
    }
  } catch (e) { fails.push({ phase: "B", tier, label: prompt, detail: String(e) }); }
}

let pbDone = 0;
async function runPlaybook(query: string, total: number) {
  const events: Record<string, unknown>[] = [];
  const reqId = `vf${Math.abs(hash(query)).toString(36).slice(0, 6)}`;
  try {
    await runPlaybookGeneration({ query, datasetId: datasetId!, proceedWithout: true, reqId, send: (e) => events.push(e) });
    const done = events.find((e) => e.type === "generation_complete");
    const err = events.find((e) => e.type === "error");
    const repaired = events.some((e) => e.type === "phase" && (e as { phase?: string }).phase === "repairing_sql");
    if (err) fails.push({ phase: "C", label: query, detail: String((err as { message?: string }).message ?? "error") });
    else if (!done) fails.push({ phase: "C", label: query, detail: "no generation_complete event" });
    else {
      const cells = ((done as { cells?: unknown[] }).cells ?? []) as { type: string }[];
      const sqlCells = cells.filter((c) => c.type === "sql").length;
      if (cells.length === 0) fails.push({ phase: "C", label: query, detail: "0 cells generated" });
      else if (repaired) warns.push({ phase: "C", label: query, detail: `ok after SQL repair (${cells.length} cells, ${sqlCells} SQL)` });
    }
  } catch (e) { fails.push({ phase: "C", label: query, detail: String(e) }); }
  pbDone++;
  process.stdout.write(`  playbook ${pbDone}/${total} done (${fails.filter((f) => f.phase === "C").length} fail so far)\n`);
}

function hash(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

async function main() {
  const ds = getDataset(datasetId!);
  const specPath = resolve(__dirname, "verify-specs", `${datasetId}.ts`);
  let spec: VerifySpec | null = null;
  if (existsSync(specPath)) {
    const mod = await import(specPath);
    const raw = mod.default ?? mod;
    spec = (raw?.L1 ? raw : raw?.default ?? raw?.spec ?? mod.spec) as VerifySpec;
  }
  console.log(`\n══════ Verifying ${ds.label} (${datasetId}) ${SAMPLE ? "[SAMPLE]" : "[FULL]"} ══════`);

  // Phase 0
  console.log("\n── Phase 0: build DuckDB + introspect ──");
  const t0 = Date.now();
  const probe = await executeSQL(`SELECT COUNT(*) n FROM ${ds.primaryTable}`, datasetId!);
  if (probe.error) { console.error("FATAL build:", probe.error); process.exit(1); }
  console.log(`  built in ${((Date.now() - t0) / 1000).toFixed(1)}s · ${ds.primaryTable}=${probe.rows[0].n}`);

  // Phase A
  console.log("\n── Phase A: structural battery (auto + spec) ──");
  const battery = [...(await buildStructuralBattery(ds)), ...(spec?.structural ?? [])];
  await pMap(battery, NL_CONC, (q) => runSql(q.sql, q.label, "A"));
  const aF = fails.filter((f) => f.phase === "A").length;
  console.log(`  ${battery.length} queries · ${battery.length - aF} passed · ${aF} failed · ${warns.filter((w) => w.phase === "A").length} empty`);

  if (NO_LLM || !process.env.OPENAI_API_KEY) {
    console.log(`\n── Phases B & C: SKIPPED (${NO_LLM ? "--no-llm" : "no OPENAI_API_KEY"}) ──`);
  } else if (spec) {
    // Phase B
    const cap = num("prompts", SAMPLE ? 5 : Infinity);
    const tiers: [string, string[]][] = [["L1", spec.L1], ["L2", spec.L2], ["L3", spec.L3]];
    const tierLists = tiers.map(([t, list]) => [t, SAMPLE ? list.slice(0, 5) : list.slice(0, cap)] as [string, string[]]);
    const totalNL = tierLists.reduce((s, [, l]) => s + l.length, 0);
    console.log(`\n── Phase B: ${totalNL} NL queries (L1=${tierLists[0][1].length} L2=${tierLists[1][1].length} L3=${tierLists[2][1].length}), conc=${NL_CONC} ──`);
    const bStart = Date.now();
    let done = 0;
    for (const [tier, list] of tierLists) {
      await pMap(list, NL_CONC, async (p) => { await runNL(p, tier); if (++done % 25 === 0) process.stdout.write(`  ...${done}/${totalNL}\n`); });
    }
    const bF = fails.filter((f) => f.phase === "B").length;
    console.log(`  ${totalNL} run · ${bF} failed SQL · ${warns.filter((w) => w.phase === "B").length} empty · ${((Date.now() - bStart) / 1000 / 60).toFixed(1)}min`);

    // Phase C
    const pbList = SAMPLE ? spec.playbooks.slice(0, 2) : spec.playbooks.slice(0, num("playbooks", Infinity));
    console.log(`\n── Phase C: ${pbList.length} complex playbook generations, conc=${PB_CONC} ──`);
    const cStart = Date.now();
    await pMap(pbList, PB_CONC, (q) => runPlaybook(q, pbList.length));
    const cF = fails.filter((f) => f.phase === "C").length;
    console.log(`  ${pbList.length} playbooks · ${pbList.length - cF} generated cleanly · ${cF} failed · ${((Date.now() - cStart) / 1000 / 60).toFixed(1)}min`);
  } else {
    console.log(`\n── Phases B & C: SKIPPED (no spec at ${specPath}) ──`);
  }

  // Report
  console.log("\n══════════════ REPORT ══════════════");
  console.log(`FAILURES: ${fails.length}`);
  for (const f of fails) {
    console.log(`\n[FAIL ${f.phase}${f.tier ? "/" + f.tier : ""}] ${f.label}\n  ${f.detail}`);
    if (f.sql) console.log(`  SQL: ${f.sql.slice(0, 280).replace(/\s+/g, " ")}`);
  }
  console.log(`\nWARNINGS: ${warns.length} (0-row results may signal a missing/stale event; "ok after SQL repair" = playbook self-healed)`);
  for (const w of warns.slice(0, 60)) console.log(`  [${w.phase}${w.tier ? "/" + w.tier : ""}] ${w.label} — ${w.detail}`);
  if (warns.length > 60) console.log(`  ...and ${warns.length - 60} more`);
  console.log(`\n${fails.length === 0 ? "✓ ALL CHECKS PASSED" : `✗ ${fails.length} FAILURES`}`);
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
