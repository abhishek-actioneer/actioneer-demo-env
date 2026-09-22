import { auth } from "@clerk/nextjs/server";
import { getDataset, getDatasetForUser } from "@/lib/datasets";
import { getFunnel } from "@/lib/server/funnel-repo";
import { executeSQLInternal } from "@/lib/sql-executor";
import {
  compileFunnelTrendSQL,
  parseFunnelTrendRows,
  computeComparisonDateRange,
  configWithDateRange,
  alignComparisonPeriods,
  type TrendGranularity,
  type TrendComparison,
} from "@/lib/funnel-trend-sql";
import { safeStringify } from "@/lib/safe-stringify";
import type { FunnelConfig } from "@/lib/funnel-types";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const funnel = getFunnel(userId, id);
  if (!funnel) return Response.json({ error: "Funnel not found" }, { status: 404 });

  const datasetId = funnel.datasetId || req.headers.get("x-dataset-id");
  if (!datasetId) return Response.json({ error: "Missing dataset" }, { status: 400 });
  if (!getDatasetForUser(datasetId, userId))
    return Response.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const granularity: TrendGranularity = body.granularity ?? "day";
  const comparison: TrendComparison = body.comparison ?? "none";
  // Allow overriding the config from request body (or use saved)
  const config: FunnelConfig = body.config ?? funnel.config;

  const dataset = getDataset(datasetId);
  const sql = compileFunnelTrendSQL(config, dataset, granularity);
  if (!sql) return Response.json({ error: "Cannot compile trend query" }, { status: 400 });

  const startTime = performance.now();
  const result = await executeSQLInternal(sql, datasetId);

  if (result.error) {
    return Response.json({ error: result.error }, { status: 422 });
  }

  const trendResult = parseFunnelTrendRows(
    result.rows as Record<string, unknown>[],
    config.steps.length,
    granularity,
    0, // will set total execution time below
  );

  // Run comparison query if requested
  let comparisonLabel: string | undefined;
  const compDateRange = computeComparisonDateRange(config, dataset, comparison);

  if (compDateRange) {
    const compConfig = configWithDateRange(config, compDateRange);
    const compSql = compileFunnelTrendSQL(compConfig, dataset, granularity);

    if (compSql) {
      const compResult = await executeSQLInternal(compSql, datasetId);
      if (!compResult.error) {
        const compTrend = parseFunnelTrendRows(
          compResult.rows as Record<string, unknown>[],
          config.steps.length,
          granularity,
          0,
        );

        // Align comparison periods to current period dates for overlay
        trendResult.comparisonPeriods = alignComparisonPeriods(
          trendResult.periods,
          compTrend.periods,
        );
        comparisonLabel =
          comparison === "previous_year"
            ? `Previous Year (${compDateRange.start} – ${compDateRange.end})`
            : `Previous Period (${compDateRange.start} – ${compDateRange.end})`;
        trendResult.comparisonLabel = comparisonLabel;
      }
    }
  }

  const executionTimeMs = Math.round(performance.now() - startTime);
  trendResult.executionTimeMs = executionTimeMs;

  return new Response(safeStringify(trendResult), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
