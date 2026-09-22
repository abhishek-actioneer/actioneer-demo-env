import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { safeStringify } from "@/lib/safe-stringify";
import {
  PLAN_PROMPT,
  type PlanResult,
} from "@/lib/prompts/competitor-research-pipeline";
import { generateText, type ModelId } from "@/lib/llm";

import { crawlIRDocs } from "@/lib/server/ir-crawler";
import { pickDocsForCompany, type PickedDoc } from "@/lib/server/ir-doc-picker";
import { multiExtract, extractsByCompany } from "@/lib/server/parallel-multi-extract";
import { buildCompanyDataset } from "@/lib/server/competitor-extractors";
import { assembleReport } from "@/lib/server/competitor-report-assembler";
import type { CompanyDataset } from "@/lib/server/competitor-data-types";

const RequestSchema = z.object({
  query: z.string().min(1).max(8000),
});

const HARD_TIMEOUT_MS = 6 * 60 * 1000; // 6 min — full pipeline
const MAX_COMPETITORS = 4;
const MAX_DOCS_PER_COMPANY = 3;

type CompetitorResearchSSEEvent =
  | { type: "phase"; phase: "researching" }
  | { type: "web_finding"; content: string }
  | { type: "web_search"; url: string; title: string }
  | { type: "web_extract"; url: string; title: string; contentLength: number }
  | { type: "text"; delta: string }
  | { type: "report"; content: string }
  | { type: "ping" }
  | { type: "done" }
  | { type: "error"; message: string };

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { query } = parsed.data;
  const modelId = (req.headers.get("x-model-id") ?? undefined) as ModelId | undefined;

  const encoder = new TextEncoder();
  const abort = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let cancelled = false;

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      function send(event: CompetitorResearchSSEEvent) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(safeStringify(event) + "\n"));
        } catch {
          closed = true;
        }
      }
      function close() {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch { /* already closed */ }
      }

      timeoutId = setTimeout(() => {
        cancelled = true;
        abort.abort();
        send({ type: "error", message: "Research timed out after 6 minutes." });
        close();
      }, HARD_TIMEOUT_MS);

      heartbeat = setInterval(() => send({ type: "ping" }), 10_000);

      try {
        // ── Stage A: Plan (LLM) ──
        send({ type: "phase", phase: "researching" });
        send({ type: "web_finding", content: "**Identifying subject and peer set…**" });

        const planJson = await generateText(query, {
          systemPrompt: PLAN_PROMPT,
          jsonMode: true,
          modelId,
          feature: "competitor_research.plan",
          timeoutMs: 30_000,
        });
        const plan = parseJsonOrThrow<PlanResult>(planJson, "plan");
        const competitors = plan.competitors.slice(0, MAX_COMPETITORS);
        const allCompanies = [{ name: plan.ownCompany.name, websiteGuess: plan.ownCompany.websiteGuess }, ...competitors];

        send({
          type: "web_finding",
          content: `**Subject:** ${plan.ownCompany.name} (${plan.ownCompany.sector})\n**Peer set:** ${competitors.map((c) => c.name).join(", ")}\n**Time scope:** ${plan.timeScope}`,
        });
        if (cancelled) return;

        // ── Stage B: IR crawl per company (parallel, deterministic) ──
        send({ type: "web_finding", content: "**Crawling investor-relations pages…**" });

        const crawlResults = await Promise.all(
          allCompanies.map((c) => crawlIRDocs(c.name, c.websiteGuess, abort.signal).then((r) => ({ company: c.name, result: r }))),
        );
        for (const cr of crawlResults) {
          if (cr.result.documents.length > 0) {
            send({ type: "web_finding", content: `${cr.company}: ${cr.result.documents.length} documents harvested from ${cr.result.irIndexUrl}` });
          } else {
            send({ type: "web_finding", content: `${cr.company}: _no IR docs harvested (${cr.result.warnings.join("; ")})_` });
          }
          if (cr.result.irIndexUrl) {
            send({ type: "web_search", url: cr.result.irIndexUrl, title: `${cr.company} — Investor Relations` });
          }
        }
        if (cancelled) return;

        // ── Stage C: LLM doc picker (per company in parallel) ──
        send({ type: "web_finding", content: "**Picking primary-source documents per peer…**" });
        const asOf = new Date();
        const pickResults = await Promise.all(
          crawlResults.map(async (cr) => {
            if (cr.result.documents.length === 0) return { company: cr.company, picks: [] as PickedDoc[] };
            const picks = await pickDocsForCompany(cr.company, cr.result.documents, plan.timeScope, asOf, MAX_DOCS_PER_COMPANY, modelId);
            return { company: cr.company, picks };
          }),
        );
        const allPicks: { company: string; doc: PickedDoc }[] = [];
        for (const cr of pickResults) {
          for (const p of cr.picks) {
            allPicks.push({ company: cr.company, doc: p });
            send({ type: "web_search", url: p.url, title: p.title });
          }
          send({ type: "web_finding", content: `${cr.company}: picked ${cr.picks.length} documents (${cr.picks.map((p) => p.type + (p.period ? "/" + p.period : "")).join(", ")})` });
        }
        if (allPicks.length === 0) {
          send({ type: "error", message: "No documents could be picked for extraction." });
          return;
        }
        if (cancelled) return;

        // ── Stage D: Multi-objective extract (Parallel /extract × 5 batches) ──
        send({ type: "web_finding", content: `**Extracting from ${allPicks.length} PDFs across 5 dimensions** (numbers, strategy, performance, risk, mix)…` });
        const bundle = await multiExtract(allPicks, abort.signal);
        for (const obj of ["numbers", "strategy", "performance", "risk_outlook", "mix_and_geography"] as const) {
          const total = bundle.byObjective[obj].reduce((s, r) => s + r.fullContent.length, 0);
          send({ type: "web_extract", url: `objective:${obj}`, title: obj, contentLength: total });
        }
        for (const r of bundle.byObjective.numbers) {
          send({ type: "web_extract", url: r.url, title: r.title, contentLength: r.fullContent.length });
        }
        if (cancelled) return;

        // ── Stage E: Structured per-company extraction (OpenAI × N companies) ──
        send({ type: "web_finding", content: "**Building structured datasets per company…**" });
        const numbersByCompany = extractsByCompany(bundle, "numbers");
        const strategyByCompany = extractsByCompany(bundle, "strategy");
        const performanceByCompany = extractsByCompany(bundle, "performance");
        const riskByCompany = extractsByCompany(bundle, "risk_outlook");
        const mixByCompany = extractsByCompany(bundle, "mix_and_geography");

        const datasets: CompanyDataset[] = await Promise.all(
          allCompanies.map((c) =>
            buildCompanyDataset({
              company: c.name,
              numbersExtracts: numbersByCompany.get(c.name) ?? [],
              strategyExtracts: strategyByCompany.get(c.name) ?? [],
              performanceExtracts: performanceByCompany.get(c.name) ?? [],
              riskExtracts: riskByCompany.get(c.name) ?? [],
              mixExtracts: mixByCompany.get(c.name) ?? [],
              asOfDate: asOf,
              modelId,
            }),
          ),
        );
        for (const d of datasets) {
          const totals = `${d.financials.length} period rows · ${d.strategic_moves.length} moves · ${d.asset_mix.length} mix rows`;
          send({ type: "web_finding", content: `${d.company}: ${totals}` });
        }
        if (cancelled) return;

        // ── Stage F: Deterministic report assembly (no LLM) ──
        send({ type: "web_finding", content: "**Assembling report…**" });
        const urlToTitle = new Map(allPicks.map((p) => [p.doc.url, p.doc.title]));
        const assembled = assembleReport({
          subjectCompany: plan.ownCompany.name,
          datasets,
          asOfDate: asOf,
          query,
        }, urlToTitle);

        // Stream the report as text deltas (so UI shows progressive render),
        // then emit a single `report` event so Save-as-Board has the full markdown.
        const CHUNK_SIZE = 800;
        for (let i = 0; i < assembled.markdown.length; i += CHUNK_SIZE) {
          if (cancelled) return;
          send({ type: "text", delta: assembled.markdown.slice(i, i + CHUNK_SIZE) });
        }
        send({ type: "report", content: assembled.markdown });
        send({ type: "done" });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Research failed.";
        send({ type: "error", message });
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        if (timeoutId) clearTimeout(timeoutId);
        close();
      }
    },
    cancel() {
      cancelled = true;
      abort.abort();
      if (heartbeat) clearInterval(heartbeat);
      if (timeoutId) clearTimeout(timeoutId);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

function parseJsonOrThrow<T>(raw: string, label: string): T {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(cleaned) as T;
  } catch (err) {
    throw new Error(`Failed to parse ${label} JSON: ${err instanceof Error ? err.message : "unknown"}. Raw: ${raw.slice(0, 200)}`);
  }
}
