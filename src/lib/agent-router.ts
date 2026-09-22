import { generateText, type ModelId } from "@/lib/llm";
import { buildRoutePrompt } from "@/lib/prompts/route";
import type { AgentSpec, DatasetConfig } from "@/lib/datasets/types";

export interface AgentChoice {
  /** Must be an id from availableAgents — hallucinated ids are filtered out. */
  id: string;
  /** Narrowed sub-question for this agent given the user's specific question. */
  focus: string;
  /** Why this agent was picked. Surfaced under each agent's expander in the UI. */
  rationale: string;
}

export interface RouterDecision {
  /** Empty array = question doesn't need analysis; caller should fall through to direct response. */
  agents: AgentChoice[];
  /** One-paragraph "why this plan" — shown to the user. */
  reasoning: string;
  /** True when the LLM output failed and we fell back to running all agents. */
  fallback?: boolean;
}

const QUICK_AGENT_BUDGET = 1;
const DEEP_AGENT_BUDGET = 5;

/**
 * Decide which specialized agents should run for a given user question.
 * One-shot — no chaining yet. The router never generates SQL itself.
 */
export async function routeQuery(args: {
  userQuery: string;
  ds: DatasetConfig;
  mode: "quick" | "deep";
  availableAgents: AgentSpec[];
  pageContext?: string;
  modelId?: ModelId;
}): Promise<RouterDecision> {
  if (args.availableAgents.length === 0) {
    return { agents: [], reasoning: "No agents available for this dataset." };
  }

  const { system, user } = buildRoutePrompt(args);

  let raw: string;
  try {
    raw = await generateText({
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      modelId: args.modelId,
      jsonMode: true,
      timeoutMs: 20_000,
      label: "agent routing",
      feature: "analyze.routing",
      datasetId: args.ds.id,
    });
  } catch {
    return fallbackToAll(args, "Router LLM call failed; running all available agents.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallbackToAll(args, "Router output was unparseable; running all available agents.");
  }

  if (!isValidShape(parsed)) {
    return fallbackToAll(args, "Router output didn't match expected shape; running all available agents.");
  }

  // Filter hallucinated agent ids
  const validIds = new Set(args.availableAgents.map((a) => a.id));
  const validAgents: AgentChoice[] = parsed.agents
    .filter((a) => validIds.has(a.id))
    .map((a) => ({
      id: a.id,
      focus: typeof a.focus === "string" ? a.focus.trim() : "",
      rationale: typeof a.rationale === "string" ? a.rationale.trim() : "",
    }));

  // Dedupe by id (keep first occurrence; v1 doesn't multi-invoke same agent)
  const seen = new Set<string>();
  const deduped = validAgents.filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });

  // Enforce mode budget
  const budget = args.mode === "quick" ? QUICK_AGENT_BUDGET : DEEP_AGENT_BUDGET;
  const capped = deduped.slice(0, budget);

  return {
    agents: capped,
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning.trim() : "",
  };
}

interface RouterShape {
  reasoning: unknown;
  agents: { id: string; focus: unknown; rationale: unknown }[];
}

function isValidShape(x: unknown): x is RouterShape {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (!Array.isArray(o.agents)) return false;
  for (const a of o.agents) {
    if (!a || typeof a !== "object") return false;
    if (typeof (a as Record<string, unknown>).id !== "string") return false;
  }
  return true;
}

/**
 * Safe fallback: when the router fails for any reason, behave like the
 * pre-router system did — fan out to every available agent. Preserves
 * functionality even if the routing LLM call breaks.
 */
function fallbackToAll(
  args: { userQuery: string; mode: "quick" | "deep"; availableAgents: AgentSpec[] },
  reasoning: string,
): RouterDecision {
  // In quick mode, fallback to a single agent (rev-opt if present, else first).
  const agents =
    args.mode === "quick"
      ? args.availableAgents
          .slice(0, 1)
          .map((a) => ({
            id: a.id,
            focus: args.userQuery,
            rationale: "Router fallback (quick mode → single agent)",
          }))
      : args.availableAgents.map((a) => ({
          id: a.id,
          focus: args.userQuery,
          rationale: "Router fallback (deep mode → all agents)",
        }));

  return { agents, reasoning, fallback: true };
}
