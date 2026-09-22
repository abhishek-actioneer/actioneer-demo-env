/**
 * Shared types for the structured-extract competitor research pipeline.
 *
 * The pipeline shape:
 *   1. Multi-objective extract (4 objectives × N PDFs)  → ExtractedBundle
 *   2. Structured extractors (OpenAI per company, per objective) → CompanyDataset
 *   3. Deterministic report assembler (no LLM) → markdown + chart specs
 *   4. Narrative writer (OpenAI, final pass) → "Where ahead / behind" bullets
 *
 * Every numeric field can carry a Citation pointing to the source quote.
 */

import type { ExtractResult } from "@/lib/parallel-client";

// ── Stage 1: Multi-objective extract ──

export type ExtractObjective = "numbers" | "strategy" | "performance" | "risk_outlook" | "mix_and_geography";

export const EXTRACT_OBJECTIVES: ExtractObjective[] = ["numbers", "strategy", "performance", "risk_outlook", "mix_and_geography"];

export interface ExtractedBundle {
  /** Per-objective extract results, keyed by URL. */
  byObjective: Record<ExtractObjective, ExtractResult[]>;
  /** Map URL → company name for downstream grouping. */
  urlToCompany: Map<string, string>;
  /** Map URL → human-readable doc title. */
  urlToTitle: Map<string, string>;
}

// ── Stage 2: Structured per-company data ──

export interface Citation {
  quote: string;
  sourceUrl: string;
  sourceTitle?: string;
}

/** Numeric fact for one period (FY26, FY25, etc.). */
export interface PeriodFinancials {
  period: string;             // e.g. "FY26", "FY25", "FY24"
  // Balance sheet / scale
  aum_inr_cr?: number;
  disbursements_inr_cr?: number;
  net_worth_inr_cr?: number;
  // P&L
  total_income_inr_cr?: number;
  nii_inr_cr?: number;
  pat_inr_cr?: number;
  // Margins / returns
  nim_pct?: number;
  roa_pct?: number;
  roe_pct?: number;
  // Asset quality
  gnpa_pct?: number;
  nnpa_pct?: number;
  pcr_pct?: number;
  credit_cost_pct?: number;
  // Capital
  crar_pct?: number;
  // Operations
  branches?: number;
  employees?: number;
  customers?: number;
  avg_ticket_size_inr_lakh?: number;

  /** Per-field citations. Key is field name, value is the quote + source. */
  citations?: Partial<Record<keyof Omit<PeriodFinancials, "period" | "citations">, Citation>>;
}

export type StrategicMoveType =
  | "capital_raise"
  | "m_and_a"
  | "leadership"
  | "expansion"
  | "regulatory"
  | "product_launch"
  | "credit_rating"
  | "other";

export interface StrategicMove {
  date?: string;             // YYYY or YYYY-MM if known
  type: StrategicMoveType;
  description: string;       // 1-line summary
  detail?: string;           // optional 2-3 line elaboration
  citation?: Citation;
}

export interface PerformanceNarrative {
  growth_drivers: Array<{ description: string; citation?: Citation }>;
  segment_commentary: Array<{ segment?: string; description: string; citation?: Citation }>;
  guidance: Array<{ description: string; citation?: Citation }>;
  cohort_or_customer_notes: Array<{ description: string; citation?: Citation }>;
}

export interface RiskOutlook {
  risk_factors: Array<{ description: string; citation?: Citation }>;
  asset_quality_concerns: Array<{ description: string; citation?: Citation }>;
  headwinds: Array<{ description: string; citation?: Citation }>;
  outlook: Array<{ description: string; citation?: Citation }>;
}

/** Asset / loan-product mix at a point in time. Percentages, share of AUM. */
export interface AssetMix {
  period: string;
  home_loan_pct?: number;
  lap_pct?: number;
  msme_pct?: number;
  construction_pct?: number;
  other_pct?: number;
  citations?: Partial<Record<keyof Omit<AssetMix, "period" | "citations">, Citation>>;
}

/** Customer / borrower mix. Percentages. */
export interface CustomerMix {
  period: string;
  self_employed_pct?: number;
  salaried_pct?: number;
  formal_income_pct?: number;
  informal_income_pct?: number;
  rural_pct?: number;
  semi_urban_pct?: number;
  urban_pct?: number;
  citations?: Partial<Record<keyof Omit<CustomerMix, "period" | "citations">, Citation>>;
}

/** Geographic concentration — top 3 states with AUM share. */
export interface GeographicMix {
  period: string;
  top_states: Array<{ state: string; aum_share_pct?: number; branches?: number; citation?: Citation }>;
  states_total?: number;
  citation?: Citation;
}

/** Funding mix — borrowings by source. Percentages, sum should ~= 100. */
export interface FundingMix {
  period: string;
  bank_borrowings_pct?: number;
  ncds_pct?: number;
  nhb_refinance_pct?: number;
  securitization_pct?: number;
  ecb_pct?: number;
  other_pct?: number;
  weighted_avg_cost_pct?: number;
  citations?: Partial<Record<keyof Omit<FundingMix, "period" | "citations">, Citation>>;
}

export interface CompanyDataset {
  company: string;
  /** Financials per reporting period, ordered most-recent first. */
  financials: PeriodFinancials[];
  strategic_moves: StrategicMove[];
  performance: PerformanceNarrative;
  risk_outlook: RiskOutlook;
  asset_mix: AssetMix[];
  customer_mix: CustomerMix[];
  geographic_mix: GeographicMix[];
  funding_mix: FundingMix[];
  /** Doc URLs that contributed to this dataset. */
  source_urls: string[];
}

// ── Stage 3-4 (assembler + narrative) consume CompanyDataset[] directly. ──
