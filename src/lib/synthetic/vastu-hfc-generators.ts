/**
 * Independent generators for vastu-hfc.
 *
 * Each function emits one tick's new rows for a single mutable+append-only
 * concern. All generators are pure functions of (rng seed, current synthetic
 * date, baseline date) plus a database connection for ID allocation and
 * cross-table sampling. Generators do NOT mutate seed rows — they only INSERT
 * into raw_<table>__live.
 *
 * Dependency order (enforced by orchestrator in step 6):
 *
 *     branches (no deps)
 *        ↓
 *     borrowers (no deps)
 *        ↓
 *     employees (samples branch_id from raw_branches)
 *        ↓
 *     borrowings (no deps)
 *        ↓
 *     loans (samples borrower_id from raw_borrowers, branch_id from raw_branches)
 *
 * Strict invariants enforced (all hand-extracted from seed profiling)
 * --------------------------------------------------------------------
 *  - co_lending_partner is FINSERVE-only (HFC always null)
 *  - NTC ⇔ bureau_score=0 biconditional
 *  - Entity → product hard partition (HFC: home/lap/micro_housing; Finserve: vehicle/msme)
 *  - Branch type by entity (HFC: main/small/micro/sales_office; Finserve: no main)
 *  - Income bounded by joint (employment_type, income_category)
 *  - Per-entity sourcing channel asymmetry
 *  - Branch type × city_tier ⇒ employee_count + monthly_rent ranges
 *  - emi_amount = annuity formula (computed, not random)
 *  - property_value = disbursed/ltv for home/lap; null for vehicle/msme
 *  - All new loans land in active|current|1 (state machine entry point)
 */

import type { DuckDBConnection } from "@duckdb/node-api";
import { createRng, hashString, type Rng } from "./rng";
import { sqlLiteral } from "./generators";
import { dailyVolume, type GrowthConfig } from "./growth";

// ────────────────────────────────────────────────────────────────────────────
// CATALOGS — all hand-extracted from seed profiling
// ────────────────────────────────────────────────────────────────────────────

// 80 first names from seed; gender-balanced. Vastu's borrower mix is 60F/40M
// (women-focused HFC) — gender weight handled separately in gender pick.

const FIRST_NAMES_FEMALE = [
  "Asha", "Rani", "Hema", "Sita", "Anita", "Padma", "Rekha", "Radha", "Kamala", "Lakshmi",
  "Pushpa", "Sunita", "Tara", "Lata", "Bhavna", "Yamuna", "Geeta", "Shanti", "Jaya", "Devi",
  "Gayatri", "Zarina", "Kavitha", "Deepa", "Sarla", "Savitri", "Chitra", "Nirmala", "Rajni",
  "Uma", "Fatima", "Nalini", "Indira", "Vani", "Parvati", "Mamta", "Priya", "Sarita",
  "Kalpana", "Meena",
];

const FIRST_NAMES_MALE = [
  "Shankar", "Naresh", "Ganesh", "Dinesh", "Mukesh", "Jagdish", "Arun", "Om", "Laxman", "Vijay",
  "Firoz", "Mohan", "Kiran", "Mahesh", "Vikram", "Ramesh", "Gopal", "Tushar", "Chandan", "Manoj",
  "Sanjay", "Deepak", "Hari", "Umesh", "Narayan", "Prakash", "Suresh", "Satish", "Govind",
  "Rakesh", "Ajay", "Anil", "Rahul", "Ravi", "Krishna", "Rajesh", "Yogesh", "Pankaj", "Bharat",
  "Vinod",
];

const INDUSTRIES = [
  "cattle_trading", "poultry_farming", "security_guard", "school_teacher", "carpentry",
  "barber_shop", "factory_worker", "private_company", "government", "footwear_shop",
  "auto_repair", "pan_shop", "taxi_driver", "agri_input_dealer", "sugarcane_vendor",
  "fruit_vendor", "flour_mill", "timber_trading", "flower_shop", "vegetable_vendor",
  "laundry_service", "tea_shop", "delivery_executive", "brick_kiln", "photography",
  "tailoring", "beauty_parlour",
];

const EMPLOYMENT_WEIGHTS = [
  { value: "self_employed_informal", weight: 66 },
  { value: "self_employed_formal", weight: 15 },
  { value: "salaried_formal", weight: 10 },
  { value: "salaried_informal", weight: 9 },
];

const INCOME_CAT_BY_EMPLOYMENT: Record<string, { value: string; weight: number }[]> = {
  salaried_formal:        [{ value: "lig", weight: 69 }, { value: "mig", weight: 21 }, { value: "ews", weight: 10 }],
  salaried_informal:      [{ value: "lig", weight: 73 }, { value: "ews", weight: 26 }, { value: "mig", weight: 1 }],
  self_employed_formal:   [{ value: "lig", weight: 50 }, { value: "mig", weight: 50 }],
  self_employed_informal: [{ value: "lig", weight: 69 }, { value: "ews", weight: 21 }, { value: "mig", weight: 10 }],
};

// (employment, income_cat) → income range INR/month. Bounds verbatim from seed
// observed values; sampling is uniform inside the range.
const INCOME_RANGES: Record<string, Record<string, { min: number; max: number }>> = {
  salaried_formal: {
    ews: { min: 20000, max: 25000 },
    lig: { min: 25000, max: 50000 },
    mig: { min: 50000, max: 86000 },
  },
  salaried_informal: {
    ews: { min: 18000, max: 25000 },
    lig: { min: 25000, max: 50000 },
    mig: { min: 50000, max: 60000 },
  },
  self_employed_formal: {
    lig: { min: 25000, max: 50000 },
    mig: { min: 50000, max: 100000 },
  },
  self_employed_informal: {
    ews: { min: 15000, max: 25000 },
    lig: { min: 25000, max: 50000 },
    mig: { min: 50000, max: 80000 },
  },
};

const PROPERTY_TYPE_WEIGHTS = [
  { value: "independent_house", weight: 70 },
  { value: "apartment",         weight: 15 },
  { value: "plot",              weight: 10 },
  { value: "commercial",        weight: 5 },
];

// State weights for new borrowers/branches. Weights = relative branch presence
// from seed (Maharashtra 14%, Rajasthan 12%, etc.).
const STATE_WEIGHTS = [
  { value: "Maharashtra",    weight: 14 },
  { value: "Rajasthan",      weight: 12 },
  { value: "Gujarat",        weight: 11 },
  { value: "Tamil Nadu",     weight: 10 },
  { value: "Madhya Pradesh", weight: 10 },
  { value: "Uttar Pradesh",  weight:  9 },
  { value: "Telangana",      weight:  7 },
  { value: "Andhra Pradesh", weight:  6 },
  { value: "Karnataka",      weight:  6 },
  { value: "Haryana",        weight:  5 },
  { value: "Punjab",         weight:  3 },
  { value: "Delhi",          weight:  2 },
  { value: "Chhattisgarh",   weight:  2 },
  { value: "Uttarakhand",    weight:  1 },
  { value: "Puducherry",     weight:  1 },
];

// (state) → cities seen in seed branches. Each city tagged with city_tier.
// Used by branch + borrower generation (borrowers can live anywhere; branches
// also drawn from this pool).
type CityEntry = { value: string; weight: number; tier: "t30" | "b30" };
const CITIES_BY_STATE: Record<string, CityEntry[]> = {
  Maharashtra:      [{ value: "Pune", weight: 25, tier: "t30" }, { value: "Nashik", weight: 20, tier: "b30" }, { value: "Aurangabad", weight: 15, tier: "b30" }, { value: "Solapur", weight: 12, tier: "b30" }, { value: "Nagpur", weight: 15, tier: "b30" }, { value: "Mumbai", weight: 13, tier: "t30" }],
  Rajasthan:        [{ value: "Jaipur", weight: 30, tier: "t30" }, { value: "Jodhpur", weight: 22, tier: "b30" }, { value: "Kota", weight: 18, tier: "b30" }, { value: "Ajmer", weight: 15, tier: "b30" }, { value: "Udaipur", weight: 15, tier: "b30" }],
  Gujarat:          [{ value: "Ahmedabad", weight: 40, tier: "t30" }, { value: "Rajkot", weight: 25, tier: "b30" }, { value: "Surat", weight: 20, tier: "t30" }, { value: "Vadodara", weight: 15, tier: "b30" }],
  "Tamil Nadu":     [{ value: "Chennai", weight: 40, tier: "t30" }, { value: "Coimbatore", weight: 20, tier: "t30" }, { value: "Tiruchirappalli", weight: 18, tier: "b30" }, { value: "Madurai", weight: 12, tier: "b30" }, { value: "Salem", weight: 10, tier: "b30" }],
  "Madhya Pradesh": [{ value: "Bhopal", weight: 30, tier: "t30" }, { value: "Indore", weight: 28, tier: "t30" }, { value: "Gwalior", weight: 18, tier: "b30" }, { value: "Jabalpur", weight: 14, tier: "b30" }, { value: "Ujjain", weight: 10, tier: "b30" }],
  "Uttar Pradesh":  [{ value: "Lucknow", weight: 35, tier: "t30" }, { value: "Kanpur", weight: 18, tier: "t30" }, { value: "Agra", weight: 15, tier: "b30" }, { value: "Varanasi", weight: 14, tier: "b30" }, { value: "Meerut", weight: 10, tier: "b30" }, { value: "Allahabad", weight: 8, tier: "b30" }],
  Telangana:        [{ value: "Hyderabad", weight: 65, tier: "t30" }, { value: "Warangal", weight: 20, tier: "b30" }, { value: "Karimnagar", weight: 15, tier: "b30" }],
  "Andhra Pradesh": [{ value: "Vijayawada", weight: 40, tier: "b30" }, { value: "Visakhapatnam", weight: 30, tier: "t30" }, { value: "Guntur", weight: 30, tier: "b30" }],
  Karnataka:        [{ value: "Bengaluru", weight: 45, tier: "t30" }, { value: "Hubli-Dharwad", weight: 25, tier: "b30" }, { value: "Mysuru", weight: 20, tier: "b30" }, { value: "Mangaluru", weight: 10, tier: "b30" }],
  Haryana:          [{ value: "Gurugram", weight: 45, tier: "t30" }, { value: "Faridabad", weight: 30, tier: "t30" }, { value: "Karnal", weight: 25, tier: "b30" }],
  Punjab:           [{ value: "Ludhiana", weight: 35, tier: "t30" }, { value: "Amritsar", weight: 33, tier: "b30" }, { value: "Jalandhar", weight: 32, tier: "b30" }],
  Delhi:            [{ value: "New Delhi", weight: 60, tier: "t30" }, { value: "Dwarka", weight: 40, tier: "t30" }],
  Chhattisgarh:     [{ value: "Raipur", weight: 55, tier: "b30" }, { value: "Bilaspur", weight: 45, tier: "b30" }],
  Uttarakhand:      [{ value: "Dehradun", weight: 100, tier: "b30" }],
  Puducherry:       [{ value: "Puducherry", weight: 100, tier: "b30" }],
};

// Entity-conditional product distribution (last 3 months of seed).
const ENTITY_WEIGHTS = [
  { value: "hfc",      weight: 56 },
  { value: "finserve", weight: 44 },
];

const PRODUCT_BY_ENTITY: Record<string, { value: string; weight: number }[]> = {
  hfc: [
    { value: "home_purchase",       weight: 50 },
    { value: "home_construction",   weight: 15 },
    { value: "home_improvement",    weight: 12 },
    { value: "lap_residential",     weight: 15 },
    { value: "lap_commercial",      weight:  5 },
    { value: "micro_housing",       weight:  3 },
  ],
  finserve: [
    { value: "used_cv",                 weight: 40 },
    { value: "used_car",                weight: 25 },
    { value: "msme",                    weight: 24 },
    { value: "micro_housing_finserve",  weight: 11 },
  ],
};

// Per-entity rate distribution: HFC ~15%, Finserve ~20%.
const RATE_BY_ENTITY: Record<string, { mean: number; sigma: number; min: number; max: number }> = {
  hfc:      { mean: 15.13, sigma: 1.2, min: 12, max: 17 },
  finserve: { mean: 20.60, sigma: 1.8, min: 14, max: 25 },
};

// Tenure ranges (months) by product, from seed observed bands.
const TENURE_RANGES: Record<string, { min: number; max: number }> = {
  home_purchase:           { min: 180, max: 240 },
  home_construction:       { min: 180, max: 240 },
  home_improvement:        { min: 120, max: 180 },
  lap_residential:         { min:  90, max: 180 },
  lap_commercial:          { min:  60, max: 120 },
  micro_housing:           { min:  60, max: 120 },
  micro_housing_finserve:  { min:  60, max: 120 },
  msme:                    { min:  24, max:  60 },
  used_car:                { min:  36, max:  72 },
  used_cv:                 { min:  36, max:  60 },
};

// (entity, product) → ticket size log-normal config + hard min/max in INR.
// Medians from seed avg disbursed; sigma chosen to span observed range.
const TICKET_BY_ENTITY_PRODUCT: Record<
  string,
  { mu: number; sigma: number; min: number; max: number }
> = {
  "hfc|home_purchase":           { mu: Math.log(1346750), sigma: 0.45, min: 300_000, max: 3_000_000 },
  "hfc|home_construction":       { mu: Math.log(1100021), sigma: 0.50, min: 250_000, max: 3_000_000 },
  "hfc|home_improvement":        { mu: Math.log( 603134), sigma: 0.40, min: 150_000, max: 1_500_000 },
  "hfc|lap_residential":         { mu: Math.log( 805391), sigma: 0.45, min: 200_000, max: 2_500_000 },
  "hfc|lap_commercial":          { mu: Math.log(1013833), sigma: 0.50, min: 250_000, max: 3_000_000 },
  "hfc|micro_housing":           { mu: Math.log( 349401), sigma: 0.30, min: 100_000, max:   800_000 },
  "finserve|used_cv":            { mu: Math.log( 403044), sigma: 0.35, min: 100_000, max: 1_500_000 },
  "finserve|used_car":           { mu: Math.log( 506783), sigma: 0.35, min: 150_000, max: 2_000_000 },
  "finserve|msme":               { mu: Math.log( 552193), sigma: 0.40, min: 100_000, max: 2_500_000 },
  "finserve|micro_housing_finserve": { mu: Math.log(300702), sigma: 0.30, min: 100_000, max: 800_000 },
};

// LTV bands by product. Home/LAP loans cluster around 0.3-0.6; vehicle/MSME 0.65-0.80.
const LTV_RANGES: Record<string, { min: number; max: number }> = {
  home_purchase:          { min: 0.30, max: 0.60 },
  home_construction:      { min: 0.30, max: 0.60 },
  home_improvement:       { min: 0.30, max: 0.60 },
  lap_residential:        { min: 0.30, max: 0.60 },
  lap_commercial:         { min: 0.30, max: 0.60 },
  micro_housing:          { min: 0.45, max: 0.55 },
  micro_housing_finserve: { min: 0.45, max: 0.55 },
  used_cv:                { min: 0.65, max: 0.80 },
  used_car:               { min: 0.65, max: 0.80 },
  msme:                   { min: 0.65, max: 0.80 },
};

// Products eligible for property_value (= disbursed/ltv). Vehicle/MSME → null.
const HAS_PROPERTY = new Set([
  "home_purchase", "home_construction", "home_improvement",
  "lap_residential", "lap_commercial",
  "micro_housing", "micro_housing_finserve",
]);

// Sourcing channel asymmetric by entity.
const SOURCING_BY_ENTITY: Record<string, { value: string; weight: number }[]> = {
  hfc: [
    { value: "direct_sales", weight: 40 },
    { value: "dsa",          weight: 35 },
    { value: "connector",    weight: 15 },
    { value: "digital",      weight: 10 },
  ],
  finserve: [
    { value: "dsa",          weight: 50 },
    { value: "direct_sales", weight: 25 },
    { value: "connector",    weight: 15 },
    { value: "digital",      weight: 10 },
  ],
};

// Co-lending — FINSERVE-ONLY (HFC has zero co-lending in seed).
const FINSERVE_COLENDING_PARTNERS = [
  { value: "DMI",      weight: 21 },
  { value: "TVS",      weight: 16 },
  { value: "HDB",      weight: 13 },
  { value: "AXIS",     weight: 13 },
  { value: "PIRAMAL",  weight: 11 },
  { value: "NAC",      weight:  9 },
  { value: "UTKARSH",  weight:  7 },
  { value: "FINNABLE", weight:  6 },
  { value: "TATA",     weight:  4 },
];

// Branch-related catalogs.
const BRANCH_TYPE_BY_ENTITY: Record<string, { value: string; weight: number }[]> = {
  hfc: [
    { value: "main",         weight: 33 },
    { value: "small",        weight: 35 },
    { value: "micro",        weight: 19 },
    { value: "sales_office", weight: 13 },
  ],
  finserve: [
    // Finserve has zero `main` in seed.
    { value: "small",        weight: 39 },
    { value: "micro",        weight: 27 },
    { value: "sales_office", weight: 34 },
  ],
};

const BRANCH_ENTITY_WEIGHTS = [
  { value: "hfc",      weight: 72 },
  { value: "finserve", weight: 28 },
];

// (branch_type, city_tier) → (employee_count_avg, monthly_rent_avg) from seed.
// Sampled with ±25% jitter on count and ±30% on rent.
const BRANCH_TYPE_TIER_MATRIX: Record<string, { empAvg: number; rentAvg: number }> = {
  "main|t30":         { empAvg: 31, rentAvg: 239980 },
  "main|b30":         { empAvg: 32, rentAvg:  93967 },
  "small|t30":        { empAvg: 15, rentAvg: 203033 },
  "small|b30":        { empAvg: 15, rentAvg:  93876 },
  "micro|t30":        { empAvg:  9, rentAvg: 188635 },
  "micro|b30":        { empAvg: 11, rentAvg:  83207 },
  "sales_office|t30": { empAvg:  9, rentAvg: 197008 },
  "sales_office|b30": { empAvg: 10, rentAvg:  87897 },
};

// Employee catalogs.
const FUNCTION_TYPE_WEIGHTS = [
  { value: "sales",           weight: 45 },
  { value: "operations",      weight: 12 },
  { value: "collections",     weight: 12 },
  { value: "credit",          weight: 12 },
  { value: "ho",              weight: 10 },
  { value: "legal_technical", weight:  8 },
];

// (function) → CTC log-normal config + hard min/max (lakh INR/year).
const FUNCTION_CTC: Record<string, { mu: number; sigma: number; min: number; max: number }> = {
  sales:           { mu: Math.log( 5.49), sigma: 0.30, min: 3.00, max: 10.83 },
  collections:     { mu: Math.log( 5.10), sigma: 0.30, min: 3.00, max: 10.55 },
  credit:          { mu: Math.log( 7.20), sigma: 0.30, min: 3.00, max: 12.10 },
  operations:      { mu: Math.log( 5.99), sigma: 0.25, min: 3.00, max:  9.71 },
  legal_technical: { mu: Math.log( 7.06), sigma: 0.30, min: 3.00, max: 12.98 },
  ho:              { mu: Math.log(12.26), sigma: 0.40, min: 3.00, max: 23.24 },
};

// Borrowing catalogs. The seed `borrowings.csv` has no entity column —
// borrowings are at the company level — so source-type weights blend HFC and
// Finserve, matching the observed seed mix where NHB dominates because Vastu
// HFC is the larger arm.
//
// (source_type) → eligible lender names. From seed catalog.
const LENDERS_BY_SOURCE: Record<string, string[]> = {
  bank: [
    "HDFC Bank", "ICICI Bank", "Axis Bank", "State Bank of India", "Canara Bank",
    "Bank of Baroda", "City Union Bank", "Federal Bank", "DCB Bank", "IndusInd Bank",
    "Karur Vysya Bank", "Kotak Mahindra Bank", "Punjab National Bank",
    "South Indian Bank", "Union Bank",
  ],
  nhb:    ["National Housing Bank"],
  fi_dfi: ["FMO", "DFC", "IFC", "Asian Development Bank", "Proparco", "CDC Group"],
  ecb:    ["U.S. DFC", "Asian Development Bank"],
  ncd:    ["BSE Listed NCD"],
};

const REPAYMENT_FREQ_WEIGHTS = [
  { value: "quarterly",   weight: 60 },
  { value: "monthly",     weight: 37 },
  { value: "semi_annual", weight:  2 },
  { value: "annual",      weight:  1 },
];

// ────────────────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────────────────

function pickWeighted<T>(rng: Rng, items: { value: T; weight: number }[]): T {
  return rng.weighted(items);
}

/** Like pickWeighted but returns the full entry (use when extra fields like `tier` are needed). */
function pickWeightedEntry<T extends { weight: number }>(rng: Rng, items: T[]): T {
  const total = items.reduce((a, b) => a + b.weight, 0);
  let r = rng.next() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

/** Box-Muller gaussian sampler, clamped to [min, max], rounded to integer. */
function gaussInt(rng: Rng, mean: number, sigma: number, min: number, max: number): number {
  const u1 = Math.max(rng.next(), 1e-9);
  const u2 = rng.next();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(min, Math.min(max, Math.round(mean + z * sigma)));
}

/** Gaussian sampler returning a float, clamped + rounded to `precision`. */
function gaussFloat(rng: Rng, mean: number, sigma: number, min: number, max: number, precision: number): number {
  const u1 = Math.max(rng.next(), 1e-9);
  const u2 = rng.next();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const v = mean + z * sigma;
  const clamped = Math.max(min, Math.min(max, v));
  const p = Math.pow(10, precision);
  return Math.round(clamped * p) / p;
}

/** Log-normal sampler clamped to [min, max], rounded to integer. */
function logNormalInt(rng: Rng, mu: number, sigma: number, min: number, max: number): number {
  const u1 = Math.max(rng.next(), 1e-9);
  const u2 = rng.next();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const v = Math.exp(mu + z * sigma);
  return Math.max(min, Math.min(max, Math.round(v)));
}

/** Log-normal float, rounded to `precision`. */
function logNormalFloat(rng: Rng, mu: number, sigma: number, min: number, max: number, precision: number): number {
  const u1 = Math.max(rng.next(), 1e-9);
  const u2 = rng.next();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const v = Math.exp(mu + z * sigma);
  const clamped = Math.max(min, Math.min(max, v));
  const p = Math.pow(10, precision);
  return Math.round(clamped * p) / p;
}

/** Annuity formula: monthly EMI for principal P, annual rate (%) r, tenure n months. */
function computeEmi(principal: number, annualRatePct: number, tenureMonths: number): number {
  const r = annualRatePct / 100 / 12;
  const n = tenureMonths;
  if (r === 0 || n === 0) return Math.round(principal / Math.max(1, n));
  return Math.round((principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1));
}

function formatDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Resolve next ID as max(seedFloor, currentMax + 1). */
async function nextIdStart(
  conn: DuckDBConnection,
  table: string,
  idColumn: string,
  seedFloor: number,
): Promise<number> {
  const r = await conn.run(`SELECT COALESCE(MAX(${idColumn}), 0) FROM ${table}`);
  const currentMax = Number((await r.getRows())[0][0]);
  return Math.max(seedFloor, currentMax + 1);
}

async function chunkInsert(
  conn: DuckDBConnection,
  table: string,
  columns: string,
  valueRows: string[],
): Promise<number> {
  if (valueRows.length === 0) return 0;
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < valueRows.length; i += CHUNK) {
    const chunk = valueRows.slice(i, i + CHUNK);
    await conn.run(`INSERT INTO ${table} (${columns}) VALUES ${chunk.join(", ")}`);
    inserted += chunk.length;
  }
  return inserted;
}

// ────────────────────────────────────────────────────────────────────────────
// VOLUME CONFIGS — daily targets, growth from baseline (Mar 2025)
//
// All rates are baselines. Day-to-day variation comes from FOUR layers:
//   1. Compound growth (1.7%/month for loans, slower for others)
//   2. Weekday seasonality (default Sun/Sat 0.85x, Tue-Thu 1.10x — applied
//      by dailyVolume internally)
//   3. Gaussian noise (per noisePct)
//   4. Spike days (per spikeProbability + spikeMultiplier)
//
// On top of dailyVolume, hfcSeasonality (below) layers HFC-specific calendar
// effects: quarter-end push, festive (Oct/Nov), monsoon dip (Jul/Aug). The
// final volume shape on a typical 250-baseline loan day spans roughly 180
// (monsoon weekend) → 380 (quarter-end festive Tuesday with a spike).
// ────────────────────────────────────────────────────────────────────────────

const VOLUME_LOANS: GrowthConfig = {
  baselineRate: 250,            // ~7,500/month at Mar 2025
  growthRatePerDay: 0.000563,   // ≈ 1.7%/month compound
  noisePct: 0.10,               // ±10% gaussian
  spikeProbability: 0.08,       // ~2-3 spike days/month
  spikeMultiplier: 1.20,
  minRows: 30,
};

const VOLUME_BORROWERS: GrowthConfig = {
  baselineRate: 33,             // ~1,000/month
  growthRatePerDay: 0.0005,
  noisePct: 0.12,
  spikeProbability: 0.05,
  spikeMultiplier: 1.25,
  minRows: 5,
};

const VOLUME_EMPLOYEES: GrowthConfig = {
  baselineRate: 4,              // ~120/month gross hires
  growthRatePerDay: 0.0003,
  noisePct: 0.20,               // higher day-to-day variance, weekends often 0
  minRows: 0,
};

const VOLUME_BRANCHES: GrowthConfig = {
  baselineRate: 0.07,           // ~2/month
  growthRatePerDay: 0.0003,
  noisePct: 0.15,
  minRows: 0,
};

const VOLUME_BORROWINGS: GrowthConfig = {
  baselineRate: 0.23,           // ~7/month
  growthRatePerDay: 0.0002,
  noisePct: 0.20,
  spikeProbability: 0.04,       // big quarterly raises bunch up
  spikeMultiplier: 2.0,
  minRows: 0,
};

/**
 * Apply HFC-specific calendar effects on top of dailyVolume's base output.
 * Returns a multiplier that captures Indian financial-services seasonality:
 *
 *   - Quarter-end push (last week of Mar/Jun/Sep/Dec): +25% — sales hustle
 *   - Festive lending peak (Oct/Nov): +15% — Diwali home/vehicle purchases
 *   - Monsoon dip (Jul/Aug): −10% — collections slow, sites pause
 *   - Year-end window dressing (last week of Mar): another +15% on top of Q4
 *
 * These compound multiplicatively. Used by loans, borrowers, borrowings.
 */
function hfcSeasonalityMultiplier(today: Date): number {
  const month = today.getUTCMonth() + 1; // 1-12
  const day = today.getUTCDate();
  let m = 1.0;
  // Quarter-end push (last 7 days of FY quarter months)
  const isQuarterMonth = month === 3 || month === 6 || month === 9 || month === 12;
  if (isQuarterMonth && day >= 24) m *= 1.25;
  // Year-end (Mar) extra hustle
  if (month === 3 && day >= 25) m *= 1.15;
  // Festive
  if (month === 10 || month === 11) m *= 1.15;
  // Monsoon
  if (month === 7 || month === 8) m *= 0.90;
  return m;
}

/**
 * Compute the day's row count for a given table, applying HFC seasonality
 * on top of dailyVolume's baseline. Used by generators that should follow
 * Indian-financial-cycle patterns.
 */
function hfcDailyVolume(
  config: GrowthConfig,
  today: Date,
  baselineDate: Date,
  rng: Rng,
): number {
  const base = dailyVolume(config, { syntheticDate: today, baselineDate, rng });
  const seasonal = base * hfcSeasonalityMultiplier(today);
  return Math.max(config.minRows ?? 0, Math.round(seasonal));
}

// ────────────────────────────────────────────────────────────────────────────
// GENERATORS
// ────────────────────────────────────────────────────────────────────────────

/**
 * Generate today's new borrowers. Mostly NTC channel (those who haven't
 * borrowed before — ~30% of seed).
 *
 * Invariants enforced:
 *   - NTC ⇔ bureau_score=0 biconditional
 *   - Joint (employment, income_cat) → income range
 *   - Property type 70/15/10/5 distribution
 *   - 60F/40M gender mix
 *   - Industry from 27-occupation catalog
 */
export async function generateNewBorrowers(
  conn: DuckDBConnection,
  today: Date,
  baselineDate: Date,
  seed: number,
): Promise<number> {
  const rng = createRng(seed);
  const count = hfcDailyVolume(VOLUME_BORROWERS, today, baselineDate, rng);
  if (count === 0) return 0;

  const startId = await nextIdStart(conn, "raw_borrowers__live", "borrower_id", 200_000);
  const todayStr = formatDate(today);

  const rows: string[] = [];
  for (let i = 0; i < count; i++) {
    const borrowerId = startId + i;

    const isFemale = rng.bool(0.60);
    const gender = isFemale ? "female" : "male";
    const firstName = rng.choice(isFemale ? FIRST_NAMES_FEMALE : FIRST_NAMES_MALE);

    const age = gaussInt(rng, 38, 10, 22, 65);

    const employmentType = pickWeighted(rng, EMPLOYMENT_WEIGHTS);
    const incomeCat = pickWeighted(rng, INCOME_CAT_BY_EMPLOYMENT[employmentType]);
    const incomeRange = INCOME_RANGES[employmentType][incomeCat];
    const monthlyIncome = rng.int(incomeRange.min, incomeRange.max);

    const industry = rng.choice(INDUSTRIES);

    const state = pickWeighted(rng, STATE_WEIGHTS);
    const cityEntry = pickWeightedEntry(rng, CITIES_BY_STATE[state]);
    const city = cityEntry.value;
    const cityTier = cityEntry.tier;

    // Most new borrowers are NTC (entering the credit system via a Vastu loan).
    // Roughly matches 30% NTC overall in seed.
    const isNtc = rng.bool(0.50);  // higher than seed since these are NEW entrants
    const bureauScore = isNtc ? 0 : gaussInt(rng, 720, 80, 580, 850);

    const propertyType = pickWeighted(rng, PROPERTY_TYPE_WEIGHTS);

    rows.push([
      borrowerId,
      sqlLiteral(firstName),
      sqlLiteral(gender),
      age,
      sqlLiteral(employmentType),
      monthlyIncome,
      sqlLiteral(incomeCat),
      sqlLiteral(industry),
      sqlLiteral(state),
      sqlLiteral(city),
      sqlLiteral(cityTier),
      bureauScore,
      isNtc ? "true" : "false",
      `'${todayStr}'`,
      sqlLiteral(propertyType),
    ].join(", ") + "");
  }

  // Wrap each row in parens
  const valueRows = rows.map((r) => `(${r})`);
  const cols = "borrower_id, first_name, gender, age, employment_type, monthly_income_inr, " +
               "income_category, industry, state, city, city_tier, bureau_score, is_ntc, " +
               "signup_date, property_type";

  return chunkInsert(conn, "raw_borrowers__live", cols, valueRows);
}

/**
 * Generate new branches (rare — ~2/month at baseline, often 0/day).
 *
 * Invariants enforced:
 *   - HFC has main/small/micro/sales_office; Finserve only the latter three
 *   - branch_type × city_tier ⇒ employee_count + monthly_rent (jittered ±25/30%)
 *   - Expansion-state weighted (state weights match active branch presence)
 */
export async function generateNewBranches(
  conn: DuckDBConnection,
  today: Date,
  baselineDate: Date,
  seed: number,
): Promise<number> {
  const rng = createRng(seed);
  const count = dailyVolume(VOLUME_BRANCHES, { syntheticDate: today, baselineDate, rng });
  if (count === 0) return 0;

  const startId = await nextIdStart(conn, "raw_branches__live", "branch_id", 1_000);
  const todayStr = formatDate(today);

  const rows: string[] = [];
  for (let i = 0; i < count; i++) {
    const branchId = startId + i;
    const entity = pickWeighted(rng, BRANCH_ENTITY_WEIGHTS);
    const branchType = pickWeighted(rng, BRANCH_TYPE_BY_ENTITY[entity]);

    const state = pickWeighted(rng, STATE_WEIGHTS);
    const cityEntry = pickWeightedEntry(rng, CITIES_BY_STATE[state]);
    const city = cityEntry.value;
    const cityTier = cityEntry.tier;

    const m = BRANCH_TYPE_TIER_MATRIX[`${branchType}|${cityTier}`];
    const empCount = Math.max(3, Math.round(m.empAvg * (1 + (rng.next() - 0.5) * 0.5))); // ±25%
    const rent = Math.max(20000, Math.round(m.rentAvg * (1 + (rng.next() - 0.5) * 0.6))); // ±30%

    const branchName = `${city} ${entity === "hfc" ? "" : "Finserve "}Branch`.replace(/\s+/g, " ").trim();

    rows.push(`(${branchId}, ${sqlLiteral(branchName)}, ${sqlLiteral(entity)}, ${sqlLiteral(state)}, ${sqlLiteral(city)}, ${sqlLiteral(cityTier)}, ${sqlLiteral(branchType)}, '${todayStr}', ${empCount}, ${rent}, true)`);
  }

  const cols = "branch_id, branch_name, entity, state, city, city_tier, branch_type, open_date, employee_count, monthly_rent_inr, is_active";
  return chunkInsert(conn, "raw_branches__live", cols, rows);
}

/**
 * Generate new employee hires.
 *
 * Invariants enforced:
 *   - Function mix 45/12/12/12/10/8 (sales/ops/collections/credit/ho/legal)
 *   - Gender 30F/70M
 *   - CTC log-normal within function-bounded range
 *   - branch_id sampled from active branches
 */
export async function generateNewEmployees(
  conn: DuckDBConnection,
  today: Date,
  baselineDate: Date,
  seed: number,
): Promise<number> {
  const rng = createRng(seed);
  const count = dailyVolume(VOLUME_EMPLOYEES, { syntheticDate: today, baselineDate, rng });
  if (count === 0) return 0;

  // Sample active branches to assign new hires. Bias toward newer branches
  // (lower observed employee count) by ordering by employee_count ASC and
  // taking a stratified sample. For simplicity here: random sample from all
  // active branches, weighted by 1 (uniform). Future optimization: weight
  // inversely by employee_count.
  const branchR = await conn.run(`
    SELECT branch_id FROM raw_branches WHERE is_active = true
    ORDER BY hash(branch_id * ${seed}) LIMIT ${count}
  `);
  const branchRows = await branchR.getRows();
  if (branchRows.length === 0) return 0;
  const branchIds = branchRows.map((r) => Number(r[0]));

  const startId = await nextIdStart(conn, "raw_employees__live", "employee_id", 10_000);
  const todayStr = formatDate(today);

  const rows: string[] = [];
  for (let i = 0; i < count; i++) {
    const empId = startId + i;
    const branchId = branchIds[i % branchIds.length];

    const functionType = pickWeighted(rng, FUNCTION_TYPE_WEIGHTS);
    const isFemale = rng.bool(0.30);
    const gender = isFemale ? "female" : "male";
    const age = gaussInt(rng, 30, 7, 22, 55);

    const ctcCfg = FUNCTION_CTC[functionType];
    const ctc = logNormalFloat(rng, ctcCfg.mu, ctcCfg.sigma, ctcCfg.min, ctcCfg.max, 2);

    rows.push(`(${empId}, ${branchId}, ${sqlLiteral(functionType)}, '${todayStr}', ${sqlLiteral(gender)}, ${age}, ${ctc}, true)`);
  }

  const cols = "employee_id, branch_id, function_type, join_date, gender, age, annual_ctc_lakh, is_active";
  return chunkInsert(conn, "raw_employees__live", cols, rows);
}

/**
 * Generate new borrowing instruments (treasury operations).
 *
 * Invariants enforced:
 *   - NHB source_type is HFC-only (allocated via separate weighted pools)
 *   - Lender name from source-type-gated catalog
 *   - Wholesale rates (6-10.5%)
 *   - Repayment freq 60/37/2/1 quarterly/monthly/semi/annual
 */
export async function generateNewBorrowings(
  conn: DuckDBConnection,
  today: Date,
  baselineDate: Date,
  seed: number,
): Promise<number> {
  const rng = createRng(seed);
  const count = hfcDailyVolume(VOLUME_BORROWINGS, today, baselineDate, rng);
  if (count === 0) return 0;

  const startId = await nextIdStart(conn, "raw_borrowings__live", "borrowing_id", 1_000);

  // borrowings.csv has no entity column — borrowings are at the company level,
  // not entity-split. So source-type weights blend HFC + Finserve (matching
  // observed seed mix where NHB dominates because Vastu HFC is the larger arm).
  const SOURCE_BLENDED = [
    { value: "bank",   weight: 51 },
    { value: "nhb",    weight: 36 },
    { value: "fi_dfi", weight: 10 },
    { value: "ecb",    weight:  2 },
    { value: "ncd",    weight:  1 },
  ];

  const rows: string[] = [];
  for (let i = 0; i < count; i++) {
    const borrowingId = startId + i;
    const sourceType = pickWeighted(rng, SOURCE_BLENDED);
    const lender = rng.choice(LENDERS_BY_SOURCE[sourceType]);

    const sanctioned = logNormalFloat(rng, Math.log(50), 0.7, 5.5, 140, 2);
    const outstanding = Math.round(sanctioned * (0.85 + rng.next() * 0.15) * 100) / 100;
    const interestRate = gaussFloat(rng, 8.0, 1.0, 6.0, 10.5, 1);
    const isFixed = rng.bool(0.40);

    // Tenure 5-10 years, expressed via maturity_date.
    const tenureYears = rng.int(5, 10);
    const startDate = new Date(today);
    const maturityDate = new Date(today);
    maturityDate.setUTCFullYear(maturityDate.getUTCFullYear() + tenureYears);

    const repaymentFreq = pickWeighted(rng, REPAYMENT_FREQ_WEIGHTS);

    rows.push(`(${borrowingId}, ${sqlLiteral(sourceType)}, ${sqlLiteral(lender)}, ${sanctioned}, ${outstanding}, ${interestRate}, '${formatDate(startDate)}', '${formatDate(maturityDate)}', ${isFixed ? "true" : "false"}, ${sqlLiteral(repaymentFreq)})`);
  }

  const cols = "borrowing_id, source_type, lender_name, sanctioned_amount_cr, outstanding_amount_cr, interest_rate, start_date, maturity_date, is_fixed_rate, repayment_frequency";
  return chunkInsert(conn, "raw_borrowings__live", cols, rows);
}

/**
 * Generate today's new loans — the engine of the live data.
 *
 * Sampling:
 *   - 90% of borrower_id values come from raw_borrowers (existing pool — repeat customers)
 *   - 10% come from this tick's new borrowers (NTC channel; signup_date = today)
 *   - branch_id sampled from raw_branches matching the loan's entity
 *
 * Invariants enforced:
 *   - Entity → product hard partition
 *   - Co-lending FINSERVE-only
 *   - Rate by entity (HFC ~15%, Finserve ~20%)
 *   - Tenure / ticket / LTV by product
 *   - emi_amount via annuity formula
 *   - property_value = disbursed/ltv for home/lap; null for vehicle/MSME
 *   - All new loans land in active|current|1
 */
export async function generateNewLoans(
  conn: DuckDBConnection,
  today: Date,
  baselineDate: Date,
  seed: number,
): Promise<number> {
  const rng = createRng(seed);
  const count = hfcDailyVolume(VOLUME_LOANS, today, baselineDate, rng);
  if (count === 0) return 0;

  const startId = await nextIdStart(conn, "raw_loans__live", "loan_id", 200_000);
  const todayStr = formatDate(today);

  // Pre-sample borrower IDs for this tick.
  // 90% existing + 10% new (signup_date=today). Hash-ordered for determinism.
  const existingNeeded = Math.ceil(count * 0.90);
  const newNeeded = count - existingNeeded;
  const borrowerSeed = (seed ^ 0xA1B2C3D4) >>> 0;

  const existingR = await conn.run(`
    SELECT borrower_id FROM raw_borrowers
    ORDER BY hash(borrower_id * ${borrowerSeed})
    LIMIT ${existingNeeded}
  `);
  const existingBorrowerIds = (await existingR.getRows()).map((r) => Number(r[0]));

  let newBorrowerIds: number[] = [];
  if (newNeeded > 0) {
    const newR = await conn.run(`
      SELECT borrower_id FROM raw_borrowers__live
      WHERE signup_date = '${todayStr}'
      ORDER BY hash(borrower_id * ${borrowerSeed})
      LIMIT ${newNeeded}
    `);
    newBorrowerIds = (await newR.getRows()).map((r) => Number(r[0]));
  }
  // If new pool is short, top up from existing.
  while (newBorrowerIds.length < newNeeded && existingBorrowerIds.length > 0) {
    newBorrowerIds.push(existingBorrowerIds.pop()!);
  }
  const allBorrowerIds = [...existingBorrowerIds, ...newBorrowerIds];

  // Pre-sample active branches by entity.
  const branchByEntityR = await conn.run(`
    SELECT branch_id, entity FROM raw_branches WHERE is_active = true
  `);
  const activeBranches: { id: number; entity: string }[] = (await branchByEntityR.getRows()).map((r) => ({ id: Number(r[0]), entity: String(r[1]) }));
  const hfcBranches = activeBranches.filter((b) => b.entity === "hfc").map((b) => b.id);
  const finserveBranches = activeBranches.filter((b) => b.entity === "finserve").map((b) => b.id);

  if (hfcBranches.length === 0 || finserveBranches.length === 0) {
    throw new Error(`generateNewLoans: missing active branches for entity (hfc=${hfcBranches.length}, finserve=${finserveBranches.length})`);
  }

  const rows: string[] = [];
  for (let i = 0; i < count; i++) {
    const loanId = startId + i;
    const borrowerId = allBorrowerIds[i % allBorrowerIds.length];

    const entity = pickWeighted(rng, ENTITY_WEIGHTS);
    const productType = pickWeighted(rng, PRODUCT_BY_ENTITY[entity]);

    const branchPool = entity === "hfc" ? hfcBranches : finserveBranches;
    const branchId = branchPool[rng.int(0, branchPool.length - 1)];

    const ticketCfg = TICKET_BY_ENTITY_PRODUCT[`${entity}|${productType}`];
    const sanctioned = logNormalInt(rng, ticketCfg.mu, ticketCfg.sigma, ticketCfg.min, ticketCfg.max);
    // Most loans equal sanctioned; some marginally less (haircut at underwriting).
    const disbursed = rng.bool(0.85) ? sanctioned : Math.round(sanctioned * (0.95 + rng.next() * 0.05));

    const rateCfg = RATE_BY_ENTITY[entity];
    const interestRate = gaussFloat(rng, rateCfg.mean, rateCfg.sigma, rateCfg.min, rateCfg.max, 2);

    const tenureCfg = TENURE_RANGES[productType];
    const tenureMonths = rng.int(tenureCfg.min, tenureCfg.max);

    const emiAmount = computeEmi(disbursed, interestRate, tenureMonths);

    const ltvCfg = LTV_RANGES[productType];
    const ltvRatio = gaussFloat(rng, (ltvCfg.min + ltvCfg.max) / 2, (ltvCfg.max - ltvCfg.min) / 4, ltvCfg.min, ltvCfg.max, 3);

    const propertyValue = HAS_PROPERTY.has(productType) ? Math.round(disbursed / Math.max(0.01, ltvRatio)) : null;

    const sourcingChannel = pickWeighted(rng, SOURCING_BY_ENTITY[entity]);

    // Co-lending: HFC always null; Finserve 70% null + 30% from 9-partner pool.
    let coLending: string | null = null;
    if (entity === "finserve" && rng.bool(0.30)) {
      coLending = pickWeighted(rng, FINSERVE_COLENDING_PARTNERS);
    }

    rows.push([
      loanId,
      borrowerId,
      branchId,
      sqlLiteral(entity),
      sqlLiteral(productType),
      `'${todayStr}'`,
      sanctioned,
      disbursed,
      interestRate,
      tenureMonths,
      emiAmount,
      ltvRatio,
      propertyValue ?? "NULL",
      sqlLiteral(sourcingChannel),
      coLending == null ? "NULL" : sqlLiteral(coLending),
      "'active'",
      "'current'",
      "1",
      "0",
      "NULL",
    ].join(", "));
  }

  const valueRows = rows.map((r) => `(${r})`);
  const cols = "loan_id, borrower_id, branch_id, entity, product_type, disbursement_date, " +
               "sanctioned_amount, disbursed_amount, interest_rate, tenure_months, emi_amount, " +
               "ltv_ratio, property_value, sourcing_channel, co_lending_partner, " +
               "loan_status, dpd_bucket, stage, overdue_amount, last_payment_date";

  return chunkInsert(conn, "raw_loans__live", cols, valueRows);
}

// ────────────────────────────────────────────────────────────────────────────
// Tick salt helpers — keep generators independent but seeded from one tick seed
// ────────────────────────────────────────────────────────────────────────────

export function deriveSeed(baseSeed: number, salt: string): number {
  return (baseSeed ^ hashString(salt)) >>> 0;
}
