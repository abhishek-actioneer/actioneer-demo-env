import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getDataset, getDatasetForUser } from "@/lib/datasets";
import { executeSQLInternal } from "@/lib/sql-executor";
import { compileFunnelSQL } from "@/lib/funnel-sql";
import type { FunnelConfig, FunnelResult, FunnelStepResult, FunnelSegmentResult, FunnelBreakdownRow } from "@/lib/funnel-types";
import { safeStringify } from "@/lib/safe-stringify";

function buildStepResults(
  config: FunnelConfig,
  dataset: { events?: { id: string; displayName: string }[] },
  row: Record<string, unknown>,
): FunnelStepResult[] {
  const events = dataset.events ?? [];
  const results: FunnelStepResult[] = [];
  const totalEntered = Number(row.step0_count) || 0;

  for (let i = 0; i < config.steps.length; i++) {
    const count = Number(row[`step${i}_count`]) || 0;
    const prevCount = i === 0 ? count : (Number(row[`step${i - 1}_count`]) || 0);
    const eventDef = events.find((e) => e.id === config.steps[i].eventId);
    const avgTimeSeconds = i > 0 ? (Number(row[`step${i}_avg_time`]) || undefined) : undefined;
    const medianTimeSeconds = i > 0 ? (Number(row[`step${i}_median_time`]) || undefined) : undefined;

    results.push({
      stepIndex: i,
      eventId: config.steps[i].eventId,
      label: config.steps[i].label || eventDef?.displayName || config.steps[i].eventId,
      userCount: count,
      conversionRate: totalEntered > 0 ? Math.round((count / totalEntered) * 10000) / 100 : 0,
      dropOffRate: prevCount > 0 ? Math.round(((prevCount - count) / prevCount) * 10000) / 100 : 0,
      dropOffCount: prevCount - count,
      avgTimeSeconds,
      medianTimeSeconds,
    });
  }
  return results;
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
    const config: FunnelConfig = body.config;
    const segmentSQLs: string[] = body.segmentSQLs ?? [];
    const segmentNames: string[] = body.segmentNames ?? [];
    const segmentCompare: boolean = body.segmentCompare ?? false;

    if (!config?.steps || config.steps.length < 2) {
      return NextResponse.json({ error: "At least 2 steps are required" }, { status: 400 });
    }

    // Segment comparison: run funnel per segment
    if (segmentCompare && segmentSQLs.length >= 2) {
      const startTime = performance.now();
      const segmentResults: FunnelSegmentResult[] = [];

      for (let si = 0; si < segmentSQLs.length; si++) {
        const segSQL = compileFunnelSQL(config, dataset, segmentSQLs[si]);
        if (!segSQL) continue;
        const segResult = await executeSQLInternal(segSQL, datasetId);
        if (segResult.error) continue;

        const row = segResult.rows[0] ?? {};
        const steps = buildStepResults(config, dataset, row);
        const entered = steps[0]?.userCount ?? 0;
        const converted = steps[steps.length - 1]?.userCount ?? 0;

        segmentResults.push({
          segmentId: `seg-${si}`,
          segmentName: segmentNames[si] ?? `Segment ${si + 1}`,
          steps,
          totalEntered: entered,
          totalConverted: converted,
          overallConversionRate: entered > 0 ? Math.round((converted / entered) * 10000) / 100 : 0,
        });
      }

      // Use first segment as the main steps
      const mainSteps = segmentResults[0]?.steps ?? [];
      const result: FunnelResult = {
        config,
        sql: "(segment comparison — multiple queries)",
        steps: mainSteps,
        totalEntered: mainSteps[0]?.userCount ?? 0,
        totalConverted: mainSteps[mainSteps.length - 1]?.userCount ?? 0,
        overallConversionRate: segmentResults[0]?.overallConversionRate ?? 0,
        segmentResults,
        executionTimeMs: Math.round(performance.now() - startTime),
      };

      return new Response(safeStringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const sql = compileFunnelSQL(config, dataset);
    if (!sql) {
      return NextResponse.json({ error: "Unable to compile funnel query" }, { status: 400 });
    }

    const queryResult = await executeSQLInternal(sql, datasetId);

    if (queryResult.error) {
      const result: FunnelResult = {
        config,
        sql,
        steps: [],
        totalEntered: 0,
        totalConverted: 0,
        overallConversionRate: 0,
        executionTimeMs: queryResult.executionTimeMs,
        error: queryResult.error,
      };
      return new Response(safeStringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const events = dataset.events ?? [];
    const stepResults: FunnelStepResult[] = [];

    let breakdownRows: FunnelBreakdownRow[] | undefined;

    if (config.breakdown) {
      // Breakdown mode: rows are (step_index, breakdown, user_count)
      // 1. Aggregate totals per step for main funnel bars
      const stepTotals = new Map<number, number>();
      // 2. Preserve per-breakdown-value rows
      const rawBreakdown: { stepIndex: number; breakdown: string; userCount: number }[] = [];

      for (const row of queryResult.rows) {
        const si = Number(row.step_index);
        const uc = Number(row.user_count) || 0;
        const bk = String(row.breakdown ?? "Unknown");
        stepTotals.set(si, (stepTotals.get(si) ?? 0) + uc);
        rawBreakdown.push({ stepIndex: si, breakdown: bk, userCount: uc });
      }

      const totalEntered = stepTotals.get(0) ?? 0;
      for (let i = 0; i < config.steps.length; i++) {
        const count = stepTotals.get(i) ?? 0;
        const prevCount = i === 0 ? count : (stepTotals.get(i - 1) ?? 0);
        const eventDef = events.find((e) => e.id === config.steps[i].eventId);
        stepResults.push({
          stepIndex: i,
          eventId: config.steps[i].eventId,
          label: config.steps[i].label || eventDef?.displayName || config.steps[i].eventId,
          userCount: count,
          conversionRate: totalEntered > 0 ? Math.round((count / totalEntered) * 10000) / 100 : 0,
          dropOffRate: prevCount > 0 ? Math.round(((prevCount - count) / prevCount) * 10000) / 100 : 0,
          dropOffCount: prevCount - count,
        });
      }

      // Compute per-value conversion rates (relative to that value's step 0 count)
      const step0ByValue = new Map<string, number>();
      for (const r of rawBreakdown) {
        if (r.stepIndex === 0) step0ByValue.set(r.breakdown, r.userCount);
      }
      breakdownRows = rawBreakdown.map((r) => {
        const base = step0ByValue.get(r.breakdown) ?? 0;
        return {
          stepIndex: r.stepIndex,
          breakdown: r.breakdown,
          userCount: r.userCount,
          conversionRate: base > 0 ? Math.round((r.userCount / base) * 10000) / 100 : 0,
        };
      });
    } else {
      // Non-breakdown: single row with step{i}_count columns
      const row = queryResult.rows[0] ?? {};
      const totalEntered = Number(row.step0_count) || 0;

      for (let i = 0; i < config.steps.length; i++) {
        const count = Number(row[`step${i}_count`]) || 0;
        const prevCount = i === 0 ? count : (Number(row[`step${i - 1}_count`]) || 0);
        const eventDef = events.find((e) => e.id === config.steps[i].eventId);
        const avgTimeSeconds = i > 0 ? (Number(row[`step${i}_avg_time`]) || undefined) : undefined;
        const medianTimeSeconds = i > 0 ? (Number(row[`step${i}_median_time`]) || undefined) : undefined;

        stepResults.push({
          stepIndex: i,
          eventId: config.steps[i].eventId,
          label: config.steps[i].label || eventDef?.displayName || config.steps[i].eventId,
          userCount: count,
          conversionRate: totalEntered > 0 ? Math.round((count / totalEntered) * 10000) / 100 : 0,
          dropOffRate: prevCount > 0 ? Math.round(((prevCount - count) / prevCount) * 10000) / 100 : 0,
          dropOffCount: prevCount - count,
          avgTimeSeconds,
          medianTimeSeconds,
        });
      }
    }

    const totalEntered = stepResults[0]?.userCount ?? 0;
    const totalConverted = stepResults[stepResults.length - 1]?.userCount ?? 0;

    const result: FunnelResult = {
      config,
      sql,
      steps: stepResults,
      totalEntered,
      totalConverted,
      overallConversionRate: totalEntered > 0
        ? Math.round((totalConverted / totalEntered) * 10000) / 100
        : 0,
      breakdownRows,
      executionTimeMs: queryResult.executionTimeMs,
    };

    return new Response(safeStringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[explorer/funnel] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
