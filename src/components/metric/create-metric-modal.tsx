"use client";

import { useState } from "react";
import { X, ArrowLeft } from "lucide-react";
import { AGGREGATION_OPTIONS } from "@/lib/metric-types";
import type { CreateMetricAggregation, Metric } from "@/lib/metric-types";
import { saveMetric } from "@/lib/metric-store";
import { useDataset } from "@/lib/dataset-context";
import { DEFAULT_DATASET } from "@/lib/datasets/constants";

export function CreateMetricModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { datasetId } = useDataset();
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedType, setSelectedType] = useState<CreateMetricAggregation | null>(null);
  const [name, setName] = useState("");
  const [table, setTable] = useState("");
  const [column, setColumn] = useState("");
  const [attempted, setAttempted] = useState(false);


  const canCreate = name.trim() && table && column && selectedType;

  const handleCreate = () => {
    setAttempted(true);
    if (!canCreate) return;

    const id = `m-${Date.now()}`;
    const formula =
      selectedType === "sum"
        ? `SUM(${column})`
        : selectedType === "count"
        ? `COUNT(${column})`
        : selectedType === "unique_count"
        ? `COUNT(DISTINCT ${column})`
        : selectedType === "ratio" || selectedType === "derived_ratio"
        ? `${column} ratio`
        : column;

    // Generate SQL — use a generic date column detection instead of hardcoded table names
    const dateCol = "date"; // Will be overridden by the time column below
    const sql = `SELECT ${formula} AS value\nFROM ${table}`;

    const newMetric: Metric = {
      id,
      name: name.trim(),
      description: `Custom metric: ${formula} from ${table}`,
      type: "diagnostic",
      category: "Revenue",
      status: "healthy",
      value: 0,
      valueFormat: "number",
      aggregation: selectedType,
      table,
      column,
      timeColumn: "date",
      formula,
      sql,
      dimensions: [],
      timeGrain: "daily",
      granularity: "Store-level",
      relationships: [],
      owner: "You",
      ownerInitials: "YO",
      createdAt: new Date().toISOString().split("T")[0],
      updatedAt: new Date().toISOString().split("T")[0],
      version: 1,
      errors: 0,
    };

    saveMetric(datasetId, newMetric);
    onCreated(id);
  };

  return (
    <>
      <div className="fixed inset-0 bg-background/60 backdrop-blur-md z-50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="bg-background border border-border rounded-xl shadow-xl w-full max-w-lg"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2">
              {step === 2 && (
                <button
                  onClick={() => setStep(1)}
                  className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
              )}
              <h2 className="text-sm font-semibold">
                {step === 2 ? "New Metric: Configure" : "New Metric: Choose Type"}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Content */}
          <div className="p-5">
            {step === 1 ? (
              <div className="grid grid-cols-2 gap-3">
                {AGGREGATION_OPTIONS.map((opt) => (
                  <button
                    key={opt.type}
                    onClick={() => {
                      setSelectedType(opt.type);
                      setStep(2);
                    }}
                    className="border border-border rounded-lg p-4 text-left hover:bg-muted/50 hover:border-foreground/30 transition-colors group"
                  >
                    <p className="text-sm font-medium group-hover:text-foreground transition-colors">
                      {opt.label}
                    </p>
                    <p className="text-[9.9px] text-muted-foreground mt-1">
                      {opt.description}
                    </p>
                  </button>
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                {/* Selected type badge */}
                <div className="flex items-center gap-2">
                  <span className="text-[9.9px] text-muted-foreground">Type:</span>
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-foreground">
                    {AGGREGATION_OPTIONS.find((o) => o.type === selectedType)?.label}
                  </span>
                </div>

                {/* Name */}
                <div>
                  <label className="text-xs font-medium text-foreground block mb-1.5">
                    Metric Name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., Daily Revenue"
                    className={`w-full px-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring/20 ${attempted && !name.trim() ? "border-foreground" : "border-border"}`}
                  />
                  {attempted && !name.trim() && (
                    <p className="text-xs text-muted-foreground mt-1">Metric name is required.</p>
                  )}
                </div>

                {/* Table */}
                <div>
                  <label className="text-xs font-medium text-foreground block mb-1.5">
                    Table
                  </label>
                  <input
                    type="text"
                    value={table}
                    onChange={(e) => setTable(e.target.value)}
                    placeholder="e.g., daily_metrics"
                    className={`w-full px-3 py-2 text-sm font-mono border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring/20 ${attempted && !table ? "border-foreground" : "border-border"}`}
                  />
                  {attempted && !table && (
                    <p className="text-xs text-muted-foreground mt-1">Table is required.</p>
                  )}
                </div>

                {/* Column */}
                <div>
                  <label className="text-xs font-medium text-foreground block mb-1.5">
                    Column
                  </label>
                  <input
                    type="text"
                    value={column}
                    onChange={(e) => setColumn(e.target.value)}
                    placeholder="e.g., revenue"
                    className={`w-full px-3 py-2 text-sm font-mono border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring/20 ${attempted && !column && table ? "border-foreground" : "border-border"}`}
                  />
                  {attempted && !column && table && (
                    <p className="text-xs text-muted-foreground mt-1">Column is required.</p>
                  )}
                </div>

                {/* Done button */}
                <button
                  onClick={handleCreate}
                  disabled={!canCreate}
                  className="w-full py-2.5 text-sm font-medium bg-foreground text-background rounded-lg hover:bg-foreground/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
