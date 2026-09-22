/**
 * Auto-generate starter funnels from a dataset's event catalog.
 * Follows the segment-generator pattern: LLM → validate → persist.
 */

import { generateJson } from "@/lib/llm";
import { compileFunnelSQL } from "@/lib/funnel-sql";
import { executeSQLInternal } from "@/lib/sql-executor";
import { upsertFunnel, listFunnels, deleteFunnel } from "@/lib/server/funnel-repo";
import type { DatasetConfig } from "@/lib/datasets/types";
import type { EventDefinition } from "@/lib/explorer-types";
import type { FunnelConfig, ConversionWindow } from "@/lib/funnel-types";

const ALLOWED_WINDOWS: readonly ConversionWindow[] = ["1h", "1d", "7d", "30d", "90d"] as const;

export interface FunnelGenerationResult {
  generated: number;
  failed: number;
}

function buildFunnelGenerationPrompt(
  events: EventDefinition[],
  label: string,
): string {
  const eventList = events
    .map((e) => `- ${e.id}: "${e.displayName}" (category: ${e.category || "General"})`)
    .join("\n");

  return `You are an analytics expert. Given the following event catalog for a "${label}" dataset, generate 3-5 meaningful sequential funnel journeys.

EVENT CATALOG:
${eventList}

RULES:
1. Each funnel must have 2-5 steps in a logical sequential order (user would do step 1 before step 2, etc.)
2. Steps must use ONLY event IDs from the catalog above — no invented events
3. Funnels should represent real user journeys that a PM or growth team would monitor
4. Avoid trivial funnels (don't just list random events)
5. Give each funnel a clear, descriptive name
6. Pick a realistic conversion window per funnel based on the natural time scale
   of the events. Allowed values: "1h", "1d", "7d", "30d", "90d".
   Examples: signup→activation = "1d" or "7d"; purchase→repeat purchase = "30d";
   loan disbursement→prepayment = "90d"; bounce→collection action = "7d".
   Pick the LARGEST allowed window if the natural cycle is months or years.

Return a single JSON object of the form {"funnels": [ ... ]} where each element is:
[
  {
    "name": "Funnel Name",
    "description": "What this funnel measures",
    "steps": ["event_id_1", "event_id_2", "event_id_3"],
    "conversionWindow": "30d"
  }
]

Return ONLY the JSON object, no markdown fences, no explanation.`;
}

export async function generateFunnelsForDataset(
  userId: string,
  datasetId: string,
  dataset: DatasetConfig,
): Promise<FunnelGenerationResult> {
  // Filter out events flagged as ineligible for funnels (status flags on
  // parent rows, daily-rollup booleans, etc — see EventDefinition.funnelEligible)
  const events = (dataset.events ?? []).filter((e) => e.funnelEligible !== false);
  if (events.length < 2) {
    return { generated: 0, failed: 0 };
  }

  const prompt = buildFunnelGenerationPrompt(events, dataset.label);

  let candidates: { name: string; description: string; steps: string[]; conversionWindow?: string }[];
  try {
    const parsed = await generateJson<unknown>(prompt, {
      label: "funnel-generator",
      timeoutMs: 120_000,
      // jsonMode forces a top-level object; wide datasets need headroom past 4096
      maxOutputTokens: 16_384,
    });
    candidates = Array.isArray(parsed)
      ? parsed
      : ((parsed && typeof parsed === "object"
          ? (Object.values(parsed).find(Array.isArray) as typeof candidates | undefined)
          : undefined) ?? []);
  } catch {
    console.warn("[funnel-generator] Failed to parse LLM response");
    return { generated: 0, failed: 0 };
  }

  if (candidates.length === 0) {
    return { generated: 0, failed: 0 };
  }

  const eventIds = new Set(events.map((e) => e.id));
  let generated = 0;
  let failed = 0;

  const validated: { name: string; description: string; config: FunnelConfig; overallConversion: number }[] = [];

  for (const candidate of candidates.slice(0, 8)) {
    if (!candidate.name || !candidate.steps || candidate.steps.length < 2) {
      failed++;
      continue;
    }

    // Validate all step event IDs exist
    const validSteps = candidate.steps.filter((id) => eventIds.has(id));
    if (validSteps.length < 2) {
      console.warn(`[funnel-generator] Invalid event IDs in "${candidate.name}"`);
      failed++;
      continue;
    }

    const llmWindow = candidate.conversionWindow as ConversionWindow | undefined;
    const conversionWindow: ConversionWindow =
      llmWindow && ALLOWED_WINDOWS.includes(llmWindow) ? llmWindow : "30d";

    const config: FunnelConfig = {
      steps: validSteps.map((eventId) => ({ eventId })),
      conversionWindow,
      order: "this_order",
      dateRange: { preset: "90d" },
    };

    // Execute to verify non-zero conversion
    const sql = compileFunnelSQL(config, dataset);
    if (!sql) {
      failed++;
      continue;
    }

    const execResult = await executeSQLInternal(sql, datasetId);
    if (execResult.error) {
      console.warn(`[funnel-generator] SQL failed for "${candidate.name}": ${execResult.error}`);
      failed++;
      continue;
    }

    const row = execResult.rows[0] as Record<string, unknown> | undefined;
    if (!row) {
      failed++;
      continue;
    }

    const step0Count = Number(row.step0_count) || 0;
    const lastStepCount = Number(row[`step${validSteps.length - 1}_count`]) || 0;
    if (step0Count === 0) {
      failed++;
      continue;
    }

    const overallConversion = Math.round((lastStepCount / step0Count) * 10000) / 100;
    validated.push({
      name: candidate.name,
      description: candidate.description?.trim() ?? "",
      config,
      overallConversion,
    });
  }

  if (validated.length === 0) {
    return { generated: 0, failed };
  }

  // Clear previously auto-generated funnels
  const existing = listFunnels(userId, datasetId);
  for (const f of existing) {
    if (f.source === "auto") {
      deleteFunnel(userId, f.id);
    }
  }

  for (const f of validated) {
    const id = crypto.randomUUID();
    try {
      upsertFunnel(userId, {
        id,
        name: f.name,
        description: f.description,
        config: f.config,
        source: "auto",
        overallConversion: f.overallConversion,
        datasetId,
      });
      generated++;
    } catch (err) {
      console.warn(`[funnel-generator] Insert failed for "${f.name}":`, err);
      failed++;
    }
  }

  return { generated, failed };
}
