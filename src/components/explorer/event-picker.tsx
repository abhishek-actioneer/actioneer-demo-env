"use client";

import { useState, useRef, useEffect } from "react";
import { Plus, X, ChevronDown } from "lucide-react";
import type {
  EventDefinition,
  EventSelection,
  MeasureType,
  PropertyFilter,
} from "@/lib/explorer-types";
import { PropertyFilterRow } from "./property-filter-row";

interface EventPickerProps {
  events: EventSelection[];
  catalog: EventDefinition[];
  onAdd: (event: EventSelection) => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, patch: Partial<EventSelection>) => void;
}

export function EventPicker({
  events,
  catalog,
  onAdd,
  onRemove,
  onUpdate,
}: EventPickerProps) {
  const availableEvents = catalog.filter(
    (e) => !events.some((sel) => sel.eventId === e.id),
  );

  return (
    <div className="space-y-2">
      {events.map((sel, i) => {
        const def = catalog.find((e) => e.id === sel.eventId);
        return (
          <EventCard
            key={`${sel.eventId}-${i}`}
            index={i}
            selection={sel}
            definition={def}
            onUpdate={(patch) => onUpdate(i, patch)}
            onRemove={() => onRemove(i)}
          />
        );
      })}

      {events.length < 5 && availableEvents.length > 0 && (
        <AddEventButton
          availableEvents={availableEvents}
          onSelect={(eventId) =>
            onAdd({ eventId, measureType: "event_totals" })
          }
        />
      )}

      {events.length === 0 && (
        <p className="text-xs text-muted-foreground py-1">
          Select an event to start exploring
        </p>
      )}
    </div>
  );
}

// ── Event Card with inline filter support ──

function EventCard({
  index,
  selection,
  definition,
  onUpdate,
  onRemove,
}: {
  index: number;
  selection: EventSelection;
  definition?: EventDefinition;
  onUpdate: (patch: Partial<EventSelection>) => void;
  onRemove: () => void;
}) {
  const [showFilterUI, setShowFilterUI] = useState(false);
  const filters = selection.filters ?? [];
  const properties = definition?.properties ?? [];

  const addFilter = (property: string) => {
    const newFilter: PropertyFilter = {
      property,
      operator: "eq",
      value: "",
    };
    onUpdate({ filters: [...filters, newFilter] });
  };

  const updateFilter = (fi: number, patch: Partial<PropertyFilter>) => {
    onUpdate({
      filters: filters.map((f, j) => (j === fi ? { ...f, ...patch } : f)),
    });
  };

  const removeFilter = (fi: number) => {
    onUpdate({ filters: filters.filter((_, j) => j !== fi) });
  };

  return (
    <div className="group/event rounded-md border text-sm">
      {/* Main row */}
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="flex h-5 w-5 items-center justify-center rounded bg-muted text-xs font-medium text-muted-foreground">
          {String.fromCharCode(65 + index)}
        </span>
        <span className="flex-1 truncate font-medium">
          {definition?.displayName ?? selection.eventId}
        </span>
        <MeasureDropdown
          value={selection.measureType}
          onChange={(m) => onUpdate({ measureType: m })}
        />
        <button
          onClick={onRemove}
          className="opacity-0 group-hover/event:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
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
              eventId={selection.eventId}
              filter={f}
              properties={properties}
              onChange={(patch) => updateFilter(fi, patch)}
              onRemove={() => removeFilter(fi)}
              propertyMinWidthClass="min-w-[60px]"
            />
          ))}
        </div>
      )}

      {/* Action links */}
      <div className="flex items-center gap-3 px-3 pb-2 pt-0.5">
        <button
          onClick={() => setShowFilterUI(!showFilterUI)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          + Filter by
        </button>
      </div>

      {/* Property picker for adding filter */}
      {showFilterUI && properties.length > 0 && (
        <div className="px-3 pb-2">
          <select
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) {
                addFilter(e.target.value);
                setShowFilterUI(false);
              }
            }}
            className="w-full appearance-none bg-muted rounded-md px-2.5 py-1.5 text-xs cursor-pointer border-0 focus:ring-1 focus:ring-border"
          >
            <option value="">Select property...</option>
            {properties.map((p) => (
              <option key={p.column} value={p.column}>
                {p.displayName}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

// ── Inline filter row ──

// ── Measure dropdown ──

function MeasureDropdown({
  value,
  onChange,
}: {
  value: MeasureType;
  onChange: (m: MeasureType) => void;
}) {
  const labels: Record<MeasureType, string> = {
    uniques: "Uniques",
    event_totals: "Totals",
    active_pct: "Active%",
    average: "Avg",
    frequency: "Freq",
    sum: "Sum",
  };

  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as MeasureType)}
        className="appearance-none bg-muted rounded px-2 py-0.5 text-xs font-medium cursor-pointer pr-5 border-0 focus:ring-1 focus:ring-border"
      >
        {(Object.keys(labels) as MeasureType[]).map((m) => (
          <option key={m} value={m}>
            {labels[m]}
          </option>
        ))}
      </select>
      <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 h-3 w-3 pointer-events-none text-muted-foreground" />
    </div>
  );
}

// ── Add event button ──

function AddEventButton({
  availableEvents,
  onSelect,
}: {
  availableEvents: EventDefinition[];
  onSelect: (eventId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        btnRef.current?.contains(e.target as Node) ||
        dropRef.current?.contains(e.target as Node)
      ) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const handleOpen = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
    setSearch("");
    setOpen(!open);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  // Filter by search
  const filtered = search
    ? availableEvents.filter((ev) =>
        ev.displayName.toLowerCase().includes(search.toLowerCase()),
      )
    : availableEvents;

  // Group by table
  const grouped = new Map<string, EventDefinition[]>();
  for (const ev of filtered) {
    const group = ev.table;
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group)!.push(ev);
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleOpen}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
      >
        <Plus className="h-3.5 w-3.5" />
        Add Event
      </button>
      {open && (
        <div
          ref={dropRef}
          className="fixed z-[100] w-72 rounded-lg border bg-popover shadow-lg overflow-hidden"
          style={{ top: pos.top, left: pos.left }}
        >
          {/* Search */}
          <div className="px-3 py-2.5 border-b">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search events..."
              className="w-full bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground"
            />
          </div>

          {/* Event list */}
          <div className="max-h-80 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-xs text-muted-foreground text-center">No events found</p>
            ) : (
              Array.from(grouped.entries()).map(([table, events]) => (
                <div key={table}>
                  <p className="px-3 pt-2.5 pb-1 text-[9px] font-medium text-muted-foreground uppercase tracking-wider">
                    {table.replace(/_/g, " ")}
                  </p>
                  {events.map((ev) => (
                    <button
                      key={ev.id}
                      onClick={() => {
                        onSelect(ev.id);
                        setOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors"
                    >
                      {ev.displayName}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}
