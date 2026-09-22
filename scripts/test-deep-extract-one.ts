/**
 * Single-doc smoke test for parallel-deep-extract.ts.
 *
 * Costs ONE Parallel Task API run (pro-fast, ~$0.50). Validates that:
 *   - Parallel actually fetches the URL we provide (not generic web search)
 *   - Returns parseable JSON matching our schema
 *   - Field-level citations land
 *
 * Usage:
 *   pnpm exec tsx scripts/test-deep-extract-one.ts [path/to/picked.json] [doc-index]
 *   default: latest tmp/vastu-ir-pipeline/.../B-picked.json, doc index 0
 */

import { config as loadEnv } from "dotenv";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

for (const f of [".env.local", ".env"]) {
  if (existsSync(f)) loadEnv({ path: f, override: false });
}

import { deepExtractDoc } from "../src/lib/server/parallel-deep-extract";
import type { PickedDoc } from "../src/lib/server/ir-doc-picker";

function findLatestPickedJson(): string | null {
  const root = path.join(process.cwd(), "tmp", "vastu-ir-pipeline");
  if (!existsSync(root)) return null;
  const dirs = readdirSync(root).filter((d) => statSync(path.join(root, d)).isDirectory());
  if (dirs.length === 0) return null;
  const sorted = dirs.sort().reverse();
  for (const d of sorted) {
    const p = path.join(root, d, "B-picked.json");
    if (existsSync(p)) return p;
  }
  return null;
}

async function main() {
  const argPath = process.argv[2];
  const argIdx = process.argv[3] ? parseInt(process.argv[3], 10) : 0;

  const pickedPath = argPath ?? findLatestPickedJson();
  if (!pickedPath || !existsSync(pickedPath)) {
    console.error("No B-picked.json found. Run scripts/run-vastu-ir-pipeline.ts first.");
    process.exit(1);
  }

  const picks: { company: string; doc: PickedDoc }[] = JSON.parse(readFileSync(pickedPath, "utf8"));
  if (argIdx < 0 || argIdx >= picks.length) {
    console.error(`Index ${argIdx} out of range (0..${picks.length - 1}).`);
    process.exit(1);
  }
  const target = picks[argIdx]!;

  console.log(`Picked doc:\n  company: ${target.company}\n  type:    ${target.doc.type}\n  period:  ${target.doc.period ?? "—"}\n  title:   ${target.doc.title.slice(0, 100)}\n  url:     ${target.doc.url.slice(0, 200)}${target.doc.url.length > 200 ? "…" : ""}\n`);
  console.log(`Firing Parallel Deep Research task… (1–3 min)\n`);

  const startedAt = Date.now();
  const result = await deepExtractDoc(target.doc);
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(process.cwd(), "tmp", "deep-extract-test", ts);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "result.json"), JSON.stringify(result, null, 2));
  if (result.rawMarkdown) writeFileSync(path.join(outDir, "raw.md"), result.rawMarkdown);

  console.log(`\n=== Result (${elapsed}s) ===`);
  console.log(`Status: ${result.status}`);
  console.log(`runId:  ${result.runId}`);
  if (result.error) console.log(`Error:  ${result.error}`);
  console.log();

  if (result.fields) {
    console.log("Extracted fields:");
    for (const [k, v] of Object.entries(result.fields)) {
      if (k.endsWith("_quote")) continue;
      const quote = (result.fields as Record<string, unknown>)[`${k}_quote`];
      const valStr = typeof v === "object" ? JSON.stringify(v).slice(0, 120) : String(v ?? "—");
      console.log(`  ${k.padEnd(28)} ${valStr}${quote ? `\n    quote: "${String(quote).slice(0, 100)}"` : ""}`);
    }
  } else {
    console.log("No structured fields parsed. Raw markdown saved to raw.md.");
    if (result.rawMarkdown) console.log(`\n--- raw markdown (first 800 chars) ---\n${result.rawMarkdown.slice(0, 800)}`);
  }

  console.log(`\nCitations (basis): ${result.citations ? `${(result.citations as unknown[]).length} items` : "none"}`);
  console.log(`Saved → ${path.relative(process.cwd(), outDir)}`);
}

main().catch((err) => {
  console.error("\n[test-deep-extract-one] failed:", err);
  process.exit(1);
});
