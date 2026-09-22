"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { Plus, X } from "lucide-react";
import type { EventDefinition, EventProperty, PropertyFilter } from "@/lib/explorer-types";
import type { RetentionConfig, RetentionGranularity, RetentionMode } from "@/lib/retention-types";
import { RETENTION_MODE_LABELS } from "@/lib/retention-types";
import { SegmentFilterBuilder } from "./segment-filter-builder";
import { PropertyFilterRow } from "./property-filter-row";

interface RetentionConfigPanelProps {
  config: RetentionConfig;
  catalog: EventDefinition[];
  segments?: { id: string; name: string }[];
  onStartEventChange: (eventId: string) => void;
  onAddReturnEvent: (eventId: string) => void;
  onSetReturnEvent: (index: number, eventId: string) => void;
  onRemoveReturnEvent: (index: number) => void;
  onModeChange: (mode: RetentionMode) => void;
  onGranularityChange: (g: RetentionGranularity) => void;
  onBreakdownChange: (breakdown: string | undefined) => void;
  onStartFiltersChange: (filters: PropertyFilter[]) => void;
  onReturnFiltersChange: (filters: PropertyFilter[]) => void;
  onSegmentIdsChange?: (ids: string[]) => void;
  onSegmentCompareChange?: (compare: boolean) => void;
}

export function RetentionConfigPanel({
  config,
  catalog,
  segments,
  onStartEventChange,
  onAddReturnEvent,
  onSetReturnEvent,
  onRemoveReturnEvent,
  onModeChange,
  onGranularityChange,
  onBreakdownChange,
  onStartFiltersChange,
  onReturnFiltersChange: _onReturnFiltersChange,
  onSegmentIdsChange,
  onSegmentCompareChange,
}: RetentionConfigPanelProps) {
  const startDef = catalog.find((e) => e.id === config.startEventId);

  // Retention breakdowns are anchored on the starting cohort event.
  const allProperties: EventProperty[] = useMemo(
    () => startDef?.properties ?? [],
    [startDef],
  );

  useEffect(() => {
    if (config.breakdown && !allProperties.some((property) => property.column === config.breakdown)) {
      onBreakdownChange(undefined);
    }
  }, [allProperties, config.breakdown, onBreakdownChange]);

  return (
    <div className="w-[340px] flex-shrink-0 border-r overflow-y-auto">
      {/* Start Event */}
      <div className="px-4 py-3 border-b">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Starting Event
        </h3>
        <EventCard
          eventId={config.startEventId}
          catalog={catalog}
          onChange={onStartEventChange}
          filters={config.startFilters ?? []}
          onFiltersChange={onStartFiltersChange}
        />
      </div>

      {/* Return Events */}
      <div className="px-4 py-3 border-b">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Then the return event
        </h3>
        <div className="space-y-2">
          {config.returnEventIds.map((rid, i) => (
            <div key={`${rid}-${i}`} className="group/ret rounded-md border text-sm">
              <div className="flex items-center gap-2 px-3 py-2">
                <span className="flex h-5 w-5 items-center justify-center rounded bg-muted text-xs font-medium text-muted-foreground">
                  {String.fromCharCode(65 + i)}
                </span>
                <select
                  value={rid}
                  onChange={(e) => onSetReturnEvent(i, e.target.value)}
                  className="flex-1 appearance-none bg-transparent border-0 text-sm font-medium cursor-pointer focus:ring-0 p-0"
                >
                  <option value="">Select event...</option>
                  {catalog.map((ev) => (
                    <option key={ev.id} value={ev.id}>{ev.displayName}</option>
                  ))}
                </select>
                {config.returnEventIds.length > 1 && (
                  <button
                    onClick={() => onRemoveReturnEvent(i)}
                    className="opacity-0 group-hover/ret:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}

          {config.returnEventIds.length < 2 && (
            <AddEventDropdown
              catalog={catalog}
              onSelect={onAddReturnEvent}
              label="Add Event"
            />
          )}

          {config.returnEventIds.length === 0 && (
            <AddEventDropdown
              catalog={catalog}
              onSelect={onAddReturnEvent}
              label="Select Return Event"
            />
          )}
        </div>
      </div>

      {/* Measured As */}
      <div className="px-4 py-3 border-b">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Measured as
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(RETENTION_MODE_LABELS) as RetentionMode[]).map((m) => (
            <button
              key={m}
              onClick={() => onModeChange(m)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                config.mode === m
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {RETENTION_MODE_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      {/* Granularity */}
      <div className="px-4 py-3 border-b">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Granularity
        </h3>
        <div className="flex gap-1.5">
          {(["daily", "weekly", "monthly"] as RetentionGranularity[]).map((g) => (
            <button
              key={g}
              onClick={() => onGranularityChange(g)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors capitalize ${
                config.granularity === g
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {/* Segment by */}
      {onSegmentIdsChange && segments && (
        <div className="px-4 py-3 border-b">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Segment by
          </h3>
          <SegmentFilterBuilder
            selectedIds={config.segmentIds ?? []}
            segments={segments}
            onChange={onSegmentIdsChange}
            compareMode={config.segmentCompare}
            onCompareModeChange={onSegmentCompareChange}
          />
        </div>
      )}

      {/* Group Segment by (breakdown) */}
      <div className="px-4 py-3 border-b">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Group Segment by
        </h3>
        {config.breakdown ? (
          <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
            <span className="flex-1 font-medium">
              {allProperties.find((p) => p.column === config.breakdown)?.displayName ?? config.breakdown}
            </span>
            <button onClick={() => onBreakdownChange(undefined)} className="text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <select
            value=""
            onChange={(e) => e.target.value && onBreakdownChange(e.target.value)}
            className="w-full appearance-none bg-transparent border rounded-md px-3 py-2 text-sm text-muted-foreground cursor-pointer focus:ring-1 focus:ring-border"
          >
            <option value="">Select property...</option>
            {allProperties.filter((p) => p.type === "string").map((p) => (
              <option key={p.column} value={p.column}>{p.displayName}</option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

// ── Event Card with filter support ──

function EventCard({
  eventId,
  catalog,
  onChange,
  filters,
  onFiltersChange,
}: {
  eventId: string;
  catalog: EventDefinition[];
  onChange: (id: string) => void;
  filters: PropertyFilter[];
  onFiltersChange: (filters: PropertyFilter[]) => void;
}) {
  const [showFilterPicker, setShowFilterPicker] = useState(false);
  const def = catalog.find((e) => e.id === eventId);
  const properties = def?.properties ?? [];

  return (
    <div className="rounded-md border text-sm">
      <div className="px-3 py-2">
        <select
          value={eventId}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none bg-transparent border-0 text-sm font-medium cursor-pointer focus:ring-0 p-0"
        >
          <option value="">Select event...</option>
          {catalog.map((ev) => (
            <option key={ev.id} value={ev.id}>{ev.displayName}</option>
          ))}
        </select>
      </div>

      {/* Filters */}
      {filters.length > 0 && (
        <div className="px-3 pb-1.5 space-y-1.5">
          {filters.map((filter, index) => (
            <PropertyFilterRow
              key={index}
              eventId={eventId}
              filter={filter}
              properties={properties}
              onChange={(patch) =>
                onFiltersChange(filters.map((item, itemIndex) => (
                  itemIndex === index ? { ...item, ...patch } : item
                )))
              }
              onRemove={() => onFiltersChange(filters.filter((_, itemIndex) => itemIndex !== index))}
            />
          ))}
        </div>
      )}

      {/* Add filter */}
      <div className="px-3 pb-2 pt-0.5">
        {showFilterPicker && properties.length > 0 ? (
          <select
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) {
                onFiltersChange([...filters, { property: e.target.value, operator: "eq", value: "" }]);
                setShowFilterPicker(false);
              }
            }}
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

// ── Add Event Dropdown ──

function AddEventDropdown({
  catalog,
  onSelect,
  label,
}: {
  catalog: EventDefinition[];
  onSelect: (id: string) => void;
  label: string;
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
        {label}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-md border bg-popover shadow-md max-h-64 overflow-y-auto">
          {catalog.map((ev) => (
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
