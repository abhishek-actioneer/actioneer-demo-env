/**
 * Standalone smoke test for src/lib/server/ir-crawler.ts.
 *
 * Hits every company's homepage, attempts footer→IR-page crawl, dumps the
 * harvested document list per company. Pure HTTP, no LLM, no Parallel API.
 *
 * Usage:
 *   pnpm exec tsx scripts/test-ir-crawler.ts
 *   pnpm exec tsx scripts/test-ir-crawler.ts "Aavas Financiers" aavas.in
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { crawlIRDocs, type IRDocument } from "../src/lib/server/ir-crawler";

interface Target {
  name: string;
  domain: string;
  expected: "success" | "fallback";
}

const TARGETS: Target[] = [
  { name: "Vastu Housing Finance", domain: "vastuhfc.com", expected: "success" },
  { name: "Aavas Financiers", domain: "aavas.in", expected: "success" },
  { name: "Aptus Value Housing Finance", domain: "aptusindia.com", expected: "success" },
  { name: "Home First Finance", domain: "homefirstindia.com", expected: "success" },
  { name: "India Shelter Finance", domain: "indiashelter.in", expected: "success" },
  { name: "LIC Housing Finance", domain: "lichousing.com", expected: "fallback" },
  { name: "PNB Housing Finance", domain: "pnbhousing.com", expected: "fallback" },
  { name: "Avanse Financial Services", domain: "avanse.com", expected: "fallback" },
];

function summarizeByType(docs: IRDocument[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const d of docs) counts[d.type] = (counts[d.type] ?? 0) + 1;
  return counts;
}

async function run() {
  const argName = process.argv[2];
  const argDomain = process.argv[3];
  const targets: Target[] = argName && argDomain
    ? [{ name: argName, domain: argDomain, expected: "success" }]
    : TARGETS;

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(process.cwd(), "tmp", "ir-crawler-test", ts);
  mkdirSync(outDir, { recursive: true });

  const summary: string[] = [];
  summary.push(`# IR crawler test — ${new Date().toISOString()}`);
  summary.push("");
  summary.push(`| Company | Expected | Actual | Docs | Source | IR page |`);
  summary.push(`|---|---|---|---:|---|---|`);

  for (const t of targets) {
    process.stdout.write(`[${t.name}] `);
    const start = Date.now();
    try {
      const res = await crawlIRDocs(t.name, t.domain);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const actual = res.documents.length > 0 ? "success" : "fallback";
      const match = actual === t.expected ? "✓" : "✗";
      console.log(`${match} ${actual} — ${res.documents.length} docs in ${elapsed}s — ${res.source}`);

      const slug = t.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      writeFileSync(path.join(outDir, `${slug}.json`), JSON.stringify(res, null, 2));

      const counts = summarizeByType(res.documents);
      const countStr = Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(", ");
      summary.push(
        `| ${t.name} | ${t.expected} | ${actual} | ${res.documents.length}${countStr ? ` (${countStr})` : ""} | ${res.source} | ${res.irIndexUrl ?? "—"} |`,
      );

      if (res.warnings.length > 0) {
        for (const w of res.warnings) console.log(`  ⚠ ${w}`);
      }
      if (res.documents.length > 0) {
        console.log(`  Latest 5:`);
        for (const d of res.documents.slice(0, 5)) {
          console.log(`    - [${d.type}${d.period ? ` · ${d.period}` : ""}] ${d.title.slice(0, 90)}`);
          console.log(`      ${d.url}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`✗ threw: ${msg}`);
      summary.push(`| ${t.name} | ${t.expected} | error | — | — | ${msg} |`);
    }
  }

  writeFileSync(path.join(outDir, "summary.md"), summary.join("\n") + "\n");
  console.log(`\nFull JSON dumps + summary in ${path.relative(process.cwd(), outDir)}/`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
