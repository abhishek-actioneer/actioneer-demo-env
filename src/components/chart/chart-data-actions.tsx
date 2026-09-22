"use client";

import { useState, useRef, useEffect } from "react";
import { Table2, Code2, Download, ChevronDown } from "lucide-react";

export type DataView = "chart" | "data" | "sql" | "export";

// ── Option A: Three inline tab buttons ──

export function DataActionsTabs({
  active,
  onChange,
  hasSql,
}: {
  active: DataView;
  onChange: (view: DataView) => void;
  hasSql: boolean;
}) {
  const items: { id: DataView; icon: typeof Table2; label: string }[] = [
    { id: "data", icon: Table2, label: "Data" },
    ...(hasSql ? [{ id: "sql" as const, icon: Code2, label: "SQL" }] : []),
    { id: "export", icon: Download, label: "Export" },
  ];

  return (
    <div className="flex items-center gap-0.5 bg-muted/50 rounded-md p-0.5" role="group" aria-label="Data views">
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = active === item.id;
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={isActive}
            className={`flex items-center gap-1 px-2 py-0.5 min-h-[24px] text-[9px] font-medium rounded transition-[color,background-color] duration-150 ease-out motion-reduce:transition-none cursor-pointer active:scale-[0.97] ${
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => onChange(isActive ? "chart" : item.id)}
          >
            <Icon className="w-3 h-3" aria-hidden="true" />
            <span className="hidden sm:inline">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Option B: Dropdown (like chart type switcher) ──

const DATA_VIEWS: { id: DataView; icon: typeof Table2; label: string }[] = [
  { id: "data", icon: Table2, label: "Data Table" },
  { id: "sql", icon: Code2, label: "SQL Query" },
  { id: "export", icon: Download, label: "Export CSV" },
];

export function DataActionsDropdown({
  active,
  onChange,
  hasSql,
}: {
  active: DataView;
  onChange: (view: DataView) => void;
  hasSql: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const available = DATA_VIEWS.filter((v) => {
    if (v.id === "sql" && !hasSql) return false;
    return true;
  });

  const isShowingData = active !== "chart";
  const currentItem = available.find((v) => v.id === active);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handleClick);
    return () => document.removeEventListener("pointerdown", handleClick);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={isShowingData ? `Viewing: ${currentItem?.label}` : "View Data"}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`flex items-center gap-1.5 px-2 py-1 min-h-[28px] text-[9.9px] font-medium rounded-md transition-[color,background-color] duration-150 ease-out motion-reduce:transition-none cursor-pointer active:scale-[0.97] ${
          isShowingData
            ? "bg-muted text-foreground"
            : "text-muted-foreground bg-muted/50 hover:text-foreground hover:bg-muted"
        }`}
        onClick={() => setOpen((o) => !o)}
      >
        {isShowingData && currentItem ? (
          <>
            <currentItem.icon className="w-3 h-3" aria-hidden="true" />
            <span>{currentItem.label}</span>
          </>
        ) : (
          <>
            <Table2 className="w-3 h-3" aria-hidden="true" />
            <span>Data</span>
          </>
        )}
        <ChevronDown
          className="w-3 h-3 transition-transform duration-150 ease-out motion-reduce:transition-none"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Data views"
          className="absolute top-full right-0 mt-1 z-50 min-w-[150px] bg-popover border border-border rounded-lg shadow-md py-1 animate-in fade-in-0 zoom-in-95 duration-150"
        >
          {/* Back to chart option */}
          {isShowingData && (
            <>
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 min-h-[32px] text-[9.9px] text-muted-foreground transition-[color,background-color] duration-100 ease-out motion-reduce:transition-none cursor-pointer active:scale-[0.98] hover:text-foreground hover:bg-muted/30"
                onClick={() => { onChange("chart"); setOpen(false); }}
              >
                <span>Show Chart</span>
              </button>
              <div className="my-1 border-t border-border/50" />
            </>
          )}

          {available.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={isActive}
                className={`w-full flex items-center gap-2.5 px-3 py-1.5 min-h-[32px] text-[9.9px] transition-[color,background-color] duration-100 ease-out motion-reduce:transition-none cursor-pointer active:scale-[0.98] ${
                  isActive
                    ? "text-foreground font-medium bg-muted/50"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                }`}
                onClick={() => { onChange(item.id); setOpen(false); }}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
