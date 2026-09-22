import { executeSQLInternal, executeSQLPrepared } from "./sql-executor";

const DATASET_ID = "fundsindia";

export type FundsIndiaFundRankMetric =
  | "return_1y"
  | "return_3y"
  | "return_5y"
  | "platform_investor_count"
  | "fi_star_rating";

export interface FundsIndiaFundRow {
  fundName: string;
  amcName: string;
  category: string;
  subcategory: string;
  riskLevel: string;
  return1y?: number;
  return3y?: number;
  return5y?: number;
  fiStarRating?: number;
  isFiSelect?: boolean;
  platformInvestorCount?: number;
}

export interface FundsIndiaFundLookupResult {
  matchedLabel: string;
  rankMetric: FundsIndiaFundRankMetric;
  funds: FundsIndiaFundRow[];
  error?: string;
}

export interface FundsIndiaFundUniverseSummary {
  totalFunds: number;
  totalAmcs: number;
  categories: Array<{
    category: string;
    fundCount: number;
    best3y?: number;
  }>;
  error?: string;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function boolValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  return undefined;
}

function formatFundRow(row: Record<string, unknown>): FundsIndiaFundRow {
  return {
    fundName: stringValue(row.fund_name),
    amcName: stringValue(row.amc_name),
    category: stringValue(row.category),
    subcategory: stringValue(row.subcategory),
    riskLevel: stringValue(row.risk_level),
    return1y: numberValue(row.return_1y),
    return3y: numberValue(row.return_3y),
    return5y: numberValue(row.return_5y),
    fiStarRating: numberValue(row.fi_star_rating),
    isFiSelect: boolValue(row.is_fi_select),
    platformInvestorCount: numberValue(row.platform_investor_count),
  };
}

export async function lookupFundsByQuery(
  query: string,
  rankBy: FundsIndiaFundRankMetric = "return_3y",
  limit = 3,
): Promise<FundsIndiaFundLookupResult> {
  const pattern = `%${query.toLowerCase().trim()}%`;
  const safeLimit = Math.max(1, Math.min(5, Math.floor(limit)));
  const result = await executeSQLPrepared(
    `SELECT fund_name, amc_name, category, subcategory, risk_level,
            return_1y, return_3y, return_5y, fi_star_rating, is_fi_select, platform_investor_count
     FROM raw_funds
     WHERE lower(fund_name) LIKE ?
        OR lower(category) LIKE ?
        OR lower(subcategory) LIKE ?
        OR lower(benchmark_index) LIKE ?
     ORDER BY ${rankBy} DESC NULLS LAST, fi_star_rating DESC NULLS LAST, platform_investor_count DESC NULLS LAST
     LIMIT ${safeLimit}`,
    [pattern, pattern, pattern, pattern],
    DATASET_ID,
  );
  return {
    matchedLabel: query,
    rankMetric: rankBy,
    funds: result.rows.map(formatFundRow).filter(r => r.fundName),
    error: result.error,
  };
}

export async function listFundCategories(): Promise<string> {
  const result = await executeSQLInternal(
    `SELECT category, COUNT(*) as cnt FROM raw_funds GROUP BY category ORDER BY cnt DESC`,
    DATASET_ID,
  );
  if (result.error || result.rows.length === 0) return "categories unavailable";
  return result.rows.map(r => String(r.category).toUpperCase()).join(", ");
}

export async function summarizeFundsIndiaFundUniverseForWhatsApp(): Promise<FundsIndiaFundUniverseSummary> {
  const totals = await executeSQLInternal(
    `SELECT
       COUNT(*) AS total_funds,
       COUNT(DISTINCT amc_name) AS total_amcs
     FROM raw_funds`,
    DATASET_ID,
  );
  const categories = await executeSQLInternal(
    `SELECT
       category,
       COUNT(*) AS fund_count,
       MAX(return_3y) AS best_3y
     FROM raw_funds
     GROUP BY category
     ORDER BY fund_count DESC, category`,
    DATASET_ID,
  );

  if (totals.error || categories.error) {
    return {
      totalFunds: 0,
      totalAmcs: 0,
      categories: [],
      error: totals.error ?? categories.error,
    };
  }

  const first = totals.rows[0] ?? {};
  return {
    totalFunds: numberValue(first.total_funds) ?? 0,
    totalAmcs: numberValue(first.total_amcs) ?? 0,
    categories: categories.rows.map((row) => ({
      category: stringValue(row.category),
      fundCount: numberValue(row.fund_count) ?? 0,
      best3y: numberValue(row.best_3y),
    })),
  };
}

function metricLabel(metric: FundsIndiaFundRankMetric): string {
  if (metric === "return_1y") return "1Y return";
  if (metric === "return_5y") return "5Y return";
  if (metric === "platform_investor_count") return "platform investor count";
  if (metric === "fi_star_rating") return "FI star rating";
  return "3Y return";
}

function percentage(value: number | undefined): string {
  return value === undefined ? "n/a" : `${value.toFixed(2).replace(/\.00$/, "")}%`;
}

function metricValue(fund: FundsIndiaFundRow, metric: FundsIndiaFundRankMetric): string {
  if (metric === "return_1y") return percentage(fund.return1y);
  if (metric === "return_5y") return percentage(fund.return5y);
  if (metric === "platform_investor_count") return String(fund.platformInvestorCount ?? "n/a");
  if (metric === "fi_star_rating") return `${fund.fiStarRating ?? "n/a"} star`;
  return percentage(fund.return3y);
}

function shortFundName(name: string): string {
  return name
    .replace(/\s*-\s*Regular\s*(Plan)?\s*-\s*Growth/gi, "")
    .replace(/\s*-\s*Regular\s*Growth/gi, "")
    .replace(/\s*-\s*Growth/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function renderFundsIndiaFundLookupReply(result: FundsIndiaFundLookupResult): string {
  if (result.error) {
    return "I could not read the fund data right now. I can still connect you to an advisor for a portfolio review.";
  }
  if (result.funds.length === 0) {
    return "I could not find matching funds in the FundsIndia sample data. Try asking by category, like ELSS, small cap, technology, debt, gold, or hybrid.";
  }

  const funds = result.funds.slice(0, 3).map((fund) => (
    `${shortFundName(fund.fundName)} (${metricValue(fund, result.rankMetric)}, ${fund.riskLevel.replace(/_/g, " ")} risk, ${fund.fiStarRating ?? "n/a"} star)`
  ));
  return [
    `Based on the FundsIndia sample data, top ${result.matchedLabel} by ${metricLabel(result.rankMetric)} are: ${funds.join("; ")}.`,
    "This is performance data, not a recommendation; suitability depends on your goal and risk profile.",
  ].join(" ");
}

export function renderFundsIndiaFundUniverseReply(summary: FundsIndiaFundUniverseSummary): string {
  if (summary.error) {
    return "I could not read the fund list right now. You can ask me for a specific category like ELSS, small cap, technology, debt, gold, or hybrid.";
  }
  const categories = summary.categories
    .slice(0, 7)
    .map((item) => item.category.toUpperCase())
    .join(", ");
  return `FundsIndia sample data has ${summary.totalFunds} mutual fund schemes across ${summary.totalAmcs} AMCs. Categories include ${categories}; ask for top funds by category, like technology, ELSS, small cap, debt, gold, or hybrid.`;
}
