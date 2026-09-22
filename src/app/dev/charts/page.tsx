"use client";

import { useState } from "react";
import { UnifiedChart } from "@/components/chart/unified-chart";
import type { ChartSpec } from "@/lib/chart-types";
import { PALETTE_NAMES, setChartPalette, type ChartPaletteName } from "@/lib/chart-colors";

// ── Mock Data Fixtures ──

const MONTHS = ["2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12"];

const LINE_SPEC: ChartSpec = {
  type: "line",
  title: "Monthly Revenue Trend",
  xKey: "month",
  yKeys: ["revenue", "costs"],
  yLabels: ["Revenue", "Costs"],
  format: { revenue: "currency", costs: "currency" },
  currency: "$",
  sql: "SELECT DATE_TRUNC('month', order_date) AS month,\n       SUM(total) AS revenue,\n       SUM(cost) AS costs\nFROM orders\nGROUP BY 1\nORDER BY 1",
  grain: "monthly",
  data: MONTHS.map((m, i) => ({
    month: m + "-01",
    revenue: 120000 + Math.sin(i * 0.8) * 30000 + i * 5000,
    costs: 80000 + Math.cos(i * 0.6) * 15000 + i * 2000,
  })),
};

const BAR_SPEC: ChartSpec = {
  type: "bar",
  title: "Revenue by Category",
  xKey: "category",
  yKeys: ["revenue"],
  yLabels: ["Revenue"],
  format: { revenue: "currency" },
  currency: "$",
  sql: "SELECT category, SUM(total) AS revenue\nFROM orders\nGROUP BY 1\nORDER BY 2 DESC",
  data: [
    { category: "Electronics", revenue: 245000 },
    { category: "Clothing", revenue: 189000 },
    { category: "Home & Garden", revenue: 156000 },
    { category: "Sports", revenue: 134000 },
    { category: "Books", revenue: 98000 },
    { category: "Toys", revenue: 72000 },
    { category: "Beauty", revenue: 61000 },
    { category: "Automotive", revenue: 45000 },
  ],
};

const AREA_SPEC: ChartSpec = {
  type: "area",
  title: "Daily Active Users",
  xKey: "date",
  yKeys: ["dau"],
  yLabels: ["DAU"],
  format: { dau: "number" },
  sql: "SELECT date, COUNT(DISTINCT user_id) AS dau\nFROM sessions\nGROUP BY 1\nORDER BY 1",
  grain: "daily",
  data: Array.from({ length: 30 }, (_, i) => ({
    date: `2025-03-${String(i + 1).padStart(2, "0")}`,
    dau: 12000 + Math.sin(i * 0.4) * 3000 + Math.random() * 1000,
  })),
};

const PIE_SPEC: ChartSpec = {
  type: "pie",
  title: "Traffic Source Distribution",
  nameKey: "source",
  valueKey: "users",
  format: { users: "number" },
  sql: "SELECT utm_source AS source, COUNT(DISTINCT user_id) AS users\nFROM sessions\nGROUP BY 1",
  data: [
    { source: "Organic Search", users: 45200 },
    { source: "Direct", users: 28900 },
    { source: "Social Media", users: 18700 },
    { source: "Email", users: 12400 },
    { source: "Referral", users: 8100 },
    { source: "Paid Search", users: 6300 },
  ],
};

const SCATTER_SPEC: ChartSpec = {
  type: "scatter",
  title: "LTV vs Acquisition Cost",
  xKey: "cac",
  yKeys: ["ltv"],
  yLabels: ["LTV"],
  nameKey: "channel",
  xAxisLabel: "Acquisition Cost ($)",
  yAxisLabel: "Lifetime Value ($)",
  format: { cac: "currency", ltv: "currency" },
  currency: "$",
  sql: "SELECT channel, AVG(cac) AS cac, AVG(ltv) AS ltv\nFROM cohorts\nGROUP BY 1",
  data: [
    { channel: "Google", cac: 12, ltv: 85 },
    { channel: "Google", cac: 15, ltv: 92 },
    { channel: "Google", cac: 18, ltv: 78 },
    { channel: "Facebook", cac: 8, ltv: 65 },
    { channel: "Facebook", cac: 10, ltv: 72 },
    { channel: "Facebook", cac: 14, ltv: 58 },
    { channel: "TikTok", cac: 5, ltv: 42 },
    { channel: "TikTok", cac: 7, ltv: 55 },
    { channel: "TikTok", cac: 9, ltv: 48 },
    { channel: "Organic", cac: 2, ltv: 95 },
    { channel: "Organic", cac: 3, ltv: 110 },
    { channel: "Organic", cac: 1, ltv: 88 },
  ],
};

const STACKED_BAR_SPEC: ChartSpec = {
  type: "bar",
  title: "Revenue by Region (Stacked)",
  xKey: "quarter",
  yKeys: ["north_america", "europe", "asia"],
  yLabels: ["North America", "Europe", "Asia"],
  format: { north_america: "currency", europe: "currency", asia: "currency" },
  currency: "$",
  stacked: true,
  sql: "SELECT quarter, SUM(CASE WHEN region='NA' THEN revenue END) AS north_america,\n       SUM(CASE WHEN region='EU' THEN revenue END) AS europe,\n       SUM(CASE WHEN region='APAC' THEN revenue END) AS asia\nFROM orders GROUP BY 1",
  data: [
    { quarter: "Q1", north_america: 120000, europe: 85000, asia: 62000 },
    { quarter: "Q2", north_america: 135000, europe: 92000, asia: 78000 },
    { quarter: "Q3", north_america: 142000, europe: 88000, asia: 95000 },
    { quarter: "Q4", north_america: 168000, europe: 110000, asia: 105000 },
  ],
};

const STACKED_AREA_SPEC: ChartSpec = {
  type: "area",
  title: "Cumulative Sessions by Device",
  xKey: "date",
  yKeys: ["mobile", "desktop", "tablet"],
  yLabels: ["Mobile", "Desktop", "Tablet"],
  stacked: true,
  sql: "SELECT date, SUM(CASE WHEN device='mobile' THEN 1 END) AS mobile,\n       SUM(CASE WHEN device='desktop' THEN 1 END) AS desktop,\n       SUM(CASE WHEN device='tablet' THEN 1 END) AS tablet\nFROM sessions GROUP BY 1",
  data: Array.from({ length: 14 }, (_, i) => ({
    date: `2025-03-${String(i + 1).padStart(2, "0")}`,
    mobile: 5000 + Math.sin(i * 0.5) * 1000 + i * 200,
    desktop: 3500 + Math.cos(i * 0.4) * 800 + i * 150,
    tablet: 1200 + Math.sin(i * 0.3) * 400 + i * 50,
  })),
};

const EMPTY_SPEC: ChartSpec = {
  type: "line",
  title: "Empty Dataset",
  xKey: "date",
  yKeys: ["value"],
  data: [],
};

const SINGLE_ROW_SPEC: ChartSpec = {
  type: "bar",
  title: "Single KPI",
  xKey: "metric",
  yKeys: ["value"],
  format: { value: "currency" },
  currency: "₹",
  data: [{ metric: "Total Revenue", value: 1245000 }],
};

const PERCENT_SPEC: ChartSpec = {
  type: "line",
  title: "Conversion Rate Over Time",
  xKey: "week",
  yKeys: ["conversion_rate", "bounce_rate"],
  yLabels: ["Conversion Rate", "Bounce Rate"],
  format: { conversion_rate: "percent", bounce_rate: "percent" },
  sql: "SELECT week, conversion_rate, bounce_rate FROM weekly_metrics ORDER BY 1",
  grain: "weekly",
  data: Array.from({ length: 12 }, (_, i) => ({
    week: `2025-W${String(i + 1).padStart(2, "0")}`,
    conversion_rate: 3.2 + Math.sin(i * 0.6) * 0.8,
    bounce_rate: 42 + Math.cos(i * 0.5) * 5,
  })),
};

const MANY_SERIES_SPEC: ChartSpec = {
  type: "line",
  title: "Revenue by 6 Channels",
  xKey: "month",
  yKeys: ["organic", "paid", "social", "email", "referral", "direct"],
  yLabels: ["Organic", "Paid", "Social", "Email", "Referral", "Direct"],
  format: { organic: "currency", paid: "currency", social: "currency", email: "currency", referral: "currency", direct: "currency" },
  currency: "$",
  data: MONTHS.slice(0, 6).map((m, i) => ({
    month: m + "-01",
    organic: 50000 + i * 5000,
    paid: 35000 + i * 3000,
    social: 22000 + Math.sin(i) * 5000,
    email: 18000 + i * 1500,
    referral: 12000 + Math.cos(i) * 3000,
    direct: 8000 + i * 800,
  })),
};

const FORECAST_SPEC: ChartSpec = {
  type: "line",
  title: "Revenue with Forecast",
  xKey: "month",
  yKeys: ["actual", "forecast"],
  yLabels: ["Actual", "Forecast"],
  format: { actual: "currency", forecast: "currency" },
  currency: "$",
  forecastKeys: ["forecast"],
  forecastStartX: "2025-07-01",
  data: MONTHS.map((m, i) => ({
    month: m + "-01",
    actual: i < 7 ? 100000 + i * 8000 + Math.sin(i) * 5000 : undefined as unknown as number,
    forecast: i >= 6 ? 100000 + i * 8000 + i * 2000 : undefined as unknown as number,
  })).filter((d) => d.actual != null || d.forecast != null),
};

const ANNOTATED_SPEC: ChartSpec = {
  type: "area",
  title: "Sessions with Launch Event",
  xKey: "date",
  yKeys: ["sessions"],
  yLabels: ["Sessions"],
  annotations: [
    { id: "launch", x: "2025-03-10", label: "Product Launch", type: "line" },
    { id: "promo", x: "2025-03-20", label: "Promo Start", type: "line", color: "#22c55e" },
  ],
  data: Array.from({ length: 30 }, (_, i) => ({
    date: `2025-03-${String(i + 1).padStart(2, "0")}`,
    sessions: 8000 + (i > 9 ? 4000 : 0) + (i > 19 ? 3000 : 0) + Math.random() * 1500,
  })),
};

// ── Edge case: 8-digit Y values with tiny range ──
const LARGE_Y_TINY_RANGE: ChartSpec = {
  type: "line",
  title: "Server Requests (tiny variance)",
  xKey: "hour",
  yKeys: ["requests"],
  yLabels: ["Requests"],
  data: Array.from({ length: 24 }, (_, i) => ({
    hour: `${String(i).padStart(2, "0")}:00`,
    requests: 10_234_500 + Math.round(Math.sin(i * 0.5) * 200 + Math.random() * 50),
  })),
};

// ── Edge case: 24 months of daily data ──
const LONG_DAILY: ChartSpec = {
  type: "line",
  title: "Daily Revenue — 24 Months",
  xKey: "date",
  yKeys: ["revenue"],
  yLabels: ["Revenue"],
  format: { revenue: "currency" },
  currency: "$",
  data: Array.from({ length: 730 }, (_, i) => {
    const d = new Date("2024-01-01");
    d.setDate(d.getDate() + i);
    return {
      date: d.toISOString().split("T")[0],
      revenue: 50000 + Math.sin(i * 0.05) * 15000 + (i / 730) * 30000 + Math.random() * 3000,
    };
  }),
};

// ── Edge case: very long category labels ──
const LONG_LABELS: ChartSpec = {
  type: "bar",
  title: "Revenue by Product Category",
  xKey: "category",
  yKeys: ["revenue"],
  format: { revenue: "currency" },
  currency: "$",
  data: [
    { category: "Electronics & Consumer Gadgets", revenue: 245000 },
    { category: "Home Improvement & Garden Supplies", revenue: 189000 },
    { category: "Sports Equipment & Outdoor Gear", revenue: 156000 },
    { category: "Fashion & Luxury Accessories", revenue: 134000 },
    { category: "Books, Media & Entertainment", revenue: 98000 },
    { category: "Health, Beauty & Personal Care", revenue: 72000 },
    { category: "Automotive Parts & Accessories", revenue: 61000 },
    { category: "Toys, Games & Children Products", revenue: 45000 },
    { category: "Office Supplies & Stationery", revenue: 38000 },
    { category: "Pet Food & Animal Supplies", revenue: 29000 },
    { category: "Industrial & Scientific Equipment", revenue: 22000 },
    { category: "Musical Instruments & DJ Equipment", revenue: 15000 },
  ],
};

// ── Edge case: very small decimal values ──
const SMALL_VALUES: ChartSpec = {
  type: "area",
  title: "Conversion Rate (tiny decimals)",
  xKey: "date",
  yKeys: ["rate"],
  yLabels: ["Conversion Rate"],
  format: { rate: "percent" },
  data: Array.from({ length: 30 }, (_, i) => ({
    date: `2025-03-${String(i + 1).padStart(2, "0")}`,
    rate: 0.032 + Math.sin(i * 0.3) * 0.005 + Math.random() * 0.002,
  })),
};

// ── All fixtures ──

const FIXTURES: { label: string; spec: ChartSpec }[] = [
  { label: "Line (multi-series)", spec: LINE_SPEC },
  { label: "Bar (categorical)", spec: BAR_SPEC },
  { label: "Area (time-series)", spec: AREA_SPEC },
  { label: "Pie (composition)", spec: PIE_SPEC },
  { label: "Scatter (grouped)", spec: SCATTER_SPEC },
  { label: "Stacked Bar", spec: STACKED_BAR_SPEC },
  { label: "Stacked Area", spec: STACKED_AREA_SPEC },
  { label: "Percent Format", spec: PERCENT_SPEC },
  { label: "6 Series Line", spec: MANY_SERIES_SPEC },
  { label: "Forecast (dashed)", spec: FORECAST_SPEC },
  { label: "With Annotations", spec: ANNOTATED_SPEC },
  { label: "EDGE: Large Y tiny range", spec: LARGE_Y_TINY_RANGE },
  { label: "EDGE: 24mo daily data", spec: LONG_DAILY },
  { label: "EDGE: Long category labels", spec: LONG_LABELS },
  { label: "EDGE: Small decimals", spec: SMALL_VALUES },
  { label: "Empty Data", spec: EMPTY_SPEC },
  { label: "Single Row (₹)", spec: SINGLE_ROW_SPEC },
];

type Variant = "compact" | "normal" | "expanded";

export default function DevChartsPage() {
  const [activeVariant, setActiveVariant] = useState<Variant>("normal");
  const [activeFixture, setActiveFixture] = useState(0);
  const [activePalette, setActivePalette] = useState<ChartPaletteName>("default");

  const handlePaletteChange = (name: ChartPaletteName) => {
    setChartPalette(name);
    setActivePalette(name);
  };

  const variants: Variant[] = ["compact", "normal", "expanded"];

  return (
    <div className="h-screen bg-background overflow-hidden flex flex-col">
      {/* Header */}
      <div className="border-b border-border bg-card px-6 py-4">
        <h1 className="text-lg font-semibold text-foreground">Unified Chart System — Dev Harness</h1>
        <p className="text-xs text-muted-foreground mt-1">
          {FIXTURES.length} fixtures × 3 variants. Toggle to evaluate.
        </p>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar: fixture list */}
        <div className="w-[220px] border-r border-border bg-card overflow-y-auto shrink-0 min-h-0 pb-8">
          <div className="p-3">
            <p className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Fixtures</p>
            {FIXTURES.map((f, i) => (
              <button
                key={i}
                type="button"
                className={`w-full text-left px-3 py-1.5 text-xs rounded mb-0.5 transition-colors cursor-pointer ${
                  activeFixture === i
                    ? "bg-muted text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
                onClick={() => setActiveFixture(i)}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="p-3 border-t border-border">
            <p className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Variant</p>
            <div className="flex flex-col gap-1">
              {variants.map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`px-3 py-1.5 text-xs rounded transition-colors cursor-pointer text-left ${
                    activeVariant === v
                      ? "bg-muted text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }`}
                  onClick={() => setActiveVariant(v)}
                >
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="p-3 border-t border-border">
            <p className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Palette</p>
            <div className="flex flex-col gap-1">
              {PALETTE_NAMES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  title={p.description}
                  className={`px-3 py-1.5 text-xs rounded transition-colors cursor-pointer text-left ${
                    activePalette === p.id
                      ? "bg-muted text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }`}
                  onClick={() => handlePaletteChange(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Main: active chart */}
        <div className="flex-1 overflow-y-auto">
          {/* Single focused chart */}
          <div className="p-6">
            <div className="mb-4">
              <h2 className="text-sm font-medium text-foreground">{FIXTURES[activeFixture].label}</h2>
              <p className="text-[9px] text-muted-foreground">
                variant=&quot;{activeVariant}&quot; · type=&quot;{FIXTURES[activeFixture].spec.type}&quot;
                {FIXTURES[activeFixture].spec.stacked && " · stacked"}
                {FIXTURES[activeFixture].spec.grain && ` · grain=${FIXTURES[activeFixture].spec.grain}`}
              </p>
            </div>

            <div style={{ maxWidth: activeVariant === "compact" ? 400 : activeVariant === "expanded" ? "100%" : 700 }}>
              <UnifiedChart
                spec={FIXTURES[activeFixture].spec}
                variant={activeVariant === "expanded" ? "normal" : activeVariant}
                fullData={FIXTURES[activeFixture].spec.data as Record<string, unknown>[]}
                onGrainChange={(g) => console.log("grain:", g)}
                onTimeRangeChange={(p) => console.log("time:", p)}
                onTypeChange={(t, s) => console.log("type:", t, "stacked:", s)}
                onTitleChange={(t) => console.log("title:", t)}
                onAnnotationAdd={(a) => console.log("annotation add:", a)}
                onAnnotationRemove={(id) => console.log("annotation remove:", id)}
              />
            </div>
          </div>

          {/* Grid: all fixtures at current variant */}
          <div className="px-6 pb-8">
            <h3 className="text-xs font-medium text-muted-foreground mb-4 uppercase tracking-wider">
              All Fixtures — {activeVariant}
            </h3>
            <div className={`grid gap-4 ${activeVariant === "compact" ? "grid-cols-3" : "grid-cols-1 md:grid-cols-2"}`}>
              {FIXTURES.map((f, i) => (
                <div key={i}>
                  <p className="text-[9px] text-muted-foreground mb-1">{f.label}</p>
                  <UnifiedChart
                    spec={f.spec}
                    variant={activeVariant === "expanded" ? "normal" : activeVariant}
                    fullData={f.spec.data as Record<string, unknown>[]}
                    onGrainChange={(g) => console.log(f.label, "grain:", g)}
                    onTimeRangeChange={(p) => console.log(f.label, "time:", p)}
                    onTypeChange={(t) => console.log(f.label, "type:", t)}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
