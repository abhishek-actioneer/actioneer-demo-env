/**
 * Generates the complete Vastu Housing Finance Corporation synthetic dataset.
 *
 * Produces 12 CSV files covering lending operations, risk, collections, and finance:
 *   1. branches.csv              (~226 rows)
 *   2. employees.csv             (~5,500 rows)
 *   3. borrowers.csv             (~1,20,000 rows)
 *   4. co_lending_partners.csv   (~11 rows)
 *   5. loans.csv                 (~1,50,000 rows)
 *   6. emi_payments.csv          (~18,00,000 rows)
 *   7. disbursements.csv         (~5,000 rows)
 *   8. borrowings.csv            (~500 rows)
 *   9. collections_actions.csv   (~50,000 rows)
 *   10. assignments.csv          (~2,000 rows)
 *   11. provisions.csv           (~36 rows)
 *   12. npa_movement.csv         (~12 rows)
 *
 * Two-book structure:
 *   - HFC (standalone): ~1,10,000 loans, ₹9,102 Cr AUM, 1.31% GNPA, 77% home loans
 *   - Finserve (subsidiary): ~40,000 loans, ₹2,435 Cr AUM, 2.23% GNPA, vehicle/MSME
 *
 * Date range: Apr 2022 – Mar 2025 (3 fiscal years: FY23, FY24, FY25)
 * Seed: 42 for reproducibility
 *
 * Usage: npx tsx scripts/generate-vastu-hfc.ts
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";

const OUT_DIR = resolve(__dirname, "../data/csv/vastu-hfc");
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

// ══════════════════════════════════════════════════════════
// SEEDED PRNG
// ══════════════════════════════════════════════════════════

let _seed = 42;
function rand(): number {
  _seed = (_seed * 16807 + 0) % 2147483647;
  return (_seed - 1) / 2147483646;
}
function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}
function weightedPick<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}
function normalRand(mean: number, std: number): number {
  const u1 = rand() || 0.0001;
  const u2 = rand();
  return mean + std * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function roundTo(val: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(val * f) / f;
}

// ══════════════════════════════════════════════════════════
// DATE UTILITIES (Indian Fiscal Year: Apr-Mar)
// ══════════════════════════════════════════════════════════

const FY_START = "2022-04-01";
const FY_END = "2025-03-31";

function dateStr(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}
function addDays(date: string, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function addMonths(date: string, months: number): string {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}
function diffDays(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}
function diffMonths(a: string, b: string): number {
  const da = new Date(a), db = new Date(b);
  return (db.getFullYear() - da.getFullYear()) * 12 + (db.getMonth() - da.getMonth());
}
function monthStart(y: number, m: number): string {
  return dateStr(y, m, 1);
}
function getMonth(date: string): number {
  return new Date(date).getMonth() + 1;
}
function getYear(date: string): number {
  return new Date(date).getFullYear();
}
function fyLabel(date: string): string {
  const d = new Date(date);
  const m = d.getMonth() + 1;
  const y = d.getFullYear();
  return m >= 4 ? `FY${(y + 1) % 100}` : `FY${y % 100}`;
}
function fyQuarter(date: string): string {
  const m = getMonth(date);
  const fy = fyLabel(date);
  if (m >= 4 && m <= 6) return `${fy}-Q1`;
  if (m >= 7 && m <= 9) return `${fy}-Q2`;
  if (m >= 10 && m <= 12) return `${fy}-Q3`;
  return `${fy}-Q4`;
}

// All months in range as [year, month] pairs
function allMonths(start: string, end: string): [number, number][] {
  const months: [number, number][] = [];
  let y = getYear(start), m = getMonth(start);
  const ey = getYear(end), em = getMonth(end);
  while (y < ey || (y === ey && m <= em)) {
    months.push([y, m]);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return months;
}

function randomDateInMonth(y: number, m: number): string {
  const d = randInt(1, daysInMonth(y, m));
  return dateStr(y, m, d);
}

function randomDateBetween(start: string, end: string): string {
  const days = diffDays(start, end);
  return addDays(start, randInt(0, Math.max(0, days)));
}

// ══════════════════════════════════════════════════════════
// CSV WRITER
// ══════════════════════════════════════════════════════════

function writeCsv(filename: string, headers: string[], rows: Record<string, unknown>[]) {
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [
    headers.join(","),
    ...rows.map(r => headers.map(h => escape(r[h])).join(","))
  ];
  const path = resolve(OUT_DIR, filename);
  writeFileSync(path, lines.join("\n"));
  console.log(`  ✓ ${filename}: ${rows.length.toLocaleString()} rows`);
}

// ══════════════════════════════════════════════════════════
// CONSTANTS & CALIBRATION TARGETS
// ══════════════════════════════════════════════════════════

// AUM targets (₹ Cr, as of Mar 2025)
const TARGET = {
  hfc_aum_cr: 9102,
  finserve_aum_cr: 2435,
  consol_aum_cr: 11423,
  hfc_active_loans: 79249,
  finserve_active_loans: 64869, // 144118 - 79249
  total_active_loans: 144118,
  hfc_branches: 191,
  finserve_branches: 74, // some overlap
  total_branches_consol: 226,
  total_employees: 5523,
  hfc_gnpa_pct: 1.31,
  finserve_gnpa_pct: 2.23,
  home_loan_pct: 0.77,
  self_employed_pct: 0.81,
  median_ltv: 0.45,
  median_cibil: 742,
  funding_bank_pct: 0.50,
  funding_nhb_pct: 0.31,
  funding_fi_pct: 0.10,
  funding_ecb_pct: 0.08,
  funding_ncd_pct: 0.01,
};

// ══════════════════════════════════════════════════════════
// GEOGRAPHIC DEFINITIONS (15 states, no state >15% AUM)
// ══════════════════════════════════════════════════════════

interface StateDef {
  name: string;
  weight: number; // fraction of AUM
  cities: { name: string; tier: "t30" | "b30"; weight: number }[];
}

const STATES: StateDef[] = [
  { name: "Maharashtra", weight: 0.14, cities: [
    { name: "Pune", tier: "t30", weight: 0.3 },
    { name: "Nashik", tier: "b30", weight: 0.2 },
    { name: "Nagpur", tier: "b30", weight: 0.15 },
    { name: "Aurangabad", tier: "b30", weight: 0.15 },
    { name: "Kolhapur", tier: "b30", weight: 0.1 },
    { name: "Solapur", tier: "b30", weight: 0.1 },
  ]},
  { name: "Rajasthan", weight: 0.13, cities: [
    { name: "Jaipur", tier: "t30", weight: 0.35 },
    { name: "Jodhpur", tier: "b30", weight: 0.2 },
    { name: "Udaipur", tier: "b30", weight: 0.15 },
    { name: "Kota", tier: "b30", weight: 0.15 },
    { name: "Ajmer", tier: "b30", weight: 0.15 },
  ]},
  { name: "Gujarat", weight: 0.12, cities: [
    { name: "Ahmedabad", tier: "t30", weight: 0.35 },
    { name: "Surat", tier: "t30", weight: 0.25 },
    { name: "Vadodara", tier: "b30", weight: 0.2 },
    { name: "Rajkot", tier: "b30", weight: 0.2 },
  ]},
  { name: "Madhya Pradesh", weight: 0.11, cities: [
    { name: "Indore", tier: "t30", weight: 0.3 },
    { name: "Bhopal", tier: "t30", weight: 0.25 },
    { name: "Jabalpur", tier: "b30", weight: 0.15 },
    { name: "Gwalior", tier: "b30", weight: 0.15 },
    { name: "Raipur", tier: "b30", weight: 0.15 }, // Chhattisgarh proximity
  ]},
  { name: "Uttar Pradesh", weight: 0.10, cities: [
    { name: "Lucknow", tier: "t30", weight: 0.3 },
    { name: "Kanpur", tier: "b30", weight: 0.2 },
    { name: "Agra", tier: "b30", weight: 0.15 },
    { name: "Varanasi", tier: "b30", weight: 0.15 },
    { name: "Meerut", tier: "b30", weight: 0.2 },
  ]},
  { name: "Tamil Nadu", weight: 0.09, cities: [
    { name: "Chennai", tier: "t30", weight: 0.3 },
    { name: "Coimbatore", tier: "b30", weight: 0.25 },
    { name: "Madurai", tier: "b30", weight: 0.2 },
    { name: "Tiruchirappalli", tier: "b30", weight: 0.25 },
  ]},
  { name: "Telangana", weight: 0.07, cities: [
    { name: "Hyderabad", tier: "t30", weight: 0.6 },
    { name: "Warangal", tier: "b30", weight: 0.2 },
    { name: "Karimnagar", tier: "b30", weight: 0.2 },
  ]},
  { name: "Karnataka", weight: 0.06, cities: [
    { name: "Bengaluru", tier: "t30", weight: 0.4 },
    { name: "Mysuru", tier: "b30", weight: 0.2 },
    { name: "Hubli-Dharwad", tier: "b30", weight: 0.2 },
    { name: "Mangaluru", tier: "b30", weight: 0.2 },
  ]},
  { name: "Andhra Pradesh", weight: 0.05, cities: [
    { name: "Visakhapatnam", tier: "t30", weight: 0.35 },
    { name: "Vijayawada", tier: "b30", weight: 0.35 },
    { name: "Guntur", tier: "b30", weight: 0.3 },
  ]},
  { name: "Haryana", weight: 0.04, cities: [
    { name: "Gurugram", tier: "t30", weight: 0.4 },
    { name: "Faridabad", tier: "t30", weight: 0.3 },
    { name: "Karnal", tier: "b30", weight: 0.3 },
  ]},
  { name: "Punjab", weight: 0.03, cities: [
    { name: "Ludhiana", tier: "b30", weight: 0.4 },
    { name: "Amritsar", tier: "b30", weight: 0.3 },
    { name: "Jalandhar", tier: "b30", weight: 0.3 },
  ]},
  { name: "Chhattisgarh", weight: 0.02, cities: [
    { name: "Raipur", tier: "b30", weight: 0.5 },
    { name: "Bilaspur", tier: "b30", weight: 0.5 },
  ]},
  { name: "Delhi", weight: 0.02, cities: [
    { name: "New Delhi", tier: "t30", weight: 0.6 },
    { name: "Dwarka", tier: "t30", weight: 0.4 },
  ]},
  { name: "Uttarakhand", weight: 0.01, cities: [
    { name: "Dehradun", tier: "b30", weight: 0.6 },
    { name: "Haridwar", tier: "b30", weight: 0.4 },
  ]},
  { name: "Puducherry", weight: 0.01, cities: [
    { name: "Puducherry", tier: "b30", weight: 1.0 },
  ]},
];

// ══════════════════════════════════════════════════════════
// PRODUCT DEFINITIONS
// ══════════════════════════════════════════════════════════

interface ProductDef {
  type: string;
  entity: "hfc" | "finserve";
  aum_share: number; // within its entity
  avg_ticket_lakh: number;
  ticket_std_lakh: number;
  min_ticket_lakh: number;
  max_ticket_lakh: number;
  rate_min: number;
  rate_max: number;
  tenure_min_months: number;
  tenure_max_months: number;
}

const HFC_PRODUCTS: ProductDef[] = [
  { type: "home_purchase", entity: "hfc", aum_share: 0.50, avg_ticket_lakh: 13.5, ticket_std_lakh: 4, min_ticket_lakh: 5, max_ticket_lakh: 30, rate_min: 12.5, rate_max: 16.0, tenure_min_months: 120, tenure_max_months: 240 },
  { type: "home_construction", entity: "hfc", aum_share: 0.15, avg_ticket_lakh: 11.0, ticket_std_lakh: 3, min_ticket_lakh: 4, max_ticket_lakh: 25, rate_min: 13.0, rate_max: 16.5, tenure_min_months: 120, tenure_max_months: 240 },
  { type: "home_improvement", entity: "hfc", aum_share: 0.12, avg_ticket_lakh: 6.0, ticket_std_lakh: 2, min_ticket_lakh: 2, max_ticket_lakh: 15, rate_min: 13.5, rate_max: 17.0, tenure_min_months: 60, tenure_max_months: 180 },
  { type: "lap_residential", entity: "hfc", aum_share: 0.15, avg_ticket_lakh: 8.0, ticket_std_lakh: 3, min_ticket_lakh: 3, max_ticket_lakh: 20, rate_min: 15.0, rate_max: 19.5, tenure_min_months: 60, tenure_max_months: 180 },
  { type: "lap_commercial", entity: "hfc", aum_share: 0.05, avg_ticket_lakh: 10.0, ticket_std_lakh: 4, min_ticket_lakh: 4, max_ticket_lakh: 25, rate_min: 16.0, rate_max: 21.0, tenure_min_months: 60, tenure_max_months: 120 },
  { type: "micro_housing", entity: "hfc", aum_share: 0.03, avg_ticket_lakh: 3.5, ticket_std_lakh: 1, min_ticket_lakh: 1.5, max_ticket_lakh: 6, rate_min: 16.0, rate_max: 20.0, tenure_min_months: 36, tenure_max_months: 120 },
];

const FINSERVE_PRODUCTS: ProductDef[] = [
  { type: "used_cv", entity: "finserve", aum_share: 0.40, avg_ticket_lakh: 4.0, ticket_std_lakh: 1.5, min_ticket_lakh: 1.5, max_ticket_lakh: 10, rate_min: 18.0, rate_max: 24.0, tenure_min_months: 36, tenure_max_months: 72 },
  { type: "used_car", entity: "finserve", aum_share: 0.25, avg_ticket_lakh: 5.0, ticket_std_lakh: 2, min_ticket_lakh: 2, max_ticket_lakh: 12, rate_min: 17.0, rate_max: 22.0, tenure_min_months: 36, tenure_max_months: 84 },
  { type: "msme", entity: "finserve", aum_share: 0.25, avg_ticket_lakh: 5.5, ticket_std_lakh: 2, min_ticket_lakh: 2, max_ticket_lakh: 15, rate_min: 18.0, rate_max: 25.0, tenure_min_months: 24, tenure_max_months: 60 },
  { type: "micro_housing_finserve", entity: "finserve", aum_share: 0.10, avg_ticket_lakh: 3.0, ticket_std_lakh: 1, min_ticket_lakh: 1, max_ticket_lakh: 5, rate_min: 17.0, rate_max: 22.0, tenure_min_months: 36, tenure_max_months: 120 },
];

const ALL_PRODUCTS = [...HFC_PRODUCTS, ...FINSERVE_PRODUCTS];

// ══════════════════════════════════════════════════════════
// CO-LENDING PARTNERS
// ══════════════════════════════════════════════════════════

const CO_LENDING_PARTNERS = [
  { id: "DMI", name: "DMI Finance", type: "nbfc", start: "2019-09-01", product_focus: "personal", active: true, weight: 0.20 },
  { id: "TVS", name: "TVS Credit", type: "nbfc", start: "2020-03-01", product_focus: "vehicle", active: true, weight: 0.15 },
  { id: "HDB", name: "HDB Financial", type: "nbfc", start: "2020-06-01", product_focus: "msme", active: true, weight: 0.12 },
  { id: "AXIS", name: "Axis Bank", type: "bank", start: "2021-01-01", product_focus: "vehicle", active: true, weight: 0.12 },
  { id: "PIRAMAL", name: "Piramal Capital", type: "nbfc", start: "2020-09-01", product_focus: "msme", active: true, weight: 0.10 },
  { id: "NAC", name: "Northern Arc Capital", type: "nbfc", start: "2021-06-01", product_focus: "micro_housing", active: true, weight: 0.08 },
  { id: "UTKARSH", name: "Utkarsh Small Finance Bank", type: "bank", start: "2021-09-01", product_focus: "msme", active: true, weight: 0.07 },
  { id: "FINNABLE", name: "Finnable Credit", type: "fintech", start: "2022-01-01", product_focus: "personal", active: true, weight: 0.06 },
  { id: "TATA", name: "Tata Capital", type: "nbfc", start: "2022-06-01", product_focus: "vehicle", active: true, weight: 0.05 },
  { id: "VCPL", name: "Vivriti Capital", type: "nbfc", start: "2020-12-01", product_focus: "msme", active: false, weight: 0.03 },
  { id: "GOSREE", name: "Gosree Finance", type: "nbfc", start: "2021-03-01", product_focus: "micro_housing", active: false, weight: 0.02 },
];

// ══════════════════════════════════════════════════════════
// INDUSTRIES (50+ for self-employed borrowers)
// ══════════════════════════════════════════════════════════

const INDUSTRIES = [
  "kirana_shop", "tailoring", "auto_repair", "vegetable_vendor", "dairy_farming",
  "poultry_farming", "construction_labor", "plumbing", "electrician", "carpentry",
  "welding", "painting_contractor", "transport_operator", "truck_driver", "taxi_driver",
  "food_stall", "tea_shop", "bakery", "flower_shop", "fruit_vendor",
  "mobile_repair", "beauty_parlour", "barber_shop", "laundry_service", "catering",
  "photography", "printing_press", "stationery_shop", "medical_store", "cloth_store",
  "hardware_store", "furniture_maker", "pottery", "handloom_weaving", "fishing",
  "rice_mill", "oil_mill", "sugarcane_vendor", "cattle_trading", "goat_farming",
  "brick_kiln", "stone_crushing", "sand_mining", "timber_trading", "scrap_dealer",
  "garment_manufacturing", "footwear_shop", "cycle_repair", "pan_shop", "irrigation_equipment",
  "agri_input_dealer", "fertilizer_dealer", "seed_shop", "flour_mill", "ice_cream_parlour",
];

const SALARIED_INDUSTRIES = [
  "private_company", "government", "school_teacher", "bank_employee", "hospital_staff",
  "factory_worker", "security_guard", "delivery_executive", "call_center", "IT_services",
];

// ══════════════════════════════════════════════════════════
// INDIAN FIRST NAMES (state-approximate)
// ══════════════════════════════════════════════════════════

const FEMALE_NAMES = [
  "Lakshmi", "Priya", "Kavitha", "Sunita", "Meena", "Rekha", "Anita", "Sita", "Geeta", "Radha",
  "Savitri", "Kamala", "Parvati", "Sarita", "Nirmala", "Shanti", "Pushpa", "Rani", "Devi", "Asha",
  "Bhavna", "Chitra", "Deepa", "Fatima", "Gayatri", "Hema", "Indira", "Jaya", "Kalpana", "Lata",
  "Mamta", "Nalini", "Padma", "Rajni", "Sarla", "Tara", "Uma", "Vani", "Yamuna", "Zarina",
];
const MALE_NAMES = [
  "Rajesh", "Suresh", "Ramesh", "Mahesh", "Ganesh", "Dinesh", "Mukesh", "Naresh", "Rakesh", "Vikram",
  "Ajay", "Sanjay", "Vijay", "Ravi", "Arun", "Mohan", "Gopal", "Krishna", "Shankar", "Prakash",
  "Anil", "Bharat", "Chandan", "Deepak", "Firoz", "Govind", "Hari", "Jagdish", "Kiran", "Laxman",
  "Manoj", "Narayan", "Om", "Pankaj", "Rahul", "Satish", "Tushar", "Umesh", "Vinod", "Yogesh",
];

// ══════════════════════════════════════════════════════════
// MONTHLY GROWTH CURVES (disbursement volumes by month)
// ══════════════════════════════════════════════════════════

// HFC monthly disbursement targets (₹ Cr) to reach ₹9,102 Cr AUM by Mar-25
// FY23: ₹2,909 Cr total, FY24: ₹3,548 Cr, FY25: ₹3,604 Cr
// Average ~₹280 Cr/mo growing from ~₹200 Cr/mo to ~₹320 Cr/mo

function hfcMonthlyDisbursementCr(y: number, m: number): number {
  const monthIdx = (y - 2022) * 12 + (m - 4); // 0-based from Apr 2022
  if (monthIdx < 0) return 0;
  // Need total ~₹14,000 Cr disbursed over 36 months to reach ₹9,102 Cr AUM
  // (accounting for ~35% runoff from repayments, prepayments, assignments, closures)
  // Linear growth from ~280 to ~480 over 36 months + seasonality
  const base = 280 + (monthIdx / 36) * 200;
  // Q4 (Jan-Mar) is typically stronger (fiscal year end push)
  const seasonal = (m >= 1 && m <= 3) ? 1.15 : (m >= 10 && m <= 12) ? 1.05 : 0.93;
  return base * seasonal;
}

function finserveMonthlyDisbursementCr(y: number, m: number): number {
  const monthIdx = (y - 2022) * 12 + (m - 4);
  if (monthIdx < 0) return 0;
  // Finserve ramped up: started small FY23, grew rapidly
  // FY25 total ~₹1,583 Cr → ~₹130 Cr/mo
  if (monthIdx < 6) return 20 + monthIdx * 5; // ramp-up FY23 H1
  if (monthIdx < 12) return 50 + (monthIdx - 6) * 8; // FY23 H2
  if (monthIdx < 24) return 90 + (monthIdx - 12) * 3; // FY24
  return 120 + (monthIdx - 24) * 2; // FY25
}

// ══════════════════════════════════════════════════════════
// STEP 1: GENERATE BRANCHES
// ══════════════════════════════════════════════════════════

console.log("\n🏛️  Generating Vastu HFC dataset...\n");
console.log("Step 1: Branches");

interface Branch {
  branch_id: number;
  branch_name: string;
  entity: string;
  state: string;
  city: string;
  city_tier: string;
  branch_type: string;
  open_date: string;
  employee_count: number;
  monthly_rent_inr: number;
  is_active: boolean;
}

const branches: Branch[] = [];
let branchId = 0;

// HFC branches (191) — cap total at target
let hfcBranchCount = 0;
for (const state of STATES) {
  const numBranches = Math.max(1, Math.round(state.weight * TARGET.hfc_branches));
  const remaining = TARGET.hfc_branches - hfcBranchCount;
  const actual = Math.min(numBranches, remaining);
  if (actual <= 0) continue;
  for (let i = 0; i < actual; i++) {
    const city = weightedPick(
      state.cities.map(c => c.name),
      state.cities.map(c => c.weight)
    );
    const cityDef = state.cities.find(c => c.name === city)!;
    const btype = weightedPick(
      ["main", "small", "micro", "sales_office"],
      [30, 35, 20, 15]
    );
    const empCount = btype === "main" ? randInt(25, 40) :
                     btype === "small" ? randInt(12, 20) :
                     btype === "micro" ? randInt(5, 10) :
                     randInt(5, 8);
    // Vintage: 55% before FY23 (before Apr 2022), 25% FY23-24, 20% FY25
    const vintageRoll = rand();
    let openDate: string;
    if (vintageRoll < 0.55) {
      openDate = randomDateBetween("2016-01-01", "2022-03-31");
    } else if (vintageRoll < 0.80) {
      openDate = randomDateBetween("2022-04-01", "2024-03-31");
    } else {
      openDate = randomDateBetween("2024-04-01", "2025-03-31");
    }
    const rent = cityDef.tier === "t30" ? randInt(150000, 300000) : randInt(50000, 150000);
    branchId++;
    branches.push({
      branch_id: branchId,
      branch_name: `${city} ${btype === "main" ? "Main" : btype === "small" ? "" : btype === "micro" ? "Micro" : "SO"} Branch`.replace("  ", " ").trim(),
      entity: "hfc",
      state: state.name,
      city,
      city_tier: cityDef.tier,
      branch_type: btype,
      open_date: openDate,
      employee_count: empCount,
      monthly_rent_inr: rent,
      is_active: rand() < 0.98,
    });
  }
}

// Finserve branches (74) — many in same cities as HFC
for (let i = 0; i < TARGET.finserve_branches; i++) {
  const state = weightedPick(STATES, STATES.map(s => s.weight));
  const city = weightedPick(
    state.cities.map(c => c.name),
    state.cities.map(c => c.weight)
  );
  const cityDef = state.cities.find(c => c.name === city)!;
  branchId++;
  branches.push({
    branch_id: branchId,
    branch_name: `${city} Finserve Branch`,
    entity: "finserve",
    state: state.name,
    city,
    city_tier: cityDef.tier,
    branch_type: weightedPick(["small", "micro", "sales_office"], [40, 35, 25]),
    open_date: randomDateBetween("2020-09-01", "2025-01-31"),
    employee_count: randInt(8, 20),
    monthly_rent_inr: cityDef.tier === "t30" ? randInt(80000, 200000) : randInt(40000, 120000),
    is_active: true,
  });
}

writeCsv("branches.csv",
  ["branch_id", "branch_name", "entity", "state", "city", "city_tier", "branch_type", "open_date", "employee_count", "monthly_rent_inr", "is_active"],
  branches
);

const hfcBranches = branches.filter(b => b.entity === "hfc" && b.is_active);
const finserveBranches = branches.filter(b => b.entity === "finserve" && b.is_active);

// ══════════════════════════════════════════════════════════
// STEP 2: GENERATE EMPLOYEES
// ══════════════════════════════════════════════════════════

console.log("Step 2: Employees");

interface Employee {
  employee_id: number;
  branch_id: number;
  function_type: string;
  join_date: string;
  gender: string;
  age: number;
  annual_ctc_lakh: number;
  is_active: boolean;
}

const employees: Employee[] = [];
let empId = 0;

for (const branch of branches) {
  const count = branch.employee_count;
  for (let i = 0; i < count; i++) {
    empId++;
    const fn = weightedPick(
      ["sales", "credit", "collections", "operations", "legal_technical", "ho"],
      [45, 12, 12, 13, 8, 10]
    );
    const gender = rand() < 0.30 ? "female" : "male";
    const age = clamp(Math.round(normalRand(32, 6)), 22, 55);
    const baseCTC = fn === "sales" ? normalRand(5.5, 1.5) :
                    fn === "credit" ? normalRand(7, 2) :
                    fn === "collections" ? normalRand(5, 1.5) :
                    fn === "operations" ? normalRand(6, 1.5) :
                    fn === "legal_technical" ? normalRand(7, 2) :
                    normalRand(12, 4);
    employees.push({
      employee_id: empId,
      branch_id: branch.branch_id,
      function_type: fn,
      join_date: randomDateBetween(
        branch.open_date > "2020-01-01" ? branch.open_date : "2020-01-01",
        "2025-03-31"
      ),
      gender,
      age,
      annual_ctc_lakh: roundTo(clamp(baseCTC, 3, 30), 2),
      is_active: rand() < 0.85,
    });
  }
}

writeCsv("employees.csv",
  ["employee_id", "branch_id", "function_type", "join_date", "gender", "age", "annual_ctc_lakh", "is_active"],
  employees
);

// ══════════════════════════════════════════════════════════
// STEP 3: GENERATE BORROWERS
// ══════════════════════════════════════════════════════════

console.log("Step 3: Borrowers");

interface Borrower {
  borrower_id: number;
  first_name: string;
  gender: string;
  age: number;
  employment_type: string;
  monthly_income_inr: number;
  income_category: string;
  industry: string;
  state: string;
  city: string;
  city_tier: string;
  bureau_score: number;
  is_ntc: boolean;
  signup_date: string;
  property_type: string;
}

const NUM_BORROWERS = 120000;
const borrowers: Borrower[] = [];

for (let i = 0; i < NUM_BORROWERS; i++) {
  const state = weightedPick(STATES, STATES.map(s => s.weight));
  const city = weightedPick(
    state.cities.map(c => c.name),
    state.cities.map(c => c.weight)
  );
  const cityDef = state.cities.find(c => c.name === city)!;

  // Employment type: 81% self-employed
  const empType = weightedPick(
    ["salaried_formal", "salaried_informal", "self_employed_formal", "self_employed_informal"],
    [10, 9, 15, 66]
  );
  const isSE = empType.startsWith("self_employed");

  // Income by employment type (monthly, INR)
  let income: number;
  if (empType === "self_employed_informal") income = clamp(normalRand(35000, 12000), 15000, 80000);
  else if (empType === "self_employed_formal") income = clamp(normalRand(50000, 15000), 25000, 120000);
  else if (empType === "salaried_informal") income = clamp(normalRand(30000, 8000), 18000, 60000);
  else income = clamp(normalRand(40000, 12000), 20000, 90000);

  const incomeCat = income < 25000 ? "ews" : income < 50000 ? "lig" : "mig";

  // Gender: 60% female (99% loans have female applicant/co-applicant)
  const gender = rand() < 0.60 ? "female" : "male";
  const age = clamp(Math.round(normalRand(35, 8)), 22, 60);

  // Bureau score: 30% NTC (no score)
  const isNtc = rand() < 0.30;
  const bureauScore = isNtc ? 0 : clamp(Math.round(normalRand(742, 60)), 550, 850);

  const industry = isSE ? pick(INDUSTRIES) : pick(SALARIED_INDUSTRIES);
  const propType = weightedPick(
    ["independent_house", "apartment", "plot", "commercial"],
    [70, 15, 10, 5]
  );

  borrowers.push({
    borrower_id: i + 1,
    first_name: gender === "female" ? pick(FEMALE_NAMES) : pick(MALE_NAMES),
    gender,
    age,
    employment_type: empType,
    monthly_income_inr: Math.round(income),
    income_category: incomeCat,
    industry,
    state: state.name,
    city,
    city_tier: cityDef.tier,
    bureau_score: bureauScore,
    is_ntc: isNtc,
    signup_date: randomDateBetween("2016-01-01", "2025-03-31"),
    property_type: propType,
  });
}

writeCsv("borrowers.csv",
  ["borrower_id", "first_name", "gender", "age", "employment_type", "monthly_income_inr", "income_category", "industry", "state", "city", "city_tier", "bureau_score", "is_ntc", "signup_date", "property_type"],
  borrowers
);

// ══════════════════════════════════════════════════════════
// STEP 4: CO-LENDING PARTNERS
// ══════════════════════════════════════════════════════════

console.log("Step 4: Co-lending Partners");

writeCsv("co_lending_partners.csv",
  ["partner_id", "partner_name", "partner_type", "start_date", "product_focus", "active"],
  CO_LENDING_PARTNERS.map(p => ({
    partner_id: p.id,
    partner_name: p.name,
    partner_type: p.type,
    start_date: p.start,
    product_focus: p.product_focus,
    active: p.active,
  }))
);

// ══════════════════════════════════════════════════════════
// STEP 5: GENERATE LOANS (THE BIG ONE)
// ══════════════════════════════════════════════════════════

console.log("Step 5: Loans (this takes a moment...)");

interface Loan {
  loan_id: number;
  borrower_id: number;
  branch_id: number;
  entity: string;
  product_type: string;
  disbursement_date: string;
  sanctioned_amount: number;
  disbursed_amount: number;
  interest_rate: number;
  tenure_months: number;
  emi_amount: number;
  ltv_ratio: number;
  property_value: number;
  sourcing_channel: string;
  co_lending_partner: string;
  loan_status: string;
  dpd_bucket: string;
  stage: number;
  overdue_amount: number;
  last_payment_date: string;
}

const loans: Loan[] = [];
let loanId = 0;
let borrowerIdx = 0; // track which borrowers we assign

const months = allMonths(FY_START, FY_END);

// Helper: calculate EMI using PMT formula
function calcEMI(principal: number, annualRate: number, tenureMonths: number): number {
  const r = annualRate / 100 / 12;
  if (r === 0) return principal / tenureMonths;
  return principal * r * Math.pow(1 + r, tenureMonths) / (Math.pow(1 + r, tenureMonths) - 1);
}

// Helper: determine loan status based on vintage and risk
function determineLoanStatus(
  disbDate: string,
  entity: string,
  product: ProductDef,
  isNtc: boolean,
  state: string,
  sourcingChannel: string,
  coLendingPartner: string,
): { status: string; dpd: string; stage: number; overdue: number } {
  const mob = diffMonths(disbDate, FY_END);
  const endDate = FY_END;

  // Base default probability increases with MOB
  let defaultProb: number;
  if (entity === "hfc") {
    // HFC: ~1.31% GNPA at Mar-25 — need very low default rate
    defaultProb = 0.0005 * Math.min(mob, 36) / 36; // max ~0.05% per cohort
  } else {
    // Finserve: ~2.23% GNPA, higher for certain partners
    defaultProb = 0.006 * Math.min(mob, 36) / 36;
    if (coLendingPartner === "FINNABLE") defaultProb *= 2.0; // Anomaly: Finnable deteriorating
    if (coLendingPartner === "VCPL") defaultProb *= 1.5;
  }

  // Risk multipliers
  if (isNtc) defaultProb *= 1.3;
  if (state === "Madhya Pradesh") defaultProb *= 1.8; // Anomaly: MP underperforming
  if (sourcingChannel === "dsa") defaultProb *= 1.4; // Anomaly: DSA quality issues
  if (sourcingChannel === "connector") defaultProb *= 1.2;

  // Older loans more likely to be closed (housing loans are long-tenure, low runoff)
  const closedProb = entity === "hfc"
    ? Math.min(0.35, mob * 0.008) // ~0.8% per month — housing loans are 15-20yr
    : Math.min(0.55, mob * 0.020); // Finserve shorter tenure, faster closure

  // Assignment probability (HFC only, ~10% of book)
  const assignProb = entity === "hfc" ? 0.10 : 0.02;

  // Prepayment (salaried HL borrowers, anomaly #10)
  const prepayProb = (product.type === "home_purchase" && sourcingChannel === "direct_sales")
    ? 0.05 * (mob > 12 ? 1.5 : 1.0) : 0.02;

  const roll = rand();

  if (roll < defaultProb) {
    // NPA path
    const severeNpa = rand() < 0.15; // 15% of NPAs are written off
    if (severeNpa && mob > 18) {
      return { status: "written_off", dpd: "npa_360_plus", stage: 3, overdue: 0 };
    }
    return {
      status: "npa",
      dpd: weightedPick(["npa_90", "npa_180", "npa_360_plus"], [50, 30, 20]),
      stage: 3,
      overdue: roundTo(calcEMI(product.avg_ticket_lakh * 100000, (product.rate_min + product.rate_max) / 2, product.tenure_min_months) * randInt(3, 12), 0),
    };
  }

  if (roll < defaultProb + closedProb) {
    return { status: "closed", dpd: "current", stage: 1, overdue: 0 };
  }

  if (roll < defaultProb + closedProb + assignProb) {
    return { status: "assigned", dpd: "current", stage: 1, overdue: 0 };
  }

  if (roll < defaultProb + closedProb + assignProb + prepayProb) {
    return { status: "prepaid", dpd: "current", stage: 1, overdue: 0 };
  }

  // Active loan — determine DPD (entity-aware)
  const smaRoll = rand();
  const emiRef = calcEMI(product.avg_ticket_lakh * 100000, (product.rate_min + product.rate_max) / 2, 120);

  if (entity === "hfc") {
    // HFC: Stage 1 95%, Stage 2 3.5%, Stage 3 1.31% — tighter distribution
    if (smaRoll < 0.955) {
      return { status: "active", dpd: "current", stage: 1, overdue: 0 };
    } else if (smaRoll < 0.970) {
      return { status: "active", dpd: "sma_0", stage: 1, overdue: roundTo(emiRef * 0.5, 0) };
    } else if (smaRoll < 0.980) {
      return { status: "active", dpd: "sma_1", stage: 1, overdue: roundTo(emiRef * 1.5, 0) };
    } else if (smaRoll < 0.990) {
      return { status: "active", dpd: "sma_2", stage: 2, overdue: roundTo(emiRef * 2.5, 0) };
    } else {
      return { status: "active", dpd: "npa_90", stage: 3, overdue: roundTo(emiRef * 4, 0) };
    }
  } else {
    // Finserve: Stage 3 ~2.23% — wider tail
    if (smaRoll < 0.935) {
      return { status: "active", dpd: "current", stage: 1, overdue: 0 };
    } else if (smaRoll < 0.955) {
      return { status: "active", dpd: "sma_0", stage: 1, overdue: roundTo(emiRef * 0.5, 0) };
    } else if (smaRoll < 0.970) {
      return { status: "active", dpd: "sma_1", stage: 1, overdue: roundTo(emiRef * 1.5, 0) };
    } else if (smaRoll < 0.985) {
      return { status: "active", dpd: "sma_2", stage: 2, overdue: roundTo(emiRef * 2.5, 0) };
    } else {
      return { status: "active", dpd: "npa_90", stage: 3, overdue: roundTo(emiRef * 4, 0) };
    }
  }
}

// Generate HFC loans
for (const [y, m] of months) {
  const targetDisbCr = hfcMonthlyDisbursementCr(y, m);
  const avgTicket = 13.2; // ₹13.2 Lakh avg
  const numLoans = Math.round((targetDisbCr * 100) / avgTicket); // convert Cr to Lakh

  for (let i = 0; i < numLoans; i++) {
    loanId++;
    borrowerIdx = (borrowerIdx % NUM_BORROWERS);
    const borrower = borrowers[borrowerIdx];
    borrowerIdx++;

    const product = weightedPick(HFC_PRODUCTS, HFC_PRODUCTS.map(p => p.aum_share));
    const branch = pick(hfcBranches);

    const ticketLakh = clamp(roundTo(normalRand(product.avg_ticket_lakh, product.ticket_std_lakh), 2), product.min_ticket_lakh, product.max_ticket_lakh);
    const sanctionedAmt = Math.round(ticketLakh * 100000);
    const disbursedAmt = Math.round(sanctionedAmt * (rand() < 0.95 ? 1.0 : clamp(normalRand(0.97, 0.02), 0.90, 1.0)));

    const rate = roundTo(clamp(
      normalRand((product.rate_min + product.rate_max) / 2, 1.5),
      product.rate_min, product.rate_max
    ), 2);
    // Salaried gets lower rate
    const adjustedRate = borrower.employment_type.startsWith("salaried") ? roundTo(rate - 0.5, 2) : rate;

    const tenure = randInt(product.tenure_min_months, product.tenure_max_months);
    // Round to nearest 12
    const roundedTenure = Math.round(tenure / 12) * 12 || 12;

    const emi = roundTo(calcEMI(disbursedAmt, adjustedRate, roundedTenure), 0);

    const ltv = clamp(roundTo(normalRand(0.45, 0.08), 3), 0.30, 0.65);
    const propValue = Math.round(disbursedAmt / ltv);

    const sourcingChannel = weightedPick(
      ["direct_sales", "dsa", "connector", "digital"],
      [40, 35, 15, 10]
    );

    const disbDate = randomDateInMonth(y, m);

    const { status, dpd, stage, overdue } = determineLoanStatus(
      disbDate, "hfc", product, borrower.is_ntc,
      borrower.state, sourcingChannel, ""
    );

    const lastPayDate = status === "active" || status === "npa"
      ? addDays(FY_END, -randInt(1, 60))
      : status === "closed" || status === "prepaid"
        ? randomDateBetween(addMonths(disbDate, 6), FY_END)
        : disbDate;

    loans.push({
      loan_id: loanId,
      borrower_id: borrower.borrower_id,
      branch_id: branch.branch_id,
      entity: "hfc",
      product_type: product.type,
      disbursement_date: disbDate,
      sanctioned_amount: sanctionedAmt,
      disbursed_amount: disbursedAmt,
      interest_rate: adjustedRate,
      tenure_months: roundedTenure,
      emi_amount: emi,
      ltv_ratio: ltv,
      property_value: propValue,
      sourcing_channel: sourcingChannel,
      co_lending_partner: "",
      loan_status: status,
      dpd_bucket: dpd,
      stage,
      overdue_amount: overdue,
      last_payment_date: lastPayDate,
    });
  }
}

// Generate Finserve loans
for (const [y, m] of months) {
  const targetDisbCr = finserveMonthlyDisbursementCr(y, m);
  const avgTicket = 4.2; // ₹4.2 Lakh avg for Finserve
  const numLoans = Math.round((targetDisbCr * 100) / avgTicket);

  for (let i = 0; i < numLoans; i++) {
    loanId++;
    borrowerIdx = (borrowerIdx % NUM_BORROWERS);
    const borrower = borrowers[borrowerIdx];
    borrowerIdx++;

    const product = weightedPick(FINSERVE_PRODUCTS, FINSERVE_PRODUCTS.map(p => p.aum_share));
    const branch = pick(finserveBranches);

    // Assign co-lending partner
    const activePartners = CO_LENDING_PARTNERS.filter(p => p.active && p.start <= dateStr(y, m, 1));
    const partner = activePartners.length > 0
      ? weightedPick(activePartners, activePartners.map(p => p.weight))
      : CO_LENDING_PARTNERS[0];

    const ticketLakh = clamp(roundTo(normalRand(product.avg_ticket_lakh, product.ticket_std_lakh), 2), product.min_ticket_lakh, product.max_ticket_lakh);
    const sanctionedAmt = Math.round(ticketLakh * 100000);
    const disbursedAmt = sanctionedAmt;

    const rate = roundTo(clamp(
      normalRand((product.rate_min + product.rate_max) / 2, 2),
      product.rate_min, product.rate_max
    ), 2);

    const tenure = randInt(product.tenure_min_months, product.tenure_max_months);
    const roundedTenure = Math.round(tenure / 12) * 12 || 12;
    const emi = roundTo(calcEMI(disbursedAmt, rate, roundedTenure), 0);

    const ltv = product.type.includes("housing")
      ? clamp(roundTo(normalRand(0.50, 0.08), 3), 0.35, 0.65)
      : clamp(roundTo(normalRand(0.70, 0.10), 3), 0.50, 0.90);
    const propValue = Math.round(disbursedAmt / ltv);

    const sourcingChannel = weightedPick(
      ["direct_sales", "dsa", "connector", "digital"],
      [25, 50, 15, 10]
    );

    const disbDate = randomDateInMonth(y, m);

    const { status, dpd, stage, overdue } = determineLoanStatus(
      disbDate, "finserve", product, borrower.is_ntc,
      borrower.state, sourcingChannel, partner.id
    );

    const lastPayDate = status === "active" || status === "npa"
      ? addDays(FY_END, -randInt(1, 45))
      : status === "closed"
        ? randomDateBetween(addMonths(disbDate, 3), FY_END)
        : disbDate;

    loans.push({
      loan_id: loanId,
      borrower_id: borrower.borrower_id,
      branch_id: branch.branch_id,
      entity: "finserve",
      product_type: product.type,
      disbursement_date: disbDate,
      sanctioned_amount: sanctionedAmt,
      disbursed_amount: disbursedAmt,
      interest_rate: rate,
      tenure_months: roundedTenure,
      emi_amount: emi,
      ltv_ratio: ltv,
      property_value: propValue,
      sourcing_channel: sourcingChannel,
      co_lending_partner: partner.id,
      loan_status: status,
      dpd_bucket: dpd,
      stage,
      overdue_amount: overdue,
      last_payment_date: lastPayDate,
    });
  }
}

writeCsv("loans.csv",
  ["loan_id", "borrower_id", "branch_id", "entity", "product_type", "disbursement_date",
   "sanctioned_amount", "disbursed_amount", "interest_rate", "tenure_months", "emi_amount",
   "ltv_ratio", "property_value", "sourcing_channel", "co_lending_partner",
   "loan_status", "dpd_bucket", "stage", "overdue_amount", "last_payment_date"],
  loans
);

console.log(`  Total loans: ${loans.length.toLocaleString()} (HFC: ${loans.filter(l => l.entity === "hfc").length.toLocaleString()}, Finserve: ${loans.filter(l => l.entity === "finserve").length.toLocaleString()})`);

// ══════════════════════════════════════════════════════════
// STEP 6: GENERATE EMI PAYMENTS
// ══════════════════════════════════════════════════════════

console.log("Step 6: EMI Payments (this will take a while...)");

interface EmiPayment {
  payment_id: number;
  loan_id: number;
  due_date: string;
  amount_due: number;
  amount_paid: number;
  paid_date: string;
  payment_mode: string;
  bounce: boolean;
  dpd_at_payment: number;
  collection_bucket: string;
}

const emiPayments: EmiPayment[] = [];
let paymentId = 0;

// Only generate EMI records for active/npa/closed loans, not written-off or assigned (keep manageable)
const emiEligibleLoans = loans.filter(l =>
  l.loan_status === "active" || l.loan_status === "npa" || l.loan_status === "closed" || l.loan_status === "prepaid"
);

// To keep file size manageable, generate last 18 months of EMIs only (Oct 2023 - Mar 2025)
const EMI_START = "2023-10-01";

for (const loan of emiEligibleLoans) {
  const loanStart = loan.disbursement_date > EMI_START ? loan.disbursement_date : EMI_START;
  const loanEnd = (loan.loan_status === "closed" || loan.loan_status === "prepaid")
    ? loan.last_payment_date
    : FY_END;

  if (loanStart >= loanEnd) continue;

  const startMonth = getYear(loanStart) * 12 + getMonth(loanStart);
  const endMonth = getYear(loanEnd) * 12 + getMonth(loanEnd);

  // Base bounce rate
  let baseBounce = 0.20; // 20% industry
  if (loan.entity === "finserve") baseBounce += 0.08;
  const borrower = borrowers[loan.borrower_id - 1];
  if (borrower?.is_ntc) baseBounce += 0.05;
  if (borrower?.employment_type === "self_employed_informal") baseBounce += 0.04;
  if (borrower?.state === "Madhya Pradesh") baseBounce += 0.06; // Anomaly
  if (loan.sourcing_channel === "dsa") baseBounce += 0.03;

  for (let mIdx = startMonth; mIdx <= endMonth; mIdx++) {
    const emiY = Math.floor((mIdx - 1) / 12);
    const emiM = ((mIdx - 1) % 12) + 1;
    const dueDate = dateStr(emiY, emiM, 5); // 5th of each month

    if (dueDate < loanStart || dueDate > FY_END) continue;

    paymentId++;

    // Seasonal bounce spike (anomaly: Oct-Nov Diwali, Jul monsoon)
    let monthBounce = baseBounce;
    if (emiM === 10 || emiM === 11) monthBounce += 0.03; // Diwali
    if (emiM === 7 || emiM === 8) monthBounce += 0.03; // Monsoon

    // MOB effect: NTC bounces high early, then improves (anomaly #9)
    const mob = diffMonths(loan.disbursement_date, dueDate);
    if (borrower?.is_ntc && mob < 6) monthBounce += 0.05;
    else if (borrower?.is_ntc && mob > 12) monthBounce -= 0.05;

    const bounced = rand() < monthBounce;
    let amountPaid: number;
    let paidDate: string;
    let dpd: number;

    if (loan.dpd_bucket.startsWith("npa") && dueDate > addDays(FY_END, -90)) {
      // NPA loans: missed payments in recent months
      amountPaid = 0;
      paidDate = "";
      dpd = 90;
    } else if (bounced) {
      // Bounced then recovered (80%) or missed (20%)
      if (rand() < 0.80) {
        const delay = randInt(5, 30);
        paidDate = addDays(dueDate, delay);
        amountPaid = loan.emi_amount;
        dpd = delay;
      } else {
        // Partial or missed
        if (rand() < 0.5) {
          amountPaid = Math.round(loan.emi_amount * clamp(normalRand(0.5, 0.2), 0.1, 0.9));
          paidDate = addDays(dueDate, randInt(10, 45));
          dpd = diffDays(dueDate, paidDate);
        } else {
          amountPaid = 0;
          paidDate = "";
          dpd = diffDays(dueDate, FY_END);
        }
      }
    } else {
      amountPaid = loan.emi_amount;
      paidDate = addDays(dueDate, randInt(0, 3));
      dpd = 0;
    }

    const bucket = dpd === 0 ? "on_time" :
                   dpd <= 30 ? "1_30" :
                   dpd <= 60 ? "31_60" :
                   dpd <= 90 ? "61_90" : "90_plus";

    emiPayments.push({
      payment_id: paymentId,
      loan_id: loan.loan_id,
      due_date: dueDate,
      amount_due: loan.emi_amount,
      amount_paid: amountPaid,
      paid_date: paidDate,
      payment_mode: weightedPick(["nach", "upi", "cash", "cheque", "neft"], [55, 20, 15, 5, 5]),
      bounce: bounced,
      dpd_at_payment: dpd,
      collection_bucket: bucket,
    });
  }
}

writeCsv("emi_payments.csv",
  ["payment_id", "loan_id", "due_date", "amount_due", "amount_paid", "paid_date",
   "payment_mode", "bounce", "dpd_at_payment", "collection_bucket"],
  emiPayments
);

// ══════════════════════════════════════════════════════════
// STEP 7: DISBURSEMENTS (aggregated monthly)
// ══════════════════════════════════════════════════════════

console.log("Step 7: Disbursements (aggregated)");

interface Disbursement {
  disbursement_id: number;
  month: string;
  entity: string;
  product_type: string;
  branch_id: number;
  state: string;
  loan_count: number;
  total_amount: number;
  avg_ticket_size: number;
  sourcing_channel: string;
}

const disbMap = new Map<string, { count: number; amount: number; branch_id: number; state: string; channel: string }>();

for (const loan of loans) {
  const month = loan.disbursement_date.slice(0, 7); // YYYY-MM
  const key = `${month}|${loan.entity}|${loan.product_type}|${loan.branch_id}|${loan.sourcing_channel}`;
  const existing = disbMap.get(key);
  if (existing) {
    existing.count++;
    existing.amount += loan.disbursed_amount;
  } else {
    const branch = branches.find(b => b.branch_id === loan.branch_id);
    disbMap.set(key, {
      count: 1,
      amount: loan.disbursed_amount,
      branch_id: loan.branch_id,
      state: branch?.state || "",
      channel: loan.sourcing_channel,
    });
  }
}

const disbursements: Disbursement[] = [];
let disbId = 0;
for (const [key, val] of disbMap.entries()) {
  const [month, entity, product] = key.split("|");
  disbId++;
  disbursements.push({
    disbursement_id: disbId,
    month: month + "-01",
    entity,
    product_type: product,
    branch_id: val.branch_id,
    state: val.state,
    loan_count: val.count,
    total_amount: val.amount,
    avg_ticket_size: Math.round(val.amount / val.count),
    sourcing_channel: val.channel,
  });
}

writeCsv("disbursements.csv",
  ["disbursement_id", "month", "entity", "product_type", "branch_id", "state",
   "loan_count", "total_amount", "avg_ticket_size", "sourcing_channel"],
  disbursements
);

// ══════════════════════════════════════════════════════════
// STEP 8: BORROWINGS (funding lines)
// ══════════════════════════════════════════════════════════

console.log("Step 8: Borrowings");

interface BorrowingLine {
  borrowing_id: number;
  source_type: string;
  lender_name: string;
  sanctioned_amount_cr: number;
  outstanding_amount_cr: number;
  interest_rate: number;
  start_date: string;
  maturity_date: string;
  is_fixed_rate: boolean;
  repayment_frequency: string;
}

const borrowingLines: BorrowingLine[] = [];
let borrId = 0;

// Generate ~500 funding lines to match published mix
// Total borrowings ~₹5,318 Cr
const TOTAL_BORROWINGS_CR = 5318;

// Bank loans (50% = ₹2,660 Cr) — 100-150 lines
const bankLenders = ["State Bank of India", "Bank of Baroda", "Punjab National Bank", "Union Bank", "Canara Bank",
  "HDFC Bank", "ICICI Bank", "Axis Bank", "Kotak Mahindra Bank", "IndusInd Bank",
  "Federal Bank", "South Indian Bank", "Karur Vysya Bank", "City Union Bank", "DCB Bank"];

for (let i = 0; i < 130; i++) {
  borrId++;
  const amt = clamp(normalRand(20, 10), 5, 80);
  borrowingLines.push({
    borrowing_id: borrId,
    source_type: "bank",
    lender_name: pick(bankLenders),
    sanctioned_amount_cr: roundTo(amt * 1.2, 2),
    outstanding_amount_cr: roundTo(amt, 2),
    interest_rate: roundTo(clamp(normalRand(8.5, 0.8), 7.5, 10.5), 2),
    start_date: randomDateBetween("2020-01-01", "2025-01-01"),
    maturity_date: randomDateBetween("2025-06-01", "2032-12-31"),
    is_fixed_rate: rand() < 0.30,
    repayment_frequency: weightedPick(["monthly", "quarterly"], [70, 30]),
  });
}

// NHB refinance (31% = ₹1,660 Cr) — 80-100 lines
for (let i = 0; i < 90; i++) {
  borrId++;
  const amt = clamp(normalRand(18, 8), 5, 50);
  borrowingLines.push({
    borrowing_id: borrId,
    source_type: "nhb",
    lender_name: "National Housing Bank",
    sanctioned_amount_cr: roundTo(amt * 1.1, 2),
    outstanding_amount_cr: roundTo(amt, 2),
    interest_rate: roundTo(clamp(normalRand(7.5, 0.5), 6.5, 9.0), 2),
    start_date: randomDateBetween("2019-01-01", "2025-01-01"),
    maturity_date: randomDateBetween("2026-01-01", "2035-12-31"),
    is_fixed_rate: rand() < 0.50,
    repayment_frequency: "quarterly",
  });
}

// FI/DFI (10% = ₹530 Cr) — 20-30 lines
const fiLenders = ["IFC", "Asian Development Bank", "DFC", "FMO", "Proparco", "CDC Group"];
for (let i = 0; i < 25; i++) {
  borrId++;
  const amt = clamp(normalRand(22, 10), 5, 60);
  borrowingLines.push({
    borrowing_id: borrId,
    source_type: "fi_dfi",
    lender_name: pick(fiLenders),
    sanctioned_amount_cr: roundTo(amt * 1.1, 2),
    outstanding_amount_cr: roundTo(amt, 2),
    interest_rate: roundTo(clamp(normalRand(8.0, 0.6), 7.0, 9.5), 2),
    start_date: randomDateBetween("2022-01-01", "2025-01-01"),
    maturity_date: randomDateBetween("2028-01-01", "2035-12-31"),
    is_fixed_rate: rand() < 0.40,
    repayment_frequency: "quarterly",
  });
}

// ECB (8% = ₹425 Cr) — 5 lines
for (let i = 0; i < 5; i++) {
  borrId++;
  borrowingLines.push({
    borrowing_id: borrId,
    source_type: "ecb",
    lender_name: pick(["U.S. DFC", "Asian Development Bank"]),
    sanctioned_amount_cr: roundTo(clamp(normalRand(85, 20), 40, 150), 2),
    outstanding_amount_cr: roundTo(clamp(normalRand(80, 20), 30, 130), 2),
    interest_rate: roundTo(clamp(normalRand(7.0, 0.5), 6.0, 8.5), 2),
    start_date: randomDateBetween("2023-06-01", "2025-01-01"),
    maturity_date: randomDateBetween("2029-01-01", "2045-12-31"),
    is_fixed_rate: true,
    repayment_frequency: "semi_annual",
  });
}

// NCD (1% = ₹38 Cr) — 3 lines (running down)
for (let i = 0; i < 3; i++) {
  borrId++;
  borrowingLines.push({
    borrowing_id: borrId,
    source_type: "ncd",
    lender_name: "BSE Listed NCD",
    sanctioned_amount_cr: roundTo(clamp(normalRand(15, 5), 5, 25), 2),
    outstanding_amount_cr: roundTo(clamp(normalRand(12, 5), 3, 20), 2),
    interest_rate: roundTo(clamp(normalRand(10.0, 0.5), 9.0, 11.0), 2),
    start_date: randomDateBetween("2020-01-01", "2022-12-31"),
    maturity_date: randomDateBetween("2025-06-01", "2027-12-31"),
    is_fixed_rate: true,
    repayment_frequency: "annual",
  });
}

writeCsv("borrowings.csv",
  ["borrowing_id", "source_type", "lender_name", "sanctioned_amount_cr", "outstanding_amount_cr",
   "interest_rate", "start_date", "maturity_date", "is_fixed_rate", "repayment_frequency"],
  borrowingLines
);

// ══════════════════════════════════════════════════════════
// STEP 9: COLLECTIONS ACTIONS
// ══════════════════════════════════════════════════════════

console.log("Step 9: Collections Actions");

interface CollectionAction {
  action_id: number;
  loan_id: number;
  action_date: string;
  action_type: string;
  dpd_at_action: number;
  result: string;
  agent_id: number;
  branch_id: number;
}

const collectionActions: CollectionAction[] = [];
let actionId = 0;

// For delinquent loans (SMA-1, SMA-2, NPA), generate 2-5 actions
const delinquentLoans = loans.filter(l =>
  l.dpd_bucket !== "current" && l.dpd_bucket !== "sma_0" && l.loan_status !== "closed" && l.loan_status !== "assigned"
);

for (const loan of delinquentLoans) {
  const numActions = loan.stage === 3 ? randInt(3, 8) : randInt(1, 4);
  for (let i = 0; i < numActions; i++) {
    actionId++;
    const actionType = weightedPick(
      ["call", "field_visit", "sms_reminder", "demand_notice", "legal_notice", "sarfaesi"],
      loan.stage === 3 ? [20, 20, 10, 20, 20, 10] : [40, 20, 20, 15, 5, 0]
    );
    const result = weightedPick(
      ["promise_to_pay", "partial_payment", "no_contact", "dispute", "resolved", "escalated"],
      [25, 15, 30, 10, 10, 10]
    );
    collectionActions.push({
      action_id: actionId,
      loan_id: loan.loan_id,
      action_date: randomDateBetween(
        addDays(loan.disbursement_date, 90),
        FY_END
      ),
      action_type: actionType,
      dpd_at_action: loan.stage === 3 ? randInt(90, 360) : randInt(30, 90),
      result,
      agent_id: randInt(1, 200), // collection agent reference
      branch_id: loan.branch_id,
    });
  }
}

writeCsv("collections_actions.csv",
  ["action_id", "loan_id", "action_date", "action_type", "dpd_at_action", "result", "agent_id", "branch_id"],
  collectionActions
);

// ══════════════════════════════════════════════════════════
// STEP 10: ASSIGNMENTS (loan sales to banks/ARCs)
// ══════════════════════════════════════════════════════════

console.log("Step 10: Assignments");

interface Assignment {
  assignment_id: number;
  transaction_date: string;
  buyer_type: string;
  buyer_name: string;
  loan_count: number;
  amount_assigned_cr: number;
  mrr_pct: number;
  avg_ltv: number;
  wtd_avg_residual_maturity_months: number;
  wtd_avg_holding_period_months: number;
}

const assignedLoans = loans.filter(l => l.loan_status === "assigned");
const assignments: Assignment[] = [];
let assignmentId = 0;

// Group assigned loans into ~quarterly batches
const assignmentMonths = ["2023-06", "2023-09", "2023-12", "2024-03", "2024-06", "2024-09", "2024-12", "2025-03"];
const loansPerAssignment = Math.ceil(assignedLoans.length / assignmentMonths.length);

for (let q = 0; q < assignmentMonths.length; q++) {
  const batchLoans = assignedLoans.slice(q * loansPerAssignment, (q + 1) * loansPerAssignment);
  if (batchLoans.length === 0) continue;

  const totalAmt = batchLoans.reduce((s, l) => s + l.disbursed_amount, 0);
  const avgLtv = batchLoans.reduce((s, l) => s + l.ltv_ratio, 0) / batchLoans.length;
  const avgResidual = batchLoans.reduce((s, l) => s + (l.tenure_months - diffMonths(l.disbursement_date, assignmentMonths[q] + "-15")), 0) / batchLoans.length;
  const avgHolding = batchLoans.reduce((s, l) => s + diffMonths(l.disbursement_date, assignmentMonths[q] + "-15"), 0) / batchLoans.length;

  assignmentId++;
  const isARC = q === 5; // One ARC transaction (stress asset sale, anomaly)

  assignments.push({
    assignment_id: assignmentId,
    transaction_date: assignmentMonths[q] + "-15",
    buyer_type: isARC ? "arc" : "bank",
    buyer_name: isARC ? "Asset Reconstruction Company" : pick(["State Bank of India", "Bank of Baroda", "ICICI Bank", "HDFC Bank"]),
    loan_count: batchLoans.length,
    amount_assigned_cr: roundTo(totalAmt / 10000000, 2), // convert to Cr
    mrr_pct: isARC ? 0 : 10,
    avg_ltv: roundTo(avgLtv, 3),
    wtd_avg_residual_maturity_months: Math.round(Math.max(12, avgResidual)),
    wtd_avg_holding_period_months: Math.round(Math.max(3, avgHolding)),
  });
}

writeCsv("assignments.csv",
  ["assignment_id", "transaction_date", "buyer_type", "buyer_name", "loan_count",
   "amount_assigned_cr", "mrr_pct", "avg_ltv", "wtd_avg_residual_maturity_months", "wtd_avg_holding_period_months"],
  assignments
);

// ══════════════════════════════════════════════════════════
// STEP 11: PROVISIONS (monthly ECL)
// ══════════════════════════════════════════════════════════

console.log("Step 11: Provisions");

interface Provision {
  month: string;
  entity: string;
  stage_1_exposure_cr: number;
  stage_2_exposure_cr: number;
  stage_3_exposure_cr: number;
  stage_1_provision_cr: number;
  stage_2_provision_cr: number;
  stage_3_provision_cr: number;
  pcr_stage_1: number;
  pcr_stage_2: number;
  pcr_stage_3: number;
  total_ecl_cr: number;
  write_offs_cr: number;
  recoveries_cr: number;
}

const provisions: Provision[] = [];

for (const entity of ["hfc", "finserve"]) {
  const entityLoans = loans.filter(l => l.entity === entity);
  for (const [y, m] of months) {
    const monthStr = dateStr(y, m, 1);

    // Filter loans that existed by this month
    const activeByMonth = entityLoans.filter(l =>
      l.disbursement_date <= monthStr &&
      (l.loan_status !== "closed" || l.last_payment_date >= monthStr)
    );

    const s1 = activeByMonth.filter(l => l.stage === 1);
    const s2 = activeByMonth.filter(l => l.stage === 2);
    const s3 = activeByMonth.filter(l => l.stage === 3);

    const s1Exp = s1.reduce((s, l) => s + l.disbursed_amount, 0) / 10000000;
    const s2Exp = s2.reduce((s, l) => s + l.disbursed_amount, 0) / 10000000;
    const s3Exp = s3.reduce((s, l) => s + l.disbursed_amount, 0) / 10000000;

    const pcr1 = entity === "hfc" ? 0.003 : 0.005;
    const pcr2 = entity === "hfc" ? 0.12 : 0.15;
    const pcr3 = entity === "hfc" ? 0.40 : 0.35;

    const s1Prov = s1Exp * pcr1;
    const s2Prov = s2Exp * pcr2;
    const s3Prov = s3Exp * pcr3;
    const totalEcl = s1Prov + s2Prov + s3Prov;

    const writeOffs = entity === "hfc" ? s3Exp * 0.02 : s3Exp * 0.05;
    const recoveries = writeOffs * clamp(normalRand(0.3, 0.1), 0.1, 0.5);

    provisions.push({
      month: monthStr,
      entity,
      stage_1_exposure_cr: roundTo(s1Exp, 2),
      stage_2_exposure_cr: roundTo(s2Exp, 2),
      stage_3_exposure_cr: roundTo(s3Exp, 2),
      stage_1_provision_cr: roundTo(s1Prov, 2),
      stage_2_provision_cr: roundTo(s2Prov, 2),
      stage_3_provision_cr: roundTo(s3Prov, 2),
      pcr_stage_1: roundTo(pcr1 * 100, 2),
      pcr_stage_2: roundTo(pcr2 * 100, 2),
      pcr_stage_3: roundTo(pcr3 * 100, 2),
      total_ecl_cr: roundTo(totalEcl, 2),
      write_offs_cr: roundTo(writeOffs, 2),
      recoveries_cr: roundTo(recoveries, 2),
    });
  }
}

writeCsv("provisions.csv",
  ["month", "entity", "stage_1_exposure_cr", "stage_2_exposure_cr", "stage_3_exposure_cr",
   "stage_1_provision_cr", "stage_2_provision_cr", "stage_3_provision_cr",
   "pcr_stage_1", "pcr_stage_2", "pcr_stage_3", "total_ecl_cr", "write_offs_cr", "recoveries_cr"],
  provisions
);

// ══════════════════════════════════════════════════════════
// STEP 12: NPA MOVEMENT (quarterly)
// ══════════════════════════════════════════════════════════

console.log("Step 12: NPA Movement");

interface NpaMovement {
  quarter: string;
  entity: string;
  opening_gnpa_cr: number;
  additions_cr: number;
  upgradations_cr: number;
  write_offs_cr: number;
  recoveries_cr: number;
  closing_gnpa_cr: number;
  gnpa_pct: number;
}

const npaMovements: NpaMovement[] = [];
const quarters = [
  "FY23-Q1", "FY23-Q2", "FY23-Q3", "FY23-Q4",
  "FY24-Q1", "FY24-Q2", "FY24-Q3", "FY24-Q4",
  "FY25-Q1", "FY25-Q2", "FY25-Q3", "FY25-Q4",
];

for (const entity of ["hfc", "finserve"]) {
  let openingGnpa = entity === "hfc" ? 15 : 5; // Starting GNPA in Cr

  for (const q of quarters) {
    // GNPA grows gradually, with acceleration in FY25
    const isFY25 = q.startsWith("FY25");
    const additionRate = entity === "hfc"
      ? (isFY25 ? normalRand(12, 3) : normalRand(8, 2))
      : (isFY25 ? normalRand(18, 5) : normalRand(10, 3));
    const upgrades = additionRate * clamp(normalRand(0.3, 0.1), 0.1, 0.5);
    const writeOffs = openingGnpa * clamp(normalRand(0.08, 0.03), 0.02, 0.15);
    const recoveries = writeOffs * clamp(normalRand(0.4, 0.1), 0.2, 0.7);

    const closingGnpa = openingGnpa + additionRate - upgrades - writeOffs;
    const totalAum = entity === "hfc" ? TARGET.hfc_aum_cr : TARGET.finserve_aum_cr;
    const gnpaPct = roundTo((closingGnpa / totalAum) * 100, 2);

    npaMovements.push({
      quarter: q,
      entity,
      opening_gnpa_cr: roundTo(openingGnpa, 2),
      additions_cr: roundTo(additionRate, 2),
      upgradations_cr: roundTo(upgrades, 2),
      write_offs_cr: roundTo(writeOffs, 2),
      recoveries_cr: roundTo(recoveries, 2),
      closing_gnpa_cr: roundTo(closingGnpa, 2),
      gnpa_pct: gnpaPct,
    });

    openingGnpa = closingGnpa;
  }
}

writeCsv("npa_movement.csv",
  ["quarter", "entity", "opening_gnpa_cr", "additions_cr", "upgradations_cr",
   "write_offs_cr", "recoveries_cr", "closing_gnpa_cr", "gnpa_pct"],
  npaMovements
);

// ══════════════════════════════════════════════════════════
// SUMMARY STATS
// ══════════════════════════════════════════════════════════

console.log("\n📊 Generation Complete! Summary:");

const hfcLoans = loans.filter(l => l.entity === "hfc");
const finLoans = loans.filter(l => l.entity === "finserve");
const hfcActive = hfcLoans.filter(l => l.loan_status === "active" || l.loan_status === "npa");
const finActive = finLoans.filter(l => l.loan_status === "active" || l.loan_status === "npa");

const hfcAum = hfcActive.reduce((s, l) => s + l.disbursed_amount, 0) / 10000000;
const finAum = finActive.reduce((s, l) => s + l.disbursed_amount, 0) / 10000000;
const hfcGnpa = hfcLoans.filter(l => l.stage === 3 && l.loan_status !== "written_off" && l.loan_status !== "closed").length / hfcActive.length * 100;
const finGnpa = finLoans.filter(l => l.stage === 3 && l.loan_status !== "written_off" && l.loan_status !== "closed").length / finActive.length * 100;
const hlPct = hfcLoans.filter(l => l.product_type.startsWith("home")).reduce((s, l) => s + l.disbursed_amount, 0) / hfcLoans.reduce((s, l) => s + l.disbursed_amount, 0) * 100;
const sePct = loans.filter(l => {
  const b = borrowers[l.borrower_id - 1];
  return b && b.employment_type.startsWith("self_employed");
}).length / loans.length * 100;

console.log(`  HFC AUM: ₹${hfcAum.toFixed(0)} Cr (target: ${TARGET.hfc_aum_cr})`);
console.log(`  Finserve AUM: ₹${finAum.toFixed(0)} Cr (target: ${TARGET.finserve_aum_cr})`);
console.log(`  HFC Active Loans: ${hfcActive.length.toLocaleString()} (target: ${TARGET.hfc_active_loans.toLocaleString()})`);
console.log(`  Finserve Active: ${finActive.length.toLocaleString()} (target: ${TARGET.finserve_active_loans.toLocaleString()})`);
console.log(`  HFC GNPA: ${hfcGnpa.toFixed(2)}% (target: ${TARGET.hfc_gnpa_pct}%)`);
console.log(`  Finserve GNPA: ${finGnpa.toFixed(2)}% (target: ${TARGET.finserve_gnpa_pct}%)`);
console.log(`  Home Loan %: ${hlPct.toFixed(1)}% (target: 77%)`);
console.log(`  Self-Employed %: ${sePct.toFixed(1)}% (target: 81%)`);
console.log(`  Branches: ${branches.length} (target: ${TARGET.total_branches_consol})`);
console.log(`  Employees: ${employees.length.toLocaleString()} (target: ${TARGET.total_employees.toLocaleString()})`);
console.log(`  Total EMI records: ${emiPayments.length.toLocaleString()}`);
console.log(`  Total loans: ${loans.length.toLocaleString()}`);
console.log(`\n  Output directory: ${OUT_DIR}`);
console.log("  Files: branches.csv, employees.csv, borrowers.csv, co_lending_partners.csv,");
console.log("         loans.csv, emi_payments.csv, disbursements.csv, borrowings.csv,");
console.log("         collections_actions.csv, assignments.csv, provisions.csv, npa_movement.csv\n");
