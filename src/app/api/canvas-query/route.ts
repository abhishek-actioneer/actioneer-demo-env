import { auth } from "@clerk/nextjs/server";
import { generateText, generateTextStream, type ModelId } from "@/lib/llm";
import { generateQueries, retryWithError } from "@/lib/sql-generator";
import { executeSQL } from "@/lib/sql-executor";
import { getSystemContext, getSchemaContext } from "@/lib/schema";
import { buildTextToSqlPrompt } from "@/lib/prompts/sql";
import { getDataset, getDatasetForUser } from "@/lib/datasets";
import type { ChartSpec } from "@/lib/chart-types";
import type { CanvasCardPlan, CanvasSSEEvent } from "@/lib/canvas-sse-types";
import { sanitizeChartData, inferChartSpec } from "@/lib/chart-inference";
import {
  topologicalOrder,
} from "@/lib/canvas-graph-utils";
import { z } from "zod/v4";
import { safeStringify } from "@/lib/safe-stringify";

const CanvasQuerySchema = z.object({
  query: z.string().min(1).max(4000),
  datasetId: z.string().optional(),
  /** Parent SQL for drill-down context — helps LLM generate contextual SQL */
  parentSql: z.string().optional(),
  /** Filter hint for drill-down (e.g., "hub_name = 'Koramangala Hub'") */
  filterHint: z.string().optional(),
});

// ── Query decomposition ──

function buildDecomposePrompt(query: string, schemaContext: string): string {
  return `You are an analytics query decomposer. Decide if this question needs multiple SQL queries or just one.

Schema:
${schemaContext}

User question: "${query}"

ONLY split into multiple sub-questions when the user explicitly asks for DIFFERENT things that require DIFFERENT SQL queries (different GROUP BY, different tables, different aggregations). Examples:

SINGLE query (return 1 item):
- "what is the cancellation rate for cleaning" → [{"q":"What is the cancellation rate for cleaning services?","title":"Cancellation Rate — Cleaning"}]
- "show me revenue by month" → [{"q":"What is the revenue by month?","title":"Monthly Revenue"}]

MULTIPLE queries (return 2-3 items):
- "top customers by spend AND monthly revenue trend" → [{"q":"Top customers by total spend","title":"Top Customers by Spend"},{"q":"Monthly revenue trend","title":"Monthly Revenue Trend"}]

Rules:
- Default to 1 sub-question. Only split if the question genuinely needs separate SQL queries.
- Questions about a single topic with multiple filters are STILL 1 query, not multiple.
- "compare X and Y" is usually 1 query, not 2.
- Maximum 3 sub-questions.
- The "title" must be a short label (2-6 words), not a sentence or question. Think dashboard card title.

Return ONLY a JSON array of objects with "q" and "title" keys. No explanation. No markdown fences.`;
}

interface DecomposedQuestion {
  q: string;
  title: string;
}

function parseDecomposition(text: string): DecomposedQuestion[] | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    const arr = JSON.parse(cleaned);
    if (!Array.isArray(arr) || arr.length === 0) return null;
    // Support both old format (string[]) and new format ({q, title}[])
    return arr.slice(0, 3).map((item: unknown) => {
      if (typeof item === "string") return { q: item, title: item };
      if (typeof item === "object" && item !== null && "q" in item) {
        const obj = item as { q: string; title?: string };
        return { q: obj.q, title: obj.title || obj.q };
      }
      return null;
    }).filter((x: DecomposedQuestion | null): x is DecomposedQuestion => x !== null);
  } catch {
    return null;
  }
}

// ── Graph plan prompt ──

// ── Chart spec builder (no LLM call — uses plan config + data) ──

function buildChartSpec(
  card: CanvasCardPlan,
  rows: Record<string, unknown>[],
  columns: string[]
): ChartSpec | null {
  if (rows.length <= 1) return null;
  const cfg = card.chartConfig;
  const data = sanitizeChartData(rows.slice(0, 50));

  // If the plan includes chartConfig, use it directly
  if (cfg) {
    return {
      type: cfg.chartType,
      title: card.title,
      data,
      xKey: cfg.xKey,
      yKeys: cfg.yKeys,
      nameKey: cfg.nameKey,
      valueKey: cfg.valueKey,
      format: cfg.format,
    };
  }

  // Use the smart inference engine — it handles description-aware metric selection,
  // scale compatibility filtering, pivot detection, and chart type selection.
  const inferred = inferChartSpec(columns, rows, card.title, {
    queryDescription: card.intent || card.title,
  });
  if (inferred) return inferred;

  // Last-resort fallback for edge cases inferChartSpec can't handle
  const numericCols: string[] = [];
  const stringCols: string[] = [];
  const sample = rows[0] ?? {};
  for (const col of columns) {
    const val = sample[col];
    if (typeof val === "number" || typeof val === "bigint") numericCols.push(col);
    else stringCols.push(col);
  }
  const dateCol = stringCols.find((c) => /date|month|week|day|year|time|period/i.test(c));
  const xKey = dateCol ?? stringCols[0] ?? columns[0];
  const yKeys = numericCols.length > 0 ? numericCols.slice(0, 2) : [columns[1] ?? columns[0]];

  return {
    type: dateCol ? "line" : "bar",
    title: card.title,
    data,
    xKey,
    yKeys,
  };
}

/**
 * Programmatically build a DAG from sub-questions.
 * Each sub-question gets: sql → table → chart
 * All chart cards converge into one summary text card.
 * An annotation sticky card is appended after the summary for LLM-generated caveats.
 * This guarantees multi-branch DAGs for L3 queries — no LLM can collapse it.
 */
function buildPlanFromSubQuestions(
  subQuestions: DecomposedQuestion[],
  requestedChartType: string | null = null
): CanvasCardPlan[] {
  const cards: CanvasCardPlan[] = [];
  const leafIds: string[] = []; // chart or table ids that feed into summary
  let idx = 0;

  for (let i = 0; i < subQuestions.length; i++) {
    const { q, title: shortTitle } = subQuestions[i];

    const sqlId = `card-${idx++}`;
    const tableId = `card-${idx++}`;
    const chartId = `card-${idx++}`;

    cards.push({
      cardId: sqlId,
      type: "sql",
      title: subQuestions.length > 1 ? `Query ${i + 1}` : "Query",
      derivedFrom: [],
      intent: q,
    });

    cards.push({
      cardId: tableId,
      type: "table",
      title: shortTitle,
      derivedFrom: [sqlId],
      intent: `Show data for: ${q}`,
    });

    cards.push({
      cardId: chartId,
      type: "chart",
      title: shortTitle,
      derivedFrom: [tableId],
      intent: requestedChartType
        ? `Visualize (${requestedChartType}): ${q}`
        : `Visualize: ${q}`,
    });

    leafIds.push(chartId);
  }

  // Fan-in summary card
  cards.push({
    cardId: `card-${idx}`,
    type: "text",
    title: "Summary",
    derivedFrom: leafIds,
    intent: "Synthesize findings from all analyses above",
  });

  return cards;
}

// ── SQL card executor (extracted for parallel execution) ──

async function executeSqlCard(
  card: CanvasCardPlan,
  originalQuery: string,
  datasetId: string,
  modelId: ModelId | undefined,
  cardData: Map<string, Record<string, unknown>>,
  send: (event: CanvasSSEEvent) => void
) {
  const queries = await generateQueries(
    card.intent || originalQuery,
    "quick",
    datasetId,
    modelId
  );

  if (queries.length === 0) {
    cardData.set(card.cardId, { error: "No SQL generated" });
    send({
      type: "card-data",
      cardId: card.cardId,
      cardType: "sql",
      sql: "-- No SQL generated",
      description: card.intent || originalQuery,
    });
    return;
  }

  let q = queries[0];
  send({
    type: "card-data",
    cardId: card.cardId,
    cardType: "sql",
    sql: q.sql,
    description: q.description,
  });

  send({ type: "progress", cardId: card.cardId, phase: "executing_sql" });
  let result = await executeSQL(q.sql, datasetId);

  // Retry on error
  if (result.error) {
    try {
      const fixedSQL = await retryWithError(
        originalQuery,
        q.sql,
        result.error,
        datasetId,
        modelId
      );
      if (fixedSQL && fixedSQL !== "UNSUPPORTED_QUERY") {
        q = { ...q, sql: fixedSQL };
        result = await executeSQL(fixedSQL, datasetId);
        send({
          type: "card-data",
          cardId: card.cardId,
          cardType: "sql",
          sql: q.sql,
          description: q.description,
        });
      }
    } catch {
      // Retry failed
    }
  }

  cardData.set(card.cardId, {
    sql: q.sql,
    description: q.description,
    columns: result.columns,
    rows: result.rows.slice(0, 100),
    rowCount: result.rowCount,
    timeMs: result.executionTimeMs,
    error: result.error || undefined,
  });
}

// ── Main handler ──

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = CanvasQuerySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }

  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { query, datasetId: bodyDatasetId, parentSql, filterHint } = parsed.data;
  const datasetId = bodyDatasetId || req.headers.get("x-dataset-id");
  if (!datasetId) {
    return Response.json({ error: "x-dataset-id header is required" }, { status: 400 });
  }
  if (!getDatasetForUser(datasetId, userId)) return Response.json({ error: "Not found" }, { status: 404 });
  const modelId = (req.headers.get("x-model-id") ?? undefined) as
    | ModelId
    | undefined;

  const ds = getDataset(datasetId);
  const systemContext = getSystemContext(datasetId);
  const schemaContext = getSchemaContext(datasetId);
  const queryGroupId = crypto.randomUUID();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;

      function send(event: CanvasSSEEvent) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(safeStringify(event) + "\n"));
        } catch {
          closed = true;
        }
      }

      try {
        // ── Step 1: Decompose query into sub-questions ──
        // For drill-down flows (parentSql present), skip decomposition — it's a focused follow-up
        let subQuestions: DecomposedQuestion[] = [{ q: query, title: query }]; // default: single question

        // Build enriched query for drill-down context
        const effectiveQuery = parentSql
          ? `Based on this parent SQL:\n${parentSql}\n${filterHint ? `Apply filter: ${filterHint}\n` : ""}\nDrill-down question: ${query}`
          : query;

        if (!parentSql) {
          try {
            const decomposePrompt = buildDecomposePrompt(query, schemaContext);
            const decomposeText = await generateText(decomposePrompt, {
              modelId,
              timeoutMs: 15_000,
              label: "canvas-decompose",
            });
            const parsed = parseDecomposition(decomposeText);
            if (parsed && parsed.length > 0) {
              subQuestions = parsed;
              console.log(`[canvas-query] Decomposed into ${subQuestions.length} sub-questions:`, subQuestions);
            }
          } catch (err) {
            console.warn("[canvas-query] Decomposition failed, using single question:", err);
          }
        }

        // ── Step 2: Build the graph plan from sub-questions ──
        // Programmatic DAG construction — no LLM call for graph structure.
        // Each sub-question gets: sql → table → chart. All converge into a summary.
        // Extract chart type from original query before decomposition erases it.
        const CHART_TYPE_PATTERN = /\b(scatter|pie|bar|line|area|histogram)\b/i;
        const requestedChartType = CHART_TYPE_PATTERN.exec(query)?.[1]?.toLowerCase() ?? null;
        const plan = buildPlanFromSubQuestions(subQuestions, requestedChartType);

        // Emit the plan
        send({ type: "plan", cards: plan, queryGroupId });

        // ── Step 3: Execute plan in topological order ──
        const ordered = topologicalOrder(plan);

        // Accumulated data per card for downstream cards to reference
        const cardData = new Map<
          string,
          {
            sql?: string;
            description?: string;
            columns?: string[];
            rows?: Record<string, unknown>[];
            rowCount?: number;
            timeMs?: number;
            error?: string;
            chartSpec?: ChartSpec;
            text?: string;
            metricValue?: string | number;
            metricLabel?: string;
          }
        >();

        // ── Run all SQL cards in parallel first ──
        const sqlCards = ordered.filter((c) => c.type === "sql");
        const nonSqlCards = ordered.filter((c) => c.type !== "sql");

        await Promise.all(
          sqlCards.map(async (card) => {
            send({ type: "progress", cardId: card.cardId, phase: "generating_sql" });
            try {
              await executeSqlCard(card, effectiveQuery, datasetId, modelId, cardData, send);
            } catch (err) {
              console.error(`[canvas-query] SQL card ${card.cardId} failed:`, err);
              cardData.set(card.cardId, { error: String(err) });
              send({ type: "error", cardId: card.cardId, message: "SQL generation failed" });
            }
            send({ type: "card-complete", cardId: card.cardId });
          })
        );

        // ── Then run non-SQL cards sequentially (they depend on SQL results) ──
        for (const card of nonSqlCards) {
          send({ type: "progress", cardId: card.cardId, phase: "starting" });

          if (card.type === "sql") {
            // Already handled in parallel above
            continue;
          } else if (card.type === "table") {
            // Table card: find upstream SQL card data
            const upstreamData = findUpstreamData(card, cardData);
            if (upstreamData?.rows && !upstreamData.error) {
              send({
                type: "card-data",
                cardId: card.cardId,
                cardType: "query_result",
                columns: upstreamData.columns ?? [],
                rows: upstreamData.rows,
                rowCount: upstreamData.rowCount ?? upstreamData.rows.length,
                timeMs: upstreamData.timeMs ?? 0,
              });
              cardData.set(card.cardId, upstreamData);
            } else {
              send({
                type: "card-data",
                cardId: card.cardId,
                cardType: "query_result",
                columns: [],
                rows: [],
                rowCount: 0,
                timeMs: 0,
                error: upstreamData?.error ?? "No upstream data",
              });
              cardData.set(card.cardId, {
                error: upstreamData?.error ?? "No upstream data",
              });
            }
            send({ type: "card-complete", cardId: card.cardId });
          } else if (card.type === "chart") {
            // Chart card: build spec directly from plan's chartConfig + upstream data
            // No second LLM call — the plan already specifies chart configuration
            const upstreamData = findUpstreamData(card, cardData);
            const rows = upstreamData?.rows;
            const columns = upstreamData?.columns ?? [];

            if (rows && rows.length > 0 && !upstreamData?.error) {
              // Scalar result (1 row) → demote to metric card
              if (rows.length === 1) {
                const firstRow = rows[0];
                const cols = Object.keys(firstRow);
                let value: string | number = "N/A";
                let label = card.title;
                for (const col of cols) {
                  const v = firstRow[col];
                  if (typeof v === "number" || typeof v === "bigint") {
                    value = Number(v);
                    label = col;
                  }
                }
                send({ type: "card-data", cardId: card.cardId, cardType: "metric", value, label });
                cardData.set(card.cardId, { metricValue: value, metricLabel: label });
                send({ type: "card-complete", cardId: card.cardId });
                continue;
              }
              const chartSpec = buildChartSpec(card, rows, columns);
              if (chartSpec) {
                // Attach SQL from upstream so the chart card has Data > SQL view
                if (upstreamData?.sql) chartSpec.sql = upstreamData.sql as string;
                send({
                  type: "card-data",
                  cardId: card.cardId,
                  cardType: "chart",
                  chartSpec,
                });
                cardData.set(card.cardId, { ...upstreamData, chartSpec });
              } else {
                // buildChartSpec returned null — fall through to table display
                send({
                  type: "card-data",
                  cardId: card.cardId,
                  cardType: "query_result",
                  rows: rows.slice(0, 500),
                  columns,
                  rowCount: rows.length,
                  timeMs: 0,
                });
                cardData.set(card.cardId, { rows, columns });
              }
            } else {
              // No upstream data — emit empty card
              cardData.set(card.cardId, { error: "No upstream data for chart" });
            }
            send({ type: "card-complete", cardId: card.cardId });
          } else if (card.type === "metric") {
            // Metric card: extract single value from upstream
            const upstreamData = findUpstreamData(card, cardData);
            if (
              upstreamData?.rows &&
              upstreamData.rows.length > 0 &&
              !upstreamData.error
            ) {
              const firstRow = upstreamData.rows[0];
              const cols = Object.keys(firstRow);
              // Use the last numeric column as the value
              let value: string | number = "N/A";
              let label = card.title;
              for (const col of cols) {
                const v = firstRow[col];
                if (typeof v === "number" || typeof v === "bigint") {
                  value = Number(v);
                  label = col;
                }
              }
              send({
                type: "card-data",
                cardId: card.cardId,
                cardType: "metric",
                value,
                label,
              });
              cardData.set(card.cardId, {
                metricValue: value,
                metricLabel: label,
              });
            }
            send({ type: "card-complete", cardId: card.cardId });
          } else if (card.type === "text") {
            // Text/summary card: synthesize from all upstream cards
            const upstreamCards = card.derivedFrom
              .map((id) => ({ id, data: cardData.get(id) }))
              .filter((c) => c.data);

            const contextBlocks = upstreamCards
              .map((c) => {
                const d = c.data!;
                if (d.sql) {
                  const preview = safeStringify(
                    (d.rows ?? []).slice(0, 30)
                  );
                  return `SQL: ${d.sql}\nDescription: ${d.description ?? ""}\nResults (${d.rowCount ?? 0} rows):\n${preview}`;
                }
                if (d.metricValue !== undefined) {
                  return `Metric: ${d.metricLabel} = ${d.metricValue}`;
                }
                if (d.text) {
                  return `Summary: ${d.text}`;
                }
                if (d.error) {
                  return `Error: ${d.error}`;
                }
                return "";
              })
              .filter(Boolean)
              .join("\n\n---\n\n");

            const summaryPrompt = `${systemContext}

This is a canvas card summary. Be concise (under 200 words). Lead with the direct answer.

You analyzed the following data from a real ${ds.label} dataset:

${contextBlocks}

Using ONLY the data above, directly answer: "${effectiveQuery}"

Cite specific numbers. If any data was unavailable, note it briefly. Stay focused.`;

            const genStream = await generateTextStream(summaryPrompt, {
              modelId,
            });
            let fullText = "";
            for await (const text of genStream) {
              fullText += text;
              send({
                type: "card-data",
                cardId: card.cardId,
                cardType: "text",
                delta: text,
              });
            }
            cardData.set(card.cardId, { text: fullText });
            send({ type: "card-complete", cardId: card.cardId });

          }
        }

        // ── Generate schema-aware follow-up questions for all card types ──
        try {
          const cardSummaryLines = ordered.map((c) => {
            const d = cardData.get(c.cardId);
            if (!d) return `- ${c.type} card: "${c.title}" (no data)`;
            const parts = [`- ${c.type} card: "${c.title}"`];
            if (d.rowCount != null) parts.push(`${d.rowCount} rows`);
            if (d.chartSpec) parts.push("has chart");
            if (d.metricValue != null) parts.push(`value=${d.metricValue}`);
            if (d.error) parts.push(`error: ${d.error}`);
            return parts.join(" — ");
          }).join("\n");

          const hasEmptyResults = ordered.some((c) => {
            const d = cardData.get(c.cardId);
            return d && (d.rowCount === 0 || d.error);
          });

          const followUpPrompt = `${buildTextToSqlPrompt(datasetId)}

The user just asked: "${effectiveQuery}"

Cards generated:
${cardSummaryLines}

Generate 2-3 follow-up questions that:
1. Are contextual to the specific charts and data shown above
2. Can be answered by writing SQL against the schema provided
3. Help the user explore deeper (drill-down, compare, filter, trend over time)
${hasEmptyResults ? "\nAt least one card had errors or 0 rows — include a question that helps debug or find the right data." : ""}

Output ONLY a JSON array of strings. Example: ["What is X?", "Show me Y", "How does Z compare?"]`;

          const followUpText = await generateText(followUpPrompt, {
            timeoutMs: 8_000,
            label: "canvas-follow-ups",
            maxOutputTokens: 256,
          });
          const cleaned = followUpText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
          const questions: string[] = (() => {
            try {
              const arr = JSON.parse(cleaned);
              if (Array.isArray(arr) && arr.every((s: unknown) => typeof s === "string")) return arr.slice(0, 3);
            } catch { /* ignore */ }
            return [];
          })();

          // Find the last text card to attach follow-ups to, or use the last card
          const targetCard = ordered.findLast((c) => c.type === "text") ?? ordered[ordered.length - 1];
          if (questions.length > 0 && targetCard) {
            send({ type: "suggestions", questions, targetCardId: targetCard.cardId, queryGroupId });
          }
        } catch {
          // Non-fatal — emit generic fallback follow-ups
          const fallbackQuestions = [
            "How does this trend over the past 30 days?",
            "Break this down by category or segment",
            "What are the top 10 by this metric?",
          ];
          const targetCard = ordered.findLast((c) => c.type === "text") ?? ordered[ordered.length - 1];
          if (targetCard) {
            send({ type: "suggestions", questions: fallbackQuestions, targetCardId: targetCard.cardId, queryGroupId });
          }
        }

        // ── Generate annotations — LLM decides which cards need caveats ──
        // Keep prompt lean: card type + title + row count only, no SQL.
        try {
          const cardSummaries = ordered
            .map((c) => {
              const d = cardData.get(c.cardId);
              if (!d) return null;
              const parts = [`[${c.cardId}] ${c.type}: "${c.title}"`];
              if (d.rowCount != null) parts.push(`${d.rowCount} rows`);
              if (d.error) parts.push(`error: ${d.error}`);
              return parts.join(" — ");
            })
            .filter(Boolean)
            .join("\n");

          const annotationPrompt = `Review these analytics cards and flag caveats (data quality, small samples, aggregation issues). Output JSON array: [{"targetCardId":"card-X","text":"..."}]. Max 20 words each. 0-2 annotations. Return [] if nothing to flag. No markdown.

Cards:\n${cardSummaries}\n\nQuestion: "${query}"`;

          let annotationText: string | null = null;
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              annotationText = await generateText(annotationPrompt, {
                timeoutMs: 15_000,
                label: "canvas-annotations",
                maxOutputTokens: 256,
              });
              break;
            } catch {
              if (attempt === 0) console.warn("[annotations] attempt 1 failed, retrying...");
            }
          }

          if (annotationText) {
            const annotations = parseAnnotations(annotationText, ordered);
            if (annotations.length > 0) {
              send({ type: "annotations", items: annotations, queryGroupId });
            }
          }
        } catch {
          // Non-fatal — skip annotations entirely
        }

        send({ type: "done", queryGroupId });
      } catch (err) {
        console.error("[canvas-query] error:", err);
        send({
          type: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        });
      } finally {
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}

// ── Helpers ──

/** Find the best upstream data for a card by traversing its derivedFrom chain */
function findUpstreamData(
  card: CanvasCardPlan,
  cardData: Map<string, Record<string, unknown>>
): {
  sql?: string;
  description?: string;
  columns?: string[];
  rows?: Record<string, unknown>[];
  rowCount?: number;
  timeMs?: number;
  error?: string;
  chartSpec?: ChartSpec;
} | null {
  // Check direct parents first
  for (const parentId of card.derivedFrom) {
    const data = cardData.get(parentId);
    if (data && data.rows && !data.error) {
      return data as ReturnType<typeof findUpstreamData>;
    }
  }
  // Fall back to any parent with data (even with error)
  for (const parentId of card.derivedFrom) {
    const data = cardData.get(parentId);
    if (data) return data as ReturnType<typeof findUpstreamData>;
  }
  return null;
}

/** Parse LLM annotation output into validated items, filtering to real card IDs */
function parseAnnotations(
  text: string,
  plan: CanvasCardPlan[]
): Array<{ targetCardId: string; text: string }> {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    const arr = JSON.parse(cleaned);
    if (!Array.isArray(arr)) return [];
    const validIds = new Set(plan.map((c) => c.cardId));
    return arr
      .filter(
        (item: unknown): item is { targetCardId: string; text: string } =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as Record<string, unknown>).targetCardId === "string" &&
          typeof (item as Record<string, unknown>).text === "string" &&
          validIds.has((item as Record<string, unknown>).targetCardId as string)
      )
      .slice(0, 3); // cap at 3 annotations max
  } catch {
    return [];
  }
}
