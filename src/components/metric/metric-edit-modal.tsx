"use client";

import { useState, useMemo } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import type { Metric, MetricType, MetricCategory, MetricValueFormat, TimeGrain } from "@/lib/metric-types";

export function MetricEditModal({
  metric,
  onSave,
  onClose,
}: {
  metric: Metric;
  onSave: (updates: Partial<Omit<Metric, "id">>) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(metric.name);
  const [description, setDescription] = useState(metric.description);
  const [type, setType] = useState<MetricType>(metric.type);
  const [category, setCategory] = useState<MetricCategory>(metric.category);
  const [formula, setFormula] = useState(metric.formula);
  const [sql, setSql] = useState(metric.sql);
  const [table, setTable] = useState(metric.table);
  const [column, setColumn] = useState(metric.column);
  const [valueFormat, setValueFormat] = useState<MetricValueFormat>(metric.valueFormat);
  const [timeGrain, setTimeGrain] = useState<TimeGrain>(metric.timeGrain);
  const [dimensions, setDimensions] = useState(metric.dimensions.join(", "));


  const hasChanges = useMemo(() => {
    return (
      name !== metric.name ||
      description !== metric.description ||
      type !== metric.type ||
      category !== metric.category ||
      formula !== metric.formula ||
      sql !== metric.sql ||
      table !== metric.table ||
      column !== metric.column ||
      valueFormat !== metric.valueFormat ||
      timeGrain !== metric.timeGrain ||
      dimensions !== metric.dimensions.join(", ")
    );
  }, [name, description, type, category, formula, sql, table, column, valueFormat, timeGrain, dimensions, metric]);

  const handleSave = () => {
    if (!name.trim()) {
      toast.error("Metric name cannot be empty.");
      return;
    }
    onSave({
      name,
      description,
      type,
      category,
      formula,
      sql,
      table,
      column,
      valueFormat,
      timeGrain,
      dimensions: dimensions
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean),
      updatedAt: new Date().toISOString().split("T")[0],
      version: metric.version + 1,
    });
  };

  return (
    <>
      <div className="fixed inset-0 bg-background/60 backdrop-blur-md z-50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="bg-background border border-border rounded-xl shadow-xl w-full max-w-xl max-h-[85vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
            <h2 className="text-sm font-semibold">Edit Metric</h2>
            <button
              onClick={onClose}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Content */}
          <div className="p-5 space-y-4 overflow-y-auto flex-1">
            <Field label="Name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </Field>

            <Field label="Description">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring/20 resize-none"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as MetricType)}
                  className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background"
                >
                  <option value="kpi">KPI</option>
                  <option value="indicator">Indicator</option>
                  <option value="diagnostic">Diagnostic</option>
                  <option value="index">Index</option>
                </select>
              </Field>

              <Field label="Category">
                <input
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring/20"
                  placeholder="e.g., Revenue, Operations"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Table">
                <input
                  value={table}
                  onChange={(e) => setTable(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring/20"
                  placeholder="e.g., daily_metrics"
                />
              </Field>

              <Field label="Column">
                <input
                  value={column}
                  onChange={(e) => setColumn(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring/20"
                  placeholder="e.g., revenue"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Value Format">
                <select
                  value={valueFormat}
                  onChange={(e) => setValueFormat(e.target.value as MetricValueFormat)}
                  className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background"
                >
                  <option value="number">Number</option>
                  <option value="currency">Currency</option>
                  <option value="percent">Percent</option>
                  <option value="integer">Integer</option>
                </select>
              </Field>

              <Field label="Time Grain">
                <select
                  value={timeGrain}
                  onChange={(e) => setTimeGrain(e.target.value as TimeGrain)}
                  className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background"
                >
                  <option value="hourly">Hourly</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </Field>
            </div>

            <Field label="Formula">
              <input
                value={formula}
                onChange={(e) => setFormula(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </Field>

            <Field label="SQL Query">
              <textarea
                value={sql}
                onChange={(e) => setSql(e.target.value)}
                rows={4}
                className="w-full px-3 py-2 text-xs font-mono border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring/20 resize-none"
              />
            </Field>

            <Field label="Dimensions (comma-separated)">
              <input
                value={dimensions}
                onChange={(e) => setDimensions(e.target.value)}
                placeholder="e.g., brand, category_code"
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </Field>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border shrink-0">
            <button
              onClick={onClose}
              className="px-3.5 py-2 text-sm font-medium border border-border rounded-lg hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges}
              className="px-3.5 py-2 text-sm font-medium bg-foreground text-background rounded-lg hover:bg-foreground/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-foreground block mb-1.5">{label}</label>
      {children}
    </div>
  );
}
