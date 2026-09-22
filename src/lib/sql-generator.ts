import { generateText, type ModelId } from "./llm";
import { getDataset, DEFAULT_DATASET } from "./datasets";
import { buildTextToSqlPrompt } from "./prompts/sql";
import { dryRunSQL, batchDryRunSQL } from "./sql-executor";
import type { AgentSpec } from "./datasets/types";

const SINGLE_QUERY_TIMEOUT_MS = 180_000;
const DEEP_AGENT_SQL_TIMEOUT_MS = Number(process.env.DEEP_AGENT_SQL_TIMEOUT_MS ?? 105_000);
const DEEP_SQL_RETRY_TIMEOUT_MS = Number(process.env.DEEP_SQL_RETRY_TIMEOUT_MS ?? 45_000);

export interface SubagentQuery {
  subagentId: string;
  queryIndex: number;
  description: string;
  sql: string;
}

export async function generateQueries(
  userQuery: string,
  mode: "quick" | "deep",
  datasetId?: string,
  modelId?: ModelId,
  pageContext?: string,
): Promise<SubagentQuery[]> {
  // Prepend page context to the user query so SQL targets the right entity
  const enrichedQuery = pageContext
    ? `${pageContext.trim()}\n\n${userQuery}`
    : userQuery;
  const dsId = datasetId || DEFAULT_DATASET;
  if (mode === "quick") {
    return generateSingleQuery(enrichedQuery, dsId, modelId);
  }
  return generateMultipleQueries(enrichedQuery, dsId, modelId);
}

async function generateSingleQuery(userQuery: string, datasetId: string, modelId?: ModelId): Promise<SubagentQuery[]> {
  const prompt = buildTextToSqlPrompt(datasetId);
  const text = await generateText(`${prompt}\n\nUser question: ${userQuery}`, {
    modelId,
    timeoutMs: SINGLE_QUERY_TIMEOUT_MS,
    label: "single query generation",
  });

  const rawSql = cleanSQL(text);
  if (rawSql === "UNSUPPORTED_QUERY") {
    return [];
  }

  const sql = await validateAndFix(rawSql, userQuery, datasetId, modelId);
  if (!sql) return [];

  return [{ subagentId: "rev-opt", queryIndex: 0, description: "Primary analysis query", sql }];
}

// ── Per-agent parallel SQL generation ──

/**
 * Always-on agents that are appended to every dataset's agent list.
 * These agents work across any domain and don't require specific columns.
 */
const UNIVERSAL_AGENTS: AgentSpec[] = [
  {
    id: "research",
    queries: [
      { description: "Industry benchmarks and external context for key metrics", hint: "" },
      { description: "Market context analysis and seasonal patterns", hint: "" },
    ],
  },
  {
    id: "data-analysis",
    queries: [
      { description: "Statistical distributions for key numeric columns", hint: "" },
      { description: "Correlation analysis between key variables", hint: "" },
      { description: "Trend significance testing", hint: "" },
    ],
  },
  {
    id: "marketing-optimization",
    queries: [
      { description: "Channel/source attribution analysis", hint: "" },
      { description: "Acquisition cost analysis by entry path", hint: "" },
      { description: "Conversion funnel optimization", hint: "" },
    ],
  },
];

/**
 * Get AgentSpec[] from dataset: prefers `agents` field (schema map),
 * falls back to parsing `multiAgentPrompt` string (handcrafted configs).
 * Always ensures the 3 universal agents are present.
 */
export function getAgentSpecs(datasetId: string): AgentSpec[] {
  const ds = getDataset(datasetId);

  let agents: AgentSpec[];

  // Schema map agents take priority
  if (ds.agents && ds.agents.length > 0) {
    agents = ds.agents;
  } else {
    // Backward compat: parse multiAgentPrompt string into AgentSpec[]
    agents = parseMultiAgentPrompt(ds.multiAgentPrompt, ds.queryDescriptions);
  }

  // Ensure universal agents are always present
  const existingIds = new Set(agents.map((a) => a.id));
  for (const ua of UNIVERSAL_AGENTS) {
    if (!existingIds.has(ua.id)) {
      // Use dataset-specific query descriptions if available
      const descs = ds.queryDescriptions[ua.id];
      if (descs && descs.length > 0) {
        const enriched: AgentSpec = {
          id: ua.id,
          queries: descs.map((d, i) => ({
            description: d,
            hint: ua.queries[i]?.hint || "",
          })),
        };
        agents.push(enriched);
      } else {
        agents.push(ua);
      }
    }
  }

  return agents;
}

/**
 * Parse the legacy "agent-id|N| — description" multiAgentPrompt format
 * into structured AgentSpec[].
 */
function parseMultiAgentPrompt(
  prompt: string,
  queryDescriptions: Record<string, string[]>,
): AgentSpec[] {
  const agentMap = new Map<string, AgentSpec>();

  for (const line of prompt.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes("|")) continue;

    const firstPipe = trimmed.indexOf("|");
    const id = trimmed.slice(0, firstPipe).trim().toLowerCase();
    const rest = trimmed.slice(firstPipe + 1);
    const secondPipe = rest.indexOf("|");
    if (secondPipe === -1) continue;

    // Extract description after the " — " separator
    const rawDesc = rest.slice(secondPipe + 1).trim();
    const description = rawDesc.startsWith("—") ? rawDesc.slice(1).trim() : rawDesc;

    if (!agentMap.has(id)) {
      agentMap.set(id, { id, queries: [] });
    }
    agentMap.get(id)!.queries.push({ description, hint: "" });
  }

  // Overlay queryDescriptions as descriptions where available
  for (const [id, spec] of agentMap) {
    const descs = queryDescriptions[id];
    if (descs) {
      for (let i = 0; i < spec.queries.length && i < descs.length; i++) {
        spec.queries[i].description = descs[i];
      }
    }
  }

  return Array.from(agentMap.values());
}

/**
 * Generate SQL for a single agent's tasks. Focused prompt = higher quality SQL.
 */
async function generateAgentQueries(
  userQuery: string,
  datasetId: string,
  agent: AgentSpec,
  modelId?: ModelId,
): Promise<SubagentQuery[]> {
  const basePrompt = buildTextToSqlPrompt(datasetId);
  const queryCount = agent.queries.length;

  // Build task list with hints
  const taskList = agent.queries
    .map((q, i) => {
      const hintPart = q.hint ? ` (hint: ${q.hint})` : "";
      return `${i + 1}. ${q.description}${hintPart}`;
    })
    .join("\n");

  const agentPrompt = `${basePrompt}

You are the "${agent.id}" analysis agent. Generate exactly ${queryCount} SQL queries for the tasks below.
Each query should be a focused, high-quality DuckDB SQL statement that directly addresses its task.

TASKS:
${taskList}

Output format — exactly ${queryCount} lines, each: query-number|SQL
Example:
1|SELECT COUNT(*) FROM table WHERE col IS NULL
2|SELECT col, COUNT(*) FROM table GROUP BY 1 ORDER BY 2 DESC LIMIT 20

Each SQL must be a single line (no newlines within the SQL). No other text, markdown, or explanation.

User question: ${userQuery}`;

  const text = await generateText(agentPrompt, {
    modelId,
    timeoutMs: DEEP_AGENT_SQL_TIMEOUT_MS,
    label: `${agent.id} SQL generation`,
  });

  const lines = text.split("\n").filter((l) => l.includes("|"));

  const parsed: { queryIndex: number; description: string; rawSql: string }[] = [];
  for (const line of lines) {
    const pipeIdx = line.indexOf("|");
    if (pipeIdx === -1) continue;

    const numStr = line.slice(0, pipeIdx).trim();
    const qNum = parseInt(numStr, 10);
    if (isNaN(qNum) || qNum < 1 || qNum > queryCount) continue;

    const rawSql = cleanSQL(line.slice(pipeIdx + 1));
    if (!rawSql || rawSql === "UNSUPPORTED_QUERY") continue;

    const queryIndex = qNum - 1;
    const description = agent.queries[queryIndex]?.description || `Query ${qNum}`;
    parsed.push({ queryIndex, description, rawSql });
  }

  // Batch validate all queries in a single DuckDB connection
  const rawSqls = parsed.map((p) => p.rawSql);
  const errors = await batchDryRunSQL(rawSqls, datasetId);

  // Retry only one failure per deep agent. More retries make the first report
  // token arrive too late for production HTTP proxies, and failed queries are
  // already surfaced in the research panel.
  const MAX_RETRIES = 1;
  let retryCount = 0;
  const queries: SubagentQuery[] = [];

  for (let i = 0; i < parsed.length; i++) {
    const { queryIndex, description, rawSql } = parsed[i];
    const error = errors[i];

    if (!error) {
      queries.push({ subagentId: agent.id, queryIndex, description, sql: rawSql });
      continue;
    }

    // Skip retry if we've hit the cap
    if (retryCount >= MAX_RETRIES) continue;
    retryCount++;

    try {
      const fixed = await retryWithError(userQuery, rawSql, error, datasetId, modelId, DEEP_SQL_RETRY_TIMEOUT_MS);
      if (fixed && fixed !== "UNSUPPORTED_QUERY") {
        const retryError = await dryRunSQL(fixed, datasetId);
        if (!retryError) {
          queries.push({ subagentId: agent.id, queryIndex, description, sql: fixed });
        }
      }
    } catch { /* drop this query */ }
  }

  return queries;
}

/**
 * Deep mode: generate SQL for all agents in parallel.
 * Each agent gets its own focused LLM call for higher quality.
 */
async function generateMultipleQueries(userQuery: string, datasetId: string, modelId?: ModelId): Promise<SubagentQuery[]> {
  const agents = getAgentSpecs(datasetId);

  // Generate per-agent in parallel — use allSettled so one timeout doesn't block the rest
  const settled = await Promise.allSettled(
    agents.map((agent) => generateAgentQueries(userQuery, datasetId, agent, modelId))
  );

  const allQueries = settled
    .filter((r): r is PromiseFulfilledResult<SubagentQuery[]> => r.status === "fulfilled")
    .flatMap((r) => r.value);

  // Fallback to single query if all agents failed
  if (allQueries.length === 0) {
    return generateSingleQuery(userQuery, datasetId, modelId);
  }

  return allQueries;
}

function cleanSQL(raw: string): string {
  let sql = raw.trim();
  sql = sql.replace(/^```(?:sql)?\n?/i, "").replace(/\n?```$/i, "").trim();
  sql = sql.replace(/^(--[^\n]*\n)+/g, "").trim();
  return sql;
}

/**
 * Dry-run SQL via EXPLAIN. If it fails, send the error back to the LLM
 * for one retry. Returns the valid SQL or null if unrecoverable.
 */
async function validateAndFix(
  sql: string,
  userQuery: string,
  datasetId: string,
  modelId?: ModelId,
): Promise<string | null> {
  if (!sql || sql === "UNSUPPORTED_QUERY") return null;

  const error = await dryRunSQL(sql, datasetId);
  if (!error) return sql; // valid

  console.warn(`[sql-generator] dry-run failed: ${error}`);

  // One retry: send the error back to the LLM
  try {
    const fixed = await retryWithError(userQuery, sql, error, datasetId, modelId);
    if (!fixed || fixed === "UNSUPPORTED_QUERY") return null;

    const retryError = await dryRunSQL(fixed, datasetId);
    if (!retryError) return fixed;

    console.warn(`[sql-generator] retry also failed: ${retryError}`);
    return null;
  } catch {
    return null;
  }
}

export async function retryWithError(
  userQuery: string,
  failedSQL: string,
  error: string,
  datasetId?: string,
  modelId?: ModelId,
  timeoutMs = SINGLE_QUERY_TIMEOUT_MS,
): Promise<string> {
  const dsId = datasetId || DEFAULT_DATASET;
  const prompt = buildTextToSqlPrompt(dsId);
  const isOOM = /out of memory|memory_limit/i.test(error);
  const memoryLimit = process.env.DUCKDB_MEMORY_LIMIT ?? "4GB";

  const retryInstruction = isOOM
    ? `The previous SQL query exceeded the DuckDB memory limit (${memoryLimit}).
Rewrite it to use less memory:
- Move all WHERE filters into subqueries/CTEs BEFORE the JOIN
- If using CASE WHEN inside SUM for filtering, move the filter condition to WHERE instead
- Reduce the date range or add tighter filters to shrink the working set
- Avoid full-table GROUP BY on high-cardinality columns
- Prefer summary/materialized tables over raw event tables when available`
    : `The previous SQL query failed with an error. Fix it.`;

  const text = await generateText(`${prompt}

${retryInstruction}

User question: ${userQuery}
Previous SQL: ${failedSQL}
Error: ${error}

Output ONLY the corrected SQL query. No explanation.`, {
    modelId,
    timeoutMs,
    label: isOOM ? "SQL retry (OOM)" : "SQL retry",
  });

  return cleanSQL(text);
}
