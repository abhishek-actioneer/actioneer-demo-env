/**
 * Statistical significance testing for funnel breakdown comparisons.
 * Uses a z-test for two proportions (breakdown value vs overall).
 * No external dependencies — includes a normalCDF approximation.
 */

export interface SignificanceResult {
  pValue: number;
  confidence: number;
  isSignificant: boolean;
  insufficientData: boolean;
}

/**
 * Approximation of the standard normal CDF using the
 * Abramowitz and Stegun rational approximation (formula 26.2.17).
 */
function normalCDF(x: number): number {
  if (x < -8) return 0;
  if (x > 8) return 1;

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y =
    1.0 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);

  return 0.5 * (1.0 + sign * y);
}

/**
 * Compute statistical significance of a breakdown value's conversion rate
 * compared to the overall conversion rate using a two-proportion z-test.
 *
 * @param valueConversion  - Conversion rate of this breakdown value (as decimal, e.g. 0.22)
 * @param valueSampleSize  - Sample size for this breakdown value
 * @param overallConversion - Overall conversion rate (as decimal, e.g. 0.18)
 * @param overallSampleSize - Overall sample size
 */
export function computeSignificance(
  valueConversion: number,
  valueSampleSize: number,
  overallConversion: number,
  overallSampleSize: number,
): SignificanceResult {
  const insufficientResult: SignificanceResult = {
    pValue: 1,
    confidence: 0,
    isSignificant: false,
    insufficientData: true,
  };

  // Insufficient data check
  if (valueSampleSize < 30 || overallSampleSize < 30) {
    return insufficientResult;
  }

  const p = overallConversion;
  const pHat = valueConversion;

  // Edge case: if overall conversion is 0 or 1, SE is 0 — can't compute z
  if (p <= 0 || p >= 1) {
    return {
      pValue: 1,
      confidence: 0,
      isSignificant: false,
      insufficientData: false,
    };
  }

  const se = Math.sqrt((p * (1 - p)) / valueSampleSize);
  if (se === 0) {
    return { pValue: 1, confidence: 0, isSignificant: false, insufficientData: false };
  }

  const z = (pHat - p) / se;
  const pValue = 2 * (1 - normalCDF(Math.abs(z)));
  const confidence = 1 - pValue;
  const isSignificant = confidence > 0.95;

  return { pValue, confidence, isSignificant, insufficientData: false };
}
