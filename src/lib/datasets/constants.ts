/**
 * Client-safe dataset constants.
 *
 * This file must NOT import from ./index.ts or ./dynamic-registry.ts
 * because those use Node.js `fs` which cannot be bundled for client components.
 */
export const DEFAULT_DATASET = "vastu-hfc";
export const ACTIONEER_CDP_ENABLED = false;

/** Sample datasets auto-assigned to new users during onboarding. First entry is the active one. */
export const DEFAULT_SAMPLE_DATASETS = ["vastu-hfc", "fundsindia", "absli-life", "presto", "quickhelp", "healthians", "hdfc-creditfraud", "yesbank-cards", "flipkart-marketplace", "suvidha-capital", "healthplus"] as const;
export type SampleDatasetId = (typeof DEFAULT_SAMPLE_DATASETS)[number];
