"use client";

import { useState } from "react";
import { Table2, Code2, Download } from "lucide-react";
import type { ChartSpec } from "@/lib/chart-types";
import { ChartDataTable } from "./chart-data-table";
import { ChartSQLDisplay } from "./chart-sql-display";
import { downloadCSV } from "@/lib/csv-export";

type DrawerTab = "data" | "sql" | "export";

function exportCSV(spec: ChartSpec, fullData?: Record<string, unknown>[]) {
  const rows = fullData ?? spec.data;
  const filename = `${(spec.title || "chart").replace(/[^a-zA-Z0-9]/g, "-")}-${new Date().toISOString().split("T")[0]}.csv`;
  downloadCSV(rows, filename);
}

export interface ChartDrawerProps {
  spec: ChartSpec;
  fullData?: Record<string, unknown>[];
  pageSize?: number;
  height?: string;
  initialTab?: DrawerTab;
  hideTabBar?: boolean;
}

export function ChartDrawer({ spec, fullData, pageSize = 20, height, initialTab, hideTabBar }: ChartDrawerProps) {
  const hasSql = !!spec.sql;
  const tabs: { id: DrawerTab; label: string; icon: typeof Table2 }[] = [
    { id: "data", label: "Data", icon: Table2 },
    ...(hasSql ? [{ id: "sql" as const, label: "SQL", icon: Code2 }] : []),
    { id: "export", label: "Export", icon: Download },
  ];

  const [activeTab, setActiveTab] = useState<DrawerTab>(initialTab ?? "data");

  const tableData = (fullData ?? spec.data) as Record<string, unknown>[];

  return (
    <div className="flex flex-col border-t border-border bg-card" style={height ? { height } : undefined}>
      {/* Tab bar — hidden when parent controls the view (overlay mode) */}
      {!hideTabBar && (
        <div className="flex items-center gap-0 border-b border-border/50 px-2 shrink-0" role="tablist" aria-label="Chart data views">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                aria-controls={`chart-drawer-panel-${tab.id}`}
                className={`flex items-center gap-1.5 px-3 py-2 min-h-[36px] text-[9px] font-medium transition-[color,border-color] duration-150 ease-out motion-reduce:transition-none cursor-pointer border-b-2 -mb-px active:scale-[0.97] ${
                  activeTab === tab.id
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon className="w-3 h-3" aria-hidden="true" />
                {tab.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Content */}
      <div className={height ? "flex-1 min-h-0 overflow-hidden" : "h-[200px] overflow-hidden"} role="tabpanel" id={`chart-drawer-panel-${activeTab}`}>
        {activeTab === "data" && (
          <ChartDataTable
            data={tableData}
            pageSize={pageSize}
            currency={spec.currency}
            format={spec.format}
          />
        )}
        {activeTab === "sql" && spec.sql && (
          <ChartSQLDisplay sql={spec.sql} />
        )}
        {activeTab === "export" && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <p className="text-xs text-muted-foreground tabular-nums">
              Download chart data as CSV ({tableData.length} rows)
            </p>
            <button
              type="button"
              className="flex items-center gap-2 px-4 py-2 min-h-[36px] text-xs font-medium bg-foreground text-background rounded-md transition-opacity duration-150 ease-out motion-reduce:transition-none cursor-pointer active:scale-[0.97] hover:opacity-90"
              onClick={() => exportCSV(spec, fullData)}
              disabled={!tableData.length}
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              Download CSV
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
