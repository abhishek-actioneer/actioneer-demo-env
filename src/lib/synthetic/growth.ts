/**
 * Business-shape volume generator.
 *
 * Single function that produces a row count for a given (syntheticDate, baseline,
 * tick-seeded RNG). Three behaviors compose:
 *   1. Compound growth — `+growthRatePerDay` per day from baseline
 *   2. Weekly seasonality — weekday peaks, weekend dip
 *   3. Daily noise — gaussian jitter
 *   4. Spike days — small probability of a campaign-bump multiplier
 *
 * Used by every table whose volume should "grow with the business" — bookings,
 * sessions, funnel, comms, ads, partners, surveys.
 *
 * Reproducibility: RNG is seeded by the tick handler from
 * (datasetId, tickIndex, tableName), so reset → re-burst always yields the
 * same sequence.
 */

import type { Rng } from "./rng";

export interface GrowthConfig {
  /** Row rate at baseline (day 0). Tune per-table to match seed average. */
  baselineRate: number;
  /** Compound daily growth rate. 0.005 = +0.5%/day ≈ 17%/month. */
  growthRatePerDay?: number;
  /** Sun..Sat multipliers. Default: weekend dip + Tue/Wed/Thu peak. */
  weekdayMultipliers?: [number, number, number, number, number, number, number];
  /** ±n*100% gaussian noise. Default 0.08 = ±8%. */
  noisePct?: number;
  /** Probability of a spike-day per tick. */
  spikeProbability?: number;
  /** Multiplier applied on a spike day. */
  spikeMultiplier?: number;
  /** Hard floor — never below this even with noise/multipliers. */
  minRows?: number;
}

const DEFAULT_WEEKDAY_MULT: [number, number, number, number, number, number, number] = [
  0.85, 1.00, 1.10, 1.10, 1.10, 1.00, 0.85,
];

export interface GrowthInputs {
  /** Synthetic date this tick is generating for. */
  syntheticDate: Date;
  /** Baseline date — typically dataset.dateRange.end. */
  baselineDate: Date;
  /** Seeded RNG for this tick × table. */
  rng: Rng;
}

export function dailyVolume(config: GrowthConfig, inputs: GrowthInputs): number {
  const {
    baselineRate,
    growthRatePerDay = 0.005,
    weekdayMultipliers = DEFAULT_WEEKDAY_MULT,
    noisePct = 0.08,
    spikeProbability = 0.05,
    spikeMultiplier = 1.25,
    minRows = 1,
  } = config;

  const days = Math.max(0, Math.round(
    (inputs.syntheticDate.getTime() - inputs.baselineDate.getTime()) / 86_400_000
  ));
  const dow = inputs.syntheticDate.getUTCDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;

  const trend = baselineRate * Math.pow(1 + growthRatePerDay, days);
  const seasonal = trend * weekdayMultipliers[dow];
  const noise = 1 + boxMullerGaussian(inputs.rng) * noisePct;
  const spike = inputs.rng.bool(spikeProbability) ? spikeMultiplier : 1;

  return Math.max(minRows, Math.round(seasonal * noise * spike));
}

/** Box-Muller approximation: returns ~N(0, 1). */
function boxMullerGaussian(rng: Rng): number {
  // Avoid log(0) by clamping
  const u1 = Math.max(rng.next(), 1e-9);
  const u2 = rng.next();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
