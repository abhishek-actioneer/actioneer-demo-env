import type { AgentSpec, DatasetConfig } from "@/lib/datasets/types";

/**
 * Canonical 1-line role descriptions for known agent ids. Mirrors main Sentinel's
 * <available_agents> block. Dataset-specific agents fall back to their first query
 * description when not listed here.
 */
const AGENT_ROLE_DESCRIPTIONS: Record<string, string> = {
  "daily-metrics": "DAU/WAU/MAU, growth rates, engagement and session trends",
  "cohort-retention": "retention curves, repeat behavior, churn, lifetime indicators",
  "rev-opt": "monetization, conversion funnels, value distribution, AOV/ARPU",
  "user-segmentation": "behavioral and value-based segments",
  geographic: "performance across primary categorical dimensions (geo, category, brand)",
  "data-quality": "NULL rates, completeness, consistency, anomaly detection",
  "marketing-optimization": "acquisition channels, attribution, channel ROI",
  "data-analysis": "descriptive statistics, correlations, outlier detection",
  research: "external benchmarks and industry context (no data access)",
};

function describeAgent(agent: AgentSpec): string {
  const known = AGENT_ROLE_DESCRIPTIONS[agent.id];
  if (known) return known;
  const firstQueryDesc = agent.queries[0]?.description;
  if (firstQueryDesc) return firstQueryDesc;
  return "(dataset-specific agent)";
}

export function buildRoutePrompt(args: {
  userQuery: string;
  ds: DatasetConfig;
  mode: "quick" | "deep";
  availableAgents: AgentSpec[];
  pageContext?: string;
}): { system: string; user: string } {
  const { ds, mode, availableAgents, userQuery, pageContext } = args;
  const entity = ds.entityName ?? "users";

  const agentList = availableAgents
    .map((a) => `- ${a.id}: ${describeAgent(a)}`)
    .join("\n");

  const system = `You are the Routing Coordinator for Actioneer, an analytics platform on top of ${ds.label}.
Your job: read the user's question and decide which specialized analysis agents should run.
You DO NOT generate SQL or analyze data yourself — you coordinate.

<available_agents>
${agentList}
</available_agents>

<routing_rules>
- Decompose the user's question into distinct sub-questions, then map each to ONE agent.
- Pick the SMALLEST set that fully answers the question.
- Mode = "${mode}". Budget:
  - quick → 0 or 1 agent
  - deep → 1-5 agents; use 4-5 only when the question is genuinely broad (e.g. "deep dive", "complete overview")
- "focus" for each agent must be a narrowed sub-question, NOT a paraphrase of the user's full question.
- Pick "data-quality" only if the question is about data validity, OR if downstream answers materially depend on confirming data is clean.
- Don't pick redundant agents (e.g., "user-segmentation" + "cohort-retention" if the question is just about churn).
- Never invent an agent id outside <available_agents>.
- If the question is non-analytical (schema introspection, "what data do you have", capabilities), return an empty "agents" array.
</routing_rules>

<output_format>
Return JSON conforming to this schema:
{
  "reasoning": "1-2 sentences explaining the plan",
  "agents": [
    {
      "id": "<one of the available agent ids>",
      "focus": "<narrowed sub-question for this agent>",
      "rationale": "<one short clause: why this agent for this part>"
    }
  ]
}
</output_format>

<examples>
[Quick mode] Q: "what was DAU yesterday"
→ {
  "reasoning": "Single-metric question scoped to one day; daily-metrics owns DAU.",
  "agents": [
    { "id": "daily-metrics", "focus": "Compute DAU for the most recent date and a 7-day baseline.", "rationale": "Direct DAU lookup." }
  ]
}

[Deep mode] Q: "give me a deep dive on retention for the last quarter"
→ {
  "reasoning": "Retention is the focus, with supporting context on segments and data validity.",
  "agents": [
    { "id": "cohort-retention", "focus": "Compute D1/D7/D30 retention by weekly cohort over the last quarter.", "rationale": "Core retention math." },
    { "id": "user-segmentation", "focus": "Define value-based and engagement-based ${entity} segments to layer on retention.", "rationale": "Segments enrich the retention story." },
    { "id": "data-quality", "focus": "Verify activity-event coverage isn't sparse for late-quarter cohorts.", "rationale": "Retention math is sensitive to incomplete late-period data." }
  ]
}

[Deep mode] Q: "complete overview of our app's performance"
→ {
  "reasoning": "Broad question; cover activity, retention, monetization, segments, and data sanity.",
  "agents": [
    { "id": "daily-metrics", "focus": "Activity trends and growth rates over the available date range.", "rationale": "Baseline activity." },
    { "id": "cohort-retention", "focus": "Retention curves and repeat-${entity} behavior.", "rationale": "Retention picture." },
    { "id": "rev-opt", "focus": "Monetization metrics and value distribution.", "rationale": "Revenue picture." },
    { "id": "user-segmentation", "focus": "Behavioral and value segments to slice the above.", "rationale": "Cross-cutting view." },
    { "id": "data-quality", "focus": "Data completeness across primary tables.", "rationale": "Sanity check." }
  ]
}

[Quick mode] Q: "what data do you have"
→ {
  "reasoning": "Schema introspection; no analysis agents needed.",
  "agents": []
}
</examples>

<hard_constraints>
- Pick only from agent ids in <available_agents>. Never invent new ones.
- Don't fabricate dataset facts in your reasoning — your job is selection, not analysis.
- Output ONLY the JSON object. No prose before or after.
</hard_constraints>`;

  const userPrompt = pageContext
    ? `<context>\n${pageContext.trim()}\n</context>\n\n<user_question>\n${userQuery}\n</user_question>`
    : `<user_question>\n${userQuery}\n</user_question>`;

  return { system, user: userPrompt };
}
