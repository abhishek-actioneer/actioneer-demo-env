import type { FollowUpAction } from "./types";

// ── /api/analyze SSE events ──

/** All SSE event types emitted by /api/analyze */
export type AnalyzeSSEEvent =
  | { type: "ack"; text: string }
  | { type: "plan"; agents: PlanAgent[] }
  | { type: "phase"; phase: "generating_sql" | "executing" | "synthesizing" }
  | { type: "sql"; subagentId: string; queries: SqlQuery[] }
  | { type: "query_result"; subagentId: string; queryIndex: number; rowCount: number; timeMs: number; columns: string[]; preview: Record<string, unknown>[]; error?: string }
  | { type: "summary"; subagentId: string; content: string }
  | { type: "result"; subagentId: string; rowCount?: number; timeMs?: number; columns?: string[]; preview?: Record<string, unknown>[]; error?: string }
  | { type: "text"; delta: string }
  | { type: "report"; content: string }
  | { type: "recommendations"; actions: FollowUpAction[] }
  | { type: "ping" }
  | { type: "done" }
  | { type: "error"; message: string };

export interface PlanAgent {
  id: string;
  queryCount: number;
  tasks: { queryIndex: number; description: string }[];
}

export interface SqlQuery {
  sql: string;
  description: string;
  queryIndex: number;
}

// ── /api/playbook/create SSE events ──

/** All SSE event types emitted by /api/playbook/create */
export type PlaybookSSEEvent =
  | { type: "phase"; phase: "discovering_schema" | "checking_requirements" | "generating_playbook" }
  | { type: "connector_required"; missing: Array<{ description: string; reason: string }>; recommendedCategories: string[]; canProceedWithout: boolean; degradedDescription?: string }
  | { type: "text"; delta: string }
  | { type: "playbook_preview"; playbook: unknown }
  | { type: "error"; message: string }
  | { type: "done" };

// ── Parsing ──

const VALID_ANALYZE_TYPES = new Set([
  "ack", "plan", "phase", "sql", "query_result", "summary",
  "result", "text", "report", "recommendations", "ping", "done", "error",
]);

/** Parse an NDJSON line into a typed SSE event. Returns null for unparseable lines. */
export function parseAnalyzeEvent(line: string): AnalyzeSSEEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Strip markdown code fences that LLMs sometimes wrap output in
  const clean = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  if (!clean) return null;

  try {
    const parsed = JSON.parse(clean);
    if (typeof parsed?.type === "string" && VALID_ANALYZE_TYPES.has(parsed.type)) {
      return parsed as AnalyzeSSEEvent;
    }
    return null;
  } catch {
    return null;
  }
}
