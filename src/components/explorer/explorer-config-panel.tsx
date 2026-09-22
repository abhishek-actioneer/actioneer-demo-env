"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EventPicker } from "./event-picker";
import { MeasureTypePicker } from "./measure-type-picker";
import { BreakdownPicker } from "./breakdown-picker";
import { SegmentFilterBuilder } from "./segment-filter-builder";
import type {
  EventDefinition,
  EventSelection,
  EventProperty,
  MeasureType,
} from "@/lib/explorer-types";

interface ExplorerConfigPanelProps {
  events: EventSelection[];
  catalog: EventDefinition[];
  breakdown?: string;
  segmentIds: string[];
  segments: { id: string; name: string }[];
  onAddEvent: (event: EventSelection) => void;
  onRemoveEvent: (index: number) => void;
  onUpdateEvent: (index: number, patch: Partial<EventSelection>) => void;
  onBreakdownChange: (breakdown: string | undefined) => void;
  onSegmentIdsChange: (ids: string[]) => void;
  segmentCompare?: boolean;
  onSegmentCompareChange?: (compare: boolean) => void;
  hideSegmentSection?: boolean;
}

function Section({
  title,
  defaultOpen = true,
  children,
  trailing,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b last:border-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        {title}
        {trailing && <span className="ml-auto">{trailing}</span>}
      </button>
      {open && <div className="px-4 pb-3">{children}</div>}
    </div>
  );
}

export function ExplorerConfigPanel({
  events,
  catalog,
  breakdown,
  segmentIds,
  segments,
  onAddEvent,
  onRemoveEvent,
  onUpdateEvent,
  onBreakdownChange,
  onSegmentIdsChange,
  segmentCompare,
  onSegmentCompareChange,
  hideSegmentSection,
}: ExplorerConfigPanelProps) {
  // Multi-event explorer SQL applies one breakdown column to every event query.
  // Only show properties that exist on all selected event definitions.
  const allProperties: EventProperty[] = useMemo(() => {
    const selectedDefs = events
      .map((sel) => catalog.find((e) => e.id === sel.eventId))
      .filter((def): def is EventDefinition => Boolean(def));
    return selectedDefs.length
      ? selectedDefs[0].properties.filter((property) =>
          selectedDefs.every((def) =>
            def.properties.some((candidate) => candidate.column === property.column),
          ),
        )
      : [];
  }, [catalog, events]);

  useEffect(() => {
    if (breakdown && !allProperties.some((property) => property.column === breakdown)) {
      onBreakdownChange(undefined);
    }
  }, [allProperties, breakdown, onBreakdownChange]);

  // Primary measure type: from first event (for the global picker display)
  const primaryMeasure = events[0]?.measureType ?? "event_totals";

  return (
    <div className="w-[340px] flex-shrink-0 overflow-y-auto">
      <Section title="Events">
        <EventPicker
          events={events}
          catalog={catalog}
          onAdd={onAddEvent}
          onRemove={onRemoveEvent}
          onUpdate={onUpdateEvent}
        />
      </Section>

      <Section title="Measured as">
        <MeasureTypePicker
          value={primaryMeasure}
          onChange={(m: MeasureType) => {
            // Apply to all events
            events.forEach((_, i) => {
              onUpdateEvent(i, { measureType: m });
            });
          }}
        />
      </Section>

      {!hideSegmentSection && (
        <Section title="Segment by" defaultOpen={false}>
          <SegmentFilterBuilder
            selectedIds={segmentIds}
            segments={segments}
            onChange={onSegmentIdsChange}
            compareMode={segmentCompare}
            onCompareModeChange={onSegmentCompareChange}
          />
        </Section>
      )}

      {allProperties.length > 0 && (
        <Section title="Breakdown" defaultOpen={false}>
          <BreakdownPicker
            value={breakdown}
            onChange={onBreakdownChange}
            properties={allProperties}
          />
        </Section>
      )}
    </div>
  );
}
