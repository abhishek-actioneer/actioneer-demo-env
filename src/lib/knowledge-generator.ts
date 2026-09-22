/**
 * Two-step knowledge generation pipeline:
 * 1. LLM reads schema → generates discovery SQL queries
 * 2. Execute queries against DuckDB
 * 3. LLM reads schema + query results → generates knowledge entries (data-grounded + domain + industry)
 */

import { generateJson } from "./llm";
import { executeSQLInternal, type QueryResult } from "./sql-executor";
import type { SchemaMap } from "./datasets/types";
import type { KnowledgeEntry } from "./knowledge-types";
import { KNOWLEDGE_CATEGORIES, KNOWLEDGE_PRIORITIES } from "./knowledge-types";

interface DiscoveryQuery {
  label: string;
  sql: string;
}

/**
 * Step 1: Ask LLM to generate discovery SQL queries based on the schema.
 * These queries extract key stats, distributions, and patterns from the actual data.
 */
async function generateDiscoveryQueries(
  schemaMap: SchemaMap,
  datasetLabel: string,
  primaryTable: string,
): Promise<DiscoveryQuery[]> {
  let colSummary = "";
  for (const [name, meta] of Object.entries(schemaMap.columns)) {
    const type = meta.semanticType;
    const desc = meta.description;
    const gotcha = meta.sqlGotcha ? ` [GOTCHA: ${meta.sqlGotcha}]` : "";
    const nullRate = meta.nullRate != null ? ` [null: ${(meta.nullRate * 100).toFixed(1)}%]` : "";
    colSummary += `  - ${name}: ${desc} [${type}]${gotcha}${nullRate}\n`;
  }

  const prompt = `You are generating SQL discovery queries for a DuckDB database to understand a dataset before populating a knowledge base.

Dataset: "${datasetLabel}" (domain: ${schemaMap.domain})
Primary table: ${primaryTable}

Schema:
${schemaMap.annotatedSchemaContext || colSummary}

${schemaMap.domainHints ? `Domain hints:\n${schemaMap.domainHints}` : ""}

Generate 5-7 SELECT queries that will reveal the most important facts about this dataset. Cover:
1. **Scale & date range** — total row count, date range (min/max of date columns), distinct entity counts
2. **Top dimensions** — top values for the most important categorical columns (e.g., top categories, top locations, most common statuses). Use LIMIT 10.
3. **Key numeric distributions** — AVG, MEDIAN, MIN, MAX for the most important numeric/monetary columns
4. **Rates & ratios** — conversion rates, completion rates, or similar domain-relevant ratios
5. **Data quality** — columns with high null rates or notable patterns

RULES:
- Use DuckDB SQL syntax
- Quote column names that contain spaces or special characters with double quotes
- Each query must be a valid SELECT statement
- Keep queries simple and fast — no complex joins or window functions
- Apply any domain-specific filters noted in the gotchas (e.g., filter cancelled rides for revenue)
- LIMIT results to 10-20 rows max

Return a JSON array of objects:
[{"label": "brief description of what this reveals", "sql": "SELECT ..."}]

Respond with ONLY the JSON array.`;

  let parsed: DiscoveryQuery[];
  try {
    const json = await generateJson<unknown>(prompt, {
      timeoutMs: 30_000,
      label: "Discovery query generation",
      maxOutputTokens: 4096,
    });
    parsed = Array.isArray(json) ? json : [];
  } catch {
    console.warn("[knowledge-generator] Failed to parse discovery queries, using fallback");
    parsed = [];
  }

  // Validate each query is a SELECT
  const valid = parsed.filter(
    (q) => q.sql && q.label && q.sql.trim().toUpperCase().startsWith("SELECT"),
  );

  // The LLM can return an empty/non-array result (common for large, complex
  // schemas), which previously degraded the whole pipeline to zero entries.
  // Always guarantee at least a basic count query so generation never silently
  // produces nothing.
  if (valid.length === 0) {
    return [{ label: "Total row count", sql: `SELECT COUNT(*) as total_rows FROM ${primaryTable}` }];
  }

  return valid;
}

/**
 * Step 2: Execute discovery queries against DuckDB.
 * Returns label + results for each, skipping failures.
 */
async function executeDiscoveryQueries(
  queries: DiscoveryQuery[],
  datasetId: string,
): Promise<{ label: string; result: QueryResult }[]> {
  const results: { label: string; result: QueryResult }[] = [];

  for (const q of queries) {
    try {
      const result = await executeSQLInternal(q.sql, datasetId);
      if (!result.error) {
        results.push({ label: q.label, result });
      } else {
        console.warn(`[knowledge-generator] Query failed: ${q.label} — ${result.error}`);
      }
    } catch (err) {
      console.warn(`[knowledge-generator] Query execution error: ${q.label}`, err);
    }
  }

  return results;
}

/**
 * Format query results into a compact string for the LLM prompt.
 */
function formatQueryResults(results: { label: string; result: QueryResult }[]): string {
  if (results.length === 0) return "No query results available.";

  return results
    .map((r) => {
      const rows = r.result.rows.slice(0, 15);
      if (rows.length === 0) return `### ${r.label}\n(no rows returned)`;

      // Format as a compact table
      const cols = r.result.columns;
      const header = cols.join(" | ");
      const data = rows
        .map((row) =>
          cols.map((c) => {
            const val = row[c];
            if (val == null) return "NULL";
            if (typeof val === "number") {
              // Format large numbers with commas, decimals to 2 places
              return Number.isInteger(val)
                ? val.toLocaleString("en-US")
                : val.toFixed(2);
            }
            return String(val);
          }).join(" | "),
        )
        .join("\n");

      return `### ${r.label}\n${header}\n${data}`;
    })
    .join("\n\n");
}

/**
 * Step 3: Generate knowledge entries from schema + real data.
 * Produces three tiers: data-grounded, domain knowledge, and industry benchmarks.
 */
async function generateKnowledgeEntries(
  schemaMap: SchemaMap,
  datasetLabel: string,
  queryResultsText: string,
): Promise<KnowledgeEntry[]> {
  let colSummary = "";
  for (const [name, meta] of Object.entries(schemaMap.columns)) {
    const type = meta.semanticType;
    const desc = meta.description;
    colSummary += `  - ${name}: ${desc} [${type}]\n`;
  }

  const prompt = `You are a knowledge base curator for an analytics platform. You have access to both the dataset schema AND real query results from the data.

Dataset: "${datasetLabel}" (domain: ${schemaMap.domain})

Schema:
${schemaMap.annotatedSchemaContext || colSummary}

${schemaMap.domainHints ? `Domain hints:\n${schemaMap.domainHints}` : ""}

## Real Data Discovery Results
${queryResultsText}

Generate 20-25 knowledge entries across THREE tiers:

### Tier 1: Data-Grounded Facts (8-10 entries)
Facts derived from the ACTUAL query results above. Include real numbers, percentages, and distributions.
Examples: "Total dataset contains X rows spanning Y to Z", "Top category is X at Y% of total", "Average order value is $X"
These MUST reference real numbers from the query results — do not make up statistics.

### Tier 2: Domain Knowledge (6-8 entries)
How this type of business works — operational patterns, key relationships between metrics, what drives success in this domain.
Examples: "In ride-hailing, cancellation rates above 15% typically indicate supply-demand mismatch in that zone", "Cart abandonment correlates strongly with checkout step count"

### Tier 3: Industry Benchmarks (4-6 entries)
External reference points from the industry that help contextualize this dataset's numbers.
Examples: "Industry average ecommerce conversion rate is 2.5-3.0% (Statista 2024)", "Typical ride-hailing platform take rate is 20-25%"
Cite the source or context for benchmarks when possible.

Each entry must have:
{
  "content": "1-2 clear, specific sentences",
  "category": "<category>",
  "priority": "<priority>",
  "tier": "data" | "domain" | "industry"
}

Categories: ${KNOWLEDGE_CATEGORIES.join(", ")}
Priorities: ${KNOWLEDGE_PRIORITIES.join(", ")}

Category guidance:
- "Metric" (Critical) — key metric definitions, how they're calculated from this data
- "Metric range" (High) — expected ranges and healthy thresholds, using real data + benchmarks
- "Data validation" (High) — data quality rules, NULL handling, column gotchas specific to this dataset
- "Insight" (High) — business context, operational patterns, domain expertise
- "External benchmark" (High) — industry reference points with sources
- "Segment" (Good to have) — key cohort definitions and how to identify them
- "Reporting" (Good to have) — how to interpret or present results for this domain

GUIDELINES:
- Tier 1 entries MUST cite actual numbers from the query results
- Tier 2 entries should be specific to the domain (${schemaMap.domain}), not generic analytics advice
- Tier 3 entries should cite real industry benchmarks with approximate sources
- Be concise: each content string should be 1-2 sentences max
- Do not repeat information across entries
- Make entries actionable — they should help an AI analyst write better queries and give better insights

Respond with ONLY the JSON array. No markdown, no explanation.`;

  let raw: { content?: string; category?: string; priority?: string; tier?: string }[];
  try {
    const json = await generateJson<unknown>(prompt, {
      timeoutMs: 45_000,
      label: "Knowledge entry generation",
      maxOutputTokens: 8192,
    });
    raw = Array.isArray(json) ? json : [];
  } catch {
    console.warn("[knowledge-generator] Failed to parse knowledge entries JSON");
    return [];
  }

  const now = new Date().toISOString();
  return raw
    .filter((e) => e.content && e.content.trim().length > 0)
    .map((e) => ({
      id: crypto.randomUUID(),
      content: e.content!.trim(),
      level: "global" as const,
      category: KNOWLEDGE_CATEGORIES.includes(e.category as never)
        ? (e.category as KnowledgeEntry["category"])
        : "Insight",
      priority: KNOWLEDGE_PRIORITIES.includes(e.priority as never)
        ? (e.priority as KnowledgeEntry["priority"])
        : "High",
      source: "auto-generated" as const,
      dateAdded: now,
      addedBy: "Actioneer AI",
    }));
}

/**
 * Full two-step knowledge generation pipeline.
 * 1. LLM generates discovery SQL from schema
 * 2. Execute queries against DuckDB
 * 3. LLM generates knowledge entries from schema + real data + domain expertise
 */
export async function generateKnowledgeForDataset(
  schemaMap: SchemaMap,
  datasetId: string,
  datasetLabel: string,
  primaryTable: string,
): Promise<KnowledgeEntry[]> {
  console.log(`[knowledge-generator] Step 1: generating discovery queries for "${datasetLabel}"`);
  const queries = await generateDiscoveryQueries(schemaMap, datasetLabel, primaryTable);
  console.log(`[knowledge-generator] Generated ${queries.length} discovery queries`);

  console.log(`[knowledge-generator] Step 2: executing discovery queries`);
  const results = await executeDiscoveryQueries(queries, datasetId);
  console.log(`[knowledge-generator] Got results from ${results.length}/${queries.length} queries`);

  const queryResultsText = formatQueryResults(results);

  console.log(`[knowledge-generator] Step 3: generating knowledge entries from schema + data`);
  const entries = await generateKnowledgeEntries(schemaMap, datasetLabel, queryResultsText);
  console.log(`[knowledge-generator] Generated ${entries.length} knowledge entries`);

  return entries;
}
