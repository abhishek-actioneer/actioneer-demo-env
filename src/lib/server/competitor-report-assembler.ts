/**
 * Deterministic competitor-report assembler.
 *
 * Takes typed CompanyDataset[] and emits markdown with:
 *   - 5 tables (Snapshot, Asset Quality, Capital, Operations, Strategic Moves)
 *   - 4 chart specs in ```chart fenced blocks for the host app's renderer
 *   - Source list grouped by company
 *
 * NO LLM CALLS. Everything is data → markdown templating. Numbers come from
 * structured extractors; tables / charts pivot the numbers; citations carry
 * through verbatim. Hallucination is structurally impossible.
 */

import type { CompanyDataset, PeriodFinancials, AssetMix, CustomerMix, FundingMix, StrategicMove, StrategicMoveType } from "./competitor-data-types";

interface ChartSpec {
  type: "bar" | "line" | "area" | "pie" | "scatter" | "combo" | "stacked-area" | "grouped-bar" | "funnel";
  title: string;
  data: Record<string, string | number>[];
  xKey?: string;
  yKeys?: string[];
  yLabels?: string[];
  format?: Record<string, "number" | "currency" | "percent">;
  currency?: string;
  highlight?: string;
  stacked?: boolean;
}

interface AssemblerInput {
  subjectCompany: string;
  datasets: CompanyDataset[];
  asOfDate: Date;
  query?: string;
}

// ── Period canonicalization ──────────────────────────────────────────────────

interface ParsedPeriod {
  fy: number;
  /** When undefined, this row represents annual / full-year data. */
  quarter?: 1 | 2 | 3 | 4;
}

/** Parse a heterogeneous period label into a canonical {fy, quarter?}. */
export function parsePeriodLabel(label: string): ParsedPeriod | null {
  const s = label.toUpperCase();

  let quarter: 1 | 2 | 3 | 4 | undefined;
  const qm = s.match(/Q([1-4])/);
  if (qm) quarter = parseInt(qm[1]!, 10) as 1 | 2 | 3 | 4;

  // FY YY-YY or FY YYYY-YY range — take the END year
  const range = s.match(/FY\s*(\d{2,4})\s*[-–]\s*(\d{2,4})/);
  if (range) {
    let end = parseInt(range[2]!, 10);
    if (end < 100) end = 2000 + end;
    if (end >= 2010 && end <= 2040) return { fy: end, quarter };
  }
  // FY YY or FY YYYY
  const fy = s.match(/FY\s*(\d{2,4})/);
  if (fy) {
    let y = parseInt(fy[1]!, 10);
    if (y < 100) y = 2000 + y;
    if (y >= 2010 && y <= 2040) return { fy: y, quarter };
  }
  // Bare year (e.g. "year ended March 2026" → 2026)
  const bare = s.match(/(20\d{2})/);
  if (bare) {
    const y = parseInt(bare[1]!, 10);
    return { fy: y, quarter };
  }
  return null;
}

/** Field categorization for the merge step. */
const PL_FIELDS = ["total_income_inr_cr", "nii_inr_cr", "pat_inr_cr", "disbursements_inr_cr"] as const;
const BALANCE_AND_OPS_FIELDS = ["aum_inr_cr", "net_worth_inr_cr", "branches", "employees", "customers", "avg_ticket_size_inr_lakh"] as const;
const RATIO_FIELDS = ["nim_pct", "roa_pct", "roe_pct", "gnpa_pct", "nnpa_pct", "pcr_pct", "credit_cost_pct", "crar_pct"] as const;

/**
 * Collapse multiple period rows for the same FY into a single canonical row.
 *
 * Rules:
 *   - For P&L metrics (PAT, total income, NII, disbursements):
 *     ONLY use values from a row labeled annual (no quarter). Drop quarterly
 *     P&L from the annual comparison — they're quarter-only, not full-year.
 *   - For balance-sheet & operations metrics (AUM, net worth, branches, etc.):
 *     prefer annual row; fall back to the latest quarter (closing-balance is
 *     identical across Q4 and the annual row since both are point-in-time).
 *   - For ratio metrics (NIM, RoA, GNPA, etc.): prefer annual; else latest quarter.
 */
export function mergeFinancialsByFY(financials: PeriodFinancials[]): PeriodFinancials[] {
  const byFY = new Map<number, Array<{ period: PeriodFinancials; parsed: ParsedPeriod }>>();
  for (const p of financials) {
    const parsed = parsePeriodLabel(p.period);
    if (!parsed) continue;
    const list = byFY.get(parsed.fy) ?? [];
    list.push({ period: p, parsed });
    byFY.set(parsed.fy, list);
  }

  const merged: PeriodFinancials[] = [];
  for (const [fy, rows] of byFY) {
    const annual = rows.find((r) => r.parsed.quarter === undefined);
    const q4 = rows.find((r) => r.parsed.quarter === 4);
    // Period-end rows: full-year annual + Q4 (year-ended). Both report FY-closing
    // balance-sheet and full-year ratios, so they're interchangeable for BS / ratio fields.
    const periodEndOrdered = [annual, q4].filter((r): r is { period: PeriodFinancials; parsed: ParsedPeriod } => !!r);

    const out: PeriodFinancials = { period: `FY${fy % 100}` };

    // P&L — annual row only. Q4 quarterly P&L ≠ full-year P&L; mid-year quarters
    // are even further from full-year. Always show "—" if no annual row exists.
    for (const field of PL_FIELDS) {
      const v = annual?.period[field];
      if (v !== undefined && v !== null) (out as unknown as Record<string, unknown>)[field] = v;
    }

    // Balance / Ops — period-end rows only (annual or Q4). Mid-year Q1/Q2/Q3
    // snapshots get dropped because they're not FY-closing balances.
    for (const field of BALANCE_AND_OPS_FIELDS) {
      for (const r of periodEndOrdered) {
        const v = r.period[field];
        if (v !== undefined && v !== null) {
          (out as unknown as Record<string, unknown>)[field] = v;
          break;
        }
      }
    }

    // Ratios — same period-end-only rule as BS.
    for (const field of RATIO_FIELDS) {
      for (const r of periodEndOrdered) {
        const v = r.period[field];
        if (v !== undefined && v !== null) {
          (out as unknown as Record<string, unknown>)[field] = v;
          break;
        }
      }
    }

    merged.push(out);
  }

  merged.sort((a, b) => {
    const fa = parsePeriodLabel(a.period)?.fy ?? 0;
    const fb = parsePeriodLabel(b.period)?.fy ?? 0;
    return fb - fa;
  });
  return merged;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtNumber(n: number | undefined | null, decimals = 0): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: decimals, minimumFractionDigits: decimals === 0 ? 0 : decimals });
}

function fmtPct(n: number | undefined | null, decimals = 2): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return `${n.toFixed(decimals)}%`;
}

/** Look up a company's row for a canonical fiscal year. Datasets must already be merged. */
function findByFY(dataset: CompanyDataset, fy: number): PeriodFinancials | undefined {
  return dataset.financials.find((p) => parsePeriodLabel(p.period)?.fy === fy);
}

function fyLabel(fy: number): string {
  return `FY${fy % 100}`;
}

/** Two most-recent FYs for which at least one company has at least one populated metric. */
function pickComparisonFYs(datasets: CompanyDataset[]): { current: number; prior: number } {
  const fySet = new Set<number>();
  for (const d of datasets) for (const p of d.financials) {
    const parsed = parsePeriodLabel(p.period);
    if (parsed) fySet.add(parsed.fy);
  }
  const sorted = [...fySet].sort((a, b) => b - a);
  return { current: sorted[0] ?? 2026, prior: sorted[1] ?? 2025 };
}

/** All FYs across the dataset, most-recent first, capped at maxYears. */
function fyAxis(datasets: CompanyDataset[], maxYears = 5): number[] {
  const fySet = new Set<number>();
  for (const d of datasets) for (const p of d.financials) {
    const parsed = parsePeriodLabel(p.period);
    if (parsed) fySet.add(parsed.fy);
  }
  return [...fySet].sort((a, b) => b - a).slice(0, maxYears).reverse(); // chronological for charts
}

function yoy(curr?: number | null, prior?: number | null): number | undefined {
  if (curr === undefined || curr === null || prior === undefined || prior === null || prior === 0) return undefined;
  return ((curr - prior) / prior) * 100;
}

// ── Table builders ───────────────────────────────────────────────────────────

interface MetricRow {
  label: string;
  unit: string;
  field: keyof PeriodFinancials;
  format: "number" | "percent" | "currency";
  decimals?: number;
}

function buildMetricTable(
  title: string,
  rows: MetricRow[],
  datasets: CompanyDataset[],
  comparisonFYs: { current: number; prior: number },
  options: { showYoY?: boolean; showPrior?: boolean } = {},
): string {
  const showYoY = options.showYoY ?? false;
  const showPrior = options.showPrior ?? true;
  const { current, prior } = comparisonFYs;
  const header = `| Metric | Period | ${datasets.map((d) => d.company).join(" | ")} |`;
  const sep = `|---|---|${datasets.map(() => "---:").join("|")}|`;
  const lines: string[] = [];

  const cellFor = (d: CompanyDataset, fy: number, row: MetricRow): string => {
    const period = findByFY(d, fy);
    const v = period ? (period[row.field] as number | undefined) : undefined;
    if (row.format === "percent") return fmtPct(v, row.decimals ?? 2);
    return fmtNumber(v, row.decimals ?? 0);
  };

  for (const row of rows) {
    lines.push(`| **${row.label}** (${row.unit}) | ${fyLabel(current)} | ${datasets.map((d) => cellFor(d, current, row)).join(" | ")} |`);

    if (showPrior) {
      lines.push(`| | ${fyLabel(prior)} | ${datasets.map((d) => cellFor(d, prior, row)).join(" | ")} |`);
    }

    if (showYoY && row.format !== "percent") {
      const yoyCells = datasets.map((d) => {
        const curr = findByFY(d, current)?.[row.field] as number | undefined;
        const priorVal = findByFY(d, prior)?.[row.field] as number | undefined;
        const pct = yoy(curr, priorVal);
        return pct === undefined ? "—" : `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
      });
      lines.push(`| | **YoY %** | ${yoyCells.join(" | ")} |`);
    }
  }

  return [`## ${title}`, "", header, sep, ...lines, ""].join("\n");
}

// ── Chart spec builders ──────────────────────────────────────────────────────

function chartFenced(spec: ChartSpec): string {
  return ["```chart", JSON.stringify(spec, null, 2), "```", ""].join("\n");
}

function buildAUMChart(datasets: CompanyDataset[], subjectCompany?: string): string | null {
  const fys = fyAxis(datasets, 5);
  if (fys.length < 2) return null;
  const data = fys.map((fy) => {
    const row: Record<string, string | number> = { period: fyLabel(fy) };
    for (const d of datasets) {
      const p = findByFY(d, fy);
      if (p && p.aum_inr_cr !== undefined && p.aum_inr_cr !== null) row[d.company] = p.aum_inr_cr;
    }
    return row;
  });
  const yKeys = datasets.map((d) => d.company).filter((name) => data.some((r) => name in r));
  if (yKeys.length === 0) return null;

  return chartFenced({
    type: "line",
    title: "AUM (₹ Cr) — by company",
    data,
    xKey: "period",
    yKeys,
    format: Object.fromEntries(yKeys.map((k) => [k, "currency" as const])),
    currency: "₹",
    highlight: subjectCompany && yKeys.includes(subjectCompany) ? subjectCompany : undefined,
  });
}

function buildPATChart(datasets: CompanyDataset[], comparisonFY: number, subjectCompany?: string): string | null {
  const data: Record<string, string | number>[] = [];
  for (const d of datasets) {
    const p = findByFY(d, comparisonFY);
    if (p && p.pat_inr_cr !== undefined && p.pat_inr_cr !== null) {
      data.push({ company: d.company, "PAT (₹ Cr)": p.pat_inr_cr });
    }
  }
  if (data.length < 2) return null;

  return chartFenced({
    type: "bar",
    title: `PAT (₹ Cr) — ${fyLabel(comparisonFY)}`,
    data,
    xKey: "company",
    yKeys: ["PAT (₹ Cr)"],
    format: { "PAT (₹ Cr)": "currency" },
    currency: "₹",
    highlight: subjectCompany && data.some((r) => r.company === subjectCompany) ? subjectCompany : undefined,
  });
}

function buildGNPAChart(datasets: CompanyDataset[], subjectCompany?: string): string | null {
  const fys = fyAxis(datasets, 5);
  if (fys.length < 2) return null;
  const data = fys.map((fy) => {
    const row: Record<string, string | number> = { period: fyLabel(fy) };
    for (const d of datasets) {
      const p = findByFY(d, fy);
      if (p && p.gnpa_pct !== undefined && p.gnpa_pct !== null) row[d.company] = p.gnpa_pct;
    }
    return row;
  });
  const yKeys = datasets.map((d) => d.company).filter((name) => data.some((r) => name in r));
  if (yKeys.length === 0) return null;

  return chartFenced({
    type: "line",
    title: "GNPA % — by company over time",
    data,
    xKey: "period",
    yKeys,
    format: Object.fromEntries(yKeys.map((k) => [k, "percent" as const])),
    highlight: subjectCompany && yKeys.includes(subjectCompany) ? subjectCompany : undefined,
  });
}

function buildBranchesChart(datasets: CompanyDataset[], comparisonFY: number, subjectCompany?: string): string | null {
  const data: Record<string, string | number>[] = [];
  for (const d of datasets) {
    const p = findByFY(d, comparisonFY);
    if (p && p.branches !== undefined && p.branches !== null) {
      data.push({ company: d.company, branches: p.branches });
    }
  }
  if (data.length < 2) return null;

  return chartFenced({
    type: "bar",
    title: `Branch network — ${fyLabel(comparisonFY)}`,
    data,
    xKey: "company",
    yKeys: ["branches"],
    format: { branches: "number" },
    highlight: subjectCompany && data.some((r) => r.company === subjectCompany) ? subjectCompany : undefined,
  });
}

// ── Asset / customer / funding mix tables + charts ───────────────────────────

function findMixForFY<T extends { period: string }>(rows: T[], fy: number): T | undefined {
  return rows.find((r) => parsePeriodLabel(r.period)?.fy === fy);
}

function buildAssetMixTable(datasets: CompanyDataset[], comparisonFYs: { current: number; prior: number }): string {
  type Row = { label: string; field: keyof Omit<AssetMix, "period" | "citations"> };
  const rows: Row[] = [
    { label: "Home loan",      field: "home_loan_pct" },
    { label: "Loan against property", field: "lap_pct" },
    { label: "MSME",           field: "msme_pct" },
    { label: "Construction",   field: "construction_pct" },
    { label: "Other",          field: "other_pct" },
  ];
  const { current, prior } = comparisonFYs;
  // Skip if zero data populated
  const anyData = datasets.some((d) => d.asset_mix.length > 0);
  if (!anyData) return "";

  const header = `| Product mix (% of AUM) | Period | ${datasets.map((d) => d.company).join(" | ")} |`;
  const sep = `|---|---|${datasets.map(() => "---:").join("|")}|`;
  const lines: string[] = [];
  for (const row of rows) {
    const currCells = datasets.map((d) => {
      const m = findMixForFY(d.asset_mix, current);
      const v = m ? (m[row.field] as number | undefined) : undefined;
      return fmtPct(v, 1);
    });
    const priorCells = datasets.map((d) => {
      const m = findMixForFY(d.asset_mix, prior);
      const v = m ? (m[row.field] as number | undefined) : undefined;
      return fmtPct(v, 1);
    });
    const hasAnyCurr = currCells.some((c) => c !== "—");
    const hasAnyPrior = priorCells.some((c) => c !== "—");
    if (!hasAnyCurr && !hasAnyPrior) continue;
    lines.push(`| **${row.label}** | ${fyLabel(current)} | ${currCells.join(" | ")} |`);
    if (hasAnyPrior) lines.push(`| | ${fyLabel(prior)} | ${priorCells.join(" | ")} |`);
  }
  if (lines.length === 0) return "";
  return ["## Asset mix (% of AUM)", "", header, sep, ...lines, ""].join("\n");
}

function buildAssetMixChart(datasets: CompanyDataset[], comparisonFY: number, subjectCompany?: string): string | null {
  // Stacked bar: one bar per company, segments = product types
  const data: Record<string, string | number>[] = [];
  for (const d of datasets) {
    const m = findMixForFY(d.asset_mix, comparisonFY);
    if (!m) continue;
    const row: Record<string, string | number> = { company: d.company };
    if (m.home_loan_pct !== undefined && m.home_loan_pct !== null) row["Home loan"] = m.home_loan_pct;
    if (m.lap_pct !== undefined && m.lap_pct !== null) row["LAP"] = m.lap_pct;
    if (m.msme_pct !== undefined && m.msme_pct !== null) row["MSME"] = m.msme_pct;
    if (m.construction_pct !== undefined && m.construction_pct !== null) row["Construction"] = m.construction_pct;
    if (m.other_pct !== undefined && m.other_pct !== null) row["Other"] = m.other_pct;
    if (Object.keys(row).length > 1) data.push(row);
  }
  if (data.length < 2) return null;
  const yKeys = ["Home loan", "LAP", "MSME", "Construction", "Other"].filter((k) => data.some((r) => k in r));
  return chartFenced({
    type: "bar",
    title: `Asset mix (% of AUM) — ${fyLabel(comparisonFY)}`,
    data,
    xKey: "company",
    yKeys,
    format: Object.fromEntries(yKeys.map((k) => [k, "percent" as const])),
    stacked: true,
    highlight: subjectCompany && data.some((r) => r.company === subjectCompany) ? subjectCompany : undefined,
  });
}

function buildCustomerMixTable(datasets: CompanyDataset[], comparisonFYs: { current: number; prior: number }): string {
  type Row = { label: string; field: keyof Omit<CustomerMix, "period" | "citations"> };
  const rows: Row[] = [
    { label: "Self-employed",   field: "self_employed_pct" },
    { label: "Salaried",        field: "salaried_pct" },
    { label: "Formal income",   field: "formal_income_pct" },
    { label: "Informal income", field: "informal_income_pct" },
    { label: "Rural",           field: "rural_pct" },
    { label: "Semi-urban",      field: "semi_urban_pct" },
    { label: "Urban",           field: "urban_pct" },
  ];
  const { current, prior } = comparisonFYs;
  const anyData = datasets.some((d) => d.customer_mix.length > 0);
  if (!anyData) return "";

  const header = `| Customer mix (%) | Period | ${datasets.map((d) => d.company).join(" | ")} |`;
  const sep = `|---|---|${datasets.map(() => "---:").join("|")}|`;
  const lines: string[] = [];
  for (const row of rows) {
    const currCells = datasets.map((d) => {
      const m = findMixForFY(d.customer_mix, current);
      const v = m ? (m[row.field] as number | undefined) : undefined;
      return fmtPct(v, 1);
    });
    const hasAnyCurr = currCells.some((c) => c !== "—");
    if (!hasAnyCurr) continue;
    lines.push(`| **${row.label}** | ${fyLabel(current)} | ${currCells.join(" | ")} |`);
    const priorCells = datasets.map((d) => {
      const m = findMixForFY(d.customer_mix, prior);
      const v = m ? (m[row.field] as number | undefined) : undefined;
      return fmtPct(v, 1);
    });
    const hasAnyPrior = priorCells.some((c) => c !== "—");
    if (hasAnyPrior) lines.push(`| | ${fyLabel(prior)} | ${priorCells.join(" | ")} |`);
  }
  if (lines.length === 0) return "";
  return ["## Customer mix", "", header, sep, ...lines, ""].join("\n");
}

function buildFundingMixTable(datasets: CompanyDataset[], comparisonFYs: { current: number; prior: number }): string {
  type Row = { label: string; field: keyof Omit<FundingMix, "period" | "citations"> };
  const rows: Row[] = [
    { label: "Bank borrowings",        field: "bank_borrowings_pct" },
    { label: "NCDs / bonds",            field: "ncds_pct" },
    { label: "NHB refinance",           field: "nhb_refinance_pct" },
    { label: "Securitization / DA",     field: "securitization_pct" },
    { label: "ECB",                     field: "ecb_pct" },
    { label: "Other",                   field: "other_pct" },
    { label: "Weighted avg cost",       field: "weighted_avg_cost_pct" },
  ];
  const { current } = comparisonFYs;
  const anyData = datasets.some((d) => d.funding_mix.length > 0);
  if (!anyData) return "";

  const header = `| Funding mix (% of borrowings) | Period | ${datasets.map((d) => d.company).join(" | ")} |`;
  const sep = `|---|---|${datasets.map(() => "---:").join("|")}|`;
  const lines: string[] = [];
  for (const row of rows) {
    const currCells = datasets.map((d) => {
      const m = findMixForFY(d.funding_mix, current);
      const v = m ? (m[row.field] as number | undefined) : undefined;
      return fmtPct(v, 1);
    });
    const hasAny = currCells.some((c) => c !== "—");
    if (!hasAny) continue;
    lines.push(`| **${row.label}** | ${fyLabel(current)} | ${currCells.join(" | ")} |`);
  }
  if (lines.length === 0) return "";
  return ["## Funding mix", "", header, sep, ...lines, ""].join("\n");
}

// ── Executive summary, coverage, comparative ranking ────────────────────────

interface MetricRanking {
  label: string;
  unit: string;
  field: keyof PeriodFinancials;
  format: "number" | "percent" | "currency";
  /** When true, lower is better (e.g. GNPA, credit cost). */
  lowerBetter?: boolean;
}

const RANKING_METRICS: MetricRanking[] = [
  { label: "AUM",         unit: "₹ Cr", field: "aum_inr_cr",    format: "currency" },
  { label: "PAT",         unit: "₹ Cr", field: "pat_inr_cr",    format: "currency" },
  { label: "RoA",         unit: "%",    field: "roa_pct",       format: "percent" },
  { label: "RoE",         unit: "%",    field: "roe_pct",       format: "percent" },
  { label: "NIM",         unit: "%",    field: "nim_pct",       format: "percent" },
  { label: "GNPA",        unit: "%",    field: "gnpa_pct",      format: "percent", lowerBetter: true },
  { label: "Credit cost", unit: "%",    field: "credit_cost_pct", format: "percent", lowerBetter: true },
  { label: "Net worth",   unit: "₹ Cr", field: "net_worth_inr_cr", format: "currency" },
];

/** Pick the FY that has the most companies populated for ranking. */
function pickRankingFY(datasets: CompanyDataset[], comparisonFYs: { current: number; prior: number }): number {
  // Try current FY first; if fewer than 3 companies have data, fall back to prior.
  for (const fy of [comparisonFYs.current, comparisonFYs.prior]) {
    let count = 0;
    for (const d of datasets) if (findByFY(d, fy)) count += 1;
    if (count >= 3) return fy;
  }
  return comparisonFYs.prior;
}

interface CompanyRank {
  company: string;
  rank: number;        // 1 = best
  total: number;
  value: number;
  spread: { min: number; max: number; leader: string };
}

function rankByMetric(datasets: CompanyDataset[], metric: MetricRanking, fy: number): CompanyRank[] {
  const populated = datasets
    .map((d) => {
      const p = findByFY(d, fy);
      const v = p ? (p[metric.field] as number | undefined) : undefined;
      return v !== undefined && v !== null ? { company: d.company, value: v } : null;
    })
    .filter((x): x is { company: string; value: number } => x !== null);

  if (populated.length < 2) return [];

  const sorted = [...populated].sort((a, b) => metric.lowerBetter ? a.value - b.value : b.value - a.value);
  const min = Math.min(...populated.map((x) => x.value));
  const max = Math.max(...populated.map((x) => x.value));
  const leader = sorted[0]!.company;

  return populated.map((p) => ({
    company: p.company,
    rank: sorted.findIndex((s) => s.company === p.company) + 1,
    total: populated.length,
    value: p.value,
    spread: { min, max, leader },
  }));
}

function buildCoverageMap(datasets: CompanyDataset[]): string {
  const lines = ["## Coverage", "", "| Company | Latest FY | Periods captured | Strategic moves | Asset mix | Customer mix |", "|---|---|---|---:|:-:|:-:|"];
  for (const d of datasets) {
    const latestFY = d.financials[0]?.period ?? "—";
    const periods = d.financials.map((p) => p.period).slice(0, 4).join(", ") || "—";
    const moves = d.strategic_moves.length;
    const am = d.asset_mix.length > 0 ? "✓" : "—";
    const cm = d.customer_mix.length > 0 ? "✓" : "—";
    lines.push(`| ${d.company} | ${latestFY} | ${periods} | ${moves} | ${am} | ${cm} |`);
  }
  lines.push("");
  return lines.join("\n");
}

function buildExecutiveSummary(datasets: CompanyDataset[], subjectCompany: string, comparisonFYs: { current: number; prior: number }): string {
  const fy = pickRankingFY(datasets, comparisonFYs);
  const lines: string[] = ["## Executive summary", ""];

  // Where subject leads
  const leads: string[] = [];
  const trails: string[] = [];
  for (const m of RANKING_METRICS) {
    const ranks = rankByMetric(datasets, m, fy);
    const subj = ranks.find((r) => r.company === subjectCompany);
    if (!subj) continue;
    const fmtVal = m.format === "percent"
      ? `${subj.value.toFixed(2)}%`
      : (m.format === "currency" ? `₹${subj.value.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr` : `${subj.value}`);
    if (subj.rank === 1) {
      leads.push(`**${m.label}** — peer-best at ${fmtVal} (${subj.total} companies tracked)`);
    } else if (subj.rank <= Math.ceil(subj.total / 2)) {
      leads.push(`**${m.label}** — ranks ${subj.rank} of ${subj.total} at ${fmtVal} (leader: ${subj.spread.leader})`);
    } else {
      trails.push(`**${m.label}** — ranks ${subj.rank} of ${subj.total} at ${fmtVal} (leader ${subj.spread.leader} at ${m.format === "percent" ? subj.spread.max.toFixed(2) + "%" : "₹" + subj.spread[m.lowerBetter ? "min" : "max"].toLocaleString("en-IN", { maximumFractionDigits: 0 }) + " Cr"})`);
    }
  }

  lines.push(`**Subject:** ${subjectCompany}. Comparison year: ${fyLabel(fy)}. Peer set: ${datasets.filter((d) => d.company !== subjectCompany).map((d) => d.company).join(", ")}.`);
  lines.push("");
  if (leads.length > 0) {
    lines.push(`**Where ${subjectCompany} is at or above peer median:**`);
    for (const l of leads) lines.push(`- ${l}`);
    lines.push("");
  }
  if (trails.length > 0) {
    lines.push(`**Where ${subjectCompany} trails peers:**`);
    for (const t of trails) lines.push(`- ${t}`);
    lines.push("");
  }

  // Pressing competitive threats — peers with most-recent disclosures the subject hasn't matched
  const threats: string[] = [];
  const subjLatestFY = parsePeriodLabel(datasets.find((d) => d.company === subjectCompany)?.financials[0]?.period ?? "")?.fy ?? 0;
  for (const d of datasets) {
    if (d.company === subjectCompany) continue;
    const peerLatestFY = parsePeriodLabel(d.financials[0]?.period ?? "")?.fy ?? 0;
    if (peerLatestFY > subjLatestFY) {
      const latest = d.financials[0]!;
      const aum = latest.aum_inr_cr ? `AUM ₹${latest.aum_inr_cr.toLocaleString("en-IN")} Cr` : "";
      const pat = latest.pat_inr_cr ? `PAT ₹${latest.pat_inr_cr.toLocaleString("en-IN")} Cr` : "";
      threats.push(`${d.company} has published ${fyLabel(peerLatestFY)} data (${[aum, pat].filter(Boolean).join(", ")}) — ahead of ${subjectCompany}'s latest ${fyLabel(subjLatestFY)} disclosure.`);
    }
  }
  if (threats.length > 0) {
    lines.push(`**Disclosure gap to address:**`);
    for (const t of threats) lines.push(`- ${t}`);
    lines.push("");
  }

  return lines.join("\n");
}

function buildComparativeRanking(datasets: CompanyDataset[], subjectCompany: string, comparisonFYs: { current: number; prior: number }): string {
  const fy = pickRankingFY(datasets, comparisonFYs);
  const header = `| Metric | ${subjectCompany} value | Rank | Best peer | Best value | Gap |`;
  const sep = `|---|---:|---|---|---:|---:|`;
  const rows: string[] = [];
  for (const m of RANKING_METRICS) {
    const ranks = rankByMetric(datasets, m, fy);
    const subj = ranks.find((r) => r.company === subjectCompany);
    if (!subj) continue;
    const fmt = (v: number) => m.format === "percent"
      ? `${v.toFixed(2)}%`
      : (m.format === "currency" ? `${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : `${v}`);
    const best = m.lowerBetter ? subj.spread.min : subj.spread.max;
    const gap = subj.value - best;
    const gapStr = m.format === "percent"
      ? `${gap >= 0 ? "+" : ""}${gap.toFixed(2)} pp`
      : `${gap >= 0 ? "+" : ""}${gap.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
    rows.push(`| **${m.label}** (${m.unit}) | ${fmt(subj.value)} | ${subj.rank} of ${subj.total} | ${subj.spread.leader} | ${fmt(best)} | ${gapStr} |`);
  }
  if (rows.length === 0) return "";
  return [`## Comparative ranking — ${subjectCompany} vs peers (${fyLabel(fy)})`, "", header, sep, ...rows, ""].join("\n");
}

// ── Themed strategic moves ───────────────────────────────────────────────────

const MOVE_CATEGORIES: Array<{ types: StrategicMoveType[]; label: string; emoji?: string }> = [
  { types: ["capital_raise"], label: "Capital raises" },
  { types: ["m_and_a"], label: "M&A and stake changes" },
  { types: ["leadership"], label: "Leadership changes" },
  { types: ["expansion"], label: "Geographic / network expansion" },
  { types: ["product_launch"], label: "Product / digital launches" },
  { types: ["regulatory", "credit_rating"], label: "Regulatory & credit-rating actions" },
  { types: ["other"], label: "Other" },
];

function buildThemedStrategicMoves(datasets: CompanyDataset[]): string {
  const allMoves: Array<{ company: string; move: StrategicMove }> = [];
  for (const d of datasets) for (const m of d.strategic_moves) allMoves.push({ company: d.company, move: m });
  if (allMoves.length === 0) return "## Strategic moves\n\n_No dated moves extracted._\n";

  const lines = ["## Strategic moves (last 18 months, themed)", ""];
  for (const cat of MOVE_CATEGORIES) {
    const items = allMoves.filter(({ move }) => cat.types.includes(move.type));
    if (items.length === 0) continue;
    items.sort((a, b) => (b.move.date ?? "").localeCompare(a.move.date ?? ""));
    lines.push(`### ${cat.label}`);
    lines.push("");
    lines.push("| Date | Company | Move | Source |");
    lines.push("|---|---|---|---|");
    for (const { company, move } of items) {
      const desc = move.description.replace(/\|/g, "\\|");
      const src = move.citation?.sourceUrl ? `[link](${move.citation.sourceUrl})` : "—";
      lines.push(`| ${move.date ?? "—"} | ${company} | ${desc} | ${src} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ── Strategic moves table (legacy flat table — kept as fallback) ─────────────

function buildStrategicMovesTable(datasets: CompanyDataset[]): string {
  type Row = { date: string; company: string; type: string; description: string; sourceUrl: string; sortKey: string };
  const rows: Row[] = [];
  for (const d of datasets) {
    for (const m of d.strategic_moves) {
      rows.push({
        date: m.date ?? "—",
        company: d.company,
        type: m.type.replace(/_/g, " "),
        description: m.description.replace(/\|/g, "\\|"),
        sourceUrl: m.citation?.sourceUrl ?? "",
        sortKey: m.date ?? "0",
      });
    }
  }
  rows.sort((a, b) => b.sortKey.localeCompare(a.sortKey)); // newest first

  if (rows.length === 0) return "## Strategic moves (last 18 months)\n\n_No dated moves extracted._\n";

  const lines = [
    "## Strategic moves (last 18 months)",
    "",
    "| Date | Company | Type | Move | Source |",
    "|---|---|---|---|---|",
    ...rows.map((r) =>
      `| ${r.date} | ${r.company} | ${r.type} | ${r.description} | ${r.sourceUrl ? `[link](${r.sourceUrl})` : "—"} |`,
    ),
    "",
  ];
  return lines.join("\n");
}

// ── Performance + Risk narrative blocks ──────────────────────────────────────

function buildPerformanceSection(datasets: CompanyDataset[]): string {
  const lines = ["## Performance narrative", ""];
  for (const d of datasets) {
    const p = d.performance;
    const items = [...p.growth_drivers, ...p.segment_commentary, ...p.guidance, ...p.cohort_or_customer_notes];
    if (items.length === 0) continue;
    lines.push(`### ${d.company}`);
    for (const it of items.slice(0, 6)) {
      const cite = it.citation?.sourceUrl ? ` [↗](${it.citation.sourceUrl})` : "";
      lines.push(`- ${it.description}${cite}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function buildRiskSection(datasets: CompanyDataset[]): string {
  const lines = ["## Risk & outlook", ""];
  for (const d of datasets) {
    const r = d.risk_outlook;
    const items = [...r.risk_factors, ...r.asset_quality_concerns, ...r.headwinds, ...r.outlook];
    if (items.length === 0) continue;
    lines.push(`### ${d.company}`);
    for (const it of items.slice(0, 5)) {
      const cite = it.citation?.sourceUrl ? ` [↗](${it.citation.sourceUrl})` : "";
      lines.push(`- ${it.description}${cite}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ── Sources block ────────────────────────────────────────────────────────────

function buildSourcesSection(datasets: CompanyDataset[], urlToTitle: Map<string, string>): string {
  const lines = ["## Sources", ""];
  for (const d of datasets) {
    if (d.source_urls.length === 0) continue;
    lines.push(`**${d.company}**`);
    for (const url of d.source_urls) {
      const title = urlToTitle.get(url) ?? url.split("/").pop() ?? url;
      lines.push(`- [${title}](${url})`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ── Top-level assembler ──────────────────────────────────────────────────────

export interface AssembledReport {
  markdown: string;
  /** Where chart specs were embedded (for debugging / re-rendering). */
  charts: { title: string; ok: boolean }[];
}

const SNAPSHOT_METRICS: MetricRow[] = [
  { label: "AUM",        unit: "₹ Cr", field: "aum_inr_cr",         format: "currency" },
  { label: "PAT",        unit: "₹ Cr", field: "pat_inr_cr",         format: "currency" },
  { label: "NIM",        unit: "%",    field: "nim_pct",            format: "percent" },
  { label: "RoA",        unit: "%",    field: "roa_pct",            format: "percent" },
  { label: "RoE",        unit: "%",    field: "roe_pct",            format: "percent" },
  { label: "Net worth",  unit: "₹ Cr", field: "net_worth_inr_cr",   format: "currency" },
];

const ASSET_QUALITY_METRICS: MetricRow[] = [
  { label: "GNPA",        unit: "%", field: "gnpa_pct",        format: "percent" },
  { label: "NNPA",        unit: "%", field: "nnpa_pct",        format: "percent" },
  { label: "PCR",         unit: "%", field: "pcr_pct",         format: "percent" },
  { label: "Credit cost", unit: "%", field: "credit_cost_pct", format: "percent" },
];

const CAPITAL_METRICS: MetricRow[] = [
  { label: "CRAR",      unit: "%",    field: "crar_pct",          format: "percent" },
  { label: "Net worth", unit: "₹ Cr", field: "net_worth_inr_cr",  format: "currency" },
];

const OPERATIONS_METRICS: MetricRow[] = [
  { label: "Branches",          unit: "count",  field: "branches",                format: "number" },
  { label: "Employees",         unit: "count",  field: "employees",               format: "number" },
  { label: "Customers",         unit: "count",  field: "customers",               format: "number" },
  { label: "Avg ticket size",   unit: "₹ Lakh", field: "avg_ticket_size_inr_lakh", format: "currency", decimals: 1 },
  { label: "Disbursements",     unit: "₹ Cr",   field: "disbursements_inr_cr",    format: "currency" },
];

export function assembleReport(input: AssemblerInput, urlToTitle: Map<string, string>): AssembledReport {
  const subject = input.subjectCompany;
  // Merge each company's heterogeneous period rows into one canonical row per FY.
  // P&L from quarterly rows is dropped (quarter-only ≠ full-year). BS / ratios
  // fold across annual + Q4 since closing-balance is identical.
  const datasets: CompanyDataset[] = input.datasets.map((d) => ({
    ...d,
    financials: mergeFinancialsByFY(d.financials),
  }));
  const comparisonFYs = pickComparisonFYs(datasets);
  const asOfStr = input.asOfDate.toISOString().slice(0, 10);

  const charts: { title: string; ok: boolean }[] = [];
  const aumChart = buildAUMChart(datasets, subject);
  charts.push({ title: "AUM trend", ok: aumChart !== null });
  const patChart = buildPATChart(datasets, comparisonFYs.current, subject);
  charts.push({ title: `PAT ${fyLabel(comparisonFYs.current)}`, ok: patChart !== null });
  const gnpaChart = buildGNPAChart(datasets, subject);
  charts.push({ title: "GNPA over time", ok: gnpaChart !== null });
  const branchesChart = buildBranchesChart(datasets, comparisonFYs.current, subject);
  charts.push({ title: `Branches ${fyLabel(comparisonFYs.current)}`, ok: branchesChart !== null });
  const assetMixChart = buildAssetMixChart(datasets, comparisonFYs.current, subject);
  charts.push({ title: `Asset mix ${fyLabel(comparisonFYs.current)}`, ok: assetMixChart !== null });

  const sections: string[] = [];

  // Header
  sections.push(`# ${subject} vs Peers`);
  sections.push("");
  sections.push(`_As of ${asOfStr} · ${datasets.length} companies · ${datasets.reduce((s, d) => s + d.source_urls.length, 0)} primary sources · comparing ${fyLabel(comparisonFYs.current)} vs ${fyLabel(comparisonFYs.prior)}_`);
  sections.push("");

  // Executive summary (top of report)
  sections.push(buildExecutiveSummary(datasets, subject, comparisonFYs));

  // Coverage map
  sections.push(buildCoverageMap(datasets));

  // Comparative ranking — where subject sits across every metric
  const rankingTable = buildComparativeRanking(datasets, subject, comparisonFYs);
  if (rankingTable) sections.push(rankingTable);

  // Snapshot table + headline charts
  sections.push(buildMetricTable("Snapshot", SNAPSHOT_METRICS, datasets, comparisonFYs, { showYoY: true }));
  if (aumChart) sections.push(aumChart);
  if (patChart) sections.push(patChart);

  // Asset quality
  sections.push(buildMetricTable("Asset quality", ASSET_QUALITY_METRICS, datasets, comparisonFYs));
  if (gnpaChart) sections.push(gnpaChart);

  // Capital
  sections.push(buildMetricTable("Capital & liquidity", CAPITAL_METRICS, datasets, comparisonFYs));

  // Asset / customer / funding mix
  const assetMixTable = buildAssetMixTable(datasets, comparisonFYs);
  if (assetMixTable) {
    sections.push(assetMixTable);
    if (assetMixChart) sections.push(assetMixChart);
  }
  const customerMixTable = buildCustomerMixTable(datasets, comparisonFYs);
  if (customerMixTable) sections.push(customerMixTable);
  const fundingMixTable = buildFundingMixTable(datasets, comparisonFYs);
  if (fundingMixTable) sections.push(fundingMixTable);

  // Operations
  sections.push(buildMetricTable("Operations & reach", OPERATIONS_METRICS, datasets, comparisonFYs));
  if (branchesChart) sections.push(branchesChart);

  // Performance narrative
  sections.push(buildPerformanceSection(datasets));

  // Strategic moves — themed (capital raises / M&A / leadership / expansion / etc.)
  sections.push(buildThemedStrategicMoves(datasets));

  // Risk + outlook
  sections.push(buildRiskSection(datasets));

  // Sources
  sections.push(buildSourcesSection(datasets, urlToTitle));

  return { markdown: sections.join("\n"), charts };
}
