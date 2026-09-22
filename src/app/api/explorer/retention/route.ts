import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getDataset, getDatasetForUser } from "@/lib/datasets";
import { executeSQLInternal } from "@/lib/sql-executor";
import { compileRetentionSQL } from "@/lib/retention-sql";
import { DAY_BUCKETS, DEFAULT_BRACKETS } from "@/lib/retention-types";
import type { RetentionConfig, RetentionResult, RetentionCohort, RetentionSeriesResult, RetentionBreakdownSeries } from "@/lib/retention-types";
import { safeStringify } from "@/lib/safe-stringify";

/**
 * Parse retention rows. When `hasBreakdown` is true, rows include a
 * `breakdown` column and we group by (breakdown, cohort_date). The unbroken
 * cohorts/overall are derived by summing across breakdown values per cohort.
 */
function parseRetentionRows(
  rows: Record<string, unknown>[],
  bucketValues: number[],
  hasBreakdown: boolean = false,
): {
  cohorts: RetentionCohort[];
  overall: Record<number, number>;
  breakdownSeries?: RetentionBreakdownSeries[];
} {
  if (!hasBreakdown) {
    const cohortMap = new Map<string, RetentionCohort>();
    for (const row of rows) {
      const date = String(row.cohort_date);
      const size = Number(row.cohort_size) || 0;
      const bucket = Number(row.day_bucket);
      const retained = Number(row.retained_users) || 0;

      if (!cohortMap.has(date)) {
        cohortMap.set(date, { cohortDate: date, cohortSize: size, retainedByBucket: {} });
      }
      if (!isNaN(bucket)) {
        cohortMap.get(date)!.retainedByBucket[bucket] = retained;
      }
    }

    const cohorts = Array.from(cohortMap.values()).sort(
      (a, b) => a.cohortDate.localeCompare(b.cohortDate),
    );

    const overall = computeOverall(cohorts, bucketValues);
    return { cohorts, overall };
  }

  // ── Breakdown branch ──
  // Group rows first by breakdown value, then by cohort date.
  const byValue = new Map<string, Map<string, RetentionCohort>>();
  for (const row of rows) {
    const value = String(row.breakdown ?? "(none)");
    const date = String(row.cohort_date);
    const size = Number(row.cohort_size) || 0;
    const bucket = Number(row.day_bucket);
    const retained = Number(row.retained_users) || 0;

    if (!byValue.has(value)) byValue.set(value, new Map());
    const cohortMap = byValue.get(value)!;
    if (!cohortMap.has(date)) {
      cohortMap.set(date, { cohortDate: date, cohortSize: size, retainedByBucket: {} });
    }
    if (!isNaN(bucket)) {
      cohortMap.get(date)!.retainedByBucket[bucket] = retained;
    }
  }

  // Per-breakdown series with weighted overall
  const breakdownSeries: RetentionBreakdownSeries[] = [];
  for (const [value, cohortMap] of byValue.entries()) {
    const seriesCohorts = Array.from(cohortMap.values()).sort(
      (a, b) => a.cohortDate.localeCompare(b.cohortDate),
    );
    const totalCohortSize = seriesCohorts.reduce((s, c) => s + c.cohortSize, 0);
    const seriesOverall = computeOverall(seriesCohorts, bucketValues);
    breakdownSeries.push({ value, totalCohortSize, overall: seriesOverall });
  }

  // Sort series by total cohort size descending (most volume first)
  breakdownSeries.sort((a, b) => b.totalCohortSize - a.totalCohortSize);

  // Build the unbroken aggregate by combining cohorts from every breakdown value.
  // For a given cohort_date, the cohort_size is summed across all breakdown values
  // (since each breakdown row independently captured its slice of that cohort).
  const aggregate = new Map<string, RetentionCohort>();
  for (const cohortMap of byValue.values()) {
    for (const c of cohortMap.values()) {
      const existing = aggregate.get(c.cohortDate);
      if (!existing) {
        aggregate.set(c.cohortDate, {
          cohortDate: c.cohortDate,
          cohortSize: c.cohortSize,
          retainedByBucket: { ...c.retainedByBucket },
        });
      } else {
        existing.cohortSize += c.cohortSize;
        for (const [bucket, retained] of Object.entries(c.retainedByBucket)) {
          const b = Number(bucket);
          existing.retainedByBucket[b] = (existing.retainedByBucket[b] ?? 0) + retained;
        }
      }
    }
  }

  const cohorts = Array.from(aggregate.values()).sort(
    (a, b) => a.cohortDate.localeCompare(b.cohortDate),
  );
  const overall = computeOverall(cohorts, bucketValues);

  return { cohorts, overall, breakdownSeries };
}

function computeOverall(cohorts: RetentionCohort[], bucketValues: number[]): Record<number, number> {
  const overall: Record<number, number> = {};
  for (const bucket of bucketValues) {
    let totalRetained = 0;
    let totalSize = 0;
    for (const c of cohorts) {
      if (bucket in c.retainedByBucket) {
        totalRetained += c.retainedByBucket[bucket];
        totalSize += c.cohortSize;
      }
    }
    overall[bucket] = totalSize > 0 ? Math.round((totalRetained / totalSize) * 10000) / 100 : 0;
  }
  return overall;
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const datasetId = req.headers.get("x-dataset-id") || undefined;
    if (!datasetId) {
      return NextResponse.json({ error: "Missing x-dataset-id header" }, { status: 400 });
    }

    if (!getDatasetForUser(datasetId, userId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const dataset = getDataset(datasetId);
    const body = await req.json();
    const config: RetentionConfig = body.config;

    if (!config?.startEventId || !config?.returnEventIds?.length) {
      return NextResponse.json({ error: "Start and return events are required" }, { status: 400 });
    }

    const startTime = performance.now();
    const events = dataset.events ?? [];

    // Determine bucket values
    const bucketValues = config.mode === "custom"
      ? (config.customBrackets ?? DEFAULT_BRACKETS).map((_, i) => i)
      : [...DAY_BUCKETS];

    // Multiple return events → run one query per return event
    if (config.returnEventIds.length > 1) {
      const seriesResults: RetentionSeriesResult[] = [];

      for (const returnId of config.returnEventIds.slice(0, 2)) {
        const sql = compileRetentionSQL(config, dataset, returnId);
        if (!sql) continue;
        const qr = await executeSQLInternal(sql, datasetId);
        if (qr.error) continue;

        const { cohorts, overall } = parseRetentionRows(qr.rows as Record<string, unknown>[], bucketValues);
        const eventDef = events.find((e) => e.id === returnId);
        seriesResults.push({
          returnEventId: returnId,
          returnEventLabel: eventDef?.displayName ?? returnId,
          cohorts,
          overall,
        });
      }

      const primary = seriesResults[0];
      const result: RetentionResult = {
        config,
        sql: "(multiple return events)",
        cohorts: primary?.cohorts ?? [],
        overall: primary?.overall ?? {},
        dayBuckets: bucketValues,
        seriesResults,
        executionTimeMs: Math.round(performance.now() - startTime),
      };

      return new Response(safeStringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Single return event
    const sql = compileRetentionSQL(config, dataset);
    if (!sql) {
      return NextResponse.json({ error: "Unable to compile retention query" }, { status: 400 });
    }

    const queryResult = await executeSQLInternal(sql, datasetId);

    if (queryResult.error) {
      const result: RetentionResult = {
        config, sql, cohorts: [], overall: {}, dayBuckets: bucketValues,
        executionTimeMs: queryResult.executionTimeMs, error: queryResult.error,
      };
      return new Response(safeStringify(result), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    const hasBreakdown = !!config.breakdown;
    const { cohorts, overall, breakdownSeries } = parseRetentionRows(
      queryResult.rows as Record<string, unknown>[],
      bucketValues,
      hasBreakdown,
    );

    const result: RetentionResult = {
      config,
      sql,
      cohorts,
      overall,
      dayBuckets: bucketValues,
      breakdownSeries,
      executionTimeMs: queryResult.executionTimeMs,
    };

    return new Response(safeStringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[explorer/retention] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
