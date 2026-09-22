/**
 * Deep extraction via Parallel's Task API (instead of the cheap /extract tool).
 *
 * Per picked doc, fires a Deep Research task instructing Parallel to read that
 * specific PDF and return structured JSON with field-level citations. Slower
 * (1–3 min per task) and more expensive than /extract, but gives structured,
 * grounded numbers instead of prose blob — which is what the synthesis stage
 * needs to assemble a reliable Snapshot table.
 */

import { createTask, streamTaskEvents, fetchTaskResult, ParallelError } from "@/lib/parallel-client";
import type { PickedDoc } from "./ir-doc-picker";

export interface DeepExtractFields {
  // Balance sheet / scale
  aum_inr_cr?: number | null;
  aum_yoy_pct?: number | null;
  disbursements_inr_cr?: number | null;
  net_worth_inr_cr?: number | null;

  // P&L
  total_income_inr_cr?: number | null;
  nii_inr_cr?: number | null;
  pat_inr_cr?: number | null;
  pat_yoy_pct?: number | null;

  // Asset quality
  gnpa_pct?: number | null;
  nnpa_pct?: number | null;

  // Margins / returns
  nim_pct?: number | null;
  roa_pct?: number | null;
  roe_pct?: number | null;
  crar_pct?: number | null;

  // Operations
  branches?: number | null;
  employees?: number | null;
  avg_ticket_size_inr_lakh?: number | null;
  customers?: number | null;

  // Period the numbers apply to (LLM-stated, e.g. "FY25", "Q4 FY26")
  reporting_period?: string | null;

  // Strategic narrative
  strategic_moves?: Array<{ date?: string; description: string; quote?: string }> | null;
  mda_highlights?: string[] | null;

  // For each numeric field, the LLM should also provide a quote substring
  // proving the source. Stored as separate keys with "_quote" suffix.
  [field: `${string}_quote`]: string | undefined;
}

export interface DeepExtractResult {
  // Identity
  url: string;
  title: string;
  type: PickedDoc["type"];
  period?: string;
  reason: string;

  // Run metadata
  runId: string;
  status: "completed" | "failed" | "timed_out";
  durationMs: number;

  // Output
  fields?: DeepExtractFields;
  citations?: unknown[];
  rawMarkdown?: string;
  error?: string;
}

const TASK_TIMEOUT_MS = 5 * 60 * 1000; // 5 min per task

function buildTaskInput(doc: PickedDoc): string {
  const docTypeLabel = doc.type.replace(/_/g, " ");
  const periodHint = doc.period ? ` covering the period ${doc.period}` : "";

  return `You are extracting structured data from a single PDF document for a competitor research report.

CRITICAL: Read ONLY the document at this exact URL. Do NOT do additional web searches. Do NOT fetch other documents. Do NOT use external knowledge.

Document URL: ${doc.url}
Document title: ${doc.title}
Document type: ${docTypeLabel}${periodHint}

Your job: extract the financial metrics listed below. For each field:
- Return the exact number stated in the document
- For percentages, return the decimal value WITHOUT a "%" suffix (e.g. 5.5, not "5.5%")
- For currency amounts in Indian Crores, return the number in Crores (e.g. 11423 for ₹11,423 Cr)
- If the field is NOT stated in the document, return null
- For each numeric field, also include a "<field>_quote" key with the exact text snippet from the document that contains the number (≤120 chars)

Fields to extract:
- aum_inr_cr — Assets Under Management at end of the most recent reported period, in INR Crores
- aum_yoy_pct — AUM year-on-year growth %
- disbursements_inr_cr — Total disbursements during the most recent FY in INR Crores
- net_worth_inr_cr — Net worth / total equity at end of the most recent FY
- total_income_inr_cr — Total income / revenue for the most recent FY
- nii_inr_cr — Net Interest Income for the most recent FY
- pat_inr_cr — Profit After Tax for the most recent FY
- pat_yoy_pct — PAT YoY growth %
- gnpa_pct — Gross NPA % at end of the most recent reported period
- nnpa_pct — Net NPA % at end of the most recent reported period
- nim_pct — Net Interest Margin %
- roa_pct — Return on Assets %
- roe_pct — Return on Equity %
- crar_pct — Capital Adequacy Ratio (CRAR) %
- branches — Total branch count at end of the most recent reported period
- employees — Total employee count
- avg_ticket_size_inr_lakh — Average loan ticket size in INR Lakh
- customers — Total customer count if disclosed
- reporting_period — The fiscal period these numbers cover (e.g. "FY25", "Q4 FY26", "FY26")
- strategic_moves — Array of recent strategic actions stated in the document. Each item: { "date": "YYYY-MM if available", "description": "brief", "quote": "exact text from doc" }. Capital raises, M&A, leadership changes, geographic expansion, regulatory actions, new product launches.
- mda_highlights — Array of 3-5 short strings (≤200 chars each) summarising key Management Discussion & Analysis points or earnings-call narrative beats from the document.

Return JSON only — no prose, no markdown fences. Schema:

{
  "aum_inr_cr": <number|null>,
  "aum_inr_cr_quote": "<exact quote ≤120 chars>",
  "aum_yoy_pct": <number|null>,
  ... (all fields above),
  "strategic_moves": [{...}, ...],
  "mda_highlights": ["...", "..."]
}`;
}

function parseJsonFields(raw: string): DeepExtractFields | undefined {
  if (!raw) return undefined;
  // Strip markdown fences if Parallel wrapped the JSON
  const cleaned = raw.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as DeepExtractFields;
    }
  } catch {
    // Try to find a JSON object inside the markdown
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as DeepExtractFields;
      } catch {
        // give up
      }
    }
  }
  return undefined;
}

export async function deepExtractDoc(doc: PickedDoc, signal?: AbortSignal): Promise<DeepExtractResult> {
  const startedAt = Date.now();
  const base: Omit<DeepExtractResult, "runId" | "status" | "durationMs"> = {
    url: doc.url,
    title: doc.title,
    type: doc.type,
    period: doc.period,
    reason: doc.reason,
  };

  let runId = "";

  try {
    const input = buildTaskInput(doc);
    const task = await createTask({ input, processor: "pro-fast", signal });
    runId = task.runId;

    // Watch SSE events until terminal state.
    let terminal: string | null = null;
    const startedStreaming = Date.now();
    for await (const event of streamTaskEvents(task.runId, signal)) {
      if (Date.now() - startedStreaming > TASK_TIMEOUT_MS) {
        terminal = "timed_out";
        break;
      }
      if (event.type === "task_run.state") {
        const status = (event as { status?: string }).status;
        if (status === "completed" || status === "failed" || status === "cancelled") {
          terminal = status;
          break;
        }
      }
    }

    if (terminal === "failed" || terminal === "cancelled") {
      return { ...base, runId, status: "failed", durationMs: Date.now() - startedAt, error: `task ${terminal}` };
    }
    if (terminal === "timed_out") {
      return { ...base, runId, status: "timed_out", durationMs: Date.now() - startedAt, error: "task timed out" };
    }

    const result = await fetchTaskResult(task.runId, signal);
    const fields = parseJsonFields(result.markdown);

    return {
      ...base,
      runId,
      status: "completed",
      durationMs: Date.now() - startedAt,
      fields,
      citations: result.basis,
      rawMarkdown: result.markdown,
    };
  } catch (err) {
    const message = err instanceof ParallelError
      ? `Parallel error: ${err.message}`
      : err instanceof Error ? err.message : String(err);
    return { ...base, runId, status: "failed", durationMs: Date.now() - startedAt, error: message };
  }
}

export async function deepExtractAll(docs: PickedDoc[], signal?: AbortSignal): Promise<DeepExtractResult[]> {
  return Promise.all(docs.map((d) => deepExtractDoc(d, signal)));
}
