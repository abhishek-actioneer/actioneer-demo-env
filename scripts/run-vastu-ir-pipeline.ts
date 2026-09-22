/**
 * End-to-end pipeline for the Vastu vs affordable-HFC peers competitor report.
 *
 * IR-first: skips Parallel search + LLM query-gen + LLM URL pick entirely.
 * Pulls docs straight from each company's IR page, picks 3 per company by
 * rules, extracts via Parallel, and (optionally) synthesizes via OpenAI.
 *
 * Usage:
 *   pnpm exec tsx scripts/run-vastu-ir-pipeline.ts            # crawl + pick + extract
 *   pnpm exec tsx scripts/run-vastu-ir-pipeline.ts --synthesize  # also run final synth
 */

import { config as loadEnv } from "dotenv";
import { existsSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";

for (const f of [".env.local", ".env"]) {
  if (existsSync(f)) loadEnv({ path: f, override: false });
}

import { crawlIRDocs } from "../src/lib/server/ir-crawler";
import { pickDocsForCompany, type PickedDoc } from "../src/lib/server/ir-doc-picker";
import { extractUrls } from "../src/lib/parallel-client";
import { deepExtractAll, type DeepExtractResult } from "../src/lib/server/parallel-deep-extract";
import { multiExtract, extractsByCompany } from "../src/lib/server/parallel-multi-extract";
import { buildCompanyDataset } from "../src/lib/server/competitor-extractors";
import { assembleReport } from "../src/lib/server/competitor-report-assembler";
import type { CompanyDataset } from "../src/lib/server/competitor-data-types";
import { generateTextStream } from "../src/lib/llm";
import { SYNTHESIZE_PROMPT, buildSynthesisInput, type PlanResult } from "../src/lib/prompts/competitor-research-pipeline";

const PLAN: PlanResult = {
  ownCompany: { name: "Vastu Housing Finance", websiteGuess: "vastuhfc.com", sector: "Indian affordable housing finance" },
  competitors: [
    { name: "Aavas Financiers", websiteGuess: "aavas.in" },
    { name: "Aptus Value Housing Finance", websiteGuess: "aptusindia.com" },
    { name: "Home First Finance", websiteGuess: "homefirstindia.com" },
    { name: "India Shelter Finance", websiteGuess: "indiashelter.in" },
  ],
  timeScope: "last_2_years",
  focusAreas: ["financials", "strategy"],
};

const USER_QUERY = "compare Vastu Housing Finance to Aavas Financiers, Aptus Value Housing Finance, Home First Finance and India Shelter Finance on financials of last 2 years";

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

async function main() {
  const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
  const doSynth = flags.has("--synthesize");
  const useDeep = flags.has("--deep"); // Use Parallel Task API (Deep Research) per PDF instead of /extract
  const useMulti = flags.has("--multi"); // Multi-objective extract → structured → deterministic assembly

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(process.cwd(), "tmp", "vastu-ir-pipeline", ts);
  mkdirSync(outDir, { recursive: true });
  const summaryPath = path.join(outDir, "summary.md");
  const log = (line: string) => {
    console.log(line);
    appendFileSync(summaryPath, line + "\n");
  };

  log(`# Vastu IR-first competitor pipeline`);
  log(`- Query: ${USER_QUERY}`);
  log(`- As of: ${new Date().toISOString()}`);
  log(`- Synthesize: ${doSynth ? "yes" : "no (pass --synthesize)"}`);
  log(`- Extract mode: ${useMulti ? "**multi-objective /extract** (4 batches: numbers, strategy, performance, risk → structured assembly)" : useDeep ? "**deep research per PDF** (slow, ~3 min total, structured analysis output)" : "fast `/extract` (batch, ~10s, raw markdown text)"}`);
  log(`- Output: \`${outDir}\``);
  log(``);

  const allCompanies = [
    { name: PLAN.ownCompany.name, websiteGuess: PLAN.ownCompany.websiteGuess },
    ...PLAN.competitors,
  ];

  // ── Stage A: crawl IR docs per company in parallel ──
  const tA = Date.now();
  log(`## Stage A — IR crawl (${allCompanies.length} companies in parallel)`);
  const crawlResults = await Promise.all(
    allCompanies.map(async (c) => {
      const r = await crawlIRDocs(c.name, c.websiteGuess);
      writeFileSync(path.join(outDir, `A-crawl-${slug(c.name)}.json`), JSON.stringify(r, null, 2));
      return { company: c.name, result: r };
    }),
  );
  for (const cr of crawlResults) {
    log(`### ${cr.company}`);
    log(`- Source: \`${cr.result.source}\` · Docs harvested: **${cr.result.documents.length}**`);
    if (cr.result.irIndexUrl) log(`- IR page: ${cr.result.irIndexUrl}`);
    if (cr.result.warnings.length > 0) for (const w of cr.result.warnings) log(`- ⚠ ${w}`);
  }
  log(`- ${((Date.now() - tA) / 1000).toFixed(1)}s`);
  log(``);

  // ── Stage B: LLM picker (one call per company in parallel) ──
  const tB = Date.now();
  log(`## Stage B — Doc picker (LLM, timeScope=\`${PLAN.timeScope}\`)`);
  const asOf = new Date();
  const pickResults = await Promise.all(
    crawlResults.map(async (cr) => {
      if (cr.result.documents.length === 0) return { company: cr.company, picks: [] as PickedDoc[] };
      const picks = await pickDocsForCompany(cr.company, cr.result.documents, PLAN.timeScope, asOf, 3);
      return { company: cr.company, picks };
    }),
  );
  const allPicks: { company: string; doc: PickedDoc }[] = [];
  for (const cr of pickResults) {
    log(`### ${cr.company}`);
    if (cr.picks.length === 0) {
      log(`- _no docs picked_`);
    } else {
      for (const p of cr.picks) {
        log(`- [${p.type}${p.period ? ` · ${p.period}` : ""}] ${p.title.slice(0, 100)}`);
        log(`  - _${p.reason}_`);
        log(`  - ${p.url.slice(0, 200)}${p.url.length > 200 ? "…" : ""}`);
        allPicks.push({ company: cr.company, doc: p });
      }
    }
  }
  writeFileSync(path.join(outDir, "B-picked.json"), JSON.stringify(allPicks, null, 2));
  log(`- Total picked: **${allPicks.length}** docs across ${allCompanies.length} companies`);
  log(`- ${((Date.now() - tB) / 1000).toFixed(1)}s`);
  log(``);

  if (allPicks.length === 0) {
    log(`Nothing to extract. Aborting.`);
    return;
  }

  // ── Multi-objective + structured + deterministic-assembly path ──
  if (useMulti) {
    const tC = Date.now();
    log(`## Stage C — Multi-objective extract (4 batches: numbers, strategy, performance, risk_outlook)`);
    const bundle = await multiExtract(allPicks);
    writeFileSync(path.join(outDir, "C-multi-bundle.json"), JSON.stringify({
      numbers: bundle.byObjective.numbers.map((r) => ({ url: r.url, title: r.title, contentLength: r.fullContent.length })),
      strategy: bundle.byObjective.strategy.map((r) => ({ url: r.url, title: r.title, contentLength: r.fullContent.length })),
      performance: bundle.byObjective.performance.map((r) => ({ url: r.url, title: r.title, contentLength: r.fullContent.length })),
      risk_outlook: bundle.byObjective.risk_outlook.map((r) => ({ url: r.url, title: r.title, contentLength: r.fullContent.length })),
      mix_and_geography: bundle.byObjective.mix_and_geography.map((r) => ({ url: r.url, title: r.title, contentLength: r.fullContent.length })),
    }, null, 2));
    for (const objective of ["numbers", "strategy", "performance", "risk_outlook", "mix_and_geography"] as const) {
      const total = bundle.byObjective[objective].reduce((s, r) => s + r.fullContent.length, 0);
      log(`- \`${objective}\`: ${bundle.byObjective[objective].length} extracts, ${total.toLocaleString()} total chars`);
    }
    log(`- ${((Date.now() - tC) / 1000).toFixed(1)}s`);
    log(``);

    // ── Stage D: structured per-company extraction ──
    const tD = Date.now();
    log(`## Stage D — Structured extract per company (OpenAI, 4 calls × ${allCompanies.length} companies in parallel)`);
    const numbersByCompany = extractsByCompany(bundle, "numbers");
    const strategyByCompany = extractsByCompany(bundle, "strategy");
    const performanceByCompany = extractsByCompany(bundle, "performance");
    const riskByCompany = extractsByCompany(bundle, "risk_outlook");
    const mixByCompany = extractsByCompany(bundle, "mix_and_geography");

    const datasets: CompanyDataset[] = await Promise.all(
      allCompanies.map(async (c) => {
        const ds = await buildCompanyDataset({
          company: c.name,
          numbersExtracts: numbersByCompany.get(c.name) ?? [],
          strategyExtracts: strategyByCompany.get(c.name) ?? [],
          performanceExtracts: performanceByCompany.get(c.name) ?? [],
          riskExtracts: riskByCompany.get(c.name) ?? [],
          mixExtracts: mixByCompany.get(c.name) ?? [],
          asOfDate: asOf,
        });
        // Save the per-company source bundle for debugging
        const dbgFile = `D-source-bundle-${slug(c.name)}.txt`;
        const sectionFor = (name: string, list: typeof numbersByCompany) => {
          const arr = list.get(c.name) ?? [];
          return `=== ${name} (${arr.length} extracts, ${arr.reduce((s, r) => s + r.fullContent.length, 0)} chars) ===\n${arr.map((r) => `--- ${r.url}\n${r.fullContent.slice(0, 8000)}\n`).join("\n")}`;
        };
        writeFileSync(path.join(outDir, dbgFile),
          sectionFor("NUMBERS", numbersByCompany) + "\n\n" +
          sectionFor("STRATEGY", strategyByCompany) + "\n\n" +
          sectionFor("PERFORMANCE", performanceByCompany) + "\n\n" +
          sectionFor("RISK_OUTLOOK", riskByCompany),
        );
        return ds;
      }),
    );
    writeFileSync(path.join(outDir, "D-datasets.json"), JSON.stringify(datasets, null, 2));

    for (const ds of datasets) {
      const fyCount = ds.financials.length;
      const moveCount = ds.strategic_moves.length;
      const perfCount = ds.performance.growth_drivers.length + ds.performance.segment_commentary.length + ds.performance.guidance.length + ds.performance.cohort_or_customer_notes.length;
      const riskCount = ds.risk_outlook.risk_factors.length + ds.risk_outlook.asset_quality_concerns.length + ds.risk_outlook.headwinds.length + ds.risk_outlook.outlook.length;
      log(`### ${ds.company}`);
      log(`- Financials: ${fyCount} period rows · Strategic moves: ${moveCount} · Performance items: ${perfCount} · Risk items: ${riskCount}`);
      if (fyCount > 0) {
        const fields = ds.financials[0]!;
        const populated = Object.entries(fields).filter(([k, v]) => k !== "period" && k !== "citations" && v !== null && v !== undefined).length;
        log(`- Top period \`${fields.period}\`: ${populated} fields populated`);
      }
    }
    log(`- ${((Date.now() - tD) / 1000).toFixed(1)}s`);
    log(``);

    // ── Stage E: deterministic report assembly ──
    const tE = Date.now();
    log(`## Stage E — Deterministic report assembly (no LLM)`);
    const urlToTitleMap = new Map(allPicks.map((p) => [p.doc.url, p.doc.title]));
    const assembled = assembleReport({
      subjectCompany: PLAN.ownCompany.name,
      datasets,
      asOfDate: asOf,
      query: USER_QUERY,
    }, urlToTitleMap);

    writeFileSync(path.join(outDir, "E-report.md"), assembled.markdown);
    log(`- Charts emitted: ${assembled.charts.filter((c) => c.ok).length}/${assembled.charts.length}`);
    for (const c of assembled.charts) {
      log(`  - ${c.ok ? "✓" : "✗"} ${c.title}`);
    }
    log(`- ${assembled.markdown.length.toLocaleString()} chars → \`E-report.md\``);
    log(`- ${((Date.now() - tE) / 1000).toFixed(1)}s`);
    log(``);
    log(`---`);
    log(`Done. Open \`${path.relative(process.cwd(), outDir)}/E-report.md\``);
    return;
  }

  // ── Stage C: extract content per doc (single-objective paths) ──
  const tC = Date.now();
  const urlToCompany = new Map(allPicks.map((p) => [p.doc.url, p.company]));
  const urlToTitle = new Map(allPicks.map((p) => [p.doc.url, p.doc.title]));

  // Per-company source list passed to synthesis later: { company, sources: [{url, title, content}] }
  const perCompanySources = new Map<string, Array<{ url: string; title: string; content: string }>>();

  if (useDeep) {
    log(`## Stage C — Deep Research per PDF (${allPicks.length} parallel Task API runs)`);
    const docs = allPicks.map((p) => p.doc);
    const deep = await deepExtractAll(docs);
    writeFileSync(path.join(outDir, "C-deep-results.json"), JSON.stringify(deep, null, 2));

    // Group by company
    const byUrl = new Map(deep.map((d: DeepExtractResult) => [d.url, d]));
    for (const c of allCompanies) {
      const sources = allPicks
        .filter((p) => p.company === c.name)
        .map((p) => byUrl.get(p.doc.url))
        .filter((d): d is DeepExtractResult => !!d);

      log(`### ${c.name}`);
      if (sources.length === 0) {
        log(`- _no docs_`);
        perCompanySources.set(c.name, []);
        continue;
      }
      const synthSources: Array<{ url: string; title: string; content: string }> = [];
      sources.forEach((s, i) => {
        const file = `C-deep-${slug(c.name)}-${i + 1}.md`;
        const body = s.rawMarkdown ?? `(empty — status=${s.status}${s.error ? `, error=${s.error}` : ""})`;
        writeFileSync(
          path.join(outDir, file),
          `# ${s.title}\nURL: ${s.url}\nStatus: ${s.status} (${(s.durationMs / 1000).toFixed(1)}s)\nrunId: ${s.runId}\n\n---\n\n${body}\n`,
        );
        const status = s.status === "completed" ? "✓" : "✗";
        log(`- ${status} [${s.type}${s.period ? ` · ${s.period}` : ""}] (${(s.durationMs / 1000).toFixed(1)}s, ${(s.rawMarkdown?.length ?? 0).toLocaleString()} chars) → \`${file}\``);
        if (s.error) log(`  - _error: ${s.error}_`);
        if (s.status === "completed" && s.rawMarkdown && s.rawMarkdown.length > 0) {
          synthSources.push({ url: s.url, title: s.title, content: s.rawMarkdown });
        }
      });
      perCompanySources.set(c.name, synthSources);
    }
  } else {
    log(`## Stage C — Extract (${allPicks.length} URLs in one batch call)`);
    const extractObjective =
      `Extract financial metrics: AUM, disbursements, revenue/total income, net interest income (NII), PAT, GNPA %, NNPA %, NIM, capital adequacy ratio (CRAR), branch count, employee count, average ticket size. ` +
      `Pull figures for FY26 (year ended March 2026) AND FY25 (year ended March 2025) where available, with YoY change. ` +
      `Quote EXACT numbers with reporting period labels (e.g. "FY26", "Q4 FY26", "FY25"). ` +
      `Also extract recent strategic moves (last 12 months): leadership changes, equity raises, geographic expansion, M&A, regulatory actions. ` +
      `If a document is corporate-governance / fair-practice / non-financial filler, write "no financial data" for that document.`;

    const urls = allPicks.map((p) => p.doc.url);
    const { results: extractResults, errors: extractErrors } = await extractUrls(urls, extractObjective);
    writeFileSync(path.join(outDir, "C-extract-errors.json"), JSON.stringify(extractErrors, null, 2));

    for (const c of allCompanies) {
      const sources = extractResults.filter((r) => urlToCompany.get(r.url) === c.name);
      log(`### ${c.name}`);
      if (sources.length === 0) {
        log(`- _no successful extracts_`);
        perCompanySources.set(c.name, []);
        continue;
      }
      const synthSources: Array<{ url: string; title: string; content: string }> = [];
      sources.forEach((s, i) => {
        const file = `C-extract-${slug(c.name)}-${i + 1}.md`;
        writeFileSync(
          path.join(outDir, file),
          `# ${urlToTitle.get(s.url) ?? s.title}\nURL: ${s.url}\n\n---\n\n${s.fullContent}\n`,
        );
        const preview = s.fullContent.slice(0, 220).replace(/\s+/g, " ").trim();
        log(`- ${s.fullContent.length.toLocaleString()} chars → \`${file}\``);
        log(`  - _${preview}${s.fullContent.length > 220 ? "…" : ""}_`);
        if (s.fullContent.length > 0) {
          synthSources.push({ url: s.url, title: urlToTitle.get(s.url) ?? s.title, content: s.fullContent });
        }
      });
      perCompanySources.set(c.name, synthSources);
    }
    if (extractErrors.length > 0) {
      log(`#### Extract errors`);
      for (const e of extractErrors) log(`- ${e.url.slice(0, 200)}${e.url.length > 200 ? "…" : ""} → \`${e.errorType}\`${e.httpStatusCode ? ` (${e.httpStatusCode})` : ""}`);
    }
  }
  log(`- ${((Date.now() - tC) / 1000).toFixed(1)}s`);
  log(``);

  // ── Stage D: synthesize (optional) ──
  if (doSynth) {
    const tD = Date.now();
    log(`## Stage D — Synthesize`);
    const perCompanyContent = allCompanies.map((c) => ({
      company: c.name,
      sources: (perCompanySources.get(c.name) ?? []).map((s) => ({
        url: s.url,
        title: s.title,
        publishDate: undefined as string | undefined,
        content: s.content,
      })),
    }));
    const synthInput = buildSynthesisInput(USER_QUERY, PLAN, perCompanyContent);
    writeFileSync(path.join(outDir, "D-synthesis-input.txt"), synthInput);

    const stream = await generateTextStream(synthInput, {
      systemPrompt: SYNTHESIZE_PROMPT,
      maxOutputTokens: 16_000,
      feature: "competitor_research.synthesize",
    });
    let report = "";
    for await (const chunk of stream) {
      report += chunk;
      process.stdout.write(chunk);
    }
    process.stdout.write("\n");
    writeFileSync(path.join(outDir, "D-report.md"), report);
    log(``);
    log(`- ${report.length.toLocaleString()} chars → \`D-report.md\``);
    log(`- ${((Date.now() - tD) / 1000).toFixed(1)}s`);
  }

  log(``);
  log(`---`);
  log(`Done. Open \`${path.relative(process.cwd(), outDir)}/summary.md\``);
}

main().catch((err) => {
  console.error("\n[run-vastu-ir-pipeline] failed:", err);
  process.exit(1);
});
