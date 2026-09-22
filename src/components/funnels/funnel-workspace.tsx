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
import { FunnelConfigPanel } from "@/components/explorer/funnel-config-panel";
import { FunnelChart } from "@/components/explorer/funnel-chart";
import { PinButton } from "@/components/canvas/pin-button";
import { useDataset } from "@/lib/dataset-context";
import { apiFetch } from "@/lib/api-client";
import { TimeDistributionChart } from "@/components/funnels/time-distribution-chart";
import type { SavedFunnel, FunnelConfig, FunnelResult } from "@/lib/funnel-types";
import type { ChartSpec } from "@/lib/chart-types";
import type { DateRangePreset } from "@/lib/explorer-types";

interface FunnelWorkspaceProps {
  funnel: SavedFunnel;
  onDelete: () => void;
  onUpdate: (updates: Partial<SavedFunnel>) => Promise<void>;
}

export function FunnelWorkspace({ funnel, onDelete, onUpdate }: FunnelWorkspaceProps) {
  const { dataset } = useDataset();
  const eventCatalog = useMemo(() => dataset?.events ?? [], [dataset]);

  const [config, setConfig] = useState<FunnelConfig>(funnel.config);
  const [result, setResult] = useState<FunnelResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track whether config has been modified from saved state
  const hasChanges = JSON.stringify(config) !== JSON.stringify(funnel.config);

  // Execute funnel query
  const executeFunnel = useCallback(async (cfg: FunnelConfig) => {
    if (cfg.steps.length < 2) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<FunnelResult>("/api/explorer/funnel", {
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
      setError(err instanceof Error ? err.message : "Funnel query failed");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    executeFunnel(funnel.config);
  }, [funnel.config, executeFunnel]);

  // Debounced re-execute on config change
  const updateConfig = useCallback((updater: (prev: FunnelConfig) => FunnelConfig) => {
    setConfig((prev) => {
      const next = updater(prev);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => executeFunnel(next), 300);
      return next;
    });
  }, [executeFunnel]);

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

  const overallConversion = result?.overallConversionRate ?? funnel.overallConversion ?? null;

  // Build a chart spec for Save to Board
  const pinSpec: ChartSpec | undefined = useMemo(() => {
    if (!result || result.steps.length === 0) return undefined;
    return {
      type: "funnel",
      title: `Funnel: ${funnel.name}`,
      data: result.steps.map((s) => ({
        step: s.label,
        conversion: s.conversionRate,
        users: s.userCount,
        medianTimeSeconds: s.medianTimeSeconds ?? 0,
      })),
      xKey: "step",
      yKeys: ["conversion"],
      format: { conversion: "percent" },
    };
  }, [result, funnel.name]);

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* ── Header ── */}
      <div className="px-8 pt-6 pb-4 border-b shrink-0">
        <div className="flex items-start justify-between gap-4 mb-1">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">{funnel.name}</h1>
            {funnel.description && (
              <p className="text-sm text-muted-foreground mt-0.5 max-w-2xl">{funnel.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {hasChanges && (
              <button
                onClick={handleSave}
                disabled={saving || config.steps.length < 2}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-foreground text-background hover:bg-foreground/90 transition-colors disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                Save Changes
              </button>
            )}
            <PinButton
              cardType="chart"
              title={`Funnel: ${funnel.name}`}
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
                  <AlertDialogTitle>Delete funnel?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete &ldquo;{funnel.name}&rdquo;. This action cannot be undone.
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
              {overallConversion != null ? `${overallConversion.toFixed(1)}%` : "--"}
            </span>
            <span className="text-xs text-muted-foreground ml-1.5">overall conversion</span>
          </div>
          <div>
            <span className="text-2xl font-bold tabular-nums">{config.steps.length}</span>
            <span className="text-xs text-muted-foreground ml-1.5">steps</span>
          </div>
        </div>
      </div>

      {/* ── Body: chart on left, config panel on right ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex-1 min-w-0 p-6 overflow-y-auto space-y-6">
          <FunnelChart
            config={config}
            result={result}
            loading={loading}
            error={error}
            onDatePresetChange={handleDatePresetChange}
          />

          {/* Time to Convert distribution — show when funnel has results */}
          {result && !loading && !error && result.steps.length >= 2 && (
            <TimeDistributionChart
              funnelId={funnel.id}
              stepLabels={result.steps.map((s) => s.label)}
              stepCount={result.steps.length}
            />
          )}
        </div>

        <FunnelConfigPanel
          steps={config.steps}
          catalog={eventCatalog}
          conversionWindow={config.conversionWindow}
          order={config.order}
          breakdown={config.breakdown}
          onAddStep={(eventId) => updateConfig((c) => ({ ...c, steps: [...c.steps, { eventId }] }))}
          onRemoveStep={(index) => updateConfig((c) => ({ ...c, steps: c.steps.filter((_, i) => i !== index) }))}
          onUpdateStep={(index, patch) => updateConfig((c) => ({ ...c, steps: c.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)) }))}
          onConversionWindowChange={(w) => updateConfig((c) => ({ ...c, conversionWindow: w }))}
          onOrderChange={(o) => updateConfig((c) => ({ ...c, order: o }))}
          onBreakdownChange={(b) => updateConfig((c) => ({ ...c, breakdown: b }))}
          countingMethod={config.countingMethod}
          onCountingMethodChange={(m) => updateConfig((c) => ({ ...c, countingMethod: m }))}
        />
      </div>
    </div>
  );
}
