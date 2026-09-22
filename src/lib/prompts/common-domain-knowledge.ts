import type { DatasetConfig } from "@/lib/datasets/types";

/**
 * Returns a reusable preamble injected into every analysis-side LLM prompt.
 * Keeps the model honest about what counts as evidence, what statistical
 * claims it can make, and how tightly it must stay on the user's question.
 *
 * Modeled loosely on main Sentinel's COMMON_DOMAIN_KNOWLEDGE Langfuse var,
 * but trimmed to baby-sentinel's runtime: DuckDB single-process, no Python,
 * no shared filesystem between agents.
 */
export function getCommonDomainKnowledge(ds: DatasetConfig): string {
  const entity = ds.entityName ?? "users";
  const currency = ds.currency ?? "$";

  return `<schema_authority>
- Use ONLY fields, table names, and values that appear in the query results provided below.
- Never invent column names, table names, dates, or values. If something isn't in the results, don't reference it.
- The dataset is ${ds.label} (DuckDB · ${ds.reportMeta.dbName}); primary table is ${ds.primaryTable}; primary entity name is ${entity}; currency is ${currency}.
- If a query failed, acknowledge it ("Q3 failed, so X is unavailable") rather than filling the gap with plausible-looking numbers.
</schema_authority>

<statistical_claims>
- Cite p-values, confidence intervals, or significance tests ONLY if the underlying SQL explicitly computed one. Otherwise omit them.
- Don't manufacture "p < 0.0001"-style values to look rigorous.
- When you describe a delta, prefer absolute numbers + percentage change over implied significance.
</statistical_claims>

<scope_safety>
- Stay focused on the user's question. If a CONTEXT entity is provided (specific metric/segment/entity), the entire response addresses that — no broad exploratory tangent.
</scope_safety>`;
}
