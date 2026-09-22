"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Trash2, Loader2, Save } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { RetentionConfigPanel } from "@/components/explorer/retention-config-panel";
import { RetentionChart } from "@/components/explorer/retention-chart";
import { PinButton } from "@/components/canvas/pin-button";
import { useDataset } from "@/lib/dataset-context";
import { apiFetch } from "@/lib/api-client";
import type { SavedRetention, RetentionConfig, RetentionResult } from "@/lib/retention-types";
import type { ChartSpec } from "@/lib/chart-types";
import type { DateRangePreset } from "@/lib/explorer-types";

interface RetentionWorkspaceProps {
  retention: SavedRetention;
  onDelete: () => void;
  onUpdate: (updates: Partial<SavedRetention>) => Promise<void>;
}

export function RetentionWorkspace({ retention, onDelete, onUpdate }: RetentionWorkspaceProps) {
  const { dataset } = useDataset();
  const eventCatalog = useMemo(() => dataset?.events ?? [], [dataset]);

  const [config, setConfig] = useState<RetentionConfig>(retention.config);
  const [result, setResult] = useState<RetentionResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track whether config has been modified from saved state
  const hasChanges = JSON.stringify(config) !== JSON.stringify(retention.config);

  // Execute retention query
  const executeRetention = useCallback(async (cfg: RetentionConfig) => {
    if (!cfg.startEventId || !cfg.returnEventIds.length) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<RetentionResult>("/api/explorer/retention", {
        method: "POST",
        body: { config: cfg },
      });
      if (res.error) {
        setError(res.error);
        setResult(res);
      } else {
        setResult(res);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retention query failed");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    executeRetention(retention.config);
  }, [retention.config, executeRetention]);

  // Debounced re-execute on config change
  const updateConfig = useCallback((updater: (prev: RetentionConfig) => RetentionConfig) => {
    setConfig((prev) => {
      const next = updater(prev);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => executeRetention(next), 300);
      return next;
    });
  }, [executeRetention]);

  // Save changes
  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await onUpdate({ config });
    } finally {
      setSaving(false);
    }
  }, [config, onUpdate]);

  // Date preset change
  const handleDatePresetChange = useCallback((preset: DateRangePreset) => {
    updateConfig((c) => ({ ...c, dateRange: { preset } }));
  }, [updateConfig]);

  const d7Retention = retention.d7Retention ?? null;

  // Build a chart spec for Save to Board
  const pinSpec: ChartSpec | undefined = useMemo(() => {
    if (!result || Object.keys(result.overall).length === 0) return undefined;
    return {
      type: "line",
      title: `Retention: ${retention.name}`,
      data: result.dayBuckets
        .filter((b) => b in result.overall)
        .map((b) => ({ day: `D${b}`, retention: result.overall[b] })),
      xKey: "day",
      yKeys: ["retention"],
      yLabels: ["Retention %"],
      yAxisLabel: "Retention %",
    };
  }, [result, retention.name]);

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* ── Header ── */}
      <div className="px-8 pt-6 pb-4 border-b shrink-0">
        <div className="flex items-start justify-between gap-4 mb-1">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">{retention.name}</h1>
            {retention.description && (
              <p className="text-sm text-muted-foreground mt-0.5 max-w-2xl">{retention.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {hasChanges && (
              <button
                onClick={handleSave}
                disabled={saving || !config.startEventId || !config.returnEventIds.length}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-foreground text-background hover:bg-foreground/90 transition-colors disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                Save Changes
              </button>
            )}
            <PinButton
              cardType="chart"
              title={`Retention: ${retention.name}`}
              chartSpec={pinSpec}
              sql={result?.sql}
              data={pinSpec?.data as Record<string, unknown>[] | undefined}
            />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border hover:bg-muted transition-colors text-muted-foreground">
                  <Trash2 className="h-3 w-3" />
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete retention?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete &ldquo;{retention.name}&rdquo;. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        {/* KPI strip */}
        <div className="flex items-center gap-6 mt-3">
          <div>
            <span className="text-2xl font-bold tabular-nums">
              {d7Retention != null ? `${d7Retention}%` : "--"}
            </span>
            <span className="text-xs text-muted-foreground ml-1.5">D7 retention</span>
          </div>
          <div>
            <span className="text-2xl font-bold tabular-nums capitalize">{config.granularity}</span>
            <span className="text-xs text-muted-foreground ml-1.5">cohorts</span>
          </div>
        </div>
      </div>

      {/* ── Body: chart on left, config panel on right ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex-1 min-w-0 p-6 overflow-y-auto space-y-6">
          <RetentionChart
            config={config}
            result={result}
            loading={loading}
            error={error}
            onDatePresetChange={handleDatePresetChange}
          />
        </div>

        <RetentionConfigPanel
          config={config}
          catalog={eventCatalog}
          onStartEventChange={(eventId) => updateConfig((c) => ({ ...c, startEventId: eventId }))}
          onAddReturnEvent={(eventId) => updateConfig((c) => ({
            ...c,
            returnEventIds: [...c.returnEventIds.slice(0, 1), eventId],
          }))}
          onSetReturnEvent={(index, eventId) => updateConfig((c) => ({
            ...c,
            returnEventIds: c.returnEventIds.map((id, i) => i === index ? eventId : id),
          }))}
          onRemoveReturnEvent={(index) => updateConfig((c) => ({
            ...c,
            returnEventIds: c.returnEventIds.filter((_, i) => i !== index),
          }))}
          onModeChange={(mode) => updateConfig((c) => ({ ...c, mode }))}
          onGranularityChange={(granularity) => updateConfig((c) => ({ ...c, granularity }))}
          onBreakdownChange={(breakdown) => updateConfig((c) => ({ ...c, breakdown }))}
          onStartFiltersChange={(filters) => updateConfig((c) => ({ ...c, startFilters: filters }))}
          onReturnFiltersChange={(filters) => updateConfig((c) => ({ ...c, returnFilters: filters }))}
        />
      </div>
    </div>
  );
}
