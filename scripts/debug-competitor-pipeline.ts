/**
 * Debug runner for the active competitor-research pipeline.
 *
 * Mirrors src/app/api/competitor-research/route.ts but writes every stage's
 * input + output to disk so we can audit what the picker saw, what it chose,
 * and what extraction returned — without spinning up the UI.
 *
 * Usage:
 *   pnpm exec tsx scripts/debug-competitor-pipeline.ts "<query>" [--synthesize]
 *
 * Env required: PARALLEL_API_KEY, OPENAI_API_KEY.
 *
 * Output: tmp/competitor-research-debug/<timestamp>__<slug>/
 *   00-input.txt
 *   01-plan.json
 *   02-queries-<company>.json
 *   03-search-<company>.json          (raw, deduped search results)
 *   04-picker-input.txt               (exact text fed to URL picker)
 *   04-picker-output.json             (selections with reasons + priorities)
 *   05-extract-<company>-<i>.md       (full extracted content per URL)
 *   05-extract-errors.json
 *   06-synthesis-input.txt            (only with --synthesize)
 *   06-report.md                      (only with --synthesize)
 *   summary.md                        (human-readable run summary, written incrementally)
 */

import { config as loadEnv } from "dotenv";
import { existsSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";

// Match Next.js: load .env.local first (overrides), then .env as fallback.
for (const f of [".env.local", ".env"]) {
  if (existsSync(f)) loadEnv({ path: f, override: false });
}
import {
  PLAN_PROMPT,
  QUERY_GEN_PROMPT,
  URL_PICKER_PROMPT,
  SYNTHESIZE_PROMPT,
  buildSynthesisInput,
  type PlanResult,
  type QueryGenResult,
  type UrlPickerResult,
} from "../src/lib/prompts/competitor-research-pipeline";
import {
  searchWeb,
  extractUrls,
  type SearchResult,
  type ExtractResult,
} from "../src/lib/parallel-client";
import { generateText, generateTextStream } from "../src/lib/llm";

const MAX_COMPETITORS = 4;
const MAX_URLS_PER_COMPANY_TO_EXTRACT = 3;

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

function parseJsonOrThrow<T>(raw: string, label: string): T {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(cleaned) as T;
  } catch (err) {
    throw new Error(`Failed to parse ${label} JSON: ${err instanceof Error ? err.message : "unknown"}. Raw: ${raw.slice(0, 400)}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const positional = args.filter((a) => !a.startsWith("--"));
  const userMessage = positional[0];
  if (!userMessage) {
    console.error('Usage: tsx scripts/debug-competitor-pipeline.ts "<query>" [--synthesize]');
    process.exit(1);
  }
  const doSynth = flags.has("--synthesize");

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(process.cwd(), "tmp", "competitor-research-debug", `${ts}__${slugify(userMessage)}`);
  mkdirSync(outDir, { recursive: true });
  const summaryPath = path.join(outDir, "summary.md");
  const log = (line: string) => {
    console.log(line);
    appendFileSync(summaryPath, line + "\n");
  };

  log(`# Competitor research debug run`);
  log(`- Query: \`${userMessage}\``);
  log(`- Started: ${new Date().toISOString()}`);
  log(`- Synthesize: ${doSynth ? "yes" : "no (pass --synthesize to run stage 6)"}`);
  log(`- Output: \`${outDir}\``);
  log(``);
  writeFileSync(path.join(outDir, "00-input.txt"), userMessage + "\n");

  // ── Stage 1: Plan ──
  const t1 = Date.now();
  log(`## Stage 1 — Plan`);
  const planJson = await generateText(userMessage, {
    systemPrompt: PLAN_PROMPT,
    jsonMode: true,
    feature: "competitor_research.plan",
    timeoutMs: 30_000,
  });
  const plan = parseJsonOrThrow<PlanResult>(planJson, "plan");
  writeFileSync(path.join(outDir, "01-plan.json"), JSON.stringify(plan, null, 2));
  const competitors = plan.competitors.slice(0, MAX_COMPETITORS);
  const allCompanies = [{ name: plan.ownCompany.name, websiteGuess: plan.ownCompany.websiteGuess }, ...competitors];
  log(`- Subject: **${plan.ownCompany.name}** (${plan.ownCompany.sector})`);
  log(`- Competitors: ${competitors.map((c) => c.name).join(", ") || "_(none)_"}`);
  log(`- Time scope: \`${plan.timeScope}\``);
  log(`- ${((Date.now() - t1) / 1000).toFixed(1)}s`);
  log(``);

  // ── Stage 2: Query gen per company ──
  const t2 = Date.now();
  log(`## Stage 2 — Query generation`);
  const queryGenResults = await Promise.all(
    allCompanies.map(async (c) => {
      const j = await generateText(
        `Company: ${c.name}\nWebsite guess: ${c.websiteGuess ?? "(unknown)"}\nSector: ${plan.ownCompany.sector}\nTime scope: ${plan.timeScope}`,
        {
          systemPrompt: QUERY_GEN_PROMPT,
          jsonMode: true,
          feature: "competitor_research.query_gen",
          timeoutMs: 20_000,
        },
      );
      const out = parseJsonOrThrow<QueryGenResult>(j, `queries.${c.name}`);
      writeFileSync(path.join(outDir, `02-queries-${slugify(c.name)}.json`), JSON.stringify(out, null, 2));
      return { company: c.name, queries: out.queries };
    }),
  );
  for (const cq of queryGenResults) {
    log(`### ${cq.company}`);
    for (const q of cq.queries) log(`- \`${q.lane}\` — ${q.query}`);
  }
  log(`- ${((Date.now() - t2) / 1000).toFixed(1)}s`);
  log(``);

  // ── Stage 3: Search ──
  const t3 = Date.now();
  log(`## Stage 3 — Search`);
  const searchTasks = queryGenResults.flatMap((cq) =>
    cq.queries.map((q) => ({ company: cq.company, lane: q.lane, query: q.query })),
  );
  const settled = await Promise.allSettled(
    searchTasks.map(async (t) => {
      const objective =
        t.lane === "ir_landing"
          ? `Find the company's official investor-relations / financial-reports page for ${t.company}.`
          : t.lane === "latest_results"
            ? `Find the most recent quarterly or annual audited financial results / investor presentation PDF for ${t.company}.`
            : t.lane === "historical_results"
              ? `Find the prior fiscal year's annual report or audited results PDF for ${t.company}.`
              : `Find recent strategic moves, M&A, leadership changes, or expansion news for ${t.company}.`;
      const results = await searchWeb(objective, [t.query]);
      return { ...t, results };
    }),
  );

  const seenUrls = new Set<string>();
  const perCompanyResults = new Map<string, SearchResult[]>();
  let failedSearches = 0;
  for (const sr of settled) {
    if (sr.status !== "fulfilled") { failedSearches += 1; continue; }
    const { company, results } = sr.value;
    const existing = perCompanyResults.get(company) ?? [];
    for (const r of results) {
      if (seenUrls.has(r.url)) continue;
      seenUrls.add(r.url);
      existing.push(r);
    }
    perCompanyResults.set(company, existing);
  }
  for (const c of allCompanies) {
    const rs = perCompanyResults.get(c.name) ?? [];
    writeFileSync(path.join(outDir, `03-search-${slugify(c.name)}.json`), JSON.stringify(rs, null, 2));
    log(`### ${c.name} — ${rs.length} unique results`);
    for (const r of rs.slice(0, 12)) {
      log(`- ${r.title}`);
      log(`  - ${r.url}${r.publishDate ? ` _(${r.publishDate})_` : ""}`);
    }
    if (rs.length > 12) log(`- _… +${rs.length - 12} more in 03-search-${slugify(c.name)}.json_`);
  }
  if (failedSearches > 0) log(`- ⚠ ${failedSearches} search call(s) failed (see stderr)`);
  log(`- ${((Date.now() - t3) / 1000).toFixed(1)}s`);
  log(``);

  // ── Stage 4: URL picker ──
  const t4 = Date.now();
  log(`## Stage 4 — URL picker`);
  const pickerInput = allCompanies
    .map((c) => {
      const rs = perCompanyResults.get(c.name) ?? [];
      if (rs.length === 0) return `=== ${c.name} ===\n(No search results)`;
      const lines = rs.slice(0, 20).map((r, i) =>
        `${i + 1}. ${r.title}\n   URL: ${r.url}${r.publishDate ? ` (published ${r.publishDate})` : ""}\n   Excerpt: ${(r.excerpts[0] ?? "").slice(0, 200)}`,
      );
      return `=== ${c.name} ===\n${lines.join("\n\n")}`;
    })
    .join("\n\n");
  writeFileSync(path.join(outDir, "04-picker-input.txt"), pickerInput);

  const pickerJson = await generateText(pickerInput, {
    systemPrompt: URL_PICKER_PROMPT,
    jsonMode: true,
    feature: "competitor_research.url_pick",
    timeoutMs: 30_000,
  });
  const picker = parseJsonOrThrow<UrlPickerResult>(pickerJson, "url_picker");
  writeFileSync(path.join(outDir, "04-picker-output.json"), JSON.stringify(picker, null, 2));

  const perCompanySelections = new Map<string, { url: string; reason: string; priority: number }[]>();
  for (const sel of picker.selections) {
    const existing = perCompanySelections.get(sel.company) ?? [];
    existing.push(sel);
    perCompanySelections.set(sel.company, existing);
  }
  const allUrlsToExtract: { company: string; url: string }[] = [];
  for (const [company, sels] of perCompanySelections) {
    const sorted = [...sels].sort((a, b) => a.priority - b.priority);
    log(`### ${company} — ${sorted.length} candidate(s), keeping top ${Math.min(sorted.length, MAX_URLS_PER_COMPANY_TO_EXTRACT)}`);
    for (let i = 0; i < sorted.length; i++) {
      const s = sorted[i];
      const kept = i < MAX_URLS_PER_COMPANY_TO_EXTRACT ? "✓" : "✗";
      log(`- ${kept} P${s.priority} — ${s.url}`);
      log(`  - _${s.reason}_`);
      if (i < MAX_URLS_PER_COMPANY_TO_EXTRACT) allUrlsToExtract.push({ company, url: s.url });
    }
  }
  log(`- ${((Date.now() - t4) / 1000).toFixed(1)}s`);
  log(``);

  // ── Stage 5: Extract ──
  const t5 = Date.now();
  log(`## Stage 5 — Extract`);
  const periodHint =
    plan.timeScope === "last_2_years" ? "Pull figures for the LAST TWO full fiscal years (e.g. FY25 AND FY26) and the YoY change."
    : plan.timeScope === "last_3_years" ? "Pull figures for the LAST THREE full fiscal years and the YoY changes."
    : plan.timeScope === "last_year" ? "Pull figures for the most recent full fiscal year."
    : plan.timeScope === "last_2_quarters" ? "Pull figures for the LAST TWO quarters (e.g. Q3 FY26 AND Q4 FY26) and the QoQ change."
    : "Pull figures for the most recent reported quarter.";
  const extractObjective = `Extract financial metrics from this document: AUM, revenue/total income, net interest income, PAT, GNPA %, NIM, capital adequacy ratio (CRAR), branch count, employee count. Also extract any recent strategic moves (M&A, leadership changes, geographic expansion, capital raises). ${periodHint} Quote EXACT numbers with their reporting period labels (e.g. "Q4 FY26", "FY25 vs FY26"). If the document is a website navigation page or product list with no financial data, say "no financial data" — do not invent numbers.`;

  const urls = allUrlsToExtract.map((u) => u.url);
  let extractResults: ExtractResult[] = [];
  let extractErrors: { url: string; errorType: string; httpStatusCode?: number; content: string }[] = [];
  if (urls.length > 0) {
    const { results, errors } = await extractUrls(urls, extractObjective);
    extractResults = results;
    extractErrors = errors;
  }
  writeFileSync(path.join(outDir, "05-extract-errors.json"), JSON.stringify(extractErrors, null, 2));

  const urlToCompany = new Map(allUrlsToExtract.map((u) => [u.url, u.company]));
  for (const c of allCompanies) {
    const sources = extractResults.filter((r) => urlToCompany.get(r.url) === c.name);
    log(`### ${c.name}`);
    if (sources.length === 0) {
      log(`- _no successful extractions_`);
      continue;
    }
    sources.forEach((s, i) => {
      const file = `05-extract-${slugify(c.name)}-${i + 1}.md`;
      writeFileSync(
        path.join(outDir, file),
        `# ${s.title}\nURL: ${s.url}\n\n---\n\n${s.fullContent}\n`,
      );
      const preview = s.fullContent.slice(0, 300).replace(/\s+/g, " ").trim();
      log(`- ${s.fullContent.length.toLocaleString()} chars → \`${file}\``);
      log(`  - ${s.url}`);
      log(`  - _${preview}${s.fullContent.length > 300 ? "…" : ""}_`);
    });
  }
  if (extractErrors.length > 0) {
    log(`#### Extract errors`);
    for (const e of extractErrors) log(`- ${e.url} → \`${e.errorType}\`${e.httpStatusCode ? ` (${e.httpStatusCode})` : ""}`);
  }
  log(`- ${((Date.now() - t5) / 1000).toFixed(1)}s`);
  log(``);

  // ── Stage 6: Synthesize (optional) ──
  if (doSynth) {
    const t6 = Date.now();
    log(`## Stage 6 — Synthesize`);
    const perCompanyContent = allCompanies.map((c) => {
      const sources = extractResults
        .filter((r) => urlToCompany.get(r.url) === c.name && r.fullContent.length > 0)
        .map((r) => {
          const fromSearch = (perCompanyResults.get(c.name) ?? []).find((s) => s.url === r.url);
          return { url: r.url, title: r.title, publishDate: fromSearch?.publishDate, content: r.fullContent };
        });
      return { company: c.name, sources };
    });
    const synthInput = buildSynthesisInput(userMessage, plan, perCompanyContent);
    writeFileSync(path.join(outDir, "06-synthesis-input.txt"), synthInput);
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
    writeFileSync(path.join(outDir, "06-report.md"), report);
    log(``);
    log(`- ${report.length.toLocaleString()} chars → \`06-report.md\``);
    log(`- ${((Date.now() - t6) / 1000).toFixed(1)}s`);
    log(``);
  }

  log(`---`);
  log(`Done. Open \`${path.relative(process.cwd(), outDir)}/summary.md\` for the run summary.`);
}

main().catch((err) => {
  console.error("\n[debug-competitor-pipeline] failed:", err);
  process.exit(1);
});
