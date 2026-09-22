/**
 * Dataset-specific canvas prompt presets.
 * Shown as clickable chips in the PromptToCardInput when the canvas is open.
 */

export interface CanvasPreset {
  /** Short label shown on the chip */
  label: string;
  /** Full prompt submitted to the canvas query API */
  prompt: string;
}

const PRESTO_PRESETS: CanvasPreset[] = [
  {
    label: "D7/D30 LTV/CAC",
    prompt:
      "Using ltv_by_cohort joined with cac_by_month, show D7 LTV/CAC and D30 LTV/CAC ratios as a line chart for the last 8 install cohort months. Aggregate across all channels and countries. Compute avg_cpi as SUM(total_spend)/SUM(installs) from cac_by_month per install_month. From ltv_by_cohort compute four columns: d7_ltv_cac_actual = AVG(avg_projected_ltv WHERE days_from_cohort=7 AND is_observed=true) / avg_cpi, d7_ltv_cac_projected = AVG(avg_projected_ltv WHERE days_from_cohort=7 AND is_observed=false) / avg_cpi, d30_ltv_cac_actual = AVG(avg_projected_ltv WHERE days_from_cohort=30 AND is_observed=true) / avg_cpi, d30_ltv_cac_projected = AVG(avg_projected_ltv WHERE days_from_cohort=30 AND is_observed=false) / avg_cpi. Set each column to NULL when no rows match that condition. Return install_month (x-axis), then those 4 ratio columns. Order by install_month ASC.",
  },
  {
    label: "CPI Trend",
    prompt:
      "Using cac_by_month, show the blended CPI trend as a line chart for install cohort months 2025-07 through 2026-02. Compute avg_cpi = ROUND(SUM(total_spend) / NULLIF(SUM(installs), 0), 2) aggregated across all channels, countries, and OS per install_month. Return install_month on the x-axis and avg_cpi on the y-axis. Order by install_month ASC.",
  },
  {
    label: "CPI vs Spend",
    prompt:
      "Show a scatter chart of monthly CPI vs total ad spend by channel for install cohort months 2025-07 through 2026-02. Using cac_by_month, group by install_month and channel. Compute total_spend = SUM(total_spend) and avg_cpi = ROUND(SUM(total_spend)/NULLIF(SUM(installs),0), 2) per install_month × channel group. Return three columns: total_spend (x-axis), avg_cpi (y-axis), channel (label). Each row is one channel × install_month data point.",
  },
  {
    label: "D30/D7 LTV Ratio",
    prompt:
      "Using ltv_by_cohort, show the D30/D7 LTV ratio as a line chart by install_month. Compute avg_d7_ltv = AVG(avg_projected_ltv WHERE days_from_cohort=7) and avg_d30_ltv = AVG(avg_projected_ltv WHERE days_from_cohort=30 AND is_observed=true) grouped by install_month across all channels and countries. Only include install_month values where avg_d30_ltv is not null (i.e., D30 data is observed). Compute d30_d7_ltv_ratio = ROUND(avg_d30_ltv / NULLIF(avg_d7_ltv, 0), 3). Return install_month (x-axis) and d30_d7_ltv_ratio (y-axis). Order by install_month ASC.",
  },
  {
    label: "Payback Window",
    prompt:
      "Using payback_analysis, show the estimated payback window in days as a line chart for install cohort months 2025-07 through 2026-02. Aggregate across all channels and countries per install_month. Compute estimated_payback_days = ROUND(90.0 / NULLIF(AVG(payback_ratio_d90), 0)). Return install_month (x-axis) and estimated_payback_days (y-axis). Order by install_month ASC.",
  },
];

const PRESET_MAP: Record<string, CanvasPreset[]> = {
  presto: PRESTO_PRESETS,
};

export function getCanvasPresets(datasetId: string): CanvasPreset[] {
  return PRESET_MAP[datasetId] ?? [];
}
