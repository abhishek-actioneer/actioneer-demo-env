"use client";

import { useState, useEffect, useRef } from "react";
import { apiFetch } from "@/lib/api-client";
import { useModel } from "@/lib/model-context";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Calculator, Database, ArrowRight, X, TrendingUp, Check, Copy, Link2, Sparkles, Loader2, RotateCcw } from "lucide-react";
import type { ForecastRow, ForecastModel, CellFormat } from "@/lib/forecast-types";
import { parseFormulaRefs } from "@/lib/forecast-engine";
import { SqlHighlighted } from "@/lib/sql-highlight";
import { getMetric } from "@/lib/metric-store";
import { useDataset } from "@/lib/dataset-context";

const SECTION_LABEL = "flex items-center gap-2 mb-2";
const SECTION_LABEL_STYLE = { fontSize: 9.9, fontWeight: 600, letterSpacing: "0.06em", color: "var(--fc-text-tertiary)", textTransform: "uppercase" as const };
const FIELD_LABEL_STYLE = { fontSize: 9.9, fontWeight: 500, color: "var(--fc-text-secondary)", marginBottom: 4 };
const INPUT_STYLE = {
  width: "100%", padding: "6px 8px", borderRadius: 6, fontSize: 11.7,
  background: "var(--fc-surface-sunken)", color: "var(--fc-text-primary)",
  border: "1px solid var(--fc-border)", outline: "none",
};
const MONO_INPUT_STYLE = { ...INPUT_STYLE, fontFamily: "var(--font-geist-mono)", fontSize: 10.8 };

function SourceSqlBlock({ sql }: { sql: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="relative rounded-lg p-3" style={{ background: "var(--fc-surface-sunken)" }}>
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1 rounded-md hover:bg-muted"
        style={{ color: "var(--fc-text-tertiary)", transition: "color 80ms ease" }}
        title="Copy SQL"
      >
        {copied ? <Check className="w-3.5 h-3.5" style={{ color: "var(--fc-accent)" }} /> : <Copy className="w-3.5 h-3.5" />}
      </button>
      <pre className="text-xs leading-relaxed overflow-x-auto" style={{ fontFamily: "var(--font-geist-mono)", margin: 0 }}>
        <code><SqlHighlighted sql={sql} /></code>
      </pre>
    </div>
  );
}

interface InspectPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: ForecastRow | null;
  model: ForecastModel;
  onModelChange: React.Dispatch<React.SetStateAction<ForecastModel>>;
  onLoadRow?: (rowId: string, sourceQuery: string, label: string, format: CellFormat) => void;
  loadingRows?: Set<string>;
}

export function InspectPanel({ open, onOpenChange, row, model, onModelChange, onLoadRow, loadingRows }: InspectPanelProps) {
  useModel(); // sync module-level model state for apiFetch
  const { datasetId } = useDataset();
  const [label, setLabel] = useState("");
  const [type, setType] = useState<"base" | "derived">("base");
  const [formula, setFormula] = useState("");
  const [format, setFormat] = useState<CellFormat>("number");

  // AI Metric Builder state
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [generatedSql, setGeneratedSql] = useState<{ sql: string; label: string; format: CellFormat } | null>(null);

  // Post-confirm loading state
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [confirmedSql, setConfirmedSql] = useState<{ sql: string; label: string; format: CellFormat } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sync local state when row changes
  useEffect(() => {
    if (row) {
      setLabel(row.label);
      setType(row.type);
      setFormula(row.type === "derived" ? row.formula : "");
      setFormat(row.format);
      // Reset AI state when switching rows
      setAiPrompt("");
      setAiLoading(false);
      setAiError(null);
      setGeneratedSql(null);
      setConfirmLoading(false);
      setConfirmedSql(null);
      setElapsed(0);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, [row]);

  // Clear confirmLoading when the row finishes loading
  useEffect(() => {
    if (confirmLoading && row && !loadingRows?.has(row.id)) {
      setConfirmLoading(false);
      setElapsed(0);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, [confirmLoading, row, loadingRows]);

  // Elapsed timer
  useEffect(() => {
    if (confirmLoading) {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
      return () => { if (timerRef.current) clearInterval(timerRef.current); };
    }
  }, [confirmLoading]);

  if (!row) return null;

  const updateRow = (updates: Partial<Pick<ForecastRow, "label" | "format">> & { type?: "base" | "derived"; formula?: string; sourceQuery?: string; sourceTable?: string }) => {
    onModelChange((prev) => ({
      ...prev,
      rows: prev.rows.map((r) => {
        if (r.id !== row.id) return r;
        const newType = updates.type ?? r.type;
        const newLabel = updates.label ?? r.label;
        const newFormat = updates.format ?? r.format;
        if (newType === "derived") {
          return { ...r, type: "derived" as const, label: newLabel, format: newFormat, formula: updates.formula ?? (r.type === "derived" ? r.formula : "") };
        }
        // base — construct clean base row
        return {
          id: r.id, label: newLabel, type: "base" as const, indent: r.indent,
          format: newFormat, overrides: r.overrides, showOnChart: r.showOnChart,
          sourceQuery: updates.sourceQuery ?? r.sourceQuery, sourceTable: updates.sourceTable ?? r.sourceTable,
          forecastMethod: r.forecastMethod, metricId: r.metricId,
        };
      }),
    }));
  };

  const handleGenerateSql = async () => {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    setAiError(null);
    setGeneratedSql(null);

    try {
      const data = await apiFetch<{ sql: string; label: string; format: CellFormat; error?: string }>("/api/forecast/generate-sql", {
        method: "POST",
        body: { description: aiPrompt.trim() },
      });
      if (data.error) {
        setAiError(data.error);
      } else {
        setGeneratedSql({ sql: data.sql, label: data.label, format: data.format });
      }
    } catch {
      setAiError("Failed to connect to AI service");
    } finally {
      setAiLoading(false);
    }
  };

  const handleConfirmSql = () => {
    if (!generatedSql) return;
    // Update row with generated SQL, label, and format
    updateRow({
      label: generatedSql.label,
      format: generatedSql.format,
      sourceQuery: generatedSql.sql,
      sourceTable: "events",
    });
    setLabel(generatedSql.label);
    setFormat(generatedSql.format);
    // Preserve SQL for display during loading, then enter loading state
    setConfirmedSql(generatedSql);
    setConfirmLoading(true);
    // Trigger data fetch with the generated values directly (avoids stale closure)
    onLoadRow?.(row.id, generatedSql.sql, generatedSql.label, generatedSql.format);
    // Reset AI builder state (but confirmedSql stays visible)
    setGeneratedSql(null);
    setAiPrompt("");
  };

  const formulaRefs = row.type === "derived" ? parseFormulaRefs(row.formula) : [];
  const referencedRows = formulaRefs
    .map((lbl) => model.rows.find((r) => r.label === lbl))
    .filter(Boolean);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[340px] sm:max-w-[340px] p-0 flex flex-col [&>button]:hidden"
        showCloseButton={false}
        style={{
          background: "var(--fc-panel)",
          borderLeft: "1px solid var(--fc-border-strong)",
          boxShadow: "-12px 0 32px oklch(0 0 0 / 50%)",
        }}
      >
        <SheetTitle className="sr-only">{row.label} details</SheetTitle>

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: "1px solid var(--fc-border)" }}>
          <h2 className="flex-1 text-sm font-semibold" style={{ color: "var(--fc-text-primary)" }}>Edit Metric</h2>
          <button
            onClick={() => onOpenChange(false)}
            className="p-1.5 rounded-md hover:bg-muted"
            style={{ color: "var(--fc-text-tertiary)" }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Editable fields */}
        <div className="px-4 py-4" style={{ borderBottom: "1px solid var(--fc-border)" }}>
          {/* Label */}
          <div className="mb-3">
            <p style={FIELD_LABEL_STYLE}>Name</p>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={() => { if (label.trim() && label !== row.label) updateRow({ label: label.trim() }); }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              style={INPUT_STYLE}
            />
            {row.metricId && (() => {
              const linked = getMetric(datasetId, row.metricId);
              return linked ? (
                <div className="mt-1.5 flex items-center gap-1.5" style={{ fontSize: 9.9, color: "var(--fc-text-tertiary)" }}>
                  <Link2 className="w-3 h-3" />
                  <span>Linked to <span style={{ color: "var(--fc-accent)", fontWeight: 500 }}>{linked.name}</span> in metric tree</span>
                </div>
              ) : null;
            })()}
          </div>

          {/* Type */}
          <div className="mb-3">
            <p style={FIELD_LABEL_STYLE}>Type</p>
            <div className="flex gap-1">
              {(["base", "derived"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    setType(t);
                    updateRow({ type: t, formula: t === "derived" ? formula : undefined });
                  }}
                  className="flex-1 py-1.5 rounded-md"
                  style={{
                    fontSize: 10.8, fontWeight: 500, transition: "background-color 80ms ease, color 80ms ease",
                    background: type === t ? "var(--fc-accent-muted)" : "var(--fc-surface-raised)",
                    color: type === t ? "var(--fc-accent)" : "var(--fc-text-secondary)",
                    border: type === t ? "1px solid var(--fc-accent)" : "1px solid var(--fc-border)",
                  }}
                >
                  {t === "base" ? "Base" : "Derived"}
                </button>
              ))}
            </div>
          </div>

          {/* Format */}
          <div>
            <p style={FIELD_LABEL_STYLE}>Format</p>
            <div className="flex gap-1">
              {(["currency", "percent", "number"] as CellFormat[]).map((f) => (
                <button
                  key={f}
                  onClick={() => {
                    setFormat(f);
                    updateRow({ format: f });
                  }}
                  className="flex-1 py-1.5 rounded-md"
                  style={{
                    fontSize: 10.8, fontWeight: 500, transition: "background-color 80ms ease, color 80ms ease",
                    background: format === f ? "var(--fc-accent-muted)" : "var(--fc-surface-raised)",
                    color: format === f ? "var(--fc-accent)" : "var(--fc-text-secondary)",
                    border: format === f ? "1px solid var(--fc-accent)" : "1px solid var(--fc-border)",
                  }}
                >
                  {f === "currency" ? "$" : f === "percent" ? "%" : "#"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Formula section (derived only) */}
        {type === "derived" && (
          <div className="px-4 py-4" style={{ borderBottom: "1px solid var(--fc-border)" }}>
            <div className={SECTION_LABEL} style={SECTION_LABEL_STYLE}>
              <Calculator className="w-4 h-4" /> Formula
            </div>
            <p style={{ fontSize: 9.9, color: "var(--fc-text-tertiary)", marginBottom: 8 }}>
              Reference other metrics with {"{"}Metric Name{"}"}. Changes apply instantly.
            </p>
            <textarea
              value={formula}
              onChange={(e) => setFormula(e.target.value)}
              onBlur={() => updateRow({ type: "derived", formula })}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }}
              rows={2}
              placeholder="{Total Revenue} - {Total Cost}"
              style={{ ...MONO_INPUT_STYLE, resize: "vertical", minHeight: 48 }}
            />
            {referencedRows.length > 0 && (
              <div className="mt-3">
                <p style={{ fontSize: 9.9, color: "var(--fc-text-tertiary)", marginBottom: 6 }}>Resolved dependencies:</p>
                <div className="flex flex-col gap-1">
                  {referencedRows.map((ref) => (
                    <div key={ref!.id} className="flex items-center gap-2" style={{ fontSize: 10.8 }}>
                      <ArrowRight className="w-3 h-3" style={{ color: "var(--fc-text-tertiary)" }} />
                      <span style={{ color: "var(--fc-text-primary)" }}>{ref!.label}</span>
                      <span
                        className="rounded px-1 py-0.5"
                        style={{ fontSize: 9, background: "var(--fc-surface-raised)", color: "var(--fc-text-secondary)" }}
                      >
                        {ref!.type}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Data source info (base only) */}
        {type === "base" && (
          <div className="px-4 py-4" style={{ borderBottom: "1px solid var(--fc-border)" }}>
            <div className={SECTION_LABEL} style={SECTION_LABEL_STYLE}>
              <Database className="w-4 h-4" /> Data Source
            </div>
            {row.sourceTable && (
              <div className="mb-2">
                <span
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1"
                  style={{ fontSize: 10.8, fontFamily: "var(--font-geist-mono)", background: "var(--fc-surface-raised)", color: "var(--fc-text-primary)" }}
                >
                  <Database className="w-3 h-3" style={{ color: "var(--fc-text-tertiary)" }} />
                  {row.sourceTable}
                </span>
              </div>
            )}
            {row.sourceQuery ? (
              <SourceSqlBlock sql={row.sourceQuery} />
            ) : (
              <p style={{ fontSize: 10.8, color: "var(--fc-text-secondary)", lineHeight: 1.5 }}>
                Double-click any cell to enter values directly.
              </p>
            )}
          </div>
        )}

        {/* AI Metric Builder (base only) */}
        {type === "base" && (
          <div className="px-4 py-4" style={{ borderBottom: "1px solid var(--fc-border)" }}>
            <div className={SECTION_LABEL} style={SECTION_LABEL_STYLE}>
              <Sparkles className="w-4 h-4" /> AI Metric Builder
            </div>

            {/* Post-confirm loading state */}
            {confirmLoading ? (
              <div>
                <div className="flex items-center gap-2 mb-3 py-2">
                  <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--fc-accent)" }} />
                  <span style={{ fontSize: 11.7, fontWeight: 500, color: "var(--fc-text-primary)" }}>
                    Fetching data &amp; generating forecast…
                  </span>
                  <span
                    className="ml-auto rounded px-1.5 py-0.5"
                    style={{ fontSize: 9.9, fontFamily: "var(--font-geist-mono)", background: "var(--fc-surface-raised)", color: "var(--fc-text-tertiary)" }}
                  >
                    {elapsed}s
                  </span>
                </div>
                {confirmedSql && <SourceSqlBlock sql={confirmedSql.sql} />}
              </div>
            ) : (
              <>
            <p style={{ fontSize: 9.9, color: "var(--fc-text-tertiary)", marginBottom: 8 }}>
              Describe a metric in plain English and AI will generate the SQL query.
            </p>
            <textarea
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleGenerateSql(); } }}
              rows={2}
              placeholder="e.g. Weekly smartphone revenue from purchases"
              disabled={aiLoading}
              style={{ ...MONO_INPUT_STYLE, resize: "vertical", minHeight: 48, opacity: aiLoading ? 0.6 : 1 }}
            />
            <button
              onClick={handleGenerateSql}
              disabled={aiLoading || !aiPrompt.trim()}
              className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 rounded-md"
              style={{
                fontSize: 10.8, fontWeight: 500, transition: "background-color 80ms ease, color 80ms ease",
                background: "var(--fc-accent)", color: "white",
                opacity: aiLoading || !aiPrompt.trim() ? 0.5 : 1,
                cursor: aiLoading || !aiPrompt.trim() ? "not-allowed" : "pointer",
              }}
            >
              {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {aiLoading ? "Generating…" : "Generate SQL"}
            </button>

            {/* Error */}
            {aiError && (
              <p className="mt-2" style={{ fontSize: 10.8, color: "var(--destructive)", lineHeight: 1.4 }}>
                {aiError}
              </p>
            )}

            {/* Generated SQL preview */}
            {generatedSql && (
              <div className="mt-3">
                <div className="mb-2 flex items-center gap-2">
                  <span style={{ fontSize: 9.9, fontWeight: 500, color: "var(--fc-text-secondary)" }}>
                    Label: <span style={{ color: "var(--fc-text-primary)" }}>{generatedSql.label}</span>
                  </span>
                  <span
                    className="rounded px-1 py-0.5"
                    style={{ fontSize: 9, background: "var(--fc-surface-raised)", color: "var(--fc-text-secondary)" }}
                  >
                    {generatedSql.format}
                  </span>
                </div>
                <SourceSqlBlock sql={generatedSql.sql} />
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={handleConfirmSql}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md"
                    style={{
                      fontSize: 10.8, fontWeight: 500,
                      background: "var(--fc-accent)", color: "white",
                    }}
                  >
                    <Check className="w-3.5 h-3.5" />
                    Confirm
                  </button>
                  <button
                    onClick={handleGenerateSql}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md"
                    style={{
                      fontSize: 10.8, fontWeight: 500,
                      background: "var(--fc-surface-raised)", color: "var(--fc-text-secondary)",
                      border: "1px solid var(--fc-border)",
                    }}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Regenerate
                  </button>
                </div>
              </div>
            )}
              </>
            )}
          </div>
        )}

        {/* Forecast method (all rows) */}
        {row.forecastMethod && (
          <div className="px-4 py-4" style={{ borderBottom: "1px solid var(--fc-border)" }}>
            <div className={SECTION_LABEL} style={SECTION_LABEL_STYLE}>
              <TrendingUp className="w-4 h-4" /> Forecast Method
            </div>
            <span
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1"
              style={{ fontSize: 10.8, fontWeight: 500, background: "var(--fc-accent-muted)", color: "var(--fc-accent)" }}
            >
              <TrendingUp className="w-3 h-3" />
              {row.forecastMethod}
            </span>
            <p className="mt-2" style={{ fontSize: 10.8, color: "var(--fc-text-secondary)", lineHeight: 1.5 }}>
              {row.forecastMethod === "Trailing 3-month average"
                ? "Forecast values are projected using the average of the last 3 historical periods, with slight variance applied."
                : row.forecastMethod === "Sum of components"
                ? "Computed as the sum of child row forecasts."
                : row.forecastMethod === "Derived from formula"
                ? "Forecast values are calculated from the formula using forecasted inputs."
                : "Forecast values are generated automatically."}
            </p>
          </div>
        )}

        {/* Auto-resolve info */}
        <div className="px-4 py-4">
          <div className="mb-2" style={SECTION_LABEL_STYLE}>
            How it works
          </div>
          <p style={{ fontSize: 10.8, color: "var(--fc-text-secondary)", lineHeight: 1.5 }}>
            All calculations resolve automatically. No apply button needed: edit a cell or change a formula and the entire table updates instantly.
          </p>
        </div>
        </div>{/* end scrollable content */}
      </SheetContent>
    </Sheet>
  );
}
