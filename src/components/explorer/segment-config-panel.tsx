"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, X, Trash2 } from "lucide-react";
import type {
  EventDefinition,
  PropertyFilter,
  DateRangePreset,
  EventProperty,
} from "@/lib/explorer-types";
import { SegmentFilterBuilder } from "./segment-filter-builder";
import { PropertyFilterRow } from "./property-filter-row";
import type {
  EventRule,
  AttributeRule,
  SegmentBuilderConfig,
  SegmentCombinator,
  SegmentRule,
  OccurrenceOp,
} from "@/lib/segment-builder-types";
import { OCCURRENCE_OP_LABELS } from "@/lib/segment-builder-types";

type NewRule = Omit<EventRule, "id"> | Omit<AttributeRule, "id">;

interface Props {
  config: SegmentBuilderConfig;
  catalog: EventDefinition[];
  onAddRule: (rule: NewRule) => void;
  onUpdateRule: (id: string, patch: Partial<SegmentRule>) => void;
  onRemoveRule: (id: string) => void;
  onCombinatorChange: (c: SegmentCombinator) => void;
  onDateRangeChange: (r: SegmentBuilderConfig["dateRange"]) => void;
  breakdown?: string;
  onBreakdownChange?: (breakdown: string | undefined) => void;
  segmentIds?: string[];
  segments?: { id: string; name: string }[];
  onSegmentIdsChange?: (ids: string[]) => void;
}

const DATE_RANGE_LABELS: Record<string, string> = {
  all: "All time",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "60d": "Last 60 days",
  "90d": "Last 90 days",
  "1y": "Last year",
};

export function SegmentConfigPanel({
  config,
  catalog,
  onAddRule,
  onUpdateRule,
  onRemoveRule,
  onCombinatorChange,
  onDateRangeChange,
  breakdown,
  onBreakdownChange,
  segmentIds,
  segments,
  onSegmentIdsChange,
}: Props) {
  const rangeKey =
    "preset" in config.dateRange ? config.dateRange.preset : "custom";
  const allProperties: EventProperty[] = [];
  const seenCols = new Set<string>();
  const firstEventTable = config.rules
    .map((rule) => rule.kind === "event" ? catalog.find((event) => event.id === rule.eventId)?.table : undefined)
    .find(Boolean);
  for (const rule of config.rules) {
    if (rule.kind !== "event") continue;
    const def = catalog.find((event) => event.id === rule.eventId);
    if (!def) continue;
    if (firstEventTable && def.table !== firstEventTable) continue;
    for (const property of def.properties) {
      if (seenCols.has(property.column)) continue;
      seenCols.add(property.column);
      allProperties.push(property);
    }
  }

  return (
    <div className="w-[340px] flex-shrink-0 border-l overflow-y-auto">
      {/* Rules */}
      <div className="px-4 py-3 border-b">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Rules
        </h3>
        <div className="space-y-2">
          {config.rules.map((rule, i) =>
            rule.kind === "event" ? (
              <EventRuleCard
                key={rule.id}
                index={i}
                rule={rule}
                catalog={catalog}
                onUpdate={(patch) => onUpdateRule(rule.id, patch)}
                onRemove={() => onRemoveRule(rule.id)}
              />
            ) : null,
          )}

          <AddRuleButton catalog={catalog} onSelect={(eventId) => onAddRule({ kind: "event", eventId, action: "did" })} />

          {config.rules.length === 0 && (
            <p className="text-xs text-muted-foreground py-1">
              Add a rule to define your audience.
            </p>
          )}
        </div>
      </div>

      {/* Date window */}
      <div className="px-4 py-3 border-b">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Time Window
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {(["all", "7d", "30d", "90d", "1y"] as const).map((preset) => (
            <button
              key={preset}
              onClick={() =>
                onDateRangeChange(
                  preset === "all"
                    ? { preset: "all" }
                    : { preset: preset as DateRangePreset },
                )
              }
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                rangeKey === preset
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {DATE_RANGE_LABELS[preset]}
            </button>
          ))}
        </div>
        <p className="text-[9.9px] text-muted-foreground mt-1.5 leading-relaxed">
          Applies to every event rule in this segment.
        </p>
      </div>

      {/* Combinator */}
      <div className="px-4 py-3 border-b">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Match
        </h3>
        <div className="flex items-center gap-1.5">
          {(["AND", "OR"] as const).map((c) => (
            <button
              key={c}
              onClick={() => onCombinatorChange(c)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                config.combinator === c
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {c === "AND" ? "All of" : "Any of"}
            </button>
          ))}
        </div>
        <p className="text-[9.9px] text-muted-foreground mt-1.5 leading-relaxed">
          {config.combinator === "AND"
            ? "Users must match every rule."
            : "Users must match at least one rule."}
        </p>
      </div>

      {onSegmentIdsChange && segments && segments.length > 0 && (
        <div className="px-4 py-3 border-b">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Compare With
          </h3>
          <SegmentFilterBuilder
            selectedIds={segmentIds ?? []}
            segments={segments}
            onChange={onSegmentIdsChange}
            emptyLabel="No comparison selected"
            addLabel="Add comparison"
          />
          <p className="text-[9.9px] text-muted-foreground mt-1.5 leading-relaxed">
            Compare this draft segment against saved segments.
          </p>
        </div>
      )}

      {onBreakdownChange && allProperties.length > 0 && (
        <div className="px-4 py-3 border-b">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Break Down By
          </h3>
          {breakdown ? (
            <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
              <span className="flex-1 font-medium">
                {allProperties.find((property) => property.column === breakdown)?.displayName ?? breakdown}
              </span>
              <button
                onClick={() => onBreakdownChange(undefined)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Clear slice"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <select
              value=""
              onChange={(event) => event.target.value && onBreakdownChange(event.target.value)}
              className="w-full appearance-none bg-transparent border rounded-md px-3 py-2 text-sm text-muted-foreground cursor-pointer focus:ring-1 focus:ring-border"
            >
              <option value="">Select property...</option>
              {allProperties.map((property) => (
                <option key={property.column} value={property.column}>
                  {property.displayName}
                </option>
              ))}
            </select>
          )}
          <p className="text-[9.9px] text-muted-foreground mt-1.5 leading-relaxed">
            Split the segment chart by an event property.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Rule card ──

function EventRuleCard({
  index,
  rule,
  catalog,
  onUpdate,
  onRemove,
}: {
  index: number;
  rule: EventRule;
  catalog: EventDefinition[];
  onUpdate: (patch: Partial<EventRule>) => void;
  onRemove: () => void;
}) {
  const def = catalog.find((e) => e.id === rule.eventId);
  const [showFilterPicker, setShowFilterPicker] = useState(false);
  const [showFrequency, setShowFrequency] = useState(Boolean(rule.occurrence));
  const filters = rule.filters ?? [];
  const properties = def?.properties ?? [];
  const showFrequencyControls = rule.action === "did" && (showFrequency || Boolean(rule.occurrence));

  useEffect(() => {
    if (rule.occurrence) setShowFrequency(true);
  }, [rule.occurrence]);

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

  const occ = rule.occurrence ?? { op: "gte" as OccurrenceOp, value: 1 };
  const setOcc = (patch: Partial<{ op: OccurrenceOp; value: number }>) => {
    setShowFrequency(true);
    onUpdate({ occurrence: { op: occ.op, value: occ.value, ...patch } });
  };

  return (
    <div className="group/rule rounded-md border text-sm">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[9.9px] font-bold text-muted-foreground tabular-nums">
          {index + 1}
        </span>

        <select
          value={rule.action}
          onChange={(e) => {
            const action = e.target.value as EventRule["action"];
            if (action === "did_not") setShowFrequency(false);
            onUpdate({
              action,
              ...(action === "did_not" ? { occurrence: undefined } : {}),
            });
          }}
          className="appearance-none bg-transparent text-xs font-medium cursor-pointer border-0 focus:ring-1 focus:ring-border rounded px-1"
        >
          <option value="did">Did</option>
          <option value="did_not">Did not do</option>
        </select>

        <span className="flex-1 truncate font-medium">
          {def?.displayName ?? rule.eventId}
        </span>

        <button
          onClick={onRemove}
          className="opacity-0 group-hover/rule:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
          aria-label="Remove rule"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {rule.action === "did" && !showFrequencyControls && (
        <div className="px-3 pb-1.5 text-xs text-muted-foreground">
          at least once
        </div>
      )}

      {/* Frequency — only for positive rules */}
      {showFrequencyControls && (
        <div className="px-3 pb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <select
            value={occ.op}
            onChange={(e) => setOcc({ op: e.target.value as OccurrenceOp })}
            className="appearance-none bg-muted rounded px-1.5 py-0.5 text-xs cursor-pointer border-0 focus:ring-1 focus:ring-border"
          >
            {(Object.keys(OCCURRENCE_OP_LABELS) as OccurrenceOp[]).map((op) => (
              <option key={op} value={op}>{OCCURRENCE_OP_LABELS[op]}</option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            value={occ.value}
            onChange={(e) => setOcc({ value: Math.max(1, Number(e.target.value) || 1) })}
            className="w-14 bg-muted rounded px-1.5 py-0.5 text-xs border-0 focus:ring-1 focus:ring-border"
          />
          <span>{occ.value === 1 ? "time" : "times"}</span>
          <button
            onClick={() => {
              onUpdate({ occurrence: undefined });
              setShowFrequency(false);
            }}
            className="ml-auto text-muted-foreground hover:text-foreground"
            title="Clear frequency (at least once)"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Filters */}
      {filters.length > 0 && (
        <div className="px-3 pb-1.5 space-y-1.5">
          {filters.map((f, fi) => (
            <PropertyFilterRow
              key={fi}
              eventId={rule.eventId}
              filter={f}
              properties={properties}
              onChange={(patch) => updateFilter(fi, patch)}
              onRemove={() => removeFilter(fi)}
            />
          ))}
        </div>
      )}

      {/* Add filter */}
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
          <div className="flex items-center gap-3">
            {rule.action === "did" && !showFrequencyControls && (
              <button
                onClick={() => setShowFrequency(true)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                + Frequency
              </button>
            )}
            <button
              onClick={() => setShowFilterPicker(true)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              disabled={properties.length === 0}
            >
              + Filter by property
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Add rule button ──

function AddRuleButton({
  catalog,
  onSelect,
}: {
  catalog: EventDefinition[];
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
        Add Rule
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-md border bg-popover shadow-md max-h-72 overflow-y-auto">
          {catalog.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">No events available for this dataset.</p>
          ) : (
            catalog.map((ev) => (
              <button
                key={ev.id}
                onClick={() => { onSelect(ev.id); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors first:rounded-t-md last:rounded-b-md"
              >
                {ev.displayName}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
