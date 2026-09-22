import { auth } from "@clerk/nextjs/server";
import { DEFAULT_DATASET, getDataset } from "@/lib/datasets";
import { compileRetentionSQL } from "@/lib/retention-sql";
import { executeSQLInternal } from "@/lib/sql-executor";
import { generateJson } from "@/lib/llm";
import type { RetentionConfig, RetentionMode } from "@/lib/retention-types";

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
      { error: "No events configured for this dataset. Retention requires event definitions." },
      { status: 422 }
    );
  }

  const eventList = events
    .map((e) => `- id: "${e.id}", name: "${e.displayName}"${e.category ? `, category: "${e.category}"` : ""}`)
    .join("\n");

  const prompt = `You are a product analytics expert. Given a user's description of a retention analysis, pick a start event and one or more return events from the available event catalog.

Available events:
${eventList}

User's description: "${description}"

Return a JSON object with these fields:
- "startEventId": string — the event that marks the start of the retention period. Must exactly match one of the available event IDs.
- "returnEventIds": array of strings — 1-2 events that the user should come back and do. Must exactly match available event IDs.
- "mode": one of "on_or_after", "on", "custom" — use "on_or_after" unless the description suggests otherwise.
- "name": a short, descriptive name for this retention analysis (max 50 chars).

Rules:
- All event IDs MUST exactly match IDs from the available events list.
- Pick events that logically represent a meaningful retention pattern.
- The start event is the initial action; return events are what users should come back to do.
- Return ONLY the JSON object. No explanation.`;

  try {
    let parsed: { startEventId: string; returnEventIds: string[]; mode?: string; name?: string };
    try {
      parsed = await generateJson(prompt, {
        label: "retentions-generate-config",
        timeoutMs: 30_000,
        maxOutputTokens: 4096,
      });
    } catch {
      return Response.json({ error: "Failed to parse LLM response as JSON" }, { status: 500 });
    }

    // Validate events
    if (!parsed.startEventId || !Array.isArray(parsed.returnEventIds) || parsed.returnEventIds.length === 0) {
      return Response.json({ error: "LLM did not generate valid start/return events" }, { status: 422 });
    }

    const eventIds = new Set(events.map((e) => e.id));
    if (!eventIds.has(parsed.startEventId)) {
      return Response.json({ error: "LLM generated an invalid start event ID" }, { status: 422 });
    }
    const validReturnIds = parsed.returnEventIds.filter((id) => eventIds.has(id));
    if (validReturnIds.length === 0) {
      return Response.json({ error: "LLM generated return events with invalid IDs" }, { status: 422 });
    }

    const validModes = new Set(["on_or_after", "on", "custom"]);
    const mode: RetentionMode = validModes.has(parsed.mode ?? "")
      ? (parsed.mode as RetentionMode)
      : "on_or_after";

    const name = (parsed.name || description).slice(0, 50);

    const config: RetentionConfig = {
      startEventId: parsed.startEventId,
      returnEventIds: validReturnIds.slice(0, 2),
      mode,
      granularity: "daily",
      dateRange: { preset: "30d" },
    };

    // Execute retention SQL to get D7 rate
    let d7Retention: number | null = null;
    try {
      const sql = compileRetentionSQL(config, dataset);
      if (sql) {
        const result = await executeSQLInternal(sql, datasetId);
        if (!result.error && result.rows.length > 0) {
          const rows = result.rows as Record<string, unknown>[];
          let totalCohortSize = 0;
          let totalD7Retained = 0;
          const seen = new Set<string>();

          for (const row of rows) {
            const cohortDate = String(row.cohort_date);
            const cohortSize = Number(row.cohort_size) || 0;
            const dayBucket = Number(row.day_bucket);
            const retained = Number(row.retained_users) || 0;

            if (!seen.has(cohortDate)) {
              seen.add(cohortDate);
              totalCohortSize += cohortSize;
            }
            if (dayBucket === 7) {
              totalD7Retained += retained;
            }
          }

          d7Retention = totalCohortSize > 0
            ? Math.round((totalD7Retained / totalCohortSize) * 10000) / 100
            : 0;
        }
      }
    } catch {
      // Non-fatal — return config even if execution fails
    }

    return Response.json({ config, name, d7Retention });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: `Generation failed: ${message}` }, { status: 500 });
  }
}
