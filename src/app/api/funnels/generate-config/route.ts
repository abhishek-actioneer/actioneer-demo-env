import { auth } from "@clerk/nextjs/server";
import { DEFAULT_DATASET, getDataset } from "@/lib/datasets";
import { compileFunnelSQL } from "@/lib/funnel-sql";
import { executeSQLInternal } from "@/lib/sql-executor";
import { generateJson } from "@/lib/llm";
import type { FunnelConfig, ConversionWindow, FunnelOrder } from "@/lib/funnel-types";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const datasetId = req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  const dataset = getDataset(datasetId);

  const body = await req.json();
  const { description } = body as { description: string };
  if (!description || typeof description !== "string") {
    return Response.json({ error: "description is required" }, { status: 400 });
  }

  const events = (dataset.events ?? []).filter((e) => e.funnelEligible !== false);
  if (events.length === 0) {
    return Response.json(
      { error: "No events configured for this dataset. Funnels require event definitions." },
      { status: 422 }
    );
  }

  const eventList = events
    .map((e) => `- id: "${e.id}", name: "${e.displayName}"${e.category ? `, category: "${e.category}"` : ""}`)
    .join("\n");

  const prompt = `You are a product analytics expert. Given a user's description of a funnel, pick 2-6 events from the available event catalog that form a sequential user journey matching the description.

Available events:
${eventList}

User's description: "${description}"

Return a JSON object with these fields:
- "steps": array of objects with "eventId" (string matching one of the available event IDs above). Pick events that logically form a sequential journey.
- "conversionWindow": one of "1h", "1d", "7d", "30d", "90d" — pick the most appropriate window for this type of funnel. Default to "30d" if unsure.
- "order": one of "this_order", "any_order", "exact_order" — use "this_order" unless the description suggests otherwise.
- "name": a short, descriptive name for this funnel (max 50 chars).

Rules:
- All eventId values MUST exactly match IDs from the available events list.
- Pick 2-6 events that form a logical sequential journey.
- Order events from the earliest action to the latest in the user journey.
- Return ONLY the JSON object. No explanation.`;

  try {
    let parsed: { steps: { eventId: string }[]; conversionWindow?: string; order?: string; name?: string };
    try {
      parsed = await generateJson(prompt, {
        label: "funnels-generate-config",
        timeoutMs: 30_000,
        maxOutputTokens: 4096,
      });
    } catch {
      return Response.json({ error: "Failed to parse LLM response as JSON" }, { status: 500 });
    }

    // Validate steps
    if (!Array.isArray(parsed.steps) || parsed.steps.length < 2) {
      return Response.json({ error: "LLM generated fewer than 2 steps" }, { status: 422 });
    }

    const eventIds = new Set(events.map((e) => e.id));
    const validSteps = parsed.steps.filter((s) => eventIds.has(s.eventId));
    if (validSteps.length < 2) {
      return Response.json({ error: "LLM generated steps with invalid event IDs" }, { status: 422 });
    }

    const validWindows = new Set(["1h", "1d", "7d", "30d", "90d"]);
    const conversionWindow: ConversionWindow = validWindows.has(parsed.conversionWindow ?? "")
      ? (parsed.conversionWindow as ConversionWindow)
      : "30d";

    const validOrders = new Set(["this_order", "any_order", "exact_order"]);
    const order: FunnelOrder = validOrders.has(parsed.order ?? "")
      ? (parsed.order as FunnelOrder)
      : "this_order";

    const name = (parsed.name || description).slice(0, 50);

    const config: FunnelConfig = {
      steps: validSteps.map((s) => ({ eventId: s.eventId })),
      conversionWindow,
      order,
      dateRange: { preset: "30d" },
    };

    // Execute funnel SQL to get conversion rate
    let overallConversion: number | null = null;
    try {
      const sql = compileFunnelSQL(config, dataset);
      if (sql) {
        const result = await executeSQLInternal(sql, datasetId);
        if (!result.error && result.rows.length > 0) {
          const row = result.rows[0] as Record<string, unknown>;
          const step0 = Number(row.step0_count) || 0;
          const lastStep = Number(row[`step${config.steps.length - 1}_count`]) || 0;
          overallConversion = step0 > 0 ? Math.round((lastStep / step0) * 10000) / 100 : 0;
        }
      }
    } catch {
      // Non-fatal — return config even if execution fails
    }

    return Response.json({ config, name, overallConversion });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: `Generation failed: ${message}` }, { status: 500 });
  }
}
