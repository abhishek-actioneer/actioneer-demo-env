import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getDataset, getDatasetForUser } from "@/lib/datasets";
import { executeSQLInternal, validateSQL } from "@/lib/sql-executor";
import { compileExplorerSQL, buildExplorerChartSpec } from "@/lib/explorer-sql";
import type { ExplorerConfig, ExplorerResult } from "@/lib/explorer-types";
import { safeStringify } from "@/lib/safe-stringify";

/** Map explorer chart types to base ChartSpec types */
function resolveBaseChartType(ct: string): "bar" | "line" | "area" | "pie" | "scatter" {
  const map: Record<string, "bar" | "line" | "area" | "pie"> = {
    "stacked-bar": "bar", "stacked-area": "area", "kpi": "bar", "pie": "pie",
  };
  return (map[ct] ?? ct) as "bar" | "line" | "area" | "pie" | "scatter";
}

/** Shift a date range back by one period (for comparison) */
function shiftDateRange(
  dateRange: ExplorerConfig["dateRange"],
  compare: "previous_period" | "previous_year",
  datasetDateRange?: { start: string; end: string },
): ExplorerConfig["dateRange"] {
  if ("start" in dateRange) {
    const start = new Date(dateRange.start);
    const end = new Date(dateRange.end);
    const durationMs = end.getTime() - start.getTime();
    if (compare === "previous_year") {
      start.setFullYear(start.getFullYear() - 1);
      end.setFullYear(end.getFullYear() - 1);
    } else {
      start.setTime(start.getTime() - durationMs);
      end.setTime(end.getTime() - durationMs);
    }
    return { start: start.toISOString().split("T")[0], end: end.toISOString().split("T")[0] };
  }
  // Preset: compute absolute dates then shift
  const days: Record<string, number> = { "7d": 7, "30d": 30, "60d": 60, "90d": 90, "1y": 365 };
  const d = days[dateRange.preset] ?? 30;
  const endDate = datasetDateRange ? new Date(datasetDateRange.end) : new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - d);
  if (compare === "previous_year") {
    startDate.setFullYear(startDate.getFullYear() - 1);
    endDate.setFullYear(endDate.getFullYear() - 1);
  } else {
    startDate.setDate(startDate.getDate() - d);
    endDate.setDate(endDate.getDate() - d);
  }
  return { start: startDate.toISOString().split("T")[0], end: endDate.toISOString().split("T")[0] };
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const datasetId = req.headers.get("x-dataset-id") || undefined;
    if (!datasetId) {
      return NextResponse.json(
        { error: "Missing x-dataset-id header" },
        { status: 400 },
      );
    }

    if (!getDatasetForUser(datasetId, userId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const dataset = getDataset(datasetId);
    const body = await req.json();
    const config: ExplorerConfig = body.config;
    const segmentSQLs: string[] = body.segmentSQLs ?? [];

    for (const segSQL of segmentSQLs) {
      const v = validateSQL(segSQL);
      if (!v.valid) {
        return NextResponse.json({ error: `Invalid segment SQL: ${v.error}` }, { status: 400 });
      }
    }

    if (!config?.events?.length) {
      return NextResponse.json(
        { error: "At least one event is required" },
        { status: 400 },
      );
    }

    // Compile config to SQL
    const compiled = compileExplorerSQL(config, dataset, segmentSQLs);
    if (!compiled) {
      return NextResponse.json(
        { error: "Unable to compile this configuration. Try simplifying your query." },
        { status: 400 },
      );
    }

    const { sql, perEventLabels } = compiled;

    // Execute SQL
    const queryResult = await executeSQLInternal(sql, datasetId);

    if (queryResult.error) {
      const result: ExplorerResult = {
        config,
        sql,
        chartSpec: { type: resolveBaseChartType(config.chartType), title: "", data: [], xKey: "period", yKeys: ["value"] },
        data: [],
        executionTimeMs: queryResult.executionTimeMs,
        error: queryResult.error,
      };
      return new Response(safeStringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Build chart spec from results
    const explorerResult = buildExplorerChartSpec(
      queryResult.rows as Record<string, unknown>[],
      config,
      perEventLabels,
    );
    let { chartSpec } = explorerResult;
    const { breakdownData, dates } = explorerResult;

    // Period-over-period comparison (disabled when breakdown is active — too many series)
    const hasBreakdown = !!config.breakdown;
    if (config.compare && config.compare !== "none" && !hasBreakdown && chartSpec.data.length > 0 && chartSpec.yKeys?.length) {
      const compareConfig: ExplorerConfig = {
        ...config,
        compare: "none", // prevent recursion
        dateRange: shiftDateRange(config.dateRange, config.compare, dataset.dateRange),
      };
      const compareCompiled = compileExplorerSQL(compareConfig, dataset, segmentSQLs);
      if (compareCompiled) {
        const compareResult = await executeSQLInternal(compareCompiled.sql, datasetId);
        if (!compareResult.error && compareResult.rows.length > 0) {
          const { chartSpec: compareSpec } = buildExplorerChartSpec(
            compareResult.rows as Record<string, unknown>[],
            compareConfig,
            perEventLabels,
          );
          // Merge comparison data: align by index, add "_prev" suffixed keys
          const prevLabel = config.compare === "previous_year" ? "Previous Year" : "Previous Period";
          const prevYKeys = chartSpec.yKeys.map((k) => `${k} (${prevLabel})`);
          const mergedData = chartSpec.data.map((row, i) => {
            const prevRow = compareSpec.data[i] ?? {};
            const merged: Record<string, string | number> = { ...row };
            for (let j = 0; j < chartSpec.yKeys!.length; j++) {
              const origKey = chartSpec.yKeys![j];
              const prevKey = prevYKeys[j];
              merged[prevKey] = prevRow[origKey] ?? 0;
            }
            return merged;
          });
          chartSpec = {
            ...chartSpec,
            data: mergedData,
            yKeys: [...chartSpec.yKeys, ...prevYKeys],
            yLabels: [...(chartSpec.yLabels ?? chartSpec.yKeys), ...prevYKeys],
            forecastKeys: prevYKeys, // renders as dashed lines
          };
        }
      }
    }

    const result: ExplorerResult = {
      config,
      sql,
      chartSpec,
      data: queryResult.rows as Record<string, unknown>[],
      breakdownData,
      dates,
      executionTimeMs: queryResult.executionTimeMs,
    };

    return new Response(safeStringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[explorer/query] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
