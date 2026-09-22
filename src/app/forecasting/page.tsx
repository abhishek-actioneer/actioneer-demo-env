"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Download, RefreshCw, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { getDefaultModel, getAllSeedData, setSeedData, hasSeedData } from "@/lib/forecast-store";
import { resolveTable } from "@/lib/forecast-engine";
import type { ForecastModel, ResolvedTable } from "@/lib/forecast-types";
import { ForecastTable } from "@/components/forecast/forecast-table";
import { ForecastChart } from "@/components/forecast/forecast-chart";
import { InspectPanel } from "@/components/forecast/inspect-panel";
import { FeatureGate } from "@/components/feature-gate";

function exportCSV(model: ForecastModel, resolved: ResolvedTable) {
  const headers = ["Metric", ...resolved.columns.map((c) => c.label)];
  const rows = model.rows.map((row) => {
    const cells = resolved.columns.map((col) => {
      const cell = resolved.rows[row.id]?.[col.key];
      if (!cell || cell.error) return cell?.error ?? "";
      if (cell.value === null) return "";
      return String(Math.round(cell.value * 100) / 100);
    });
    return [row.label, ...cells];
  });

  const csv = [headers, ...rows].map((r) =>
    r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")
  ).join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${model.name.replace(/\s+/g, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Fetch historical data from SQL for a single row. */
async function fetchSeedData(sql: string): Promise<{ data: Record<string, number>; error?: string }> {
  return apiFetch("/api/forecast/seed", {
    method: "POST",
    body: { sql },
  });
}

/** Fetch LLM forecast for a single row. */
async function fetchForecast(
  label: string,
  format: "currency" | "percent" | "number",
  historical: Record<string, number>,
  forecastWeeks: number,
): Promise<{ forecast: Record<string, number>; error?: string }> {
  return apiFetch("/api/forecast/predict", {
    method: "POST",
    body: { label, format, historical, forecastWeeks },
  });
}

export default function ForecastingPage() {
  const [model, setModel] = useState<ForecastModel>(() => getDefaultModel());
  const [loadingRows, setLoadingRows] = useState<Set<string>>(new Set());
  const [version, setVersion] = useState(0); // bump to trigger re-resolve from seedData
  const mountedRef = useRef(false);

  // Auto-resolve: always consistent with model + seedData
  const resolved = useMemo(
    () => resolveTable(model, getAllSeedData()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, version],
  );

  const [inspectRowId, setInspectRowId] = useState<string | null>(null);
  const inspectRow = inspectRowId ? model.rows.find((r) => r.id === inspectRowId) ?? null : null;

  const handleExport = useCallback(() => {
    exportCSV(model, resolved);
  }, [model, resolved]);

  /** Load historical + forecast for a set of base rows. */
  const loadRows = useCallback(async (
    rows: { id: string; label: string; format: "currency" | "percent" | "number"; sourceQuery: string }[],
    forecastWeeks: number,
    skipHistorical = false,
  ) => {
    const rowIds = new Set(rows.map((r) => r.id));
    setLoadingRows((prev) => new Set([...prev, ...rowIds]));

    try {
      await Promise.all(rows.map(async (row) => {
        // Step 1: Fetch historical data from SQL (unless skipping)
        let historical: Record<string, number>;
        if (skipHistorical && hasSeedData(row.id)) {
          // Use existing seed data as historical (filter to only historical keys)
          historical = { ...getAllSeedData().get(row.id)! };
        } else {
          const seedResult = await fetchSeedData(row.sourceQuery);
          if (seedResult.error) {
            console.warn(`[forecast] seed error for ${row.label}:`, seedResult.error);
            return; // Keep existing seed data
          }
          historical = seedResult.data;
          setSeedData(row.id, historical);
        }

        // Step 2: Fetch LLM forecast
        if (Object.keys(historical).length > 0) {
          const predictResult = await fetchForecast(row.label, row.format, historical, forecastWeeks);
          if (predictResult.error) {
            console.warn(`[forecast] predict error for ${row.label}:`, predictResult.error);
          } else if (Object.keys(predictResult.forecast).length > 0) {
            setSeedData(row.id, predictResult.forecast);
          }
        }
      }));

      setVersion((v) => v + 1);
    } finally {
      setLoadingRows((prev) => {
        const next = new Set(prev);
        for (const id of rowIds) next.delete(id);
        return next;
      });
    }
  }, []);

  // On mount: load forecasts for all base rows
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;

    const baseRows = model.rows
      .filter((r) => r.type === "base" && r.sourceQuery)
      .map((r) => ({
        id: r.id,
        label: r.label,
        format: r.format,
        sourceQuery: r.sourceQuery!,
      }));

    if (baseRows.length > 0) {
      // Skip historical fetch if we already have hardcoded seed data
      const hasAllSeeds = baseRows.every((r) => hasSeedData(r.id));
      loadRows(baseRows, model.forecastWeeks ?? 12, hasAllSeeds);
    }
  }, [model, loadRows]);

  const handleLoadRow = useCallback(async (
    rowId: string,
    sourceQuery: string,
    label: string,
    format: "currency" | "percent" | "number",
  ) => {
    await loadRows(
      [{ id: rowId, label, format, sourceQuery }],
      model.forecastWeeks ?? 12,
      false,
    );
  }, [model.forecastWeeks, loadRows]);

  const handleRegenerate = useCallback(() => {
    const baseRows = model.rows
      .filter((r) => r.type === "base" && r.sourceQuery)
      .map((r) => ({
        id: r.id,
        label: r.label,
        format: r.format,
        sourceQuery: r.sourceQuery!,
      }));

    if (baseRows.length > 0) {
      // Re-run LLM forecast only (skip historical SQL re-fetch)
      loadRows(baseRows, model.forecastWeeks ?? 12, true);
    }
  }, [model, loadRows]);

  const isAnyLoading = loadingRows.size > 0;

  return (
    <FeatureGate feature="forecasting">
    <div className="flex flex-col h-full min-w-0">
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-[1400px] mx-auto px-6 py-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1
                className="font-semibold"
                style={{ fontSize: 18, letterSpacing: "0.01em", color: "var(--fc-text-primary)" }}
              >
                {model.name}
              </h1>
              <p
                className="mt-1"
                style={{ fontSize: 11.7, color: "var(--fc-text-secondary)" }}
              >
                {model.rows.length} metrics · Weekly
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleRegenerate}
                disabled={isAnyLoading}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                style={{ fontSize: 11.7, fontWeight: 500 }}
              >
                {isAnyLoading
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <RefreshCw className="w-4 h-4" />
                }
                Regenerate Forecast
              </button>
              <button
                onClick={handleExport}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                style={{ fontSize: 11.7, fontWeight: 500 }}
              >
                <Download className="w-4 h-4" />
                Export CSV
              </button>
            </div>
          </div>

          {/* Chart */}
          <ForecastChart model={model} resolved={resolved} />

          {/* Table */}
          <ForecastTable
            model={model}
            resolved={resolved}
            onModelChange={setModel}
            onInspectRow={(rowId) => setInspectRowId(rowId)}
            loadingRows={loadingRows}
          />
        </div>
      </main>

      {/* Inspect Panel */}
      <InspectPanel
        open={!!inspectRowId}
        onOpenChange={(open) => { if (!open) setInspectRowId(null); }}
        row={inspectRow}
        model={model}
        onModelChange={setModel}
        onLoadRow={handleLoadRow}
        loadingRows={loadingRows}
      />
    </div>
    </FeatureGate>
  );
}
