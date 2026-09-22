import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { generateText, type ModelId } from "@/lib/llm";

/** Add N weeks to a Monday date string. */
function addWeeks(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 7 * n);
  return d.toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const modelId = (req.headers.get("x-model-id") ?? undefined) as ModelId | undefined;
    const { label, format, historical, forecastWeeks = 12 } = (await req.json()) as {
      label: string;
      format: "currency" | "percent" | "number";
      historical: Record<string, number>;
      forecastWeeks?: number;
    };

    if (!historical || Object.keys(historical).length === 0) {
      return NextResponse.json({ forecast: {}, error: "No historical data provided" }, { status: 400 });
    }

    // Sort historical by date to find the last week
    const sortedKeys = Object.keys(historical).sort();
    const lastHistoricalWeek = sortedKeys[sortedKeys.length - 1];

    // Generate expected forecast week keys
    const forecastKeys: string[] = [];
    for (let i = 1; i <= forecastWeeks; i++) {
      forecastKeys.push(addWeeks(lastHistoricalWeek, i));
    }

    const formatContext = format === "currency"
      ? "This is a monetary metric (USD). Values are large sums (millions). Forecast realistic growth."
      : format === "percent"
      ? "This is a percentage metric (0-100 range typically). Keep forecasted values within reasonable bounds."
      : "This is a count metric. Values should be positive integers.";

    const prompt = `You are a time-series forecasting expert. Analyze the weekly historical data below and forecast the next ${forecastWeeks} weeks.

Metric: ${label}
${formatContext}

Historical data (week-start Monday → value):
${JSON.stringify(historical, null, 2)}

Forecast these exact weeks: ${JSON.stringify(forecastKeys)}

Consider:
- Overall trend (growing, declining, stable)
- Any seasonality patterns
- The metric's nature and reasonable bounds

Return ONLY a valid JSON object mapping each forecast week to its predicted value. No explanation, no markdown fences.
Example: {"2019-12-02": 61500000, "2019-12-09": 62000000, ...}`;

    const text = (await generateText(prompt, { modelId })).trim();

    if (!text) {
      return NextResponse.json({ forecast: {}, error: "Empty response from LLM" });
    }

    // Parse JSON — strip markdown fences if present
    const cleaned = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();

    let forecast: Record<string, number>;
    try {
      forecast = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({ forecast: {}, error: "Failed to parse LLM forecast response" });
    }

    // Validate: ensure all values are numbers
    const validated: Record<string, number> = {};
    for (const [key, val] of Object.entries(forecast)) {
      const num = Number(val);
      if (!isNaN(num)) {
        validated[key] = num;
      }
    }

    return NextResponse.json({ forecast: validated });
  } catch (err) {
    return NextResponse.json(
      { forecast: {}, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
