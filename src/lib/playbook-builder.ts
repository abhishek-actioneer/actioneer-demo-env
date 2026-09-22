import type { ChatMessage } from "@/lib/types";
import type { PlaybookV2, PlaybookCellV2 } from "@/lib/playbook-types";
import { PLAYBOOK_DEFAULTS } from "@/lib/playbook-defaults";

function createId() {
  return Math.random().toString(36).slice(2, 10);
}

/** Extract a short label from SQL by looking at table names, aggregations, and key clauses */
function inferLabelFromSql(sql: string): string {
  const upper = sql.toUpperCase();
  // Extract main table
  const tableMatch = sql.match(/\bFROM\s+([a-z_][a-z0-9_]*)/i);
  const table = tableMatch?.[1] ?? "";

  // Detect aggregation type
  const hasSum = /\bSUM\b/i.test(upper);
  const hasCount = /\bCOUNT\b/i.test(upper);
  const hasAvg = /\bAVG\b/i.test(upper);
  const hasGroupBy = /\bGROUP\s+BY\b/i.test(upper);

  // Extract GROUP BY columns for breakdown context
  const groupMatch = sql.match(/GROUP\s+BY\s+([^;\n]+)/i);
  const groupCols = groupMatch?.[1]
    ?.split(",")
    .map((c) => c.trim().replace(/^\d+$/, "").replace(/.*\./, "").trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(", ") ?? "";

  // Build label
  const parts: string[] = [];
  if (hasSum) parts.push("Calculate");
  else if (hasCount) parts.push("Count");
  else if (hasAvg) parts.push("Average");
  else parts.push("Query");

  if (table) parts.push(table.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));

  if (hasGroupBy && groupCols) parts.push(`by ${groupCols}`);

  const label = parts.join(" ");
  return label.length > 60 ? label.slice(0, 57) + "..." : label;
}

/** Extract a short description from the user message that prompted a query */
function inferDescription(userMsg: string): string {
  // Remove common prefixes
  const cleaned = userMsg
    .replace(/^(show me|can you|please|what is|what are|how|tell me about)\s+/i, "")
    .trim();
  return cleaned.length > 100 ? cleaned.slice(0, 97) + "..." : cleaned;
}

/**
 * Build a V2 Playbook from conversation messages.
 * Extracts SQL queries from both deep-research subagents AND quick-mode responses.
 * Uses conversation context for meaningful cell labels.
 */
export function buildPlaybookFromResearch(
  messages: ChatMessage[],
  userQuery: string,
  sourceConversationId?: string,
  ownerInfo?: { owner: string; ownerInitials: string }
): PlaybookV2 | null {
  const allQueries: Array<{ id: string; label: string; description: string; sql: string }> = [];
  const seenSql = new Set<string>();
  const userQuestions: string[] = [];

  // Collect user questions for context
  for (const m of messages) {
    if (m.role === "user" && m.content.trim().length > 5) {
      userQuestions.push(m.content.trim());
    }
  }

  // Strategy 1: Extract from deep-research subagent queries
  const agentMsg = messages.find((m) => m.role === "agent" && m.agent);
  if (agentMsg?.agent) {
    for (const sub of agentMsg.agent.subagents) {
      if (sub.id === "critique") continue;
      for (const q of sub.queries || []) {
        const sqlKey = q.sql.replace(/\s+/g, " ").trim().toLowerCase();
        if (seenSql.has(sqlKey)) continue;
        seenSql.add(sqlKey);

        const label = q.description && q.description !== "Primary analysis query"
          ? (q.description.length > 60 ? q.description.slice(0, 57) + "..." : q.description)
          : inferLabelFromSql(q.sql);
        allQueries.push({
          id: `q${allQueries.length + 1}`,
          label,
          description: q.description || inferLabelFromSql(q.sql),
          sql: q.sql,
        });
      }
    }
  }

  // Strategy 2: Extract SQL from sentinel messages (quick mode or inline SQL)
  if (allQueries.length === 0) {
    const sqlBlockPattern = /```sql\s*\n([\s\S]*?)```/gi;
    let userMsgIdx = 0;
    for (const m of messages) {
      if (m.role === "user") {
        userMsgIdx = userQuestions.indexOf(m.content.trim());
        continue;
      }
      if (m.role !== "sentinel") continue;
      let match: RegExpExecArray | null;
      sqlBlockPattern.lastIndex = 0;
      while ((match = sqlBlockPattern.exec(m.content)) !== null) {
        const sql = match[1].trim();
        if (sql.length < 20) continue;
        // Skip DDL/DML — only allow SELECT queries
        const firstKeyword = sql.split(/\s/)[0].toUpperCase();
        if (["CREATE", "ALTER", "DROP", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "MERGE"].includes(firstKeyword)) continue;
        const sqlKey = sql.replace(/\s+/g, " ").toLowerCase();
        if (seenSql.has(sqlKey)) continue;
        seenSql.add(sqlKey);

        // Use the preceding user question as context for the label
        const contextQuestion = userQuestions[userMsgIdx] ?? userQuestions[userQuestions.length - 1] ?? "";
        const label = contextQuestion
          ? inferDescription(contextQuestion)
          : inferLabelFromSql(sql);
        allQueries.push({
          id: `q${allQueries.length + 1}`,
          label,
          description: contextQuestion || inferLabelFromSql(sql),
          sql,
        });
      }
    }
  }

  // Strategy 3: Extract SQL from message metadata (query_result events stored in messages)
  if (allQueries.length === 0) {
    for (const m of messages) {
      if (m.role === "sentinel" && m.agent?.subagents) {
        for (const sub of m.agent.subagents) {
          for (const q of sub.queries || []) {
            const sqlKey = q.sql.replace(/\s+/g, " ").trim().toLowerCase();
            if (seenSql.has(sqlKey)) continue;
            seenSql.add(sqlKey);
            allQueries.push({
              id: `q${allQueries.length + 1}`,
              label: q.description || inferLabelFromSql(q.sql),
              description: q.description || inferLabelFromSql(q.sql),
              sql: q.sql,
            });
          }
        }
      }
    }
  }

  if (allQueries.length === 0) return null;

  const pbId = `pb-${createId()}`;
  // Use the first meaningful user question as the playbook name
  const meaningfulQuery = userQuestions.find((q) => !(/convert|playbook|notebook/i.test(q))) ?? userQuery;
  // Clean truncation: break at word boundary
  const pbName = meaningfulQuery.length > 50
    ? meaningfulQuery.slice(0, 50).replace(/\s+\S*$/, "") + "..."
    : meaningfulQuery;

  // Extract key tables from all queries for the guardrail description
  const allTables = new Set<string>();
  for (const q of allQueries) {
    const tablePattern = /\bFROM\s+([a-z_][a-z0-9_]*)/gi;
    let tm: RegExpExecArray | null;
    while ((tm = tablePattern.exec(q.sql)) !== null) allTables.add(tm[1]);
  }
  const tableList = Array.from(allTables).slice(0, 3).join(", ");

  const cells: PlaybookCellV2[] = [];

  // Guardrail cell
  cells.push({
    id: "c1",
    label: "Validate Data Availability",
    description: tableList
      ? `Check that ${tableList} tables exist and contain recent data`
      : "Validate required tables exist and contain data",
    type: "llm",
    role: "guardrail",
    status: "idle",
    dependsOn: [],
    outputs: ["init_context"],
  });

  // Individual SQL query cells — clean up description
  for (const q of allQueries) {
    // If description is a generic fallback, derive from SQL
    const isGenericDesc = !q.description || /primary analysis query/i.test(q.description) || q.description === q.label;
    const cleanDesc = isGenericDesc ? inferLabelFromSql(q.sql) : q.description;
    cells.push({
      id: q.id,
      label: q.label,
      description: cleanDesc,
      type: "sql",
      role: "query",
      status: "idle",
      dependsOn: ["c1"],
      outputs: [`result_${q.id}`],
      sql: q.sql,
    });
  }

  // Analysis cell
  const queryCellIds = allQueries.map((q) => q.id);
  const queryLabels = allQueries.map((q) => q.label).slice(0, 3);
  cells.push({
    id: "analysis",
    label: allQueries.length > 1
      ? `Analyze ${allQueries.length} Query Results`
      : `Interpret ${queryLabels[0] ?? "Query"} Results`,
    description: allQueries.length > 1
      ? `Compare results across ${queryLabels.join(", ")} to find patterns and anomalies`
      : `Analyze the output of ${queryLabels[0] ?? "the query"} for insights`,
    type: "llm",
    role: "analysis",
    status: "idle",
    dependsOn: queryCellIds,
    outputs: ["findings"],
    prompt: `Analyze all query results. Identify key patterns, anomalies, and correlations.`,
  });

  // Summary cell
  cells.push({
    id: "summary",
    label: "Generate Report",
    description: `Compile findings into a concise report with recommendations`,
    type: "llm",
    role: "summary",
    status: "idle",
    dependsOn: ["analysis"],
    outputs: ["report"],
    prompt: `Synthesize findings into an actionable report with key insights and recommendations.`,
  });

  return {
    id: pbId,
    schemaVersion: 2,
    name: pbName,
    description: meaningfulQuery,
    category: PLAYBOOK_DEFAULTS.category,
    version: PLAYBOOK_DEFAULTS.version,
    approvalStatus: PLAYBOOK_DEFAULTS.approvalStatus,
    owner: ownerInfo?.owner ?? "You",
    ownerInitials: ownerInfo?.ownerInitials ?? "U",
    cells,
    params: [
      { name: "lookback_days", label: "Lookback Days", type: "integer", defaultVal: "30", group: "Filters" },
    ],
    produces: [
      { name: `${pbName} Analysis`, description: "Data-driven analysis with findings" },
      { name: "Recommendations", description: "Actionable next steps" },
    ],
    runHistory: [],
    changelog: [],
    sourceConversationId,
    sourceQuery: meaningfulQuery,
  };
}
