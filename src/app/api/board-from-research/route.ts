import { auth } from "@clerk/nextjs/server";
import { getDatasetForUser } from "@/lib/datasets";
import { generateJson, generateText } from "@/lib/llm";
import { inferCardType, inferChartSpec } from "@/lib/chart-inference";
import { generateFollowUpQuestions } from "@/lib/prompts/follow-up";
import type { SubagentInfo, QueryInfo } from "@/lib/types";
import { safeStringify } from "@/lib/safe-stringify";

// Agents to skip — meta-analysis, not user-facing insights
const SKIP_AGENTS = new Set(["data-quality", "critique"]);

interface ResearchInput {
  userQuery: string;
  subagents: SubagentInfo[];
  reportMarkdown?: string;
}

interface SectionOutput {
  id: string;
  boardId: string;
  title: string;
  prose: string;
  order: number;
  collapsed: boolean;
}

interface CardOutput {
  id: string;
  boardId: string;
  type: string;
  title: string;
  author: string;
  pinnedAt: string;
  sql: string;
  chartSpec?: unknown;
  heroMetric?: string;
  heroDelta?: string;
  data?: Record<string, unknown>[];
  reportMarkdown?: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  refreshCadence: string;
  lastRefreshed: string;
  comments: unknown[];
  sectionId: string;
  orderInSection: number;
  colSpan?: 1 | 2 | 3;
  markdownContent?: string;
  followUpQuestions?: string[];
}

/** Generate a short board name from the user query */
async function generateBoardName(userQuery: string): Promise<string> {
  try {
    const result = await generateText(`Summarize this analytics question into a short dashboard title (3-6 words, no quotes):\n\n"${userQuery}"`, {
      label: "board-name",
      timeoutMs: 10_000,
      maxOutputTokens: 64,
    });
    const name = result.trim().replace(/^["']|["']$/g, "");
    return name.length > 0 && name.length <= 60 ? name : "Research Board";
  } catch {
    return "Research Board";
  }
}

/** Use LLM to generate tight section insights from agent summaries */
async function generateSectionInsights(
  userQuery: string,
  agents: { id: string; name: string; summary?: string; queryDescriptions: string[] }[]
): Promise<Array<{ agentId: string; title: string; prose: string }>> {
  const fallback = () => agents.map((a) => ({
    agentId: a.id,
    title: a.name.replace(" Agent", ""),
    prose: a.summary?.slice(0, 150) ?? "",
  }));

  const agentContext = agents
    .map(
      (a) =>
        `Agent: ${a.name} (${a.id})\nQueries: ${a.queryDescriptions.join("; ")}\nSummary: ${a.summary?.slice(0, 300) ?? "No summary"}`
    )
    .join("\n\n");

  const prompt = `A user asked: "${userQuery}"

The following analysis agents produced results:

${agentContext}

For each agent, generate a dashboard section. Rules:
- Title: 2-4 words, specific to the analysis (NOT the agent name)
- Prose: Single-sentence verdict, MAX 20 WORDS. What the numbers can't say alone — the "so what." Not a description, not a summary.
- ORDER: Put the agent with the single most important headline metric FIRST. The first section is the star number that answers the user's question at a glance.

Return JSON array (no fences):
[{"agentId": "agent-id", "title": "Short Title", "prose": "20-word verdict..."}]`;

  try {
    const result = await generateJson<unknown>(prompt, {
      label: "board-from-research-insights",
      timeoutMs: 20_000,
      maxOutputTokens: 4096,
    });
    if (!Array.isArray(result)) {
      console.warn("[board-from-research] Section insight response was not an array:", result);
      return fallback();
    }
    const insights = result
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .map((item) => ({
        agentId: typeof item.agentId === "string" ? item.agentId : "",
        title: typeof item.title === "string" && item.title.trim() ? item.title : "Analysis",
        prose: typeof item.prose === "string" ? item.prose : "",
      }))
      .filter((item) => item.agentId);
    return insights.length > 0 ? insights : fallback();
  } catch (err) {
    console.error("[board-from-research] LLM insight generation failed:", err);
    // Fallback: use agent names as titles, summaries as prose
    return fallback();
  }
}

/** Format a numeric value for hero display */
function formatHeroValue(val: number): string {
  return Math.abs(val) >= 1_000_000
    ? `${(val / 1_000_000).toFixed(1)}M`
    : Math.abs(val) >= 1_000
      ? `${(val / 1_000).toFixed(1)}K`
      : val.toFixed(1);
}

/** Build a card from a query result — card type is data-driven */
function buildCard(
  query: QueryInfo,
  agentId: string,
  sectionId: string,
  orderInSection: number,
  sectionIndex: number,
  now: string,
  totalQueriesInSection: number
): CardOutput | null {
  if (!query.sql || query.error) return null;

  const cols = query.columns ?? [];
  const rows = (query.data ?? []) as Record<string, unknown>[];

  let cardType = "chart";
  let chartSpec = undefined;
  let heroMetric: string | undefined;

  if (cols.length > 0 && rows.length > 0) {
    try {
      cardType = inferCardType(cols, rows);

      if (cardType === "chart") {
        chartSpec = inferChartSpec(cols, rows, query.description, {
          agentId,
          queryDescription: query.description,
        });
      }
    } catch (err) {
      console.warn("[board-from-research] Card inference failed, falling back to table:", err);
      cardType = "table";
      chartSpec = undefined;
    }

    if (cardType === "metric") {
      // Single-row numeric result — extract hero value
      const val = Object.values(rows[0]).find((v) => typeof v === "number") as number | undefined;
      if (val !== undefined) heroMetric = formatHeroValue(val);
    }
  }

  // Fallback: chart without spec → table; no data → sql
  if (cardType === "chart" && !chartSpec && rows.length > 0) {
    cardType = "table";
  }
  if (rows.length === 0 && !query.error) {
    cardType = "sql";
  }

  return {
    id: `research-${agentId}-q${orderInSection}`,
    boardId: "",
    type: cardType,
    title: query.description || `Query ${orderInSection + 1}`,
    author: "system",
    pinnedAt: now,
    sql: query.sql,
    chartSpec: chartSpec ? { ...chartSpec, sql: query.sql } : undefined,
    heroMetric,
    data: rows.length > 0 ? rows.slice(0, 50) : undefined,
    position: { x: orderInSection * 520, y: sectionIndex * 480 },
    size: { width: 500, height: cardType === "metric" ? 80 : 400 },
    refreshCadence: "manual",
    lastRefreshed: now,
    comments: [],
    sectionId,
    orderInSection,
    colSpan: totalQueriesInSection === 1 && cardType !== "metric" ? 3 : 1,
  };
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

    let body: ResearchInput;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const userQuery = typeof body.userQuery === "string" ? body.userQuery : "";
    const subagents = Array.isArray(body.subagents) ? body.subagents : [];
    const reportMarkdown = body.reportMarkdown?.trim();
    const datasetId = req.headers.get("x-dataset-id");
    if (!datasetId) {
      return Response.json({ error: "x-dataset-id header is required" }, { status: 400 });
    }

    if (!getDatasetForUser(datasetId, userId)) return Response.json({ error: "Not found" }, { status: 404 });

    if (!subagents.length && !reportMarkdown) {
      return Response.json({ error: "No subagent data or report markdown provided" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const followUpPromises: Promise<void>[] = [];

    // Filter to content-producing agents
    const contentAgents = subagents.filter(
      (a) => !SKIP_AGENTS.has(a.id) && Array.isArray(a.queries) && a.queries.length > 0
    );

    if (contentAgents.length === 0 && !reportMarkdown) {
      return Response.json({ error: "No content-producing agents found" }, { status: 400 });
    }

    // Generate section insights via LLM
    const insights = contentAgents.length > 0
      ? await generateSectionInsights(
          userQuery,
          contentAgents.map((a) => ({
            id: a.id,
            name: a.name,
            summary: a.summary,
            queryDescriptions: a.queries.map((q) => q.description),
          }))
        )
      : [];

    // Build sections and cards — use LLM-returned order (star metric first)
    const sections: SectionOutput[] = [];
    const cards: CardOutput[] = [];

    if (reportMarkdown) {
      const sectionId = "sec-research-report";
      sections.push({
        id: sectionId,
        boardId: "",
        title: "Research Report",
        prose: "Full narrative report saved from the conversation.",
        order: 0,
        collapsed: false,
      });
      cards.push({
        id: "research-report-card",
        boardId: "",
        type: "report",
        title: "Research Report",
        author: "system",
        pinnedAt: now,
        sql: "",
        reportMarkdown,
        markdownContent: reportMarkdown,
        position: { x: 0, y: 0 },
        size: { width: 1040, height: 680 },
        refreshCadence: "manual",
        lastRefreshed: now,
        comments: [],
        sectionId,
        orderInSection: 0,
        colSpan: 3,
      });
    }

    // Reorder agents to match LLM's recommended ordering
    const agentById = new Map(contentAgents.map((a) => [a.id, a]));
    const orderedAgents = [
      ...insights.map((ins) => agentById.get(ins.agentId)).filter(Boolean),
      ...contentAgents.filter((a) => !insights.some((ins) => ins.agentId === a.id)),
    ] as SubagentInfo[];

    for (let i = 0; i < orderedAgents.length; i++) {
      const agent = orderedAgents[i];
      const insight = insights.find((ins) => ins.agentId === agent.id);
      const sectionId = `sec-${agent.id}`;
      const sectionOrder = sections.length;

      sections.push({
        id: sectionId,
        boardId: "",
        title: insight?.title ?? agent.name.replace(" Agent", ""),
        prose: insight?.prose ?? agent.summary?.slice(0, 150) ?? "",
        order: sectionOrder,
        collapsed: false,
      });

      // Build cards from queries — every query with data becomes a card
      const sectionCards: CardOutput[] = [];
      const queryCount = agent.queries.length;
      agent.queries.forEach((query, qIdx) => {
        const card = buildCard(query, agent.id, sectionId, qIdx, i, now, queryCount);
        if (card) sectionCards.push(card);
      });
      cards.push(...sectionCards);

      // Generate schema-aware follow-up questions for this section
      const summaries = sectionCards.map((c) => ({
        type: c.type,
        title: c.title,
        rowCount: c.data?.length,
        hasChart: !!c.chartSpec,
        metricValue: c.heroMetric,
      }));
      followUpPromises.push(
        generateFollowUpQuestions(datasetId, userQuery, summaries).then((questions) => {
          if (questions.length > 0 && sectionCards.length > 0) {
            // Create an analysis text card with follow-ups at end of section
            const analysisCard: CardOutput = {
              id: `analysis-${sectionId}`,
              boardId: "",
              type: "text",
              title: "Analysis",
              author: "system",
              pinnedAt: now,
              sql: "",
              markdownContent: insight?.prose ?? agent.summary?.slice(0, 300) ?? "",
              followUpQuestions: questions,
              position: { x: 0, y: 0 },
              size: { width: 400, height: 260 },
              refreshCadence: "manual",
              lastRefreshed: now,
              comments: [],
              sectionId,
              orderInSection: sectionCards.length,
              colSpan: 2,
            };
            cards.push(analysisCard);
          }
        }),
      );
    }

    // Wait for all follow-up generations (non-blocking per section)
    await Promise.allSettled(followUpPromises);

    // Generate a short board name via LLM
    const boardName = await generateBoardName(userQuery);

    return new Response(
      safeStringify({
        name: boardName,
        description: userQuery.slice(0, 120),
        sections,
        cards,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[board-from-research] Fatal:", err);
    return Response.json(
      { error: `Failed to create board from research: ${message}` },
      { status: 500 },
    );
  }
}
