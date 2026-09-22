import { auth } from "@clerk/nextjs/server";
import { generateJson } from "@/lib/llm";
import { getDataset, DEFAULT_DATASET, getDatasetForUser } from "@/lib/datasets";
import { executeSQL } from "@/lib/sql-executor";
import { discoverSchema, formatSchemaForLLM } from "@/lib/schema-discovery";
import { getTemplate } from "@/lib/board-templates";
import type { BoardTemplate } from "@/lib/board-templates";
import type { ChartSpec } from "@/lib/chart-types";
import { safeStringify } from "@/lib/safe-stringify";
import {
  buildFundsIndiaBoardData,
  FUNDSINDIA_DATASET_ID,
} from "@/lib/server/fundsindia-sample-workspace";

/* ── Types for LLM-generated board ── */

interface GeneratedCard {
  id: string;
  title: string;
  /** Visualization type */
  chartType: "line" | "bar" | "area" | "pie" | "table";
  /** SQL that returns the data for this card */
  sql: string;
  /** For kpi cards: SQL returning ONE row with ONE numeric value */
  valueSql?: string;
  /** "currency" | "percent" | "integer" | "number" */
  format?: string;
  /** For bar/line/area: the x-axis column name */
  xKey?: string;
  /** For bar/line/area: the y-axis column name(s) */
  yKeys?: string[];
  /** For pie: the label column */
  nameKey?: string;
  /** For pie: the value column */
  valueKey?: string;
  /** For bar: highlight the category with this name */
  highlight?: string;
  /** Whether bars/areas should be stacked */
  stacked?: boolean;
}

interface GeneratedSection {
  id: string;
  title: string;
  prose: string;
  cards: GeneratedCard[];
}

interface GeneratedBoard {
  name: string;
  description: string;
  sections: GeneratedSection[];
}

/* ── Helpers ── */

function formatValue(num: number, format?: string, currency?: string): string {
  const sym = currency ?? "$";
  switch (format) {
    case "currency":
      return Math.abs(num) >= 1_000_000
        ? `${sym}${(num / 1_000_000).toFixed(1)}M`
        : Math.abs(num) >= 1_000
          ? `${sym}${(num / 1_000).toFixed(1)}K`
          : `${sym}${num.toFixed(0)}`;
    case "percent":
      return `${num.toFixed(1)}%`;
    case "integer":
      return Math.abs(num) >= 1_000_000
        ? `${(num / 1_000_000).toFixed(1)}M`
        : Math.abs(num) >= 1_000
          ? `${(num / 1_000).toFixed(1)}K`
          : String(Math.round(num));
    default:
      return Math.abs(num) >= 1_000_000
        ? `${(num / 1_000_000).toFixed(2)}M`
        : Math.abs(num) >= 1_000
          ? `${(num / 1_000).toFixed(1)}K`
          : num.toFixed(2);
  }
}

/** Build a ChartSpec from LLM card definition + query result */
function buildChartSpec(
  card: GeneratedCard,
  data: Record<string, unknown>[],
  columns: string[],
): ChartSpec | undefined {
  if (card.chartType === "table") return undefined;
  if (data.length === 0) return undefined;

  const type = card.chartType === "area" ? "area" : card.chartType === "bar" ? "bar" : card.chartType === "pie" ? "pie" : "line";

  const base: ChartSpec = {
    type,
    title: card.title,
    data: data as Record<string, string | number>[],
  };

  if (type === "pie") {
    base.nameKey = card.nameKey ?? columns[0];
    base.valueKey = card.valueKey ?? columns[1];
  } else {
    base.xKey = card.xKey ?? columns[0];
    base.yKeys = card.yKeys ?? columns.slice(1);
    base.yLabels = base.yKeys.map((k) => k.replace(/_/g, " "));
    if (card.stacked) base.stacked = true;
    if (card.highlight) base.highlight = card.highlight;
  }

  if (card.format && base.yKeys) {
    base.format = Object.fromEntries(
      base.yKeys.map((k) => [k, card.format as "currency" | "percent" | "number"])
    );
  }

  return base;
}

/* ── LLM board generation ── */

async function generateBoardWithSQL(
  datasetLabel: string,
  schemaText: string,
  systemContext: string,
  domainHints: string | undefined,
  template?: BoardTemplate,
): Promise<GeneratedBoard> {
  const templateBlock = template
    ? `\nDASHBOARD FOCUS:\n${template.focusPrompt}\n${template.sectionHints?.length ? `\nSuggested section themes (adapt to available data): ${template.sectionHints.join(", ")}` : ""}\n`
    : "";

  const prompt = `You are building a product analytics dashboard for "${datasetLabel}".
${templateBlock}
DATABASE SCHEMA (actual tables and columns — only use these):
${schemaText}

DOMAIN CONTEXT:
${systemContext.slice(0, 1500)}
${domainHints ? `\nSQL HINTS:\n${domainHints.slice(0, 800)}` : ""}

Generate a dashboard with 4-6 sections, each containing 1-3 cards. For EACH card you must write actual SQL.

CHART TYPES — pick the best visualization for each metric:
- "line": Time-series trends. SQL returns (date, value) or (date, series1, series2). Use for metrics over time.
- "bar": Categorical comparisons. SQL returns (category, value). Use for top-N rankings, breakdowns by dimension.
- "area": Like line but filled. Use for volume/cumulative metrics over time. Can be stacked.
- "pie": Composition/share. SQL returns (name, value). Use for percentage breakdowns (max 8 slices).
- "table": Tabular data. SQL returns multiple columns. Use for ranked lists, detailed breakdowns.

RULES:
1. MIX CHART TYPES — a good dashboard uses 3-4 different types. Don't make everything line charts.
2. SECTIONS: 4-6 sections, 1-3 cards each. Single-card sections render full-width (great for hero line/area charts).
3. Every card needs chartType + "sql" + column mappings ("xKey"/"yKeys" or "nameKey"/"valueKey" for pie).
5. For line/area: ALWAYS use DATE_TRUNC('week', date_col) or DATE_TRUNC('month', date_col) with GROUP BY and aggregate functions (SUM, COUNT, AVG). Do NOT select directly from pre-aggregated/summary tables for time-series — always aggregate from raw tables so the grain can be changed dynamically. Include ORDER BY date. LIMIT 500.
6. For bar: ORDER BY value DESC. Use LIMIT 10-15 for top-N. Set "highlight" to the top category name if known.
7. For pie: LIMIT 8 max slices. ORDER BY value DESC.
8. SQL MUST only reference tables/columns from the schema above.
9. "format": "currency" for money values. "percent" ONLY when the values are already 0-100 scale (like 85.3 meaning 85.3%). If values are decimal ratios (like 0.05 meaning 5%), use "number" NOT "percent". "integer" for whole-number counts.
10. PROSE: One tight sentence per section, MAX 20 words. The "so what".
11. SECTION TITLES: Short, domain-specific.

A GOOD DASHBOARD example structure:
- Section 1: 1 card — hero line/area chart (key trend over time, full-width)
- Section 2: 2 cards — bar chart (top categories) + pie chart (composition)
- Section 3: 1 card — area chart (growth trend, full-width)
- Section 4: 2 cards — line chart (secondary trend) + table (ranked list)
- Section 5: 1 card — bar chart (comparison, full-width)

Respond ONLY with valid JSON (no markdown fences):
{
  "name": "short board name",
  "description": "one-line description under 80 chars",
  "sections": [
    {
      "id": "sec-kebab-id",
      "title": "Short Title",
      "prose": "Tight insight under 20 words.",
      "cards": [
        {
          "id": "card-1",
          "title": "Revenue Trend",
          "chartType": "line",
          "sql": "SELECT date_trunc('month', order_date) AS date, SUM(revenue) AS revenue FROM orders GROUP BY 1 ORDER BY 1",
          "xKey": "date",
          "yKeys": ["revenue"],
          "format": "currency"
        },
        {
          "id": "card-3",
          "title": "Top Categories",
          "chartType": "bar",
          "sql": "SELECT category, SUM(revenue) AS revenue FROM orders GROUP BY 1 ORDER BY 2 DESC LIMIT 10",
          "xKey": "category",
          "yKeys": ["revenue"],
          "format": "currency",
          "highlight": "Electronics"
        },
        {
          "id": "card-4",
          "title": "Revenue Split",
          "chartType": "pie",
          "sql": "SELECT category AS name, SUM(revenue) AS value FROM orders GROUP BY 1 ORDER BY 2 DESC LIMIT 6",
          "nameKey": "name",
          "valueKey": "value",
          "format": "currency"
        }
      ]
    }
  ]
}`;

  return generateJson<GeneratedBoard>(prompt, {
    label: "board-generate",
    timeoutMs: 45_000,
    maxOutputTokens: 8192,
  });
}

/* ── Route handler ── */

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const headerDatasetId = req.headers.get("x-dataset-id");
  const datasetId = headerDatasetId || DEFAULT_DATASET;

  if (!getDatasetForUser(datasetId, userId)) return Response.json({ error: "Not found" }, { status: 404 });

  const dataset = getDataset(datasetId);

  // Parse optional templateId from request body
  let templateId: string | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    templateId = body?.templateId;
  } catch {
    // No body or invalid JSON — proceed without template
  }

  const template = templateId ? getTemplate(templateId) : undefined;

  try {
    if (datasetId === FUNDSINDIA_DATASET_ID) {
      return new Response(safeStringify(await buildFundsIndiaBoardData()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 1. Discover actual database schema
    const schema = await discoverSchema(datasetId);
    if (schema.tables.length === 0) {
      return Response.json(
        { error: "No tables found in the database for this dataset." },
        { status: 400 }
      );
    }

    const schemaText = formatSchemaForLLM(schema);

    // 2. LLM generates board structure with SQL + chart types
    const board = await generateBoardWithSQL(
      dataset.label,
      schemaText,
      dataset.systemContext ?? dataset.schemaContext,
      dataset.domainHints,
      template,
    );

    // 3. Execute all SQL queries in parallel
    const allCards = board.sections.flatMap((s) => s.cards);

    const sqlResults = await Promise.allSettled(
      allCards.map((card) => {
        const query = card.sql;
        if (!query) return Promise.resolve(null);
        return executeSQL(query, datasetId).then((r) => {
          if (r.error || !r.rows.length) return null;
          return { rows: r.rows, columns: r.columns };
        }).catch(() => null);
      })
    );

    // 4. Build lookup
    const cardResults = new Map<string, { rows: Record<string, unknown>[]; columns: string[] } | null>();
    allCards.forEach((card, i) => {
      const r = sqlResults[i];
      cardResults.set(card.id, r.status === "fulfilled" ? r.value : null);
    });

    // 5. Assemble response
    const now = new Date().toISOString();
    const boardId = "";
    const responseCards: Record<string, unknown>[] = [];

    const sections = board.sections.map((section, sIdx) => {
      section.cards.forEach((card, cIdx) => {
        const result = cardResults.get(card.id);
        if (!result) return; // SQL failed — skip

        const validCardsInSection = section.cards.filter((c) => cardResults.get(c.id) != null);
        const colSpan: 1 | 2 | 3 = validCardsInSection.length === 1 ? 3 : 1;

        if (card.chartType === "table") {
          // Table card — tabular data
          responseCards.push({
            id: card.id,
            boardId,
            type: "table" as const,
            title: card.title,
            author: "system",
            pinnedAt: now,
            data: result.rows.slice(0, 50),
            sql: card.sql,
            position: { x: cIdx * 500, y: sIdx * 500 },
            size: { width: 450, height: 380 },
            refreshCadence: "manual",
            lastRefreshed: now,
            comments: [],
            sectionId: section.id,
            orderInSection: cIdx,
            colSpan,
          });
          return;
        }

        // Chart cards (line, bar, area, pie)
        const chartData = result.rows.slice(0, 100);
        const chartSpec = buildChartSpec(card, chartData, result.columns);

        if (!chartSpec) return; // couldn't build spec

        // Attach SQL to chartSpec so UnifiedChart can show it in the Data dropdown
        chartSpec.sql = card.sql;

        // Also compute a hero metric from the first y-value or valueSql
        let heroMetric: string | undefined;
        if (card.valueSql) {
          // valueSql was provided — we already executed the main sql, try valueSql separately
          // For simplicity, derive hero from the data
        }
        if (card.chartType === "bar" || card.chartType === "pie") {
          // Sum all values for hero
          const vk = card.chartType === "pie"
            ? (card.valueKey ?? result.columns[1])
            : (card.yKeys?.[0] ?? result.columns[1]);
          if (vk) {
            const total = chartData.reduce((sum, row) => sum + (Number(row[vk]) || 0), 0);
            heroMetric = formatValue(total, card.format, dataset.currency);
          }
        }

        responseCards.push({
          id: card.id,
          boardId,
          type: "chart" as const,
          title: card.title,
          author: "system",
          pinnedAt: now,
          heroMetric,
          chartSpec,
          data: chartData.slice(0, 30),
          sql: card.sql,
          position: { x: cIdx * 500, y: sIdx * 500 },
          size: { width: 450, height: 400 },
          refreshCadence: "manual",
          lastRefreshed: now,
          comments: [],
          sectionId: section.id,
          orderInSection: cIdx,
          colSpan,
        });
      });

      return {
        id: section.id,
        boardId,
        title: section.title,
        prose: section.prose,
        order: sIdx,
        collapsed: false,
      };
    });

    return new Response(
      safeStringify({
        name: board.name,
        description: board.description,
        sections,
        cards: responseCards,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("[board-generate] Error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to generate board" },
      { status: 500 }
    );
  }
}
