/**
 * Auto-generate starter retentions from a dataset's event catalog.
 * Follows the funnel-generator pattern: LLM → validate → persist.
 */

import { generateJson } from "@/lib/llm";
import { compileRetentionSQL } from "@/lib/retention-sql";
import { executeSQLInternal } from "@/lib/sql-executor";
import { upsertRetention, listRetentions, deleteRetention } from "@/lib/server/retention-repo";
import type { DatasetConfig } from "@/lib/datasets/types";
import type { EventDefinition } from "@/lib/explorer-types";
import type { RetentionConfig } from "@/lib/retention-types";

export interface RetentionGenerationResult {
  generated: number;
  failed: number;
}

function buildRetentionGenerationPrompt(
  events: EventDefinition[],
  label: string,
): string {
  const eventList = events
    .map((e) => `- ${e.id}: "${e.displayName}" (category: ${e.category || "General"})`)
    .join("\n");

  return `You are an analytics expert. Given the following event catalog for a "${label}" dataset, generate 2-3 meaningful retention analyses using start event → return event pairs.

EVENT CATALOG:
${eventList}

RULES:
1. Each retention must have exactly 1 start event and 1 return event
2. The start event and return event can be the same (e.g. "any_event" → "any_event" for general retention)
3. Events must use ONLY event IDs from the catalog above — no invented events
4. Retentions should represent meaningful user engagement patterns that a PM or growth team would monitor
5. Think about: onboarding retention, feature adoption, purchase repeat, engagement loops
6. Give each retention a clear, descriptive name

Return a single JSON object of the form {"retentions": [ ... ]} where each element is:
[
  {
    "name": "Retention Name",
    "description": "What this retention measures",
    "startEventId": "event_id_1",
    "returnEventId": "event_id_2"
  }
]

Return ONLY the JSON object, no markdown fences, no explanation.`;
}

export async function generateRetentionsForDataset(
  userId: string,
  datasetId: string,
  dataset: DatasetConfig,
): Promise<RetentionGenerationResult> {
  // Filter out events flagged as ineligible (status flags / daily rollups)
  const events = (dataset.events ?? []).filter((e) => e.funnelEligible !== false);
  if (events.length < 1) {
    return { generated: 0, failed: 0 };
  }

  const prompt = buildRetentionGenerationPrompt(events, dataset.label);

  let candidates: { name: string; description: string; startEventId: string; returnEventId: string }[];
  try {
    const parsed = await generateJson<unknown>(prompt, {
      label: "retention-generator",
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
    console.warn("[retention-generator] Failed to parse LLM response");
    return { generated: 0, failed: 0 };
  }

  if (candidates.length === 0) {
    return { generated: 0, failed: 0 };
  }

  const eventIds = new Set(events.map((e) => e.id));
  let generated = 0;
  let failed = 0;

  const validated: { name: string; description: string; config: RetentionConfig; d7Retention: number }[] = [];

  for (const candidate of candidates.slice(0, 5)) {
    if (!candidate.name || !candidate.startEventId || !candidate.returnEventId) {
      failed++;
      continue;
    }

    // Validate event IDs exist
    if (!eventIds.has(candidate.startEventId) || !eventIds.has(candidate.returnEventId)) {
      console.warn(`[retention-generator] Invalid event IDs in "${candidate.name}"`);
      failed++;
      continue;
    }

    const config: RetentionConfig = {
      startEventId: candidate.startEventId,
      returnEventIds: [candidate.returnEventId],
      mode: "on_or_after",
      granularity: "daily",
      dateRange: { preset: "30d" },
    };

    // Execute to verify non-zero cohort and get D7 retention
    const sql = compileRetentionSQL(config, dataset);
    if (!sql) {
      failed++;
      continue;
    }

    const execResult = await executeSQLInternal(sql, datasetId);
    if (execResult.error) {
      console.warn(`[retention-generator] SQL failed for "${candidate.name}": ${execResult.error}`);
      failed++;
      continue;
    }

    // Look for D7 bucket in results
    const rows = execResult.rows as Record<string, unknown>[];
    if (rows.length === 0) {
      failed++;
      continue;
    }

    // Sum cohort sizes and D7 retained to compute overall D7 retention
    let totalCohortSize = 0;
    let totalD7Retained = 0;
    const cohortSizes = new Map<string, number>();

    for (const row of rows) {
      const cohortDate = String(row.cohort_date);
      const cohortSize = Number(row.cohort_size) || 0;
      const dayBucket = Number(row.day_bucket);
      const retained = Number(row.retained_users) || 0;

      if (!cohortSizes.has(cohortDate)) {
        cohortSizes.set(cohortDate, cohortSize);
        totalCohortSize += cohortSize;
      }

      if (dayBucket === 7) {
        totalD7Retained += retained;
      }
    }

    if (totalCohortSize === 0) {
      failed++;
      continue;
    }

    const d7Retention = Math.round((totalD7Retained / totalCohortSize) * 10000) / 100;

    validated.push({
      name: candidate.name,
      description: candidate.description?.trim() ?? "",
      config,
      d7Retention,
    });
  }

  if (validated.length === 0) {
    return { generated: 0, failed };
  }

  // Clear previously auto-generated retentions
  const existing = listRetentions(userId, datasetId);
  for (const r of existing) {
    if (r.source === "auto") {
      deleteRetention(userId, r.id);
    }
  }

  for (const r of validated) {
    const id = crypto.randomUUID();
    try {
      upsertRetention(userId, {
        id,
        name: r.name,
        description: r.description,
        config: r.config,
        source: "auto",
        d7Retention: r.d7Retention,
        datasetId,
      });
      generated++;
    } catch (err) {
      console.warn(`[retention-generator] Insert failed for "${r.name}":`, err);
      failed++;
    }
  }

  return { generated, failed };
}
