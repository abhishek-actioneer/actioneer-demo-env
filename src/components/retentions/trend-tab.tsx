"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Loader2 } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { apiFetch } from "@/lib/api-client";
import { getSeriesColor, getSeriesDash } from "@/lib/chart-colors";
import type { RetentionConfig } from "@/lib/retention-types";
import { DAY_BUCKETS, DEFAULT_BRACKETS } from "@/lib/retention-types";
import type { RetentionTrendResult } from "@/lib/retention-trend-sql";

interface TrendTabProps {
  retentionId: string;
  config: RetentionConfig;
  eventCatalog: Array<{ id: string; displayName: string }>;
}

/** Bucket options for standard (non-custom) modes. */
const STANDARD_BUCKET_OPTIONS = [
  { value: 0, label: "Day 0" },
  { value: 1, label: "Day 1" },
  { value: 3, label: "Day 3" },
  { value: 7, label: "Day 7" },
  { value: 14, label: "Day 14" },
  { value: 30, label: "Day 30" },
];

function getBucketOptions(config: RetentionConfig) {
  if (config.mode === "custom") {
    const brackets = config.customBrackets ?? DEFAULT_BRACKETS;
    return brackets.map((b, i) => ({
      value: i,
      label: `Day ${b.from}-${b.to}`,
    }));
  }
  return STANDARD_BUCKET_OPTIONS;
}

function getBucketLabel(config: RetentionConfig, bucket: number): string {
  if (config.mode === "custom") {
    const brackets = config.customBrackets ?? DEFAULT_BRACKETS;
    if (bucket >= 0 && bucket < brackets.length) {
      const b = brackets[bucket];
      return `Day ${b.from}-${b.to}`;
    }
    return `Bracket ${bucket}`;
  }
  return `Day ${bucket}`;
}

export function RetentionTrendTab({ retentionId, config, eventCatalog }: TrendTabProps) {
  const bucketOptions = useMemo(() => getBucketOptions(config), [config]);
  const defaultBucket = config.mode === "custom" ? 0 : 7;

  const [selectedBucket, setSelectedBucket] = useState<number>(defaultBucket);
  const [allBuckets, setAllBuckets] = useState(false);
  const [data, setData] = useState<RetentionTrendResult | null>(null);
  const [allBucketsData, setAllBucketsData] = useState<Map<number, RetentionTrendResult>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch trend data for a single bucket
  const fetchTrend = useCallback(async (bucket: number) => {
    try {
      const res = await apiFetch<RetentionTrendResult>(
        `/api/retentions/${retentionId}/trend`,
        {
          method: "POST",
          body: { bucket, config },
        }
      );
      return res;
    } catch (err) {
      throw err;
    }
  }, [retentionId, config]);

  // Fetch single bucket
  useEffect(() => {
    if (allBuckets) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchTrend(selectedBucket)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load trend data");
          setData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [selectedBucket, fetchTrend, allBuckets]);

  // Fetch all buckets
  useEffect(() => {
    if (!allBuckets) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    const bucketsToFetch = bucketOptions.map((o) => o.value);

    Promise.all(bucketsToFetch.map((b) => fetchTrend(b).then((r) => [b, r] as const)))
      .then((results) => {
        if (cancelled) return;
        const map = new Map<number, RetentionTrendResult>();
        for (const [b, r] of results) map.set(b, r);
        setAllBucketsData(map);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load trend data");
          setAllBucketsData(new Map());
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [allBuckets, fetchTrend, bucketOptions]);

  // Build chart data for single bucket view
  const singleChartData = useMemo(() => {
    if (!data?.periods.length) return [];
    return data.periods.map((p) => ({
      period: p.period,
      retentionRate: p.retentionRate,
      cohortSize: p.cohortSize,
      retainedCount: p.retainedCount,
    }));
  }, [data]);

  // Build chart data for all buckets view — merge all bucket series by period
  const allBucketsChartData = useMemo(() => {
    if (!allBuckets || allBucketsData.size === 0) return [];

    // Collect all unique periods
    const periodSet = new Set<string>();
    for (const result of allBucketsData.values()) {
      for (const p of result.periods) periodSet.add(p.period);
    }
    const sortedPeriods = [...periodSet].sort();

    return sortedPeriods.map((period) => {
      const row: Record<string, unknown> = { period };
      for (const [bucket, result] of allBucketsData) {
        const p = result.periods.find((pp) => pp.period === period);
        row[`bucket_${bucket}`] = p?.retentionRate ?? null;
        row[`size_${bucket}`] = p?.cohortSize ?? 0;
        row[`retained_${bucket}`] = p?.retainedCount ?? 0;
      }
      return row;
    });
  }, [allBuckets, allBucketsData]);

  const chartData = allBuckets ? allBucketsChartData : singleChartData;
  const activeBuckets = allBuckets ? bucketOptions : [];

  // Metadata for display
  const currentResult = allBuckets
    ? (allBucketsData.size > 0 ? [...allBucketsData.values()][0] : null)
    : data;
  const totalPeriods = currentResult?.periods.length ?? 0;
  const execTime = currentResult?.executionTimeMs ?? 0;

  const formatPeriod = useCallback((val: string) => {
    if (!val) return "";
    const d = new Date(val + "T00:00:00");
    if (config.granularity === "monthly") {
      return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    }
    if (config.granularity === "weekly") {
      return `W${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
    }
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }, [config.granularity]);

  if (!config.startEventId || !config.returnEventIds.length) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground text-sm text-center">
        Configure start and return events to see retention trends.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Controls */}
      <div className="flex items-center gap-4 text-sm flex-wrap">
        {/* Bucket selector pills */}
        <div className="flex items-center rounded-md border overflow-hidden">
          {bucketOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                setAllBuckets(false);
                setSelectedBucket(opt.value);
              }}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                !allBuckets && selectedBucket === opt.value
                  ? "bg-foreground text-background"
                  : "hover:bg-muted text-muted-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* All Buckets toggle */}
        <button
          onClick={() => setAllBuckets(!allBuckets)}
          className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${
            allBuckets
              ? "bg-foreground text-background"
              : "hover:bg-muted text-muted-foreground"
          }`}
        >
          All Buckets
        </button>

        {/* Metadata */}
        <div className="flex items-center gap-3 ml-auto">
          {!loading && totalPeriods > 0 && (
            <span className="text-xs text-muted-foreground">
              {totalPeriods} periods{execTime > 0 ? ` · ${execTime}ms` : ""}
            </span>
          )}
        </div>
      </div>

      {/* Chart */}
      <div className="relative rounded-lg border bg-background min-h-[350px] flex items-center justify-center">
        {loading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading trend data...</span>
          </div>
        )}

        {error && !loading && (
          <div className="text-center max-w-md px-4">
            <p className="text-sm text-foreground">{error}</p>
          </div>
        )}

        {!loading && !error && chartData.length === 0 && (
          <p className="text-sm text-muted-foreground text-center">No trend data available.</p>
        )}

        {!loading && !error && chartData.length > 0 && (
          <div className="w-full h-[350px] px-4 py-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--color-border)"
                  strokeOpacity={0.3}
                  vertical={false}
                />
                <XAxis
                  dataKey="period"
                  tickFormatter={formatPeriod}
                  tick={{ fontSize: 9, fill: "var(--color-muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  padding={{ left: 4, right: 4 }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tickFormatter={(v) => `${v}%`}
                  tick={{ fontSize: 8.1, fill: "var(--color-muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  width={50}
                  tickCount={5}
                  domain={[0, 100]}
                />
                <Tooltip
                  cursor={{ fill: "var(--color-muted)", opacity: 0.4 }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="rounded-md border border-border bg-popover px-3 py-2 shadow-sm antialiased">
                        <p className="text-[9.9px] font-medium text-foreground mb-1">
                          {formatPeriod(String(label ?? ""))}
                        </p>
                        {payload.map((entry, i) => {
                          if (entry.value == null) return null;

                          let labelText: string;
                          let sizeText = "";

                          if (allBuckets) {
                            const bucketVal = Number(
                              String(entry.dataKey).replace("bucket_", "")
                            );
                            labelText = getBucketLabel(config, bucketVal);
                            const sizeKey = `size_${bucketVal}`;
                            const retKey = `retained_${bucketVal}`;
                            const row = entry.payload as Record<string, unknown>;
                            const size = Number(row[sizeKey]) || 0;
                            const retained = Number(row[retKey]) || 0;
                            sizeText = ` (${retained}/${size})`;
                          } else {
                            labelText = getBucketLabel(config, selectedBucket);
                            const row = entry.payload as Record<string, unknown>;
                            const size = Number(row.cohortSize) || 0;
                            const retained = Number(row.retainedCount) || 0;
                            sizeText = ` (${retained}/${size})`;
                          }

                          return (
                            <p key={i} className="text-[9.9px] text-muted-foreground tabular-nums">
                              <span
                                className="inline-block w-2 h-2 rounded-full mr-1.5"
                                style={{ backgroundColor: entry.color }}
                              />
                              {labelText}: {Number(entry.value).toFixed(1)}%{sizeText}
                            </p>
                          );
                        })}
                      </div>
                    );
                  }}
                />

                {allBuckets ? (
                  // One line per bucket
                  activeBuckets.map((opt, i) => (
                    <Line
                      key={opt.value}
                      type="monotone"
                      dataKey={`bucket_${opt.value}`}
                      name={opt.label}
                      stroke={getSeriesColor(i)}
                      strokeWidth={i === 0 ? 2 : 1.5}
                      strokeDasharray={getSeriesDash(i)}
                      dot={chartData.length > 60 ? false : { r: 2, fill: getSeriesColor(i) }}
                      activeDot={{ r: 3 }}
                      connectNulls
                    />
                  ))
                ) : (
                  // Single bucket line
                  <Line
                    type="monotone"
                    dataKey="retentionRate"
                    name={getBucketLabel(config, selectedBucket)}
                    stroke={getSeriesColor(0)}
                    strokeWidth={2}
                    dot={chartData.length > 60 ? false : { r: 2.5, fill: getSeriesColor(0) }}
                    activeDot={{ r: 4, fill: getSeriesColor(0) }}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Legend */}
      {!loading && chartData.length > 0 && (
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground px-1">
          {allBuckets ? (
            activeBuckets.map((opt, i) => (
              <span key={opt.value} className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: getSeriesColor(i) }}
                />
                {opt.label}
              </span>
            ))
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-0.5 w-4 rounded"
                style={{ backgroundColor: getSeriesColor(0) }}
              />
              {getBucketLabel(config, selectedBucket)} Retention
            </span>
          )}
        </div>
      )}
    </div>
  );
}
