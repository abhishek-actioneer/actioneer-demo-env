import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { getDatasetForUser } from "@/lib/datasets";
import { executeSQL } from "@/lib/sql-executor";
import { runConcurrent } from "@/lib/concurrent";
import type { Slide } from "@/lib/deck-types";
import { buildTextToSqlPrompt, OUTPUT_SQL_ONLY } from "@/lib/prompts/sql";
import type { ChartSpec } from "@/lib/chart-types";
import { generateJson, generateJsonWithMedia, generateText } from "@/lib/llm";

export const maxDuration = 300;
export const runtime = "nodejs";

const SLIDE_SCHEMA = {
  type: "object",
  properties: {
    slides: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "number" },
          title: { type: "string" },
          commentaryText: { type: "string" },
          charts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                chartType: { type: "string", enum: ["line", "bar", "pie", "area", "scatter", "none"] },
                metric: { type: "string" },
                xAxisLabel: { type: "string" },
                yAxisLabel: { type: "string" },
                timeGranularity: { type: "string" },
                dateRangeText: { type: "string" },
              },
              required: ["chartType", "metric"],
            },
          },
        },
        required: ["index", "title", "charts"],
      },
    },
    deckTitle: { type: "string" },
    deckReviewDate: { type: "string" },
  },
  required: ["slides"],
};

const ExtractedChartSchema = z.object({
  chartType: z.enum(["line", "bar", "pie", "area", "scatter", "none"]),
  metric: z.string().max(300),
  xAxisLabel: z.string().max(200).optional(),
  yAxisLabel: z.string().max(200).optional(),
  timeGranularity: z.string().max(100).optional(),
  dateRangeText: z.string().max(100).optional(),
});

const ExtractedSlideSchema = z.object({
  index: z.number(),
  title: z.string().max(200),
  commentaryText: z.string().max(1000).optional(),
  charts: z.array(ExtractedChartSchema),
});

const ExtractionSchema = z.object({
  slides: z.array(ExtractedSlideSchema),
  deckTitle: z.string().max(200).optional(),
  deckReviewDate: z.string().max(100).optional(),
});

type ExtractionResult = z.infer<typeof ExtractionSchema>;
type ExtractedChart = z.infer<typeof ExtractedChartSchema>;

const EXTRACTION_PROMPT = `You are analyzing a PDF business review deck.
For each slide, extract:
- index: slide number (0-based)
- title: the slide title
- commentaryText: any commentary or insight text on the slide (max 1000 chars)
- charts: an array of ALL distinct charts or metrics on this slide. A slide showing Revenue, Orders, and AOV separately should produce 3 chart entries.

For each chart entry:
- chartType: one of "line", "bar", "pie", "area", "scatter", or "none" if no chart
- metric: the key metric or data being shown (e.g. "Daily Active Users", "Revenue by Region", "Top 5 Brands by Revenue")
- xAxisLabel: x-axis label if present
- yAxisLabel: y-axis label if present
- timeGranularity: "daily", "weekly", "monthly", "quarterly", "yearly" if time-series
- dateRangeText: any explicit date range mentioned on the slide (e.g. "Nov 1-7", "Q4 2019", "Oct 1 - Oct 31"), or omit if none

For text-only slides with no charts, include a single chart entry with chartType "none".

Also extract deckTitle: the overall deck title.
Also extract deckReviewDate: the end date of the review period from the deck title or header in ISO 8601 format (YYYY-MM-DD) (e.g., for "W4 · Jan 20 – 26, 2025", deckReviewDate would be "2025-01-26"). Omit if no review period is apparent.
Return valid JSON matching the schema.`;

function sanitize(s: string | undefined, maxLen: number): string {
  if (!s) return "";
  return s.slice(0, maxLen);
}

function wrapInDelimiters(content: string): string {
  return `[SLIDE CONTEXT START]\n${content}\n[SLIDE CONTEXT END]`;
}

/** Strip leading SQL comments and code fences that LLMs sometimes emit. */
function cleanGeneratedSQL(raw: string): string {
  let sql = raw.trim();
  // Strip code fences (```sql ... ``` or ``` ... ```)
  sql = sql.replace(/^```(?:sql)?\n?/i, "").replace(/\n?```$/i, "").trim();
  // Strip leading -- comment lines
  sql = sql.replace(/^(--[^\n]*\n)+/g, "").trim();
  return sql;
}

function buildChartSpec(
  chartType: string,
  data: Record<string, string | number>[],
  chart: ExtractedChart,
  slideTitle: string,
): ChartSpec | null {
  if (chartType === "none" || data.length === 0) return null;

  const keys = Object.keys(data[0] ?? {});
  if (keys.length < 2) return null;

  const xAxisHint = chart.xAxisLabel?.toLowerCase().slice(0, 5) ?? "";
  const xKey = xAxisHint
    ? (keys.find((k) => k.toLowerCase().includes(xAxisHint)) ?? keys[0])
    : keys[0];
  const yKey = keys.find((k) => k !== xKey && typeof data[0][k] === "number") ?? keys[1];

  const validTypes = ["line", "bar", "pie", "area"] as const;
  const type: ChartSpec["type"] = validTypes.includes(chartType as (typeof validTypes)[number])
    ? (chartType as ChartSpec["type"])
    : "bar";

  return {
    type,
    ...(type === "pie"
      ? { nameKey: xKey, valueKey: yKey }
      : { xKey, yKeys: [yKey] }),
    data: data as Record<string, string | number>[],
    title: slideTitle,
    ...(chart.xAxisLabel && { xAxisLabel: chart.xAxisLabel }),
    ...(chart.yAxisLabel && { yAxisLabel: chart.yAxisLabel }),
  };
}

async function generateSQL(
  sqlPrompt: string,
  metricContext: string,
  chart: ExtractedChart,
  priorError?: string,
  dateRangeText?: string,
): Promise<string> {
  const errorHint = priorError
    ? `\n\nPrevious attempt failed with: ${priorError}\nFix the query accordingly.`
    : "";
  const dateHint = dateRangeText
    ? `\nDate filter: ${dateRangeText}. You MUST add a WHERE clause to restrict data to this date range.`
    : "";
  const result = await generateText(`${sqlPrompt}\n\nGenerate a single SQL SELECT query to retrieve data for: ${metricContext}\n\nChart type: ${chart.chartType}\nX-axis: ${chart.xAxisLabel ?? "auto"}\nY-axis: ${chart.yAxisLabel ?? "auto"}\nTime granularity: ${chart.timeGranularity ?? "auto"}${dateHint}\n\n${OUTPUT_SQL_ONLY}${errorHint}`, {
    label: "deck-process-sql",
    timeoutMs: 30_000,
    maxOutputTokens: 1024,
  });
  return cleanGeneratedSQL(result);
}

async function processOneChart(
  chart: ExtractedChart,
  slideTitle: string,
  datasetId: string,
  dateRangeText?: string,
): Promise<{ sql: string; data: Record<string, string | number>[]; chartSpec: ChartSpec | null }> {
  const metricContext = wrapInDelimiters(sanitize(chart.metric, 300));
  const sqlPrompt = buildTextToSqlPrompt(datasetId, dateRangeText ? { dateRangeOverride: dateRangeText } : undefined);

  let sql = "";
  let data: Record<string, string | number>[] = [];
  let chartSpec: ChartSpec | null = null;

  try {
    sql = await generateSQL(sqlPrompt, metricContext, chart, undefined, dateRangeText);

    let queryResult = await executeSQL(sql, datasetId);

    if (queryResult.error) {
      console.error(`[deck-process] SQL error for "${slideTitle}" / "${chart.metric}": ${queryResult.error}\nSQL: ${sql}`);
      sql = await generateSQL(sqlPrompt, metricContext, chart, queryResult.error, dateRangeText);
      queryResult = await executeSQL(sql, datasetId);
      if (queryResult.error) {
        console.error(`[deck-process] Retry also failed for "${slideTitle}" / "${chart.metric}": ${queryResult.error}\nSQL: ${sql}`);
      }
    }

    if (queryResult.rows && queryResult.rows.length > 0) {
      data = queryResult.rows.slice(0, 500) as Record<string, string | number>[];
    }

    chartSpec = buildChartSpec(chart.chartType, data, chart, slideTitle);
  } catch (err) {
    console.error(`[deck-process] Unexpected error for "${slideTitle}" / "${chart.metric}":`, err);
  }

  return { sql, data, chartSpec };
}

async function processSlide(
  extracted: z.infer<typeof ExtractedSlideSchema>,
  datasetId: string,
  deckReviewDate?: string,
): Promise<Omit<Slide, "commentaryThreadId" | "chatThreadId">> {
  // Filter out "none" chart entries
  const chartsToProcess = extracted.charts.filter((c) => c.chartType !== "none");

  // Process all charts in parallel (up to 3 concurrent handled by outer runConcurrent per slide)
  const chartResults = await Promise.all(
    chartsToProcess.map((chart) => {
      const effectiveDate = chart.dateRangeText
        ?? (deckReviewDate ? `data up to ${deckReviewDate}` : undefined);
      return processOneChart(chart, extracted.title, datasetId, effectiveDate);
    }),
  );

  // Collect valid chart specs
  const chartSpecs: ChartSpec[] = chartResults.flatMap((r) => (r.chartSpec ? [r.chartSpec] : []));

  // First chart's sql/data used for backward-compat fields and commentary
  const firstResult = chartResults[0] ?? { sql: "", data: [] };
  const sql = firstResult.sql;
  const firstData = firstResult.data;

  let commentary = extracted.commentaryText ?? "";
  let followUps: string[] = [];

  try {
    // Build data samples for all charts
    const dataSamples = chartResults.map((r, i) => ({
      metric: chartsToProcess[i]?.metric ?? "",
      sample: r.data.slice(0, 5),
    }));
    const dataPreview = JSON.stringify(dataSamples);

    const commentaryPrompt = `Based on this slide data, provide:
1. commentary: A 2-3 sentence analysis insight
2. followUps: 3 follow-up questions an analyst might ask
3. chartTitles: An array of concise, descriptive chart titles derived from the actual data (one per chart). Titles should reflect what the data shows (e.g. "Top 5 Brands by Revenue Q1 2024"), not just the slide title.

Slide: ${wrapInDelimiters(sanitize(extracted.title, 200))}
Charts and data samples: ${dataPreview}

Return JSON: { "commentary": string, "followUps": string[], "chartTitles": string[] }`;

    const parsed = await generateJson<{
      commentary?: string;
      followUps?: unknown[];
      chartTitles?: unknown[];
    }>(commentaryPrompt, {
      label: "deck-process-commentary",
      timeoutMs: 30_000,
      maxOutputTokens: 2048,
    });
    commentary =
      typeof parsed.commentary === "string" ? parsed.commentary.slice(0, 500) : commentary;
    followUps = Array.isArray(parsed.followUps)
      ? parsed.followUps.slice(0, 3).map((q: unknown) => String(q).slice(0, 200))
      : [];

    // Apply generated titles to chart specs
    if (Array.isArray(parsed.chartTitles)) {
      parsed.chartTitles.forEach((t: unknown, i: number) => {
        if (chartSpecs[i] && typeof t === "string" && t.trim()) {
          chartSpecs[i].title = t.trim().slice(0, 200);
        }
      });
    }
  } catch {
    // Commentary failure — use extracted text
  }

  return {
    id: crypto.randomUUID(),
    index: extracted.index,
    title: sanitize(extracted.title, 200),
    status: "ok",
    chartSpecs,
    sql,
    data: firstData.slice(0, 10),
    lastRefreshed: Date.now(),
    commentary,
    followUps,
  };
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const datasetId = req.headers.get("x-dataset-id");
  if (!datasetId) {
    return NextResponse.json({ error: "Missing x-dataset-id header" }, { status: 400 });
  }

  if (!getDatasetForUser(datasetId, userId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  if (file.type !== "application/pdf") {
    return NextResponse.json({ error: "File must be a PDF" }, { status: 422 });
  }

  if (file.size > 50 * 1024 * 1024) {
    return NextResponse.json({ error: "File too large (max 50 MB)" }, { status: 422 });
  }

  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");

  const deckId = crypto.randomUUID();

  const abortController = new AbortController();
  req.signal.addEventListener("abort", () => abortController.abort(), { once: true });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      function send(event: object) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          closed = true;
        }
      }

      try {
        send({ type: "progress", stage: "uploading_file" });

        // Heartbeat: keep connection alive during long file processing
        let heartbeatStage = "uploading_file";
        const heartbeat = setInterval(() => {
          send({ type: "progress", stage: heartbeatStage });
        }, 10_000);

        let extractionData: ExtractionResult;
        try {
          const buffer = await file.arrayBuffer();
          send({ type: "progress", stage: "processing_file" });
          heartbeatStage = "processing_file";

          send({ type: "progress", stage: "reading_slides" });
          heartbeatStage = "reading_slides";
          const extraction = await generateJsonWithMedia<unknown>(
            [
              {
                type: "file",
                filename: file.name,
                mimeType: "application/pdf",
                fileData: `data:application/pdf;base64,${Buffer.from(buffer).toString("base64")}`,
              },
              { type: "text", text: EXTRACTION_PROMPT },
            ],
            {
              label: "deck-process-extraction",
              timeoutMs: 120_000,
              maxOutputTokens: 12000,
              jsonSchema: { name: "deck_extraction", schema: SLIDE_SCHEMA, strict: false },
            },
          );

          try {
            extractionData = ExtractionSchema.parse(extraction);
          } catch {
            throw new Error("Failed to parse extraction response from OpenAI");
          }
        } finally {
          clearInterval(heartbeat);
        }

        const deckName =
          sanitize(extractionData.deckTitle, 200) || file.name.replace(/\.pdf$/i, "");

        // Filter out slides with no actual charts (all entries are "none")
        const slidesToProcess = extractionData.slides.filter((s) =>
          s.charts.some((c) => c.chartType !== "none"),
        );

        // Send extraction metadata so client can build skeleton sections immediately
        send({
          type: "extraction_complete",
          count: slidesToProcess.length,
          deckTitle: deckName,
          deckId,
          slides: slidesToProcess.map((s) => ({
            index: s.index,
            title: sanitize(s.title, 200),
            charts: s.charts
              .filter((c) => c.chartType !== "none")
              .map((c) => ({ chartType: c.chartType, metric: sanitize(c.metric, 300) })),
          })),
        });

        send({ type: "total", count: slidesToProcess.length });

        const factories = slidesToProcess.map((extracted, slideIdx) => async () => {
          if (abortController.signal.aborted) return;

          send({ type: "progress", slideIndex: slideIdx, stage: "sql" });

          try {
            const slide = await processSlide(extracted, datasetId, extractionData.deckReviewDate);
            send({ type: "progress", slideIndex: slideIdx, stage: "complete" });
            send({ type: "slide_complete", slideIndex: slideIdx, slide });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : "Processing failed";
            send({ type: "error", message: errMsg, slideIndex: slideIdx });
          }
        });

        await runConcurrent(factories, 3);

        send({ type: "done", deckId });
        controller.close();
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : "Unknown error" });
        controller.close();
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
