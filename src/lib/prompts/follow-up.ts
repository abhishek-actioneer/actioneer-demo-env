import { generateText } from "@/lib/llm";
import { buildTextToSqlPrompt } from "@/lib/prompts/sql";

interface CardSummary {
  type: string;
  title: string;
  rowCount?: number;
  hasChart?: boolean;
  metricValue?: string | number;
  error?: string;
}

/**
 * Generate 2-3 schema-aware follow-up questions based on card context.
 * Returns an empty array on failure (non-fatal).
 */
export async function generateFollowUpQuestions(
  datasetId: string,
  context: string,
  cardSummaries: CardSummary[],
  dateRangeOverride?: string,
): Promise<string[]> {
  try {
    const cardSummaryLines = cardSummaries
      .map((c) => {
        const parts = [`- ${c.type} card: "${c.title}"`];
        if (c.rowCount != null) parts.push(`${c.rowCount} rows`);
        if (c.hasChart) parts.push("has chart");
        if (c.metricValue != null) parts.push(`value=${c.metricValue}`);
        if (c.error) parts.push(`error: ${c.error}`);
        return parts.join(" — ");
      })
      .join("\n");

    const hasEmptyResults = cardSummaries.some(
      (c) => c.rowCount === 0 || c.error,
    );

    const prompt = `${buildTextToSqlPrompt(datasetId, dateRangeOverride ? { dateRangeOverride } : undefined)}

Context: "${context}"

Cards generated:
${cardSummaryLines}

Generate 2-3 follow-up questions that:
1. Are contextual to the specific charts and data shown above
2. Can be answered by writing SQL against the schema provided
3. Help the user explore deeper (drill-down, compare, filter, trend over time)
${hasEmptyResults ? "\nAt least one card had errors or 0 rows — include a question that helps debug or find the right data." : ""}

Output ONLY a JSON array of strings. Example: ["What is X?", "Show me Y", "How does Z compare?"]`;

    const text = await generateText(prompt, {
      timeoutMs: 8_000,
      label: "follow-up-questions",
      maxOutputTokens: 256,
    });

    const cleaned = text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "");

    try {
      const arr = JSON.parse(cleaned);
      if (Array.isArray(arr) && arr.every((s: unknown) => typeof s === "string")) {
        return arr.slice(0, 3);
      }
    } catch {
      /* ignore parse errors */
    }
    return [];
  } catch {
    return [];
  }
}
