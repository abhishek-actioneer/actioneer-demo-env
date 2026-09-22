/**
 * Re-render the multi-pipeline report from a saved D-datasets.json + B-picked.json.
 * Cheap iteration on the assembler — no extracts, no LLM calls.
 *
 * Usage:
 *   pnpm exec tsx scripts/rerender-multi-report.ts [path/to/run-dir]
 *   default: latest tmp/vastu-ir-pipeline/* dir
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { assembleReport } from "../src/lib/server/competitor-report-assembler";
import type { CompanyDataset } from "../src/lib/server/competitor-data-types";
import type { PickedDoc } from "../src/lib/server/ir-doc-picker";

function findLatestRunDir(): string | null {
  const root = path.join(process.cwd(), "tmp", "vastu-ir-pipeline");
  if (!existsSync(root)) return null;
  const dirs = readdirSync(root)
    .filter((d) => statSync(path.join(root, d)).isDirectory())
    .sort()
    .reverse();
  for (const d of dirs) {
    const full = path.join(root, d);
    if (existsSync(path.join(full, "D-datasets.json")) && existsSync(path.join(full, "B-picked.json"))) {
      return full;
    }
  }
  return null;
}

function main() {
  const runDir = process.argv[2] ?? findLatestRunDir();
  if (!runDir || !existsSync(runDir)) {
    console.error("No run directory found. Run scripts/run-vastu-ir-pipeline.ts --multi first.");
    process.exit(1);
  }

  const datasetsPath = path.join(runDir, "D-datasets.json");
  const pickedPath = path.join(runDir, "B-picked.json");
  if (!existsSync(datasetsPath) || !existsSync(pickedPath)) {
    console.error(`Run dir is missing D-datasets.json or B-picked.json:\n  ${runDir}`);
    process.exit(1);
  }

  const datasets: CompanyDataset[] = JSON.parse(readFileSync(datasetsPath, "utf8"));
  const picks: { company: string; doc: PickedDoc }[] = JSON.parse(readFileSync(pickedPath, "utf8"));
  const urlToTitle = new Map(picks.map((p) => [p.doc.url, p.doc.title]));

  // Subject = first company in datasets (preserves source order from the runner)
  const subject = datasets[0]?.company ?? "Subject";

  const result = assembleReport(
    {
      subjectCompany: subject,
      datasets,
      asOfDate: new Date(),
    },
    urlToTitle,
  );

  const outPath = path.join(runDir, "E-report-rerender.md");
  writeFileSync(outPath, result.markdown);

  console.log(`Re-rendered → ${path.relative(process.cwd(), outPath)}`);
  console.log(`  ${result.markdown.length.toLocaleString()} chars`);
  console.log(`  charts: ${result.charts.filter((c) => c.ok).length}/${result.charts.length}`);
  for (const c of result.charts) console.log(`    ${c.ok ? "✓" : "✗"} ${c.title}`);
}

main();
