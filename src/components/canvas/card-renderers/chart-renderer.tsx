import { useCallback, useMemo, useRef } from "react";
import { UnifiedChart } from "@/components/chart/unified-chart";
import { useChartRequery } from "@/hooks/use-chart-requery";
import { autoGranularity } from "@/lib/explorer-types";
import type { ChartSpec } from "@/lib/chart-types";
import type { CardRendererProps } from "./types";
import { InnerContainer } from "./shared";

export function ChartRenderer({
  item,
  isSelected,
  isEditing,
  onDataPointClick,
  onUpdateCard,
}: CardRendererProps) {
  const spec: ChartSpec | undefined = item.chartSpec;
  const isInteractive = isSelected || isEditing;
  const { requery } = useChartRequery();
  const clickInteractive = isInteractive && !!onDataPointClick;

  // Remember the original SQL (before any date/grain transforms) so "All time"
  // can re-run the unfiltered query and subsequent transforms work correctly.
  const originalSqlRef = useRef<string | undefined>(spec?.sql);
  if (spec?.sql && !originalSqlRef.current) {
    originalSqlRef.current = spec.sql;
  }

  // Detect if data is time-series (has a date-like xKey)
  const isTimeSeries = useMemo(() => {
    if (!spec?.data?.length || !spec.xKey) return false;
    const sample = String(spec.data[0][spec.xKey] ?? "");
    return /^\d{4}-\d{2}/.test(sample);
  }, [spec]);

  const handleGrainChange = useCallback(
    async (grain: "daily" | "weekly" | "monthly") => {
      if (!onUpdateCard || !spec) return;
      const baseSql = originalSqlRef.current ?? spec.sql;

      if (baseSql) {
        const result = await requery({
          sql: baseSql,
          newGrain: grain,
          newDateRange: spec.dateRange,
          title: spec.title,
        });
        if (result?.chartSpec) {
          onUpdateCard({
            chartSpec: { ...spec, ...result.chartSpec, type: spec.type, grain, dateRange: spec.dateRange },
            data: result.data as Record<string, unknown>[],
          });
          return;
        }
      }

      onUpdateCard({ chartSpec: { ...spec, grain } });
    },
    [spec, onUpdateCard, requery],
  );

  const handleTimeRangeChange = useCallback(
    async (range: { start: string; end: string } | string) => {
      if (!onUpdateCard || !spec) return;
      const baseSql = originalSqlRef.current ?? spec.sql;

      // "All time" — re-run original SQL without date filter
      if (typeof range === "string") {
        if (baseSql) {
          const result = await requery({ sql: baseSql, newGrain: spec.grain, title: spec.title });
          if (result?.chartSpec) {
            onUpdateCard({
              chartSpec: { ...spec, ...result.chartSpec, type: spec.type, grain: spec.grain, dateRange: undefined },
              data: result.data as Record<string, unknown>[],
            });
          }
        }
        return;
      }

      // Auto-pick grain based on date span (coerce hourly → daily for chart grain)
      const rawGrain = autoGranularity({ start: range.start, end: range.end });
      const autoGrain: "daily" | "weekly" | "monthly" = rawGrain === "hourly" ? "daily" : rawGrain;

      // Specific date range
      if (baseSql) {
        const result = await requery({
          sql: baseSql,
          newDateRange: range,
          newGrain: autoGrain,
          title: spec.title,
        });
        if (result?.chartSpec) {
          onUpdateCard({
            chartSpec: { ...spec, ...result.chartSpec, type: spec.type, grain: autoGrain, dateRange: range },
            data: result.data as Record<string, unknown>[],
          });
          return;
        }
      }

      // No SQL — client-side: filter data by date range
      if (spec.xKey) {
        const filtered = spec.data.filter((row) => {
          const val = String(row[spec.xKey!] ?? "");
          return val >= range.start && val <= range.end + "T23:59:59";
        });
        onUpdateCard({
          chartSpec: { ...spec, data: filtered, dateRange: range, grain: autoGrain },
        });
      }
    },
    [spec, onUpdateCard, requery],
  );

  // Grain controls require DATE_TRUNC in SQL (requery replaces the grain argument)
  const hasDateTrunc = !!spec?.sql && /DATE_TRUNC/i.test(spec.sql);
  // Date range controls work on any chart with SQL + time-series data.
  // Also keep showing if the card already has a dateRange or DATE_TRUNC
  // (i.e. it was time-series before) so the user isn't trapped on empty results.
  const canFilterByDate = !!spec?.sql && (isTimeSeries || !!spec.dateRange || hasDateTrunc);

  if (!spec) {
    return (
      <InnerContainer>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            fontSize: 10.8,
            color: "var(--muted-foreground)",
          }}
        >
          Chart data not found
        </div>
      </InnerContainer>
    );
  }

  return (
    <InnerContainer>
      <UnifiedChart
        spec={spec}
        variant="normal"
        fullData={item.data as Record<string, unknown>[] | undefined}
        canvasMode
        isSelected={isSelected}
        isEditing={isEditing}
        onGrainChange={onUpdateCard && hasDateTrunc ? handleGrainChange : undefined}
        onTimeRangeChange={onUpdateCard && canFilterByDate ? handleTimeRangeChange : undefined}
        onDataPointClick={
          clickInteractive
            ? (click) => {
                onDataPointClick?.({
                  column: click.column,
                  value: click.value,
                  measure: click.measure,
                  measureKey: click.measureKey,
                  screenX: click.screenX,
                  screenY: click.screenY,
                });
              }
            : undefined
        }
        onTypeChange={
          onUpdateCard
            ? (newType, stacked) => {
                if (newType === "pie" && spec.xKey && !spec.nameKey) {
                  onUpdateCard({
                    chartSpec: {
                      ...spec,
                      type: newType,
                      stacked,
                      nameKey: spec.xKey,
                      valueKey: spec.yKeys?.[0] ?? "value",
                    },
                  });
                } else if (newType !== "pie" && spec.nameKey && !spec.xKey) {
                  onUpdateCard({
                    chartSpec: {
                      ...spec,
                      type: newType,
                      stacked,
                      xKey: spec.nameKey,
                      yKeys: [spec.valueKey ?? "value"],
                    },
                  });
                } else {
                  onUpdateCard({ chartSpec: { ...spec, type: newType, stacked } });
                }
              }
            : undefined
        }
        onTitleChange={
          onUpdateCard && isInteractive
            ? (newTitle) =>
                onUpdateCard({ chartSpec: { ...spec, title: newTitle } })
            : undefined
        }
      />
    </InnerContainer>
  );
}
