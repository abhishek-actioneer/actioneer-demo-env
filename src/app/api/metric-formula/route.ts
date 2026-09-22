import { generateText } from "@/lib/llm";

export async function POST(req: Request) {
  let body: { sql: string; metricName: string; description?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { sql, metricName, description } = body;
  if (!sql || !metricName) {
    return Response.json({ error: "sql and metricName are required" }, { status: 400 });
  }

  try {
    const prompt = `Given this SQL query and metric name, write a concise formula expression that describes the calculation.

Metric name: "${metricName}"
${description ? `Description: "${description}"` : ""}
SQL: ${sql}

Return ONLY the formula expression — no explanation, no markdown. Examples of good formulas:
- SUM(revenue) / COUNT(DISTINCT users)
- COUNT(*) WHERE status = 'cancelled' / COUNT(*) * 100
- AVG(order_value)
- (churned_partners / active_partners) * 100`;

    const result = await generateText(prompt, {
      label: "metric_formula_sync",
      maxOutputTokens: 256,
    });

    const formula = result.trim().replace(/^```[^\n]*\n?/i, "").replace(/\n?```$/i, "").trim();

    return Response.json({ formula });
  } catch (err) {
    console.error("[api/metric-formula] Error:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Failed to generate formula" }, { status: 500 });
  }
}
