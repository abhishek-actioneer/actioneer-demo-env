"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { Plus, X } from "lucide-react";
import type { EventDefinition, PropertyFilter, EventProperty } from "@/lib/explorer-types";
import { SegmentFilterBuilder } from "./segment-filter-builder";
import { PropertyFilterRow } from "./property-filter-row";
import type { FunnelStep, ConversionWindow, FunnelOrder, CountingMethod } from "@/lib/funnel-types";
import { CONVERSION_WINDOW_LABELS, FUNNEL_ORDER_LABELS, COUNTING_METHOD_LABELS } from "@/lib/funnel-types";

interface FunnelConfigPanelProps {
  steps: FunnelStep[];
  catalog: EventDefinition[];
  conversionWindow: ConversionWindow;
  order: FunnelOrder;
  breakdown?: string;
  onAddStep: (eventId: string) => void;
  onRemoveStep: (index: number) => void;
  onUpdateStep: (index: number, patch: Partial<FunnelStep>) => void;
  onConversionWindowChange: (w: ConversionWindow) => void;
  onOrderChange: (o: FunnelOrder) => void;
  onBreakdownChange?: (breakdown: string | undefined) => void;
  segmentIds?: string[];
  segments?: { id: string; name: string }[];
  onSegmentIdsChange?: (ids: string[]) => void;
  segmentCompare?: boolean;
  onSegmentCompareChange?: (compare: boolean) => void;
  countingMethod?: CountingMethod;
  onCountingMethodChange?: (m: CountingMethod) => void;
}

export function FunnelConfigPanel({
  steps,
  catalog,
  conversionWindow,
  order,
  breakdown,
  onAddStep,
  onRemoveStep,
  onUpdateStep,
  onConversionWindowChange,
  onOrderChange,
  onBreakdownChange,
  segmentIds,
  segments,
  onSegmentIdsChange,
  segmentCompare,
  onSegmentCompareChange,
  countingMethod,
  onCountingMethodChange,
}: FunnelConfigPanelProps) {
  // Funnel breakdowns are anchored on the entry step in compileFunnelSQL.
  const allProperties: EventProperty[] = useMemo(
    () => catalog.find((e) => e.id === steps[0]?.eventId)?.properties ?? [],
    [catalog, steps],
  );

  useEffect(() => {
    if (breakdown && !allProperties.some((property) => property.column === breakdown)) {
      onBreakdownChange?.(undefined);
    }
  }, [allProperties, breakdown, onBreakdownChange]);

  return (
    <div className="w-[340px] flex-shrink-0 border-r overflow-y-auto">
      {/* Steps */}
      <div className="border-b px-4 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Steps
        </h3>
        <div className="space-y-2">
          {steps.map((step, i) => {
            const def = catalog.find((e) => e.id === step.eventId);
            return (
              <StepCard
                key={`${step.eventId}-${i}`}
                index={i}
                step={step}
                definition={def}
                onUpdate={(patch) => onUpdateStep(i, patch)}
                onRemove={() => onRemoveStep(i)}
              />
            );
          })}

          <AddStepButton
            availableEvents={catalog}
            onSelect={onAddStep}
          />

          {steps.length < 2 && (
            <p className="text-xs text-muted-foreground py-1">
              Add at least 2 steps to build a funnel
            </p>
          )}
        </div>
      </div>

      {/* Conversion window */}
      <div className="px-4 py-3 border-b">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Conversion Window
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(CONVERSION_WINDOW_LABELS) as ConversionWindow[]).map((w) => (
            <button
              key={w}
              onClick={() => onConversionWindowChange(w)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                conversionWindow === w
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {CONVERSION_WINDOW_LABELS[w]}
            </button>
          ))}
        </div>
      </div>

      {/* Ordering mode */}
      <div className="px-4 py-3 border-b">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Ordering
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(FUNNEL_ORDER_LABELS) as FunnelOrder[]).map((o) => (
            <button
              key={o}
              onClick={() => onOrderChange(o)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                order === o
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {FUNNEL_ORDER_LABELS[o]}
            </button>
          ))}
        </div>
        <p className="text-[9.9px] text-muted-foreground mt-1.5 leading-relaxed">
          {order === "this_order" && "Steps must happen in order. Other events can occur between them."}
          {order === "any_order" && "All steps required, but can happen in any sequence within the window."}
          {order === "exact_order" && "Steps must happen consecutively with no other events between them."}
        </p>
      </div>

      {/* Counting method */}
      {onCountingMethodChange && (() => {
        // Detect if any property looks like a session column
        const SESSION_COL_RE = /^(session_id|session|sessionid|session_number)$/i;
        const hasSessionProperty = allProperties.some((p) => SESSION_COL_RE.test(p.column));
        const sessionPropName = allProperties.find((p) => SESSION_COL_RE.test(p.column))?.displayName;

        return (
          <div className="px-4 py-3 border-b">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Counting
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(COUNTING_METHOD_LABELS) as CountingMethod[]).map((m) => {
                const isSessionsDisabled = m === "sessions" && !hasSessionProperty;
                return (
                  <button
                    key={m}
                    onClick={() => !isSessionsDisabled && onCountingMethodChange(m)}
                    disabled={isSessionsDisabled}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                      (countingMethod ?? "uniques") === m
                        ? "bg-foreground text-background"
                        : isSessionsDisabled
                          ? "bg-muted text-muted-foreground/40 cursor-not-allowed"
                          : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                    title={isSessionsDisabled ? "No session property found in selected events" : undefined}
                  >
                    {COUNTING_METHOD_LABELS[m]}
                  </button>
                );
              })}
            </div>
            <p className="text-[9.9px] text-muted-foreground mt-1.5 leading-relaxed">
              {(countingMethod ?? "uniques") === "uniques" && "Count each user once (first entry only)."}
              {countingMethod === "totals" && "Count every funnel attempt (users can re-enter)."}
              {countingMethod === "sessions" && `Count each session (holds ${sessionPropName ?? "session property"} constant).`}
            </p>
            {countingMethod !== "sessions" && !hasSessionProperty && steps.length >= 2 && (
              <p className="text-[9.9px] text-muted-foreground/60 mt-0.5">No session property found</p>
            )}
          </div>
        );
      })()}

      {/* Segment by */}
      {onSegmentIdsChange && segments && (
        <div className="px-4 py-3 border-b">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Segment by
          </h3>
          <SegmentFilterBuilder
            selectedIds={segmentIds ?? []}
            segments={segments}
            onChange={onSegmentIdsChange}
            compareMode={segmentCompare}
            onCompareModeChange={onSegmentCompareChange}
          />
        </div>
      )}

      {/* Breakdown */}
      {onBreakdownChange && (
        <div className="px-4 py-3 border-b">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Breakdown
          </h3>
          {breakdown ? (
            <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
              <span className="flex-1 font-medium">
                {allProperties.find((p) => p.column === breakdown)?.displayName ?? breakdown}
              </span>
              <button
                onClick={() => onBreakdownChange(undefined)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <select
              value=""
              onChange={(e) => e.target.value && onBreakdownChange(e.target.value)}
              className="w-full appearance-none bg-transparent border rounded-md px-3 py-2 text-sm text-muted-foreground cursor-pointer focus:ring-1 focus:ring-border"
            >
              <option value="">+ Select Property</option>
              {allProperties.filter((p) => p.type === "string").map((p) => (
                <option key={p.column} value={p.column}>{p.displayName}</option>
              ))}
            </select>
          )}
        </div>
      )}
    </div>
  );
}

// ── Step Card with inline filters ──

function StepCard({
  index,
  step,
  definition,
  onUpdate,
  onRemove,
}: {
  index: number;
  step: FunnelStep;
  definition?: EventDefinition;
  onUpdate: (patch: Partial<FunnelStep>) => void;
  onRemove: () => void;
}) {
  const [showFilterPicker, setShowFilterPicker] = useState(false);
  const filters = step.filters ?? [];
  const properties = definition?.properties ?? [];

  const addFilter = (property: string) => {
    onUpdate({ filters: [...filters, { property, operator: "eq", value: "" }] });
    setShowFilterPicker(false);
  };

  const updateFilter = (fi: number, patch: Partial<PropertyFilter>) => {
    onUpdate({ filters: filters.map((f, j) => (j === fi ? { ...f, ...patch } : f)) });
  };

  const removeFilter = (fi: number) => {
    onUpdate({ filters: filters.filter((_, j) => j !== fi) });
  };

  return (
    <div className="group/step rounded-md border text-sm">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
          {index + 1}
        </span>
        <span className="flex-1 truncate font-medium">
          {definition?.displayName ?? step.eventId}
        </span>
        <button
          onClick={onRemove}
          className="opacity-0 group-hover/step:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Inline filters */}
      {filters.length > 0 && (
        <div className="px-3 pb-1.5 space-y-1.5">
          {filters.map((f, fi) => (
            <PropertyFilterRow
              key={fi}
              eventId={step.eventId}
              filter={f}
              properties={properties}
              onChange={(patch) => updateFilter(fi, patch)}
              onRemove={() => removeFilter(fi)}
            />
          ))}
        </div>
      )}

      {/* Add filter link + property picker */}
      <div className="px-3 pb-2 pt-0.5">
        {showFilterPicker && properties.length > 0 ? (
          <select
            defaultValue=""
            onChange={(e) => { if (e.target.value) addFilter(e.target.value); }}
            onBlur={() => setShowFilterPicker(false)}
            autoFocus
            className="w-full appearance-none bg-muted rounded-md px-2.5 py-1.5 text-xs cursor-pointer border-0 focus:ring-1 focus:ring-border"
          >
            <option value="">Select property...</option>
            {properties.map((p) => (
              <option key={p.column} value={p.column}>{p.displayName}</option>
            ))}
          </select>
        ) : (
          <button
            onClick={() => setShowFilterPicker(true)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            + Filter by
          </button>
        )}
      </div>
    </div>
  );
}

// ── Add step button ──

function AddStepButton({
  availableEvents,
  onSelect,
}: {
  availableEvents: EventDefinition[];
  onSelect: (eventId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
      >
        <Plus className="h-3.5 w-3.5" />
        Add Step
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-md border bg-popover shadow-md max-h-64 overflow-y-auto">
          {availableEvents.map((ev) => (
            <button
              key={ev.id}
              onClick={() => { onSelect(ev.id); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors first:rounded-t-md last:rounded-b-md"
            >
              {ev.displayName}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
