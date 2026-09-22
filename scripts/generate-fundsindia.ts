/**
 * FundsIndia Synthetic Dataset Generator
 *
 * Generates 10 CSV files for the FundsIndia mutual fund distribution platform demo.
 * Date range: Jun 2024 – May 2026 (24 months, ends today)
 * All distributions grounded in real AMFI data (Mar 2025 report + monthly SIP series).
 *
 * Tables:
 *   1. funds.csv               (~150 rows)      — real fund names, AMC weights, returns
 *   2. investors.csv           (~50,000 rows)   — 35K pre-existing + 15K new in period
 *   3. sips.csv                (~40,000 rows)   — sample SIP registrations
 *   4. transactions.csv        (~500,000 rows)  — installments + lumpsums + redemptions
 *   5. systematic_plans.csv    (~12,000 rows)   — STP / SWP / Super Savings
 *   6. goals.csv               (~65,000 rows)   — Money Mitr + self-set goals
 *   7. comms_log.csv           (~300,000 rows)  — email / push / SMS sends
 *   8. advisory_sessions.csv   (~20,000 rows)   — advisor + Money Mitr interactions
 *   9. support_tickets.csv     (~10,000 rows)   — support cases (KYC spike Jun-Jul 2024)
 *  10. user_events.csv         (~1,500,000 rows)— Mixpanel-style event log (all surfaces)
 *
 * Planted stories:
 *   - SEBI KYC crisis Jun-Jul 2024 (kyc_on_hold spike, support surge)
 *   - Oct 2024 equity correction (email alert open rate 34% vs 22% baseline)
 *   - ELSS tax season × 2 (Jan-Mar 2025 and Jan-Mar 2026: 3.2× SIP creation)
 *   - FI Select → 76% 12-month SIP retention vs 48% regular
 *   - NACH 6.2% failure vs UPI 1.9%
 *   - Pre-redemption call saves 55% of exits
 *   - Calculator → highest LTV acquisition channel
 *   - B30 SIP growth +38% YoY vs T30 +14%
 *
 * Usage: npx tsx scripts/generate-fundsindia.ts
 * Seed: 42 (deterministic, reproduces identical output every run)
 */

import { writeFileSync, appendFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";

const OUT_DIR = resolve(__dirname, "../data/csv/fundsindia");
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

// ════════════════════════════════════════════════════════════════
// SEEDED PRNG (LCG — identical to quickhelp/vastu pattern)
// ════════════════════════════════════════════════════════════════

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
function logNormalRand(mean: number, std: number): number {
  // mean and std of the underlying normal
  return Math.exp(normalRand(mean, std));
}
function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
function roundTo(val: number, d: number): number {
  const f = Math.pow(10, d);
  return Math.round(val * f) / f;
}
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ════════════════════════════════════════════════════════════════
// DATE UTILITIES
// ════════════════════════════════════════════════════════════════

const DATE_START = "2024-06-01";
const DATE_END   = "2026-05-31";

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
function getMonth(date: string): number { return new Date(date).getMonth() + 1; }
function getYear(date: string): number  { return new Date(date).getFullYear(); }
function monthKey(date: string): string { return date.slice(0, 7); } // "YYYY-MM"
function randomDateInMonth(y: number, m: number): string {
  return dateStr(y, m, randInt(1, daysInMonth(y, m)));
}
function randomDateBetween(start: string, end: string): string {
  const days = diffDays(start, end);
  return addDays(start, randInt(0, Math.max(0, days)));
}
function allMonths(start: string, end: string): [number, number][] {
  const months: [number, number][] = [];
  let y = getYear(start), m = getMonth(start);
  const ey = getYear(end), em = getMonth(end);
  while (y < ey || (y === ey && m <= em)) {
    months.push([y, m]);
    m++; if (m > 12) { m = 1; y++; }
  }
  return months;
}
function indianFY(date: string): string {
  const m = getMonth(date), y = getYear(date);
  return m >= 4 ? `FY${(y + 1) % 100}` : `FY${y % 100}`;
}
// Is this date in an ELSS tax season? (Jan 1 – Mar 31)
function isElssSeason(date: string): boolean {
  const m = getMonth(date);
  return m >= 1 && m <= 3;
}
// Season multiplier for SIP creation
function sipSeasonMultiplier(y: number, m: number): number {
  const date = dateStr(y, m, 15);
  // ELSS / tax season
  if (m === 1) return 1.8;
  if (m === 2) return 2.6;
  if (m === 3) return 3.2;
  // Moderate dips
  if (m === 7 || m === 8) return 0.85; // monsoon
  if (m === 11) return 0.90; // post-Diwali
  return 1.0;
}

// Is this month in the KYC crisis window?
function isKycCrisisMonth(y: number, m: number): boolean {
  return (y === 2024 && (m === 6 || m === 7));
}

// ════════════════════════════════════════════════════════════════
// CSV WRITERS
// ════════════════════════════════════════════════════════════════

function escape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// Standard writer (for tables ≤ 500K rows)
function writeCsv(filename: string, headers: string[], rows: Record<string, unknown>[]) {
  const lines = [
    headers.join(","),
    ...rows.map(r => headers.map(h => escape(r[h])).join(","))
  ];
  writeFileSync(resolve(OUT_DIR, filename), lines.join("\n") + "\n");
  console.log(`  ✓ ${filename}: ${rows.length.toLocaleString()} rows`);
}

// Streaming writer for user_events (1.5M rows — too large for in-memory array)
function writeCsvHeader(filename: string, headers: string[]) {
  writeFileSync(resolve(OUT_DIR, filename), headers.join(",") + "\n");
}
function writeCsvChunk(filename: string, headers: string[], rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  const lines = rows.map(r => headers.map(h => escape(r[h])).join(","));
  appendFileSync(resolve(OUT_DIR, filename), lines.join("\n") + "\n");
}

// ════════════════════════════════════════════════════════════════
// CALIBRATION CONSTANTS
// ════════════════════════════════════════════════════════════════

// Synthetic platform context used only to shape the 50K-investor sample.
// These are not surfaced as sample row counts in the app.
const TARGET = {
  aum_cr:              25_000,
  active_sips_end:    270_000,
  active_sips_start:  185_000,
  total_investors:     50_000,   // Dataset sample
  existing_investors:  35_000,   // Signed up pre-Jun-2024 (70%)
  new_investors:       15_000,   // Signed up Jun 2024 – May 2026 (30%)
  market_share:        0.0038,   // 25000 / 6574287 (AMFI Mar 2025)
};

// Real monthly industry SIP inflows (₹ Cr) — complete Jun 2024–May 2026 series
// Sources: Zee Biz (Jun-Jul 2024), Angel One (Nov 2024), Tata MF (Jan-Sep 2025),
//          AMFI Monthly Notes (Oct-Nov 2025), estimates for Dec 2025–May 2026
const INDUSTRY_SIP_CR: Record<string, number> = {
  "2024-06": 21_262, "2024-07": 23_332, "2024-08": 23_547,
  "2024-09": 24_509, "2024-10": 25_013, "2024-11": 25_320,
  "2024-12": 26_459, "2025-01": 26_400, "2025-02": 25_999,
  "2025-03": 25_926, "2025-04": 26_632, "2025-05": 26_688,
  "2025-06": 27_269, "2025-07": 28_464, "2025-08": 28_265,
  "2025-09": 29_361, "2025-10": 29_529, "2025-11": 29_445,
  "2025-12": 29_700, "2026-01": 30_200, "2026-02": 30_500,
  "2026-03": 31_000, "2026-04": 31_400, "2026-05": 31_800,
};
// FI monthly inflow = industry × 0.38%
function fiSipCrForMonth(ym: string): number {
  return (INDUSTRY_SIP_CR[ym] ?? 25_000) * TARGET.market_share;
}

// AMC market weights (real, AdvisorKhoj Jul 2025)
const AMC_WEIGHTS: [string, number][] = [
  ["SBI Mutual Fund",           0.177],
  ["ICICI Prudential",          0.150],
  ["HDFC Mutual Fund",          0.130],
  ["Nippon India",              0.097],
  ["Kotak Mahindra",            0.082],
  ["Aditya Birla Sun Life",     0.063],
  ["Axis Mutual Fund",          0.052],
  ["UTI Mutual Fund",           0.056],
  ["Mirae Asset",               0.035],
  ["Parag Parikh (PPFAS)",      0.030],
  ["DSP Mutual Fund",           0.031],
  ["Tata Mutual Fund",          0.032],
  ["Franklin Templeton",        0.015],
  ["Canara Robeco",             0.012],
  ["Edelweiss",                 0.010],
  ["Motilal Oswal",             0.009],
  ["Quant Mutual Fund",         0.008],
  ["360 ONE AMC",               0.006],
  ["Bandhan MF",                0.005],
];

// FundsIndia category mix (adjusted from AMFI industry — advisory bias)
const CATEGORY_WEIGHTS: [string, number][] = [
  ["equity_largecap",   0.10],
  ["equity_midcap",     0.09],
  ["equity_smallcap",   0.08],
  ["equity_flexicap",   0.10],
  ["equity_multicap",   0.05],
  ["equity_sectoral",   0.06],
  ["elss",              0.09],
  ["daaf",              0.07],
  ["hybrid_aggressive", 0.05],
  ["debt",              0.13],
  ["liquid",            0.08],
  ["global",            0.03],
  ["index",             0.02],
  ["gold",              0.05],
];

// Geographic distribution (AMFI state-wise folio data)
interface StateDef { name: string; weight: number; tier: string; cities: string[] }
const STATES: StateDef[] = [
  { name: "Maharashtra",     weight: 0.18, tier: "t30", cities: ["Mumbai","Pune","Thane","Nagpur","Nashik"] },
  { name: "Karnataka",       weight: 0.12, tier: "t30", cities: ["Bengaluru","Mysuru","Hubli","Mangaluru"] },
  { name: "Delhi",           weight: 0.10, tier: "t30", cities: ["New Delhi","Gurgaon","Noida","Faridabad"] },
  { name: "Tamil Nadu",      weight: 0.08, tier: "t30", cities: ["Chennai","Coimbatore","Madurai","Tiruchirappalli"] },
  { name: "Gujarat",         weight: 0.07, tier: "t30", cities: ["Ahmedabad","Surat","Vadodara","Rajkot"] },
  { name: "Rajasthan",       weight: 0.05, tier: "b30", cities: ["Jaipur","Jodhpur","Udaipur","Kota"] },
  { name: "Uttar Pradesh",   weight: 0.05, tier: "b30", cities: ["Lucknow","Kanpur","Agra","Varanasi"] },
  { name: "West Bengal",     weight: 0.04, tier: "t30", cities: ["Kolkata","Howrah","Durgapur"] },
  { name: "Telangana",       weight: 0.04, tier: "t30", cities: ["Hyderabad","Warangal","Karimnagar"] },
  { name: "Andhra Pradesh",  weight: 0.03, tier: "b30", cities: ["Visakhapatnam","Vijayawada","Tirupati"] },
  { name: "Madhya Pradesh",  weight: 0.04, tier: "b30", cities: ["Indore","Bhopal","Jabalpur","Ratlam"] },
  { name: "Punjab",          weight: 0.03, tier: "b30", cities: ["Chandigarh","Ludhiana","Amritsar"] },
  { name: "Haryana",         weight: 0.03, tier: "t30", cities: ["Gurgaon","Faridabad","Panipat"] },
  { name: "Kerala",          weight: 0.03, tier: "b30", cities: ["Kochi","Thiruvananthapuram","Calicut"] },
  { name: "Others",          weight: 0.11, tier: "b30", cities: ["Patna","Bhubaneswar","Dehradun","Raipur","Surat"] },
];

function pickState(): StateDef {
  return weightedPick(STATES, STATES.map(s => s.weight));
}

// First names (Indian, gender-split)
const MALE_NAMES = ["Rahul","Amit","Vijay","Rajesh","Sanjay","Suresh","Anil","Ravi","Kiran","Deepak",
  "Pradeep","Ramesh","Ashok","Vinod","Manoj","Sandeep","Nitin","Rohit","Vikas","Arjun",
  "Nikhil","Akash","Harsh","Dev","Rishabh","Sahil","Pranav","Varun","Kartik","Yash",
  "Aryan","Kunal","Rohan","Aarav","Vivek","Gaurav","Mohit","Sumit","Tarun","Ankit"];
const FEMALE_NAMES = ["Priya","Sunita","Anjali","Rekha","Kavita","Meena","Pooja","Neha","Swati","Sneha",
  "Asha","Divya","Anita","Seema","Ritu","Shweta","Nidhi","Pallavi","Shilpa","Deepa",
  "Aarti","Preeti","Nisha","Sonal","Kratika","Richa","Mansi","Megha","Tanvi","Aditi",
  "Ishita","Simran","Shruti","Tanya","Komal","Disha","Payal","Bhavna","Ruhi","Isha"];
const LAST_NAMES = ["Sharma","Verma","Singh","Patel","Kumar","Gupta","Joshi","Shah","Mehta","Rao",
  "Nair","Reddy","Iyer","Pillai","Menon","Tiwari","Mishra","Pandey","Sinha","Das",
  "Bose","Chatterjee","Banerjee","Mukherjee","Ghosh","Agarwal","Jain","Malhotra","Khanna","Chopra",
  "Kaur","Gill","Sandhu","Grewal","Sethi","Bhatt","Kapoor","Arora","Mathur","Bajaj"];

function fullName(gender: string): string {
  const first = gender === "male" ? pick(MALE_NAMES) : pick(FEMALE_NAMES);
  return `${first} ${pick(LAST_NAMES)}`;
}

// ════════════════════════════════════════════════════════════════
// STEP 1: FUNDS (~150 real fund names from AMFI)
// ════════════════════════════════════════════════════════════════

interface Fund {
  fund_id: string;
  fund_name: string;
  amc_name: string;
  category: string;
  subcategory: string;
  risk_level: string;
  trailing_commission_pct: number;
  inception_year: number;
  benchmark_index: string;
  return_1y: number;
  return_3y: number;
  return_5y: number;
  fi_star_rating: number;
  is_fi_select: boolean;
  is_trending_now: boolean;
  is_investor_favourite: boolean;
  is_gold_fund: boolean;
  is_global_fund: boolean;
  platform_investor_count: number;
}

// Real fund names organized by category
const FUND_DEFINITIONS: Omit<Fund, "fund_id" | "trailing_commission_pct" | "return_1y" | "return_3y" | "return_5y" | "fi_star_rating" | "platform_investor_count">[] = [
  // ── LARGE CAP (18) ──
  { fund_name: "SBI Bluechip Fund - Regular Plan - Growth",              amc_name: "SBI Mutual Fund",           category: "equity", subcategory: "large_cap", risk_level: "moderately_high", inception_year: 2006, benchmark_index: "NIFTY 100",     is_fi_select: true,  is_trending_now: false, is_investor_favourite: true,  is_gold_fund: false, is_global_fund: false },
  { fund_name: "HDFC Top 100 Fund - Regular Plan - Growth",              amc_name: "HDFC Mutual Fund",          category: "equity", subcategory: "large_cap", risk_level: "moderately_high", inception_year: 1996, benchmark_index: "NIFTY 100",     is_fi_select: true,  is_trending_now: false, is_investor_favourite: true,  is_gold_fund: false, is_global_fund: false },
  { fund_name: "ICICI Prudential Bluechip Fund - Growth",                amc_name: "ICICI Prudential",          category: "equity", subcategory: "large_cap", risk_level: "moderately_high", inception_year: 2008, benchmark_index: "NIFTY 100",     is_fi_select: false, is_trending_now: false, is_investor_favourite: true,  is_gold_fund: false, is_global_fund: false },
  { fund_name: "Nippon India Large Cap Fund - Growth",                   amc_name: "Nippon India",              category: "equity", subcategory: "large_cap", risk_level: "moderately_high", inception_year: 2004, benchmark_index: "NIFTY 100",     is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Axis Bluechip Fund - Regular Growth",                    amc_name: "Axis Mutual Fund",          category: "equity", subcategory: "large_cap", risk_level: "moderately_high", inception_year: 2010, benchmark_index: "NIFTY 50",      is_fi_select: false, is_trending_now: false, is_investor_favourite: true,  is_gold_fund: false, is_global_fund: false },
  { fund_name: "Mirae Asset Large Cap Fund - Regular Plan - Growth",     amc_name: "Mirae Asset",               category: "equity", subcategory: "large_cap", risk_level: "moderately_high", inception_year: 2008, benchmark_index: "NIFTY 100",     is_fi_select: true,  is_trending_now: false, is_investor_favourite: true,  is_gold_fund: false, is_global_fund: false },
  { fund_name: "Kotak Bluechip Fund - Regular Plan - Growth",            amc_name: "Kotak Mahindra",            category: "equity", subcategory: "large_cap", risk_level: "moderately_high", inception_year: 2001, benchmark_index: "NIFTY 50",      is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Aditya Birla Sun Life Frontline Equity Fund - Growth",   amc_name: "Aditya Birla Sun Life",     category: "equity", subcategory: "large_cap", risk_level: "moderately_high", inception_year: 2002, benchmark_index: "NIFTY 100",     is_fi_select: false, is_trending_now: false, is_investor_favourite: true,  is_gold_fund: false, is_global_fund: false },
  { fund_name: "UTI Mastershare Fund - Regular Growth",                  amc_name: "UTI Mutual Fund",           category: "equity", subcategory: "large_cap", risk_level: "moderately_high", inception_year: 1986, benchmark_index: "NIFTY 50",      is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Canara Robeco Bluechip Equity Fund - Regular Growth",    amc_name: "Canara Robeco",             category: "equity", subcategory: "large_cap", risk_level: "moderately_high", inception_year: 2010, benchmark_index: "NIFTY 100",     is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "DSP Top 100 Equity Fund - Regular Plan - Growth",        amc_name: "DSP Mutual Fund",           category: "equity", subcategory: "large_cap", risk_level: "moderately_high", inception_year: 2003, benchmark_index: "NIFTY 100",     is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Franklin India Bluechip Fund - Growth",                  amc_name: "Franklin Templeton",        category: "equity", subcategory: "large_cap", risk_level: "moderately_high", inception_year: 1993, benchmark_index: "BSE SENSEX",    is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Tata Large Cap Fund - Regular Plan - Growth",            amc_name: "Tata Mutual Fund",          category: "equity", subcategory: "large_cap", risk_level: "moderately_high", inception_year: 1996, benchmark_index: "NIFTY 100",     is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },

  // ── LARGE & MID CAP (5) ──
  { fund_name: "Kotak Large & Midcap Fund - Regular Growth",             amc_name: "Kotak Mahindra",            category: "equity", subcategory: "large_and_midcap", risk_level: "high", inception_year: 2011, benchmark_index: "NIFTY LargeMidcap 250", is_fi_select: true,  is_trending_now: true,  is_investor_favourite: true,  is_gold_fund: false, is_global_fund: false },
  { fund_name: "Mirae Asset Large & Midcap Fund - Regular Plan - Growth",amc_name: "Mirae Asset",               category: "equity", subcategory: "large_and_midcap", risk_level: "high", inception_year: 2010, benchmark_index: "NIFTY LargeMidcap 250", is_fi_select: true,  is_trending_now: false, is_investor_favourite: true,  is_gold_fund: false, is_global_fund: false },
  { fund_name: "SBI Large & Midcap Fund - Regular Plan - Growth",        amc_name: "SBI Mutual Fund",           category: "equity", subcategory: "large_and_midcap", risk_level: "high", inception_year: 2005, benchmark_index: "NIFTY LargeMidcap 250", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Canara Robeco Emerging Equities Fund - Regular Growth",  amc_name: "Canara Robeco",             category: "equity", subcategory: "large_and_midcap", risk_level: "high", inception_year: 2005, benchmark_index: "NIFTY LargeMidcap 250", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "HDFC Large and Mid Cap Fund - Regular Plan - Growth",    amc_name: "HDFC Mutual Fund",          category: "equity", subcategory: "large_and_midcap", risk_level: "high", inception_year: 1994, benchmark_index: "NIFTY LargeMidcap 250", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },

  // ── MID CAP (12) ──
  { fund_name: "Kotak Emerging Equity Fund - Regular Plan - Growth",     amc_name: "Kotak Mahindra",            category: "equity", subcategory: "mid_cap", risk_level: "high", inception_year: 2007, benchmark_index: "NIFTY Midcap 150",  is_fi_select: true,  is_trending_now: true,  is_investor_favourite: true,  is_gold_fund: false, is_global_fund: false },
  { fund_name: "Kotak Midcap Fund - Regular Growth",                     amc_name: "Kotak Mahindra",            category: "equity", subcategory: "mid_cap", risk_level: "high", inception_year: 2005, benchmark_index: "NIFTY Midcap 150",  is_fi_select: true,  is_trending_now: true,  is_investor_favourite: true,  is_gold_fund: false, is_global_fund: false },
  { fund_name: "Nippon India Growth Fund - Regular Plan - Growth",       amc_name: "Nippon India",              category: "equity", subcategory: "mid_cap", risk_level: "high", inception_year: 1995, benchmark_index: "NIFTY Midcap 100",  is_fi_select: false, is_trending_now: false, is_investor_favourite: true,  is_gold_fund: false, is_global_fund: false },
  { fund_name: "HDFC Mid-Cap Opportunities Fund - Growth",               amc_name: "HDFC Mutual Fund",          category: "equity", subcategory: "mid_cap", risk_level: "high", inception_year: 2007, benchmark_index: "NIFTY Midcap 150",  is_fi_select: false, is_trending_now: true,  is_investor_favourite: true,  is_gold_fund: false, is_global_fund: false },
  { fund_name: "Axis Midcap Fund - Regular Growth",                      amc_name: "Axis Mutual Fund",          category: "equity", subcategory: "mid_cap", risk_level: "high", inception_year: 2011, benchmark_index: "NIFTY Midcap 150",  is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Mirae Asset Midcap Fund - Regular Plan - Growth",        amc_name: "Mirae Asset",               category: "equity", subcategory: "mid_cap", risk_level: "high", inception_year: 2019, benchmark_index: "NIFTY Midcap 150",  is_fi_select: true,  is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Edelweiss Mid Cap Fund - Regular Plan - Growth",         amc_name: "Edelweiss",                 category: "equity", subcategory: "mid_cap", risk_level: "high", inception_year: 2007, benchmark_index: "NIFTY Midcap 150",  is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "DSP Midcap Fund - Regular Plan - Growth",                amc_name: "DSP Mutual Fund",           category: "equity", subcategory: "mid_cap", risk_level: "high", inception_year: 2006, benchmark_index: "NIFTY Midcap 150",  is_fi_select: false, is_trending_now: false, is_investor_favourite: true,  is_gold_fund: false, is_global_fund: false },
  { fund_name: "SBI Magnum Midcap Fund - Regular Plan - Growth",         amc_name: "SBI Mutual Fund",           category: "equity", subcategory: "mid_cap", risk_level: "high", inception_year: 2005, benchmark_index: "NIFTY Midcap 150",  is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Franklin India Prima Fund - Regular Plan - Growth",      amc_name: "Franklin Templeton",        category: "equity", subcategory: "mid_cap", risk_level: "high", inception_year: 1993, benchmark_index: "NIFTY Midcap 100",  is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "PGIM India Midcap Opportunities Fund - Regular Growth",  amc_name: "Nippon India",              category: "equity", subcategory: "mid_cap", risk_level: "high", inception_year: 2010, benchmark_index: "NIFTY Midcap 150",  is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Tata Mid Cap Growth Fund - Regular Plan - Growth",       amc_name: "Tata Mutual Fund",          category: "equity", subcategory: "mid_cap", risk_level: "high", inception_year: 1994, benchmark_index: "NIFTY Midcap 150",  is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },

  // ── SMALL CAP (10) ──
  { fund_name: "Nippon India Small Cap Fund - Growth",                   amc_name: "Nippon India",              category: "equity", subcategory: "small_cap", risk_level: "very_high", inception_year: 2010, benchmark_index: "NIFTY Smallcap 250", is_fi_select: true,  is_trending_now: true,  is_investor_favourite: true,  is_gold_fund: false, is_global_fund: false },
  { fund_name: "SBI Small Cap Fund - Regular Plan - Growth",             amc_name: "SBI Mutual Fund",           category: "equity", subcategory: "small_cap", risk_level: "very_high", inception_year: 2009, benchmark_index: "BSE SmallCap",      is_fi_select: true,  is_trending_now: false, is_investor_favourite: true,  is_gold_fund: false, is_global_fund: false },
  { fund_name: "HDFC Small Cap Fund - Regular Plan - Growth",            amc_name: "HDFC Mutual Fund",          category: "equity", subcategory: "small_cap", risk_level: "very_high", inception_year: 2008, benchmark_index: "NIFTY Smallcap 250", is_fi_select: false, is_trending_now: false, is_investor_favourite: true,  is_gold_fund: false, is_global_fund: false },
  { fund_name: "Axis Small Cap Fund - Regular Growth",                   amc_name: "Axis Mutual Fund",          category: "equity", subcategory: "small_cap", risk_level: "very_high", inception_year: 2013, benchmark_index: "NIFTY Smallcap 250", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Kotak Small Cap Fund - Regular Plan - Growth",           amc_name: "Kotak Mahindra",            category: "equity", subcategory: "small_cap", risk_level: "very_high", inception_year: 2004, benchmark_index: "NIFTY Smallcap 250", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "DSP Small Cap Fund - Regular Plan - Growth",             amc_name: "DSP Mutual Fund",           category: "equity", subcategory: "small_cap", risk_level: "very_high", inception_year: 2007, benchmark_index: "NIFTY Smallcap 250", is_fi_select: false, is_trending_now: true,  is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Quant Small Cap Fund - Regular Plan - Growth",           amc_name: "Quant Mutual Fund",         category: "equity", subcategory: "small_cap", risk_level: "very_high", inception_year: 1996, benchmark_index: "BSE SmallCap",      is_fi_select: false, is_trending_now: true,  is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Canara Robeco Small Cap Fund - Regular Growth",          amc_name: "Canara Robeco",             category: "equity", subcategory: "small_cap", risk_level: "very_high", inception_year: 2019, benchmark_index: "NIFTY Smallcap 250", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Tata Small Cap Fund - Regular Plan - Growth",            amc_name: "Tata Mutual Fund",          category: "equity", subcategory: "small_cap", risk_level: "very_high", inception_year: 2018, benchmark_index: "NIFTY Smallcap 250", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Franklin India Smaller Companies Fund - Regular Growth", amc_name: "Franklin Templeton",        category: "equity", subcategory: "small_cap", risk_level: "very_high", inception_year: 2006, benchmark_index: "NIFTY Smallcap 100", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },

  // ── FLEXI CAP (11) ──
  { fund_name: "Parag Parikh Flexi Cap Fund - Regular Plan - Growth",    amc_name: "Parag Parikh (PPFAS)",      category: "equity", subcategory: "flexi_cap", risk_level: "high", inception_year: 2013, benchmark_index: "NIFTY 500",          is_fi_select: true,  is_trending_now: true,  is_investor_favourite: true,  is_gold_fund: false, is_global_fund: false },
  { fund_name: "HDFC Flexi Cap Fund - Regular Plan - Growth",            amc_name: "HDFC Mutual Fund",          category: "equity", subcategory: "flexi_cap", risk_level: "high", inception_year: 1994, benchmark_index: "NIFTY 500",          is_fi_select: true,  is_trending_now: false, is_investor_favourite: true,  is_gold_fund: false, is_global_fund: false },
  { fund_name: "Kotak Flexicap Fund - Regular Plan - Growth",            amc_name: "Kotak Mahindra",            category: "equity", subcategory: "flexi_cap", risk_level: "high", inception_year: 1999, benchmark_index: "NIFTY 500",          is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "SBI Flexicap Fund - Regular Plan - Growth",              amc_name: "SBI Mutual Fund",           category: "equity", subcategory: "flexi_cap", risk_level: "high", inception_year: 2005, benchmark_index: "BSE 500",            is_fi_select: false, is_trending_now: false, is_investor_favourite: true,  is_gold_fund: false, is_global_fund: false },
  { fund_name: "ICICI Prudential Flexicap Fund - Growth",                amc_name: "ICICI Prudential",          category: "equity", subcategory: "flexi_cap", risk_level: "high", inception_year: 1994, benchmark_index: "NIFTY 500",          is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Axis Flexi Cap Fund - Regular Growth",                   amc_name: "Axis Mutual Fund",          category: "equity", subcategory: "flexi_cap", risk_level: "high", inception_year: 2020, benchmark_index: "NIFTY 500",          is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "UTI Flexi Cap Fund - Regular Growth",                    amc_name: "UTI Mutual Fund",           category: "equity", subcategory: "flexi_cap", risk_level: "high", inception_year: 1992, benchmark_index: "NIFTY 500",          is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "DSP Flexi Cap Fund - Regular Plan - Growth",             amc_name: "DSP Mutual Fund",           category: "equity", subcategory: "flexi_cap", risk_level: "high", inception_year: 2007, benchmark_index: "NIFTY 500",          is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Franklin India Flexi Cap Fund - Regular Growth",         amc_name: "Franklin Templeton",        category: "equity", subcategory: "flexi_cap", risk_level: "high", inception_year: 1994, benchmark_index: "BSE 500",            is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Mirae Asset Flexi Cap Fund - Regular Plan - Growth",     amc_name: "Mirae Asset",               category: "equity", subcategory: "flexi_cap", risk_level: "high", inception_year: 2020, benchmark_index: "NIFTY 500",          is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Aditya Birla Sun Life Flexi Cap Fund - Regular Growth",  amc_name: "Aditya Birla Sun Life",     category: "equity", subcategory: "flexi_cap", risk_level: "high", inception_year: 1995, benchmark_index: "BSE 500",            is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },

  // ── MULTI CAP (5) ──
  { fund_name: "Nippon India Multi Cap Fund - Growth",                   amc_name: "Nippon India",              category: "equity", subcategory: "multi_cap", risk_level: "very_high", inception_year: 2005, benchmark_index: "NIFTY 500 Multicap", is_fi_select: false, is_trending_now: true,  is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Kotak Multicap Fund - Regular Plan - Growth",            amc_name: "Kotak Mahindra",            category: "equity", subcategory: "multi_cap", risk_level: "very_high", inception_year: 2021, benchmark_index: "NIFTY 500 Multicap", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "HDFC Multi Cap Fund - Regular Plan - Growth",            amc_name: "HDFC Mutual Fund",          category: "equity", subcategory: "multi_cap", risk_level: "very_high", inception_year: 2021, benchmark_index: "NIFTY 500 Multicap", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "SBI Multicap Fund - Regular Plan - Growth",              amc_name: "SBI Mutual Fund",           category: "equity", subcategory: "multi_cap", risk_level: "very_high", inception_year: 2021, benchmark_index: "NIFTY 500 Multicap", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Quant Active Fund - Regular Plan - Growth",              amc_name: "Quant Mutual Fund",         category: "equity", subcategory: "multi_cap", risk_level: "very_high", inception_year: 2001, benchmark_index: "NIFTY 500",          is_fi_select: false, is_trending_now: true,  is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },

  // ── SECTORAL / THEMATIC (10) ──
  { fund_name: "Nippon India Banking Fund - Regular Plan - Growth",          amc_name: "Nippon India",          category: "equity", subcategory: "sectoral", risk_level: "very_high", inception_year: 2003, benchmark_index: "NIFTY Bank",            is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "SBI Banking & Financial Services Fund - Regular Growth",     amc_name: "SBI Mutual Fund",       category: "equity", subcategory: "sectoral", risk_level: "very_high", inception_year: 2015, benchmark_index: "NIFTY Financial Services", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "ICICI Prudential Technology Fund - Growth",                  amc_name: "ICICI Prudential",      category: "equity", subcategory: "sectoral", risk_level: "very_high", inception_year: 1999, benchmark_index: "NIFTY IT",              is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "SBI Technology Opportunities Fund - Regular Plan - Growth",  amc_name: "SBI Mutual Fund",       category: "equity", subcategory: "sectoral", risk_level: "very_high", inception_year: 2004, benchmark_index: "NIFTY IT",              is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "DSP India T.I.G.E.R. Fund - Regular Plan - Growth",         amc_name: "DSP Mutual Fund",       category: "equity", subcategory: "sectoral", risk_level: "very_high", inception_year: 2004, benchmark_index: "NIFTY Infrastructure",  is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Aditya Birla Sun Life Healthcare Fund - Regular Growth",     amc_name: "Aditya Birla Sun Life", category: "equity", subcategory: "sectoral", risk_level: "very_high", inception_year: 2015, benchmark_index: "NIFTY Healthcare",      is_fi_select: false, is_trending_now: true,  is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Quant Infrastructure Fund - Regular Plan - Growth",          amc_name: "Quant Mutual Fund",     category: "equity", subcategory: "sectoral", risk_level: "very_high", inception_year: 2007, benchmark_index: "NIFTY Infrastructure",  is_fi_select: false, is_trending_now: true,  is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Motilal Oswal Midcap Fund - Regular Plan - Growth",          amc_name: "Motilal Oswal",         category: "equity", subcategory: "sectoral", risk_level: "very_high", inception_year: 2014, benchmark_index: "NIFTY Midcap 150",      is_fi_select: false, is_trending_now: true,  is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "360 ONE Quant Fund - Regular Plan - Growth",                 amc_name: "360 ONE AMC",           category: "equity", subcategory: "sectoral", risk_level: "very_high", inception_year: 2020, benchmark_index: "NIFTY 200",             is_fi_select: true,  is_trending_now: true,  is_investor_favourite: true,  is_gold_fund: false, is_global_fund: false },
  { fund_name: "Mirae Asset Healthcare Fund - Regular Plan - Growth",        amc_name: "Mirae Asset",           category: "equity", subcategory: "sectoral", risk_level: "very_high", inception_year: 2018, benchmark_index: "NIFTY Healthcare",      is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },

  // ── ELSS (12) ──
  { fund_name: "Axis Long Term Equity Fund - Regular Growth",              amc_name: "Axis Mutual Fund",          category: "elss", subcategory: "elss", risk_level: "high", inception_year: 2009, benchmark_index: "NIFTY 500",    is_fi_select: true,  is_trending_now: false, is_investor_favourite: true,  is_gold_fund: false, is_global_fund: false },
  { fund_name: "Mirae Asset ELSS Tax Saver Fund - Regular Plan - Growth",  amc_name: "Mirae Asset",               category: "elss", subcategory: "elss", risk_level: "high", inception_year: 2015, benchmark_index: "NIFTY 500",    is_fi_select: true,  is_trending_now: false, is_investor_favourite: true,  is_gold_fund: false, is_global_fund: false },
  { fund_name: "Quant ELSS Tax Saver Fund - Regular Plan - Growth",        amc_name: "Quant Mutual Fund",         category: "elss", subcategory: "elss", risk_level: "high", inception_year: 2000, benchmark_index: "BSE 500",      is_fi_select: false, is_trending_now: true,  is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "DSP Tax Saver Fund - Regular Plan - Growth",               amc_name: "DSP Mutual Fund",           category: "elss", subcategory: "elss", risk_level: "high", inception_year: 2007, benchmark_index: "NIFTY 500",    is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "SBI Long Term Equity Fund - Regular Plan - Growth",        amc_name: "SBI Mutual Fund",           category: "elss", subcategory: "elss", risk_level: "high", inception_year: 1993, benchmark_index: "BSE 500",      is_fi_select: false, is_trending_now: false, is_investor_favourite: true,  is_gold_fund: false, is_global_fund: false },
  { fund_name: "HDFC Taxsaver Fund - Regular Plan - Growth",               amc_name: "HDFC Mutual Fund",          category: "elss", subcategory: "elss", risk_level: "high", inception_year: 1996, benchmark_index: "NIFTY 500",    is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "ICICI Prudential Long Term Equity Fund - Growth",          amc_name: "ICICI Prudential",          category: "elss", subcategory: "elss", risk_level: "high", inception_year: 1999, benchmark_index: "NIFTY 500",    is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Aditya Birla Sun Life ELSS Tax Saver Fund - Growth",       amc_name: "Aditya Birla Sun Life",     category: "elss", subcategory: "elss", risk_level: "high", inception_year: 1999, benchmark_index: "BSE 500",      is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Kotak ELSS Tax Saver Fund - Regular Plan - Growth",        amc_name: "Kotak Mahindra",            category: "elss", subcategory: "elss", risk_level: "high", inception_year: 2005, benchmark_index: "NIFTY 500",    is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Franklin India ELSS Tax Saver Fund - Regular Growth",      amc_name: "Franklin Templeton",        category: "elss", subcategory: "elss", risk_level: "high", inception_year: 1999, benchmark_index: "BSE 500",      is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Canara Robeco Equity Tax Saver Fund - Regular Growth",     amc_name: "Canara Robeco",             category: "elss", subcategory: "elss", risk_level: "high", inception_year: 2009, benchmark_index: "BSE 500",      is_fi_select: true,  is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Nippon India Tax Saver Fund - Growth",                     amc_name: "Nippon India",              category: "elss", subcategory: "elss", risk_level: "high", inception_year: 2005, benchmark_index: "NIFTY 500",    is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },

  // ── DAAF / BALANCED ADVANTAGE (10) ──
  { fund_name: "ICICI Prudential Balanced Advantage Fund - Growth",       amc_name: "ICICI Prudential",          category: "daaf", subcategory: "balanced_advantage", risk_level: "moderate", inception_year: 2006, benchmark_index: "NIFTY 50", is_fi_select: true,  is_trending_now: false, is_investor_favourite: true,  is_gold_fund: false, is_global_fund: false },
  { fund_name: "HDFC Balanced Advantage Fund - Regular Plan - Growth",   amc_name: "HDFC Mutual Fund",          category: "daaf", subcategory: "balanced_advantage", risk_level: "moderate", inception_year: 1994, benchmark_index: "NIFTY 50", is_fi_select: true,  is_trending_now: false, is_investor_favourite: true,  is_gold_fund: false, is_global_fund: false },
  { fund_name: "SBI Balanced Advantage Fund - Regular Plan - Growth",    amc_name: "SBI Mutual Fund",           category: "daaf", subcategory: "balanced_advantage", risk_level: "moderate", inception_year: 2021, benchmark_index: "NIFTY 50", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Edelweiss Balanced Advantage Fund - Regular Plan - Growth", amc_name: "Edelweiss",             category: "daaf", subcategory: "balanced_advantage", risk_level: "moderate", inception_year: 2009, benchmark_index: "NIFTY 50", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Kotak Balanced Advantage Fund - Regular Plan - Growth",  amc_name: "Kotak Mahindra",            category: "daaf", subcategory: "balanced_advantage", risk_level: "moderate", inception_year: 2018, benchmark_index: "NIFTY 50", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Nippon India Balanced Advantage Fund - Growth",          amc_name: "Nippon India",              category: "daaf", subcategory: "balanced_advantage", risk_level: "moderate", inception_year: 2004, benchmark_index: "NIFTY 50", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Aditya Birla Sun Life Balanced Advantage Fund - Growth", amc_name: "Aditya Birla Sun Life",     category: "daaf", subcategory: "balanced_advantage", risk_level: "moderate", inception_year: 2000, benchmark_index: "NIFTY 50", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "DSP Dynamic Asset Allocation Fund - Regular Plan - Growth", amc_name: "DSP Mutual Fund",        category: "daaf", subcategory: "balanced_advantage", risk_level: "moderate", inception_year: 2014, benchmark_index: "NIFTY 50", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "UTI Dynamic Asset Allocation Fund - Regular Growth",     amc_name: "UTI Mutual Fund",           category: "daaf", subcategory: "balanced_advantage", risk_level: "moderate", inception_year: 2014, benchmark_index: "NIFTY 50", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Tata Balanced Advantage Fund - Regular Plan - Growth",   amc_name: "Tata Mutual Fund",          category: "daaf", subcategory: "balanced_advantage", risk_level: "moderate", inception_year: 2018, benchmark_index: "NIFTY 50", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },

  // ── HYBRID AGGRESSIVE (8) ──
  { fund_name: "ICICI Prudential Equity & Debt Fund - Growth",            amc_name: "ICICI Prudential",          category: "hybrid", subcategory: "aggressive_hybrid", risk_level: "moderately_high", inception_year: 1999, benchmark_index: "NIFTY 50 Hybrid Composite", is_fi_select: true,  is_trending_now: false, is_investor_favourite: true,  is_gold_fund: false, is_global_fund: false },
  { fund_name: "HDFC Hybrid Equity Fund - Regular Plan - Growth",         amc_name: "HDFC Mutual Fund",          category: "hybrid", subcategory: "aggressive_hybrid", risk_level: "moderately_high", inception_year: 1994, benchmark_index: "NIFTY 50 Hybrid Composite", is_fi_select: false, is_trending_now: false, is_investor_favourite: true,  is_gold_fund: false, is_global_fund: false },
  { fund_name: "SBI Equity Hybrid Fund - Regular Plan - Growth",          amc_name: "SBI Mutual Fund",           category: "hybrid", subcategory: "aggressive_hybrid", risk_level: "moderately_high", inception_year: 2005, benchmark_index: "CRISIL Hybrid 35+65",       is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Mirae Asset Hybrid Equity Fund - Regular Plan - Growth",  amc_name: "Mirae Asset",               category: "hybrid", subcategory: "aggressive_hybrid", risk_level: "moderately_high", inception_year: 2015, benchmark_index: "NIFTY 50 Hybrid Composite", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Kotak Equity Hybrid Fund - Regular Plan - Growth",        amc_name: "Kotak Mahindra",            category: "hybrid", subcategory: "aggressive_hybrid", risk_level: "moderately_high", inception_year: 2014, benchmark_index: "NIFTY 50 Hybrid Composite", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Canara Robeco Equity Hybrid Fund - Regular Growth",       amc_name: "Canara Robeco",             category: "hybrid", subcategory: "aggressive_hybrid", risk_level: "moderately_high", inception_year: 1992, benchmark_index: "CRISIL Hybrid 35+65",       is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "UTI Aggressive Hybrid Fund - Regular Growth",             amc_name: "UTI Mutual Fund",           category: "hybrid", subcategory: "aggressive_hybrid", risk_level: "moderately_high", inception_year: 1995, benchmark_index: "CRISIL Hybrid 35+65",       is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Franklin India Equity Hybrid Fund - Regular Growth",      amc_name: "Franklin Templeton",        category: "hybrid", subcategory: "aggressive_hybrid", risk_level: "moderately_high", inception_year: 1999, benchmark_index: "NIFTY 50 Hybrid Composite", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },

  // ── GLOBAL / INTERNATIONAL (7) ──
  { fund_name: "Edelweiss Emerging Markets Opportunities Equity Offshore Fund - Regular Growth", amc_name: "Edelweiss", category: "global", subcategory: "emerging_markets", risk_level: "very_high", inception_year: 2014, benchmark_index: "MSCI Emerging Markets", is_fi_select: true, is_trending_now: true, is_investor_favourite: true, is_gold_fund: false, is_global_fund: true },
  { fund_name: "Nippon India US Equity Opportunities Fund - Growth",      amc_name: "Nippon India",              category: "global", subcategory: "us_equity", risk_level: "very_high", inception_year: 2015, benchmark_index: "S&P 500",            is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: true },
  { fund_name: "Motilal Oswal S&P 500 Index Fund - Regular Plan - Growth",amc_name: "Motilal Oswal",             category: "global", subcategory: "us_equity", risk_level: "high",      inception_year: 2020, benchmark_index: "S&P 500",            is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: true },
  { fund_name: "ICICI Prudential US Bluechip Equity Fund - Growth",       amc_name: "ICICI Prudential",          category: "global", subcategory: "us_equity", risk_level: "very_high", inception_year: 2012, benchmark_index: "S&P 500",            is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: true },
  { fund_name: "Franklin India Feeder-Franklin US Opportunities Fund - Growth", amc_name: "Franklin Templeton",  category: "global", subcategory: "us_equity", risk_level: "very_high", inception_year: 2012, benchmark_index: "Russell 3000",       is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: true },
  { fund_name: "DSP World Gold Fund - Regular Plan - Growth",             amc_name: "DSP Mutual Fund",           category: "global", subcategory: "global_blend", risk_level: "high", inception_year: 2007, benchmark_index: "NYSE Arca Gold Miners", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: true },
  { fund_name: "SBI International Access - US Equity FoF - Regular Growth", amc_name: "SBI Mutual Fund",        category: "global", subcategory: "us_equity", risk_level: "very_high", inception_year: 2020, benchmark_index: "S&P 500",            is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: true },

  // ── DEBT (12) ──
  { fund_name: "HDFC Short Term Debt Fund - Regular Plan - Growth",       amc_name: "HDFC Mutual Fund",          category: "debt", subcategory: "short_duration", risk_level: "low",  inception_year: 2002, benchmark_index: "CRISIL Short Duration Debt", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "ICICI Prudential Short Term Fund - Regular Growth",       amc_name: "ICICI Prudential",          category: "debt", subcategory: "short_duration", risk_level: "low",  inception_year: 2001, benchmark_index: "CRISIL Short Duration Debt", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Aditya Birla Sun Life Short Term Fund - Regular Growth",  amc_name: "Aditya Birla Sun Life",     category: "debt", subcategory: "short_duration", risk_level: "low",  inception_year: 1997, benchmark_index: "CRISIL Short Duration Debt", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Kotak Banking and PSU Debt Fund - Regular Plan - Growth", amc_name: "Kotak Mahindra",            category: "debt", subcategory: "banking_psu",    risk_level: "low",  inception_year: 1998, benchmark_index: "CRISIL Banking & PSU Debt", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Nippon India Short Duration Fund - Regular Plan - Growth",amc_name: "Nippon India",              category: "debt", subcategory: "short_duration", risk_level: "low",  inception_year: 2003, benchmark_index: "CRISIL Short Duration Debt", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "SBI Short Term Debt Fund - Regular Plan - Growth",        amc_name: "SBI Mutual Fund",           category: "debt", subcategory: "short_duration", risk_level: "low",  inception_year: 2007, benchmark_index: "CRISIL Short Duration Debt", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Axis Short Duration Fund - Regular Growth",               amc_name: "Axis Mutual Fund",          category: "debt", subcategory: "short_duration", risk_level: "low",  inception_year: 2010, benchmark_index: "CRISIL Short Duration Debt", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "ICICI Prudential Gilt Fund - Regular Plan - Growth",      amc_name: "ICICI Prudential",          category: "debt", subcategory: "gilt",           risk_level: "moderate", inception_year: 1999, benchmark_index: "CRISIL Gilt",           is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "SBI Gilt Fund - Regular Plan - Growth",                   amc_name: "SBI Mutual Fund",           category: "debt", subcategory: "gilt",           risk_level: "moderate", inception_year: 2000, benchmark_index: "CRISIL Gilt",           is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "HDFC Gilt Fund - Regular Plan - Growth",                  amc_name: "HDFC Mutual Fund",          category: "debt", subcategory: "gilt",           risk_level: "moderate", inception_year: 1999, benchmark_index: "CRISIL Gilt",           is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Nippon India Gilt Securities Fund - Regular Plan - Growth",amc_name: "Nippon India",             category: "debt", subcategory: "gilt",           risk_level: "moderate", inception_year: 2003, benchmark_index: "CRISIL Gilt",           is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "DSP Gilt Fund - Regular Plan - Growth",                   amc_name: "DSP Mutual Fund",           category: "debt", subcategory: "gilt",           risk_level: "moderate", inception_year: 1999, benchmark_index: "CRISIL Gilt",           is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },

  // ── LIQUID (5) ──
  { fund_name: "SBI Liquid Fund - Regular Plan - Growth",                 amc_name: "SBI Mutual Fund",           category: "liquid", subcategory: "liquid", risk_level: "low", inception_year: 2003, benchmark_index: "NIFTY Liquid",   is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "HDFC Liquid Fund - Regular Plan - Growth",                amc_name: "HDFC Mutual Fund",          category: "liquid", subcategory: "liquid", risk_level: "low", inception_year: 2000, benchmark_index: "NIFTY Liquid",   is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "ICICI Prudential Liquid Fund - Regular Plan - Growth",    amc_name: "ICICI Prudential",          category: "liquid", subcategory: "liquid", risk_level: "low", inception_year: 2001, benchmark_index: "NIFTY Liquid",   is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Kotak Liquid Fund - Regular Plan - Growth",               amc_name: "Kotak Mahindra",            category: "liquid", subcategory: "liquid", risk_level: "low", inception_year: 2001, benchmark_index: "NIFTY Liquid",   is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Nippon India Liquid Fund - Regular Plan - Growth",        amc_name: "Nippon India",              category: "liquid", subcategory: "liquid", risk_level: "low", inception_year: 2003, benchmark_index: "NIFTY Liquid",   is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },

  // ── GOLD (5) ──
  { fund_name: "SBI Gold Fund - Regular Plan - Growth",                   amc_name: "SBI Mutual Fund",           category: "gold", subcategory: "gold", risk_level: "high",      inception_year: 2011, benchmark_index: "Domestic Gold Price", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: true,  is_global_fund: false },
  { fund_name: "HDFC Gold Fund - Regular Plan - Growth",                  amc_name: "HDFC Mutual Fund",          category: "gold", subcategory: "gold", risk_level: "high",      inception_year: 2011, benchmark_index: "Domestic Gold Price", is_fi_select: false, is_trending_now: true,  is_investor_favourite: false, is_gold_fund: true,  is_global_fund: false },
  { fund_name: "Nippon India Gold Savings Fund - Growth",                 amc_name: "Nippon India",              category: "gold", subcategory: "gold", risk_level: "high",      inception_year: 2011, benchmark_index: "Domestic Gold Price", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: true,  is_global_fund: false },
  { fund_name: "Axis Gold Fund - Regular Growth",                         amc_name: "Axis Mutual Fund",          category: "gold", subcategory: "gold", risk_level: "high",      inception_year: 2011, benchmark_index: "Domestic Gold Price", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: true,  is_global_fund: false },
  { fund_name: "Kotak Gold Fund - Regular Plan - Growth",                 amc_name: "Kotak Mahindra",            category: "gold", subcategory: "gold", risk_level: "high",      inception_year: 2011, benchmark_index: "Domestic Gold Price", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: true,  is_global_fund: false },

  // ── INDEX (5) ──
  { fund_name: "UTI Nifty 50 Index Fund - Regular Plan - Growth",         amc_name: "UTI Mutual Fund",           category: "index", subcategory: "nifty50", risk_level: "moderately_high", inception_year: 2000, benchmark_index: "NIFTY 50", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "HDFC Index Fund - Nifty 50 Plan - Growth",                amc_name: "HDFC Mutual Fund",          category: "index", subcategory: "nifty50", risk_level: "moderately_high", inception_year: 2002, benchmark_index: "NIFTY 50", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "SBI Nifty Index Fund - Regular Plan - Growth",            amc_name: "SBI Mutual Fund",           category: "index", subcategory: "nifty50", risk_level: "moderately_high", inception_year: 2002, benchmark_index: "NIFTY 50", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "Nippon India Index Fund - Nifty 50 Plan - Growth",        amc_name: "Nippon India",              category: "index", subcategory: "nifty50", risk_level: "moderately_high", inception_year: 2010, benchmark_index: "NIFTY 50", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
  { fund_name: "ICICI Prudential Nifty 50 Index Fund - Regular Growth",   amc_name: "ICICI Prudential",          category: "index", subcategory: "nifty50", risk_level: "moderately_high", inception_year: 2002, benchmark_index: "NIFTY 50", is_fi_select: false, is_trending_now: false, is_investor_favourite: false, is_gold_fund: false, is_global_fund: false },
];

// Return ranges by category (realistic as of May 2026 market conditions)
const RETURN_RANGES: Record<string, { r1y: [number, number]; r3y: [number, number]; r5y: [number, number] }> = {
  large_cap:        { r1y: [-8, 18],   r3y: [10, 22], r5y: [12, 20] },
  large_and_midcap: { r1y: [-5, 22],   r3y: [12, 26], r5y: [14, 22] },
  mid_cap:          { r1y: [-10, 28],  r3y: [13, 30], r5y: [15, 28] },
  small_cap:        { r1y: [-15, 35],  r3y: [14, 38], r5y: [16, 32] },
  flexi_cap:        { r1y: [-6, 20],   r3y: [11, 25], r5y: [13, 22] },
  multi_cap:        { r1y: [-8, 25],   r3y: [12, 28], r5y: [14, 25] },
  sectoral:         { r1y: [-20, 45],  r3y: [10, 50], r5y: [12, 40] },
  elss:             { r1y: [-8, 22],   r3y: [11, 24], r5y: [12, 22] },
  balanced_advantage:{ r1y: [2, 14],   r3y: [8, 16],  r5y: [9, 14]  },
  aggressive_hybrid: { r1y: [-4, 18],  r3y: [9, 20],  r5y: [10, 18] },
  emerging_markets: { r1y: [-15, 40],  r3y: [5, 35],  r5y: [8, 30]  },
  us_equity:        { r1y: [5, 25],    r3y: [10, 22], r5y: [12, 20] },
  global_blend:     { r1y: [-10, 20],  r3y: [5, 18],  r5y: [8, 16]  },
  short_duration:   { r1y: [6, 9],     r3y: [6, 9],   r5y: [7, 9]   },
  banking_psu:      { r1y: [6, 9],     r3y: [6, 9],   r5y: [7, 9]   },
  gilt:             { r1y: [4, 12],    r3y: [5, 10],  r5y: [6, 10]  },
  liquid:           { r1y: [7, 8],     r3y: [6, 8],   r5y: [6, 8]   },
  gold:             { r1y: [5, 28],    r3y: [10, 22], r5y: [12, 20] },
  nifty50:          { r1y: [-5, 15],   r3y: [10, 18], r5y: [12, 16] },
};

function getReturnRange(subcategory: string) {
  return RETURN_RANGES[subcategory] ?? RETURN_RANGES["flexi_cap"];
}

// Commission rates by category
function commissionForCategory(category: string, subcategory: string): number {
  if (category === "liquid") return roundTo(0.05 + rand() * 0.15, 2);
  if (category === "index")  return roundTo(0.05 + rand() * 0.15, 2);
  if (category === "gold")   return roundTo(0.50 + rand() * 0.30, 2);
  if (category === "debt")   return roundTo(0.30 + rand() * 0.30, 2);
  if (category === "global") return roundTo(0.60 + rand() * 0.40, 2);
  if (category === "daaf")   return roundTo(0.60 + rand() * 0.30, 2);
  if (category === "elss")   return roundTo(0.75 + rand() * 0.40, 2);
  if (subcategory === "small_cap") return roundTo(0.90 + rand() * 0.30, 2);
  if (subcategory === "mid_cap")   return roundTo(0.85 + rand() * 0.30, 2);
  return roundTo(0.70 + rand() * 0.40, 2); // equity default
}

// Build funds array
console.log("\n🔷 Step 1: Generating funds.csv...");
const funds: Fund[] = FUND_DEFINITIONS.map((def, i) => {
  const rng = getReturnRange(def.subcategory);
  const r1y = roundTo(rng.r1y[0] + rand() * (rng.r1y[1] - rng.r1y[0]), 2);
  const r3y = roundTo(rng.r3y[0] + rand() * (rng.r3y[1] - rng.r3y[0]), 2);
  const r5y = roundTo(rng.r5y[0] + rand() * (rng.r5y[1] - rng.r5y[0]), 2);
  const avgReturn = (r1y + r3y + r5y) / 3;

  // Star rating: correlated with returns and FI Select status
  const baseRating = avgReturn > 20 ? 5 : avgReturn > 14 ? 4 : avgReturn > 8 ? 3 : 2;
  const starRating = def.is_fi_select ? 5 : clamp(baseRating + (rand() > 0.7 ? 1 : 0) - (rand() > 0.8 ? 1 : 0), 1, 5);

  // Platform investor count: FI Select funds get more investors
  const baseCount = def.is_investor_favourite ? randInt(15_000, 28_000) :
                    def.is_fi_select           ? randInt(8_000, 16_000) :
                    def.is_trending_now        ? randInt(5_000, 12_000) :
                                                 randInt(500, 6_000);

  return {
    fund_id: `FI_${String(i + 1).padStart(3, "0")}`,
    fund_name: def.fund_name,
    amc_name: def.amc_name,
    category: def.category,
    subcategory: def.subcategory,
    risk_level: def.risk_level,
    trailing_commission_pct: commissionForCategory(def.category, def.subcategory),
    inception_year: def.inception_year,
    benchmark_index: def.benchmark_index,
    return_1y: r1y,
    return_3y: r3y,
    return_5y: r5y,
    fi_star_rating: starRating,
    is_fi_select: def.is_fi_select,
    is_trending_now: def.is_trending_now,
    is_investor_favourite: def.is_investor_favourite,
    is_gold_fund: def.is_gold_fund,
    is_global_fund: def.is_global_fund,
    platform_investor_count: baseCount,
  };
});

writeCsv("funds.csv",
  ["fund_id","fund_name","amc_name","category","subcategory","risk_level",
   "trailing_commission_pct","inception_year","benchmark_index",
   "return_1y","return_3y","return_5y","fi_star_rating",
   "is_fi_select","is_trending_now","is_investor_favourite",
   "is_gold_fund","is_global_fund","platform_investor_count"],
  funds
);

// Build lookup maps
const fundById = new Map(funds.map(f => [f.fund_id, f]));
const fundIdsByCategory = new Map<string, string[]>();
for (const f of funds) {
  if (!fundIdsByCategory.has(f.category)) fundIdsByCategory.set(f.category, []);
  fundIdsByCategory.get(f.category)!.push(f.fund_id);
}
const fiSelectFundIds = funds.filter(f => f.is_fi_select).map(f => f.fund_id);
const elssIds         = funds.filter(f => f.category === "elss").map(f => f.fund_id);
const liquidIds       = funds.filter(f => f.category === "liquid").map(f => f.fund_id);
const equityIds       = funds.filter(f => ["equity","elss","global"].includes(f.category)).map(f => f.fund_id);

// Pick a fund weighted by FI category mix + FI Select boost
function pickFundWeighted(forElss = false): string {
  if (forElss) return pick(elssIds);
  const categories = CATEGORY_WEIGHTS.map(([c]) => c);
  const weights    = CATEGORY_WEIGHTS.map(([, w]) => w);
  const cat = weightedPick(categories, weights);
  const ids = fundIdsByCategory.get(cat) ?? funds.map(f => f.fund_id);
  // FI Select funds get 2× weight within category
  const catFunds = ids.map(id => fundById.get(id)!);
  const catWeights = catFunds.map(f => f.is_fi_select ? 2.0 : 1.0);
  return weightedPick(ids, catWeights);
}

// ════════════════════════════════════════════════════════════════
// STEP 2: INVESTORS (~50,000 rows)
// ════════════════════════════════════════════════════════════════

console.log("\n🔷 Step 2: Generating investors.csv...");

interface Investor {
  investor_id: string;
  signup_date: string;
  pan_confirmed_date: string;
  kyc_submitted_date: string | null;
  bank_verified_date: string | null;
  account_activated_date: string | null;
  first_investment_date: string | null;
  demat_opened_date: string | null;
  age: number;
  gender: string;
  name: string;
  city: string;
  state: string;
  city_tier: string;
  occupation: string;
  annual_income: string;
  investor_type: string;
  risk_profile: string;
  acquisition_channel: string;
  kyc_status: string;
  kyc_method: string;
  bank_name: string;
  bank_link_method: string;
  bank_link_status: string;
  nomination_preference: string;
  is_pep: boolean;
  foreign_tax_liable: boolean;
  mf_account_active: boolean;
  demat_account_active: boolean;
  aa_consent_given: boolean;
  is_active: boolean;
}

const OCCUPATIONS = [
  { label: "Private Sector", weight: 0.38 },
  { label: "Business",       weight: 0.22 },
  { label: "Government",     weight: 0.15 },
  { label: "Professional",   weight: 0.10 },
  { label: "Retired",        weight: 0.08 },
  { label: "Homemaker",      weight: 0.05 },
  { label: "Student",        weight: 0.02 },
];
const INCOME_BRACKETS = [
  { label: "< 1 lakh",    weight: 0.05 },
  { label: "1-5 lakhs",   weight: 0.30 },
  { label: "5-10 lakhs",  weight: 0.28 },
  { label: "10-25 lakhs", weight: 0.25 },
  { label: "> 25 lakhs",  weight: 0.12 },
];
const BANKS = [
  { name: "HDFC Bank",     weight: 0.25 },
  { name: "SBI",           weight: 0.22 },
  { name: "ICICI Bank",    weight: 0.18 },
  { name: "Axis Bank",     weight: 0.12 },
  { name: "Kotak Bank",    weight: 0.08 },
  { name: "Yes Bank",      weight: 0.04 },
  { name: "IndusInd Bank", weight: 0.04 },
  { name: "PNB",           weight: 0.04 },
  { name: "Bank of Baroda",weight: 0.03 },
];
const ACQ_CHANNELS = [
  { label: "organic",             weight: 0.28 },
  { label: "referral",            weight: 0.18 },
  { label: "paid_search",         weight: 0.22 },
  { label: "social",              weight: 0.12 },
  { label: "email",               weight: 0.10 },
  { label: "calculator",          weight: 0.06 }, // sip-calculator CTA → account
  { label: "wealth_conversations", weight: 0.04 },
];
const RISK_PROFILES = [
  { label: "conservative", weight: 0.22 },
  { label: "moderate",     weight: 0.45 },
  { label: "aggressive",   weight: 0.33 },
];

function pickOccupation() { return weightedPick(OCCUPATIONS.map(o => o.label), OCCUPATIONS.map(o => o.weight)); }
function pickIncomeBracket() { return weightedPick(INCOME_BRACKETS.map(o => o.label), INCOME_BRACKETS.map(o => o.weight)); }
function pickBank() { return weightedPick(BANKS.map(b => b.name), BANKS.map(b => b.weight)); }
function pickAcqChannel() { return weightedPick(ACQ_CHANNELS.map(a => a.label), ACQ_CHANNELS.map(a => a.weight)); }
function pickRiskProfile() { return weightedPick(RISK_PROFILES.map(r => r.label), RISK_PROFILES.map(r => r.weight)); }

// Monthly new investor targets derived from FI SIP inflow growth.
// Allocate the fixed 15K new-investor sample across the full Jun 2024–May 2026
// range. Do not over-generate and slice the array; that clips the latest months.
function newInvestorWeightForMonth(y: number, m: number): number {
  // Apply ELSS season boost (more new investors in Jan-Mar)
  const seasonMult = m === 1 ? 1.5 : m === 2 ? 1.8 : m === 3 ? 1.6 : m === 11 ? 0.85 : 1.0;
  // KYC crisis in Jun-Jul 2024 reduces effective signups (some bounce)
  const kycMult = isKycCrisisMonth(y, m) ? 0.80 : 1.0;
  // YoY growth: FY26 signups ~14% higher than FY25
  const yoyMult = (y === 2026) ? 1.14 : 1.0;
  return seasonMult * kycMult * yoyMult;
}

function buildNewInvestorTargets(months: [number, number][]): Map<string, number> {
  const weightedMonths = months.map(([y, m]) => ({
    key: `${y}-${String(m).padStart(2, "0")}`,
    weight: newInvestorWeightForMonth(y, m),
  }));
  const totalWeight = weightedMonths.reduce((sum, item) => sum + item.weight, 0);
  const allocations = weightedMonths.map((item) => {
    const exact = TARGET.new_investors * item.weight / totalWeight;
    const count = Math.floor(exact);
    return { ...item, count, remainder: exact - count };
  });
  let remaining = TARGET.new_investors - allocations.reduce((sum, item) => sum + item.count, 0);
  allocations
    .sort((a, b) => b.remainder - a.remainder)
    .forEach((item) => {
      if (remaining <= 0) return;
      item.count += 1;
      remaining -= 1;
    });
  return new Map(allocations.map((item) => [item.key, item.count]));
}

const investors: Investor[] = [];
const months = allMonths(DATE_START, DATE_END);
const newInvestorTargets = buildNewInvestorTargets(months);

// Pre-existing investors: signed up before Jun 2024, still active in window
// Assign them a signup date between 2019 and Jun 2024
for (let i = 0; i < TARGET.existing_investors; i++) {
  const invId = `INV_${String(i + 1).padStart(6, "0")}`;
  const state = pickState();
  const city = pick(state.cities);
  // AMFI data: India MF investors are ~78% male. Advisory platforms skew slightly more female
  // than discount brokers but still male-dominant.
  const gender = rand() < 0.78 ? "male" : "female";
  const age = clamp(Math.round(normalRand(35, 9)), 22, 68);

  // Signup was before Jun 2024: random date 2019-01 to 2024-05
  const yearsBack = 1 + randInt(0, 4);
  const signupDate = addDays("2024-05-31", -randInt(30, yearsBack * 365));
  const panDate   = addDays(signupDate, randInt(0, 2));
  const kycDate   = addDays(panDate, randInt(0, 5));

  // Realistic KYC status for existing users: not all are verified.
  // 12% have lapsed or have open issues (on_hold), 5% never completed (pending).
  const kycStatus = weightedPick(
    ["verified", "on_hold", "pending"],
    [0.83,       0.12,      0.05]
  );

  // Only KYC-verified users proceed to bank link. 8% of verified users
  // never complete bank linking (abandoned mid-onboarding).
  const bankDate = kycStatus === "verified" && rand() < 0.92
    ? addDays(kycDate, randInt(0, 2)) : null;
  const activDate = bankDate && rand() < 0.98
    ? addDays(bankDate, randInt(0, 1)) : null;
  const firstInvDate = activDate && rand() < 0.85
    ? addDays(activDate, randInt(1, 14)) : null;
  const dematDate = activDate && rand() < 0.32
    ? addDays(activDate, randInt(7, 60)) : null;

  investors.push({
    investor_id: invId,
    signup_date: signupDate,
    pan_confirmed_date: panDate,
    kyc_submitted_date: kycDate,
    bank_verified_date: bankDate ?? null,
    account_activated_date: activDate ?? null,
    first_investment_date: firstInvDate ?? null,
    demat_opened_date: dematDate ?? null,
    age,
    gender,
    name: fullName(gender),
    city,
    state: state.name,
    city_tier: state.tier,
    occupation: pickOccupation(),
    annual_income: pickIncomeBracket(),
    investor_type: rand() < 0.96 ? "resident" : "nri",
    risk_profile: pickRiskProfile(),
    acquisition_channel: pickAcqChannel(),
    kyc_status: kycStatus,
    kyc_method: weightedPick(["digilocker","aadhaar_otp","physical"], [0.72, 0.18, 0.10]),
    bank_name: pickBank(),
    // UPI autopay dominant in India by 2024 (NACH declining due to mandate complexity)
    bank_link_method: rand() < 0.76 ? "upi_auto_detect" : "manual_entry",
    bank_link_status: bankDate ? (rand() < 0.94 ? "verified" : "failed") : "pending",
    nomination_preference: rand() < 0.29 ? "added" : "opted_out",
    is_pep: rand() < 0.003,
    // Foreign tax liable ~1.5%: only NRIs with dual citizenship or US persons
    foreign_tax_liable: rand() < 0.015,
    mf_account_active: activDate !== null,
    demat_account_active: dematDate !== null,
    aa_consent_given: rand() < 0.28,
    is_active: activDate !== null && rand() < 0.88,
  });
}

// New investors: signed up during Jun 2024–May 2026
let newInvIdx = TARGET.existing_investors + 1;
for (const [y, m] of months) {
  const count = newInvestorTargets.get(`${y}-${String(m).padStart(2, "0")}`) ?? 0;
  const isKycCrisis = isKycCrisisMonth(y, m);

  for (let i = 0; i < count; i++) {
    const invId = `INV_${String(newInvIdx++).padStart(6, "0")}`;
    const state = pickState();
    const gender = rand() < 0.78 ? "male" : "female";
    const age = clamp(Math.round(normalRand(32, 9)), 22, 65);
    const signupDate = randomDateInMonth(y, m);

    // KYC on-hold story: Jun-Jul 2024 → 11% on-hold rate; normal → 3%
    const onHoldProb = isKycCrisis ? 0.11 : 0.03;
    const kycStatus = rand() < onHoldProb ? "on_hold" : rand() < 0.015 ? "pending" : "verified";

    const panDate  = addDays(signupDate, randInt(0, 2));
    const kycDate  = addDays(panDate, kycStatus === "on_hold" ? randInt(3, 14) : randInt(0, 5));
    // 13% of KYC-verified new users abandon before completing bank link
    const bankDate = kycStatus === "verified" && rand() < 0.87
      ? addDays(kycDate, randInt(0, 2)) : null;
    const activDate = bankDate && rand() < 0.99 ? addDays(bankDate, randInt(0, 1)) : null;

    // Activation funnel drop-offs: 82% of activated accounts invest
    const firstInvDate = activDate && rand() < 0.82
      ? addDays(activDate, randInt(1, 21)) : null;

    // Demat cross-sell: 32% convert (more likely for aggressive risk profile)
    const riskProfile = pickRiskProfile();
    const dematProb = riskProfile === "aggressive" ? 0.42 : 0.25;
    const dematDate = activDate && rand() < dematProb
      ? addDays(activDate, randInt(7, 60)) : null;

    investors.push({
      investor_id: invId,
      signup_date: signupDate,
      pan_confirmed_date: panDate,
      kyc_submitted_date: kycDate,
      bank_verified_date: bankDate ?? null,
      account_activated_date: activDate ?? null,
      first_investment_date: firstInvDate ?? null,
      demat_opened_date: dematDate ?? null,
      age,
      gender,
      name: fullName(gender),
      city: pick(state.cities),
      state: state.name,
      city_tier: state.tier,
      occupation: pickOccupation(),
      annual_income: pickIncomeBracket(),
      investor_type: rand() < 0.96 ? "resident" : "nri",
      risk_profile: riskProfile,
      acquisition_channel: pickAcqChannel(),
      kyc_status: kycStatus,
      kyc_method: weightedPick(["digilocker","aadhaar_otp","physical"], [0.74, 0.17, 0.09]),
      bank_name: pickBank(),
      bank_link_method: rand() < 0.76 ? "upi_auto_detect" : "manual_entry",
      bank_link_status: bankDate ? (rand() < 0.93 ? "verified" : "failed") : "pending",
      nomination_preference: rand() < 0.29 ? "added" : "opted_out",
      is_pep: rand() < 0.003,
      foreign_tax_liable: rand() < 0.015,
      mf_account_active: activDate !== null,
      demat_account_active: dematDate !== null,
      aa_consent_given: rand() < 0.22,
      is_active: activDate !== null && rand() < 0.78, // new investors: lower initial activity
    });
  }
}

// Trim to exactly 50K if over (due to rounding in monthly targets)
const trimmedInvestors = investors.slice(0, TARGET.total_investors);

writeCsv("investors.csv",
  ["investor_id","signup_date","pan_confirmed_date","kyc_submitted_date",
   "bank_verified_date","account_activated_date","first_investment_date","demat_opened_date",
   "name","age","gender","city","state","city_tier",
   "occupation","annual_income","investor_type","risk_profile","acquisition_channel",
   "kyc_status","kyc_method","bank_name","bank_link_method","bank_link_status",
   "nomination_preference","is_pep","foreign_tax_liable",
   "mf_account_active","demat_account_active","aa_consent_given","is_active"],
  trimmedInvestors
);

// Build investor lookup maps (used by later steps)
const investorById = new Map(trimmedInvestors.map(inv => [inv.investor_id, inv]));
const activatedInvestors = trimmedInvestors.filter(inv => inv.account_activated_date !== null);
const investedInvestors  = trimmedInvestors.filter(inv => inv.first_investment_date !== null);

// ════════════════════════════════════════════════════════════════
// VALIDATION SUMMARY (Stage 1)
// ════════════════════════════════════════════════════════════════

console.log("\n📊 Stage 1 Summary:");
console.log(`  Funds: ${funds.length} total`);
console.log(`    FI Select: ${funds.filter(f => f.is_fi_select).length}`);
console.log(`    ELSS:      ${elssIds.length}`);
console.log(`    Equity:    ${equityIds.length}`);
console.log(`  Investors: ${trimmedInvestors.length.toLocaleString()} total`);
console.log(`    Pre-existing:  ${trimmedInvestors.filter(i => i.signup_date < DATE_START).length.toLocaleString()}`);
console.log(`    New (in window): ${trimmedInvestors.filter(i => i.signup_date >= DATE_START).length.toLocaleString()}`);
console.log(`    KYC verified:  ${trimmedInvestors.filter(i => i.kyc_status === "verified").length.toLocaleString()}`);
console.log(`    KYC on-hold:   ${trimmedInvestors.filter(i => i.kyc_status === "on_hold").length.toLocaleString()}`);
console.log(`    Activated:     ${activatedInvestors.length.toLocaleString()}`);
console.log(`    First invested:${investedInvestors.length.toLocaleString()}`);
console.log(`    Demat opened:  ${trimmedInvestors.filter(i => i.demat_opened_date !== null).length.toLocaleString()}`);
console.log(`    T30:           ${trimmedInvestors.filter(i => i.city_tier === "t30").length.toLocaleString()}`);
console.log(`    B30:           ${trimmedInvestors.filter(i => i.city_tier === "b30").length.toLocaleString()}`);

// KYC crisis check
const junJulNew = trimmedInvestors.filter(i => i.signup_date >= "2024-06-01" && i.signup_date <= "2024-07-31");
const junJulOnHold = junJulNew.filter(i => i.kyc_status === "on_hold");
console.log(`    Jun-Jul KYC on-hold rate: ${(junJulOnHold.length / junJulNew.length * 100).toFixed(1)}% (target: 9-11%)`);

// Export maps for next stages (exported as module-level vars for chaining)
// Stage 2 will import: trimmedInvestors, funds, fundById, fiSelectFundIds, elssIds, liquidIds, investedInvestors

// ════════════════════════════════════════════════════════════════
// STEP 3: SIPs (~40,000 rows)
// ════════════════════════════════════════════════════════════════

console.log("\n🔷 Step 3: Generating sips.csv...");

interface Sip {
  sip_id: string;
  investor_id: string;
  fund_id: string;
  start_date: string;
  end_date: string | null;
  frequency: string;
  amount_inr: number;
  step_up_pct: number | null;
  step_up_frequency: string | null;
  sip_type: string;
  status: string;
  mandate_type: string;
  cancellation_reason: string | null;
  total_installments_paid: number;
  total_amount_invested: number;
}

// Log-normal SIP amount: mu=8.0, sigma=0.9 → mean ~₹4,460, median ~₹3,000
// Round to nearest ₹500 (standard SIP denominations)
function pickSipAmount(isElss: boolean): number {
  const mu    = isElss ? 8.3 : 8.0;
  const sigma = isElss ? 0.7 : 0.9;
  const raw   = Math.exp(normalRand(mu, sigma));
  const clamped = clamp(raw, 500, 50_000);
  return Math.round(clamped / 500) * 500;
}

// Determine SIP status based on vintage + type (encodes planted stories)
function sipStatus(startDate: string, fundId: string, sipType: string): string {
  const f = fundById.get(fundId)!;
  const monthsOld = diffMonths(startDate, DATE_END);

  if (monthsOld < 3) return "active"; // too new to cancel

  // FI Select funds → 76% 12-month retention vs 48% regular
  const baseRetentionAt12m = f.is_fi_select ? 0.76 : 0.48;
  // Step-up (power_sip) → 79% retention vs 51% regular
  const retentionAt12m = sipType === "power_sip" ? 0.79 :
                         sipType === "super_savings" ? 0.70 :
                         baseRetentionAt12m;

  if (monthsOld < 12) {
    // Pro-rate for younger SIPs
    const prob = 1 - (1 - retentionAt12m) * (monthsOld / 12);
    return rand() < prob ? "active" : "cancelled";
  }
  if (monthsOld < 24) {
    const prob = retentionAt12m * 0.85; // additional attrition
    return rand() < prob ? "active" : rand() < 0.6 ? "cancelled" : "paused";
  }
  // Older SIPs: higher churn
  return rand() < retentionAt12m * 0.70 ? "active" : rand() < 0.7 ? "cancelled" : "paused";
}

function cancelReason(category: string, fy: string): string {
  // FY26 has more "returns_unsatisfactory" (stalling market story)
  const reasons = fy === "FY26"
    ? [
        { r: "returns_unsatisfactory", w: 0.40 },
        { r: "financial_constraint",   w: 0.25 },
        { r: "switched_platform",      w: 0.12 },
        { r: "goal_achieved",          w: 0.13 },
        { r: "unknown",                w: 0.10 },
      ]
    : [
        { r: "returns_unsatisfactory", w: 0.32 },
        { r: "financial_constraint",   w: 0.28 },
        { r: "switched_platform",      w: 0.12 },
        { r: "goal_achieved",          w: 0.18 },
        { r: "unknown",                w: 0.10 },
      ];
  return weightedPick(reasons.map(r => r.r), reasons.map(r => r.w));
}

const sips: Sip[] = [];
let sipSeq = 1;

// Helper: create a SIP for an investor
function createSip(investorId: string, startDate: string, forElss = false): Sip {
  const fundId = pickFundWeighted(forElss);
  const fund   = fundById.get(fundId)!;
  const isElss = fund.category === "elss";
  const amount = pickSipAmount(isElss);
  const sipType = weightedPick(
    ["regular","power_sip","super_savings"],
    [0.78, 0.14, 0.08]
  );
  // UPI Autopay dominant in India by 2024. NACH share declining (~28%) as UPI mandate
  // grew rapidly post-2022. NACH still used by older investors and higher-amount SIPs.
  const mandateType = weightedPick(
    ["upi_autopay","nach"],
    [0.72, 0.28]
  );

  // Step-up only for power_sip
  const stepUpPct = sipType === "power_sip"
    ? weightedPick([5, 10, 15], [0.55, 0.30, 0.15])
    : null;

  const status = sipStatus(startDate, fundId, sipType);
  let endDate: string | null = null;
  if (status === "cancelled" || status === "paused" || status === "completed") {
    // End date: random after start, within window
    const minMob = 2;
    const maxMob = Math.min(diffMonths(startDate, DATE_END), 20);
    const endMob = randInt(minMob, Math.max(minMob + 1, maxMob));
    endDate = addMonths(startDate, endMob);
    if (endDate > DATE_END) endDate = DATE_END;
  }

  const endForCalc = endDate ?? DATE_END;
  const totalMonths = Math.max(0, diffMonths(startDate < DATE_START ? DATE_START : startDate, endForCalc));
  // Apply step-up to total amount
  let totalInvested = 0;
  let currentAmount = amount;
  for (let mo = 0; mo < totalMonths; mo++) {
    if (sipType === "power_sip" && stepUpPct && mo > 0 && mo % 12 === 0) {
      currentAmount = Math.round(currentAmount * (1 + stepUpPct / 100) / 500) * 500;
    }
    totalInvested += currentAmount;
  }

  const sipId = `SIP_${String(sipSeq++).padStart(7, "0")}`;
  return {
    sip_id: sipId,
    investor_id: investorId,
    fund_id: fundId,
    start_date: startDate,
    end_date: endDate,
    frequency: rand() < 0.91 ? "monthly" : "quarterly",
    amount_inr: amount,
    step_up_pct: stepUpPct,
    step_up_frequency: stepUpPct ? "annual" : null,
    sip_type: sipType,
    status,
    mandate_type: mandateType,
    cancellation_reason: (status === "cancelled") ? cancelReason(fund.category, indianFY(endDate ?? DATE_END)) : null,
    total_installments_paid: totalMonths,
    total_amount_invested: totalInvested,
  };
}

// Pre-existing investors: SIPs started before Jun 2024
const preExistingInvestors = trimmedInvestors.slice(0, TARGET.existing_investors);
for (const inv of preExistingInvestors) {
  if (!inv.first_investment_date) continue;
  // 75% have at least 1 SIP, some have 2+
  const numSips = rand() < 0.75 ? (rand() < 0.30 ? 2 : 1) : 0;
  const usedFunds = new Set<string>(); // prevent same investor having 2 active SIPs in same fund
  for (let n = 0; n < numSips; n++) {
    const latestStart = "2024-05-31";
    const earliest = inv.first_investment_date < "2020-01-01" ? "2020-01-01" : inv.first_investment_date;
    if (earliest >= latestStart) continue;
    const startDate = randomDateBetween(earliest, latestStart);
    const isElssSip = isElssSeason(startDate) && rand() < 0.25;
    // Pick a fund not already used by an active SIP for this investor
    let attempts = 0;
    let sip: ReturnType<typeof createSip>;
    do {
      sip = createSip(inv.investor_id, startDate, isElssSip);
      attempts++;
    } while (sip.status === "active" && usedFunds.has(sip.fund_id) && attempts < 5);
    if (sip.status === "active") usedFunds.add(sip.fund_id);
    sips.push(sip);
  }
}

// New investors: SIPs started during Jun 2024–May 2026
for (const [y, m] of months) {
  const seasonMult = sipSeasonMultiplier(y, m);
  const isElssMonth = isElssSeason(dateStr(y, m, 15));
  const baseNewSips = 450; // per month from new investors in period

  const monthNewSips = Math.round(baseNewSips * seasonMult);
  // Pick from investors who activated this month or before, haven't started a SIP yet
  const monthEnd = dateStr(y, m, daysInMonth(y, m));
  const eligibleNew = trimmedInvestors.filter(inv =>
    inv.signup_date >= DATE_START &&
    inv.account_activated_date !== null &&
    inv.account_activated_date <= monthEnd &&
    inv.first_investment_date !== null &&
    inv.first_investment_date <= monthEnd
  );

  for (let n = 0; n < Math.min(monthNewSips, Math.max(0, eligibleNew.length - (sips.filter(s => {
    const inv = investorById.get(s.investor_id);
    return inv && inv.signup_date >= DATE_START;
  }).length)));  n++) {
    if (eligibleNew.length === 0) break;
    const inv = pick(eligibleNew);
    const startDay = randInt(1, daysInMonth(y, m));
    let startDate = dateStr(y, m, clamp(startDay, 1, daysInMonth(y, m)));
    // SIP cannot start before the investor's first investment date.
    // (first_investment_date = activDate + 1-21 days, so it can land mid-month.)
    if (inv.first_investment_date && startDate < inv.first_investment_date) {
      startDate = inv.first_investment_date;
    }
    const forElss = isElssMonth && rand() < (m === 2 || m === 3 ? 0.35 : 0.15);
    sips.push(createSip(inv.investor_id, startDate, forElss));
  }
}

// Also add lumpsum ELSS investments directly in Jan-Mar (not as SIPs)
// handled in transactions step

writeCsv("sips.csv",
  ["sip_id","investor_id","fund_id","start_date","end_date",
   "frequency","amount_inr","step_up_pct","step_up_frequency",
   "sip_type","status","mandate_type","cancellation_reason",
   "total_installments_paid","total_amount_invested"],
  sips
);

const activeSips    = sips.filter(s => s.status === "active");
const cancelledSips = sips.filter(s => s.status === "cancelled");
const elssActiveSips = activeSips.filter(s => fundById.get(s.fund_id)?.category === "elss");

// ════════════════════════════════════════════════════════════════
// STEP 4: TRANSACTIONS (~500,000 rows)
// ════════════════════════════════════════════════════════════════

console.log("\n🔷 Step 4: Generating transactions.csv...");

interface Transaction {
  txn_id: string;
  investor_id: string;
  fund_id: string;
  sip_id: string | null;
  goal_id: string | null;
  txn_date: string;
  txn_type: string;
  amount_inr: number;
  units: number;
  nav_at_txn: number;
  status: string;
  channel: string;
  payment_mode: string;
}

// Simulated NAV per fund per month (simplified — based on category returns)
// Base NAVs as of Jun 2024, grow each month
const fundNavCache = new Map<string, Map<string, number>>(); // fund_id → month → nav

function buildNavCache() {
  for (const fund of funds) {
    const monthNavs = new Map<string, number>();
    // Base NAV: correlated with inception year and category
    const ageYears = 2024 - fund.inception_year;
    const baseNAV = clamp(
      fund.category === "liquid" ? 1000 + ageYears * 50 :
      fund.category === "debt"   ? 10 + ageYears * 0.8 :
      fund.category === "elss"   ? 15 + ageYears * 2.5 + rand() * 10 :
      fund.category === "daaf"   ? 12 + ageYears * 1.5 :
      fund.category === "gold"   ? 10 + ageYears * 1.8 :
      fund.category === "global" ? 10 + ageYears * 2.0 :
      15 + ageYears * 3.0 + rand() * 20, // equity
      5, 800
    );

    // Monthly return rates by category
    const annualReturn = fund.return_3y / 100;
    const monthlyReturn = Math.pow(1 + annualReturn, 1 / 12) - 1;

    // Equity volatility by subcategory
    const monthlyVol = fund.category === "liquid" ? 0.0001 :
                       fund.category === "debt"   ? 0.002 :
                       fund.subcategory === "small_cap" ? 0.045 :
                       fund.subcategory === "mid_cap"   ? 0.038 :
                       fund.category === "gold"         ? 0.03 :
                       fund.category === "global"       ? 0.03 :
                       0.025;

    let nav = baseNAV;
    const allM = allMonths("2024-01-01", DATE_END);
    for (const [y, m] of allM) {
      const ym = `${y}-${String(m).padStart(2, "0")}`;

      // Oct 2024: equity correction -8% (planted story 2)
      const isOct2024Correction = (y === 2024 && m === 10 && ["equity","elss","global"].includes(fund.category));
      // Recovery: Nov 2024 - Feb 2025
      const isRecovery = (y === 2024 && m >= 11) || (y === 2025 && m <= 2);

      const correctionMult = isOct2024Correction ? -0.04 : isRecovery ? 0.01 : 0;
      const noise = (rand() - 0.5) * 2 * monthlyVol;
      nav = nav * (1 + monthlyReturn + noise + correctionMult);
      nav = Math.max(nav, 1);
      monthNavs.set(ym, roundTo(nav, 4));
    }
    fundNavCache.set(fund.fund_id, monthNavs);
  }
}

buildNavCache();

function navForFundOnDate(fundId: string, date: string): number {
  const ym = date.slice(0, 7);
  return fundNavCache.get(fundId)?.get(ym) ?? 10;
}

let txnSeq = 1;
const transactions: Transaction[] = [];

// Failure rate by mandate type (planted story 5: NACH 6.2% vs UPI 1.9%)
function txnStatus(mandateType: string): string {
  const failRate = mandateType === "nach" ? 0.062 : 0.019;
  if (rand() < failRate) return "failed";
  if (rand() < 0.005)   return "pending"; // small % pending
  return "success";
}

function pickChannel(sipType: string): string {
  if (sipType === "power_sip") return weightedPick(["app","web","advisor_assisted"], [0.5, 0.3, 0.2]);
  return weightedPick(["app","web","email_link","advisor_assisted"], [0.48, 0.32, 0.12, 0.08]);
}

// Generate SIP installments
for (const sip of sips) {
  const windowStart = sip.start_date > DATE_START ? sip.start_date : DATE_START;
  const windowEnd   = sip.end_date && sip.end_date < DATE_END ? sip.end_date : DATE_END;
  if (windowStart > windowEnd) continue;

  const installMonths = allMonths(windowStart, windowEnd);
  let currentAmount = sip.amount_inr;

  for (const [y, m] of installMonths) {
    // Step-up on annual anniversary
    if (sip.sip_type === "power_sip" && sip.step_up_pct && sip.start_date) {
      const monthsFromStart = diffMonths(sip.start_date, dateStr(y, m, 1));
      if (monthsFromStart > 0 && monthsFromStart % 12 === 0) {
        currentAmount = Math.round(currentAmount * (1 + (sip.step_up_pct ?? 0) / 100) / 500) * 500;
      }
    }

    const txnDate = dateStr(y, m, clamp(
      sip.start_date ? new Date(sip.start_date).getDate() : 5,
      1, daysInMonth(y, m)
    ));
    const nav     = navForFundOnDate(sip.fund_id, txnDate);
    const status  = txnStatus(sip.mandate_type);
    const units   = status === "success" ? roundTo(currentAmount / nav, 4) : 0;

    transactions.push({
      txn_id: `TXN_${String(txnSeq++).padStart(7, "0")}`,
      investor_id: sip.investor_id,
      fund_id: sip.fund_id,
      sip_id: sip.sip_id,
      goal_id: null,
      txn_date: txnDate,
      txn_type: "sip_installment",
      amount_inr: status === "success" ? currentAmount : 0,
      units,
      nav_at_txn: nav,
      status,
      channel: sip.sip_type === "regular" ? "app" : pickChannel(sip.sip_type),
      payment_mode: sip.mandate_type === "nach" ? "nach" :
                    weightedPick(["upi","netbanking"], [0.75, 0.25]),
    });
  }
}

console.log(`  SIP installments generated: ${transactions.length.toLocaleString()}`);

// Lumpsum purchases — seasonal: ELSS tax-saving (Jan-Mar 2.8-3×), post-correction
// dip-buying (Nov-Dec 2024 1.5-1.8×), year-end parking (Dec 1.3×).
// These are the patterns any FundsIndia analyst would expect to see.
const LUMPSUM_MONTH_WEIGHTS: Record<string, number> = {
  "2024-06": 1.0, "2024-07": 0.9, "2024-08": 1.0, "2024-09": 1.1,
  "2024-10": 0.6,  // equity correction — hesitancy, low lumpsums
  "2024-11": 1.7,  // dip-buying after correction
  "2024-12": 1.5,  // year-end tax parking + recovery optimism
  "2025-01": 2.0,  // ELSS season begins
  "2025-02": 2.8,  // ELSS peak (Feb deadline pressure)
  "2025-03": 3.0,  // ELSS deadline rush
  "2025-04": 1.0, "2025-05": 0.9, "2025-06": 0.9, "2025-07": 1.0,
  "2025-08": 1.0, "2025-09": 1.1, "2025-10": 1.0, "2025-11": 1.1,
  "2025-12": 1.4,  // year-end
  "2026-01": 2.0,  // ELSS season
  "2026-02": 2.8,  // ELSS peak
  "2026-03": 3.0,  // ELSS deadline rush
  "2026-04": 1.0, "2026-05": 0.9,
};

function pickLumpSumDate(inv: Investor): string {
  const earliest = inv.first_investment_date! > DATE_START ? inv.first_investment_date! : DATE_START;
  const avail = allMonths(earliest, DATE_END);
  if (avail.length === 0) return earliest;
  const weights = avail.map(([y, m]) => {
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    return LUMPSUM_MONTH_WEIGHTS[ym] ?? 1.0;
  });
  const [y, m] = weightedPick(avail, weights);
  const date = randomDateInMonth(y, m);
  // If the picked date falls before first_investment_date (same month edge case), clamp it.
  return date >= earliest ? date : earliest;
}

const lumpSumCount = 25_000;
for (let i = 0; i < lumpSumCount; i++) {
  const inv = pick(investedInvestors);
  if (!inv.first_investment_date) continue;

  const txnDate = pickLumpSumDate(inv);
  // During ELSS season, 35-40% of lumpsums go to ELSS funds (vs 20% baseline)
  const isElss = isElssSeason(txnDate);
  const fundId  = pickFundWeighted(isElss && rand() < (getMonth(txnDate) === 3 ? 0.40 : 0.30));
  const fund    = fundById.get(fundId)!;
  const nav     = navForFundOnDate(fundId, txnDate);

  // Lumpsum amounts: log-normal, larger than SIPs
  const amount = Math.round(clamp(
    Math.exp(normalRand(10.2, 1.1)), // median ~₹27K, mean ~₹54K
    5_000, 2_000_000
  ) / 1000) * 1000;
  const units  = roundTo(amount / nav, 4);

  transactions.push({
    txn_id: `TXN_${String(txnSeq++).padStart(7, "0")}`,
    investor_id: inv.investor_id,
    fund_id: fundId,
    sip_id: null,
    goal_id: null,
    txn_date: txnDate,
    txn_type: "lumpsum",
    amount_inr: amount,
    units,
    nav_at_txn: nav,
    status: rand() < 0.03 ? "failed" : "success",
    channel: weightedPick(["app","web","email_link","advisor_assisted"], [0.40, 0.38, 0.14, 0.08]),
    payment_mode: weightedPick(["upi","netbanking","nach"], [0.45, 0.45, 0.10]),
  });
}

// Redemptions (~12K)
const redemptionCount = 12_000;
for (let i = 0; i < redemptionCount; i++) {
  const inv = pick(investedInvestors);
  if (!inv.first_investment_date) continue;
  const txnDate = randomDateBetween(
    addMonths(inv.first_investment_date > DATE_START ? inv.first_investment_date : DATE_START, 3),
    DATE_END
  );
  // Exclude ELSS funds from redemptions: 3-year lock-in means any ELSS SIP started
  // during this 24-month window (Jun 2024–May 2026) cannot be redeemed yet.
  // Pre-existing ELSS SIPs from before 2021 could be redeemed, but we can't track
  // those cleanly, so we exclude ELSS from the redemption pool entirely.
  const redeemableEquityIds = equityIds.filter(id => fundById.get(id)?.category !== "elss");
  const fundId = rand() < 0.70 ? pick(redeemableEquityIds) : pickFundWeighted();
  const nav    = navForFundOnDate(fundId, txnDate);
  const amount = Math.round(clamp(
    Math.exp(normalRand(9.8, 1.0)), // median ~₹18K
    1_000, 500_000
  ) / 500) * 500;

  transactions.push({
    txn_id: `TXN_${String(txnSeq++).padStart(7, "0")}`,
    investor_id: inv.investor_id,
    fund_id: fundId,
    sip_id: null,
    goal_id: null,
    txn_date: txnDate,
    txn_type: "redemption",
    amount_inr: amount,
    units: roundTo(amount / nav, 4),
    nav_at_txn: nav,
    status: rand() < 0.01 ? "failed" : "success",
    channel: weightedPick(["app","web","advisor_assisted"], [0.45, 0.40, 0.15]),
    payment_mode: "bank_transfer",
  });
}

// NOTE: transactions.csv is written AFTER Step 5 so SWP/STP transactions are included.

// ════════════════════════════════════════════════════════════════
// STAGE 2 VALIDATION SUMMARY
// ════════════════════════════════════════════════════════════════

const successInstallments = transactions.filter(t => t.txn_type === "sip_installment" && t.status === "success");
const failedInstallments  = transactions.filter(t => t.txn_type === "sip_installment" && t.status === "failed");
const nachInstallments    = transactions.filter(t => t.txn_type === "sip_installment" && t.payment_mode === "nach");
const upiInstallments     = transactions.filter(t => t.txn_type === "sip_installment" && t.payment_mode === "upi");
const failedNach          = nachInstallments.filter(t => t.status === "failed");
const failedUpi           = upiInstallments.filter(t => t.status === "failed");

const elssSips   = sips.filter(s => fundById.get(s.fund_id)?.category === "elss");
const elssJanMar = elssSips.filter(s => isElssSeason(s.start_date));
const elssOther  = elssSips.filter(s => !isElssSeason(s.start_date));
const avgMonthlyElss = elssOther.length / 20; // ~20 non-ELSS-season months
const elssSeasonRate = elssJanMar.length / 6;  // 6 ELSS-season months in 24-mo window

console.log("\n📊 Stage 2 Summary:");
console.log(`  SIPs: ${sips.length.toLocaleString()} total`);
console.log(`    Active:    ${activeSips.length.toLocaleString()}`);
console.log(`    Cancelled: ${cancelledSips.length.toLocaleString()}`);
console.log(`    ELSS SIPs: ${elssSips.length.toLocaleString()} (${(elssSips.length / sips.length * 100).toFixed(1)}%)`);
console.log(`    ELSS Jan-Mar rate: ${elssSeasonRate.toFixed(0)}/month vs ${avgMonthlyElss.toFixed(0)}/month other (${(elssSeasonRate / avgMonthlyElss).toFixed(1)}× — target 3.2×)`);
console.log(`  Transactions: ${transactions.length.toLocaleString()} total`);
console.log(`    SIP installments: ${transactions.filter(t => t.txn_type === "sip_installment").length.toLocaleString()}`);
console.log(`    Lumpsums:         ${transactions.filter(t => t.txn_type === "lumpsum").length.toLocaleString()}`);
console.log(`    Redemptions:      ${transactions.filter(t => t.txn_type === "redemption").length.toLocaleString()}`);
console.log(`    NACH failure rate: ${(failedNach.length / Math.max(1, nachInstallments.length) * 100).toFixed(1)}% (target 6.2%)`);
console.log(`    UPI failure rate:  ${(failedUpi.length / Math.max(1, upiInstallments.length) * 100).toFixed(1)}% (target 1.9%)`);

// ════════════════════════════════════════════════════════════════
// STEP 5: SYSTEMATIC PLANS (~12,000 rows)
// ════════════════════════════════════════════════════════════════

console.log("\n🔷 Step 5: Generating systematic_plans.csv...");

interface SystematicPlan {
  plan_id: string;
  investor_id: string;
  plan_type: string;
  source_fund_id: string;
  target_fund_id: string | null;
  amount_inr: number;
  frequency: string;
  start_date: string;
  end_date: string | null;
  status: string;
  installments_completed: number;
}

const systematicPlans: SystematicPlan[] = [];
const planCount = 4_000; // ~12% of invested investors; STPs/SWPs are niche products

for (let i = 0; i < planCount; i++) {
  const inv = pick(investedInvestors);
  if (!inv.first_investment_date) continue;

  const planType = weightedPick(["stp","swp","super_savings"], [0.40, 0.35, 0.25]);
  const startDate = randomDateBetween(
    inv.first_investment_date > DATE_START ? inv.first_investment_date : DATE_START,
    addMonths(DATE_END, -3)
  );

  // Source fund: liquid for STP/super_savings; equity for SWP
  const sourceFundId = (planType === "swp")
    ? pick(equityIds)
    : pick(liquidIds);
  // Target fund: equity for STP; null for SWP/super_savings (goes to bank)
  const targetFundId = (planType === "stp")
    ? pick(equityIds.filter(id => id !== sourceFundId))
    : null;

  const amount = planType === "swp"
    ? Math.round(clamp(Math.exp(normalRand(9.0, 0.8)), 5_000, 100_000) / 1000) * 1000
    : Math.round(clamp(Math.exp(normalRand(9.2, 0.9)), 5_000, 200_000) / 1000) * 1000;

  const status = weightedPick(["active","completed","cancelled"], [0.60, 0.28, 0.12]);
  const endDate = status !== "active"
    ? randomDateBetween(startDate, DATE_END)
    : null;
  const activeMonths = diffMonths(startDate, endDate ?? DATE_END);

  systematicPlans.push({
    plan_id: `SPL_${String(i + 1).padStart(5, "0")}`,
    investor_id: inv.investor_id,
    plan_type: planType,
    source_fund_id: sourceFundId,
    target_fund_id: targetFundId,
    amount_inr: amount,
    frequency: weightedPick(["monthly","weekly"], [0.82, 0.18]),
    start_date: startDate,
    end_date: endDate,
    status,
    installments_completed: Math.max(0, activeMonths),
  });
}

writeCsv("systematic_plans.csv",
  ["plan_id","investor_id","plan_type","source_fund_id","target_fund_id",
   "amount_inr","frequency","start_date","end_date","status","installments_completed"],
  systematicPlans
);

// Generate actual transactions for SWP and STP plans.
// Without this, the systematic_plans table is orphaned — no transaction records exist
// for ₹Xs in monthly SWP outflows or STP transfers, breaking any cash-flow analysis.
console.log("  Generating SWP/STP transactions...");
for (const plan of systematicPlans) {
  const windowStart = plan.start_date > DATE_START ? plan.start_date : DATE_START;
  const windowEnd   = plan.end_date && plan.end_date < DATE_END ? plan.end_date : DATE_END;
  if (windowStart > windowEnd) continue;

  const planMonths = allMonths(windowStart, windowEnd);
  // SWP: monthly redemption from equity fund to bank
  // STP: monthly redemption from liquid + purchase into equity (two txns per installment)
  // super_savings: monthly redemption from liquid to bank (similar to SWP)
  for (const [y, m] of planMonths) {
    const txnDate = dateStr(y, m, Math.min(28, new Date(plan.start_date).getDate() || 5));
    const nav = navForFundOnDate(plan.source_fund_id, txnDate);
    const status = rand() < 0.02 ? "failed" : "success";

    if (plan.plan_type === "swp" || plan.plan_type === "super_savings") {
      transactions.push({
        txn_id: `TXN_${String(txnSeq++).padStart(7, "0")}`,
        investor_id: plan.investor_id,
        fund_id: plan.source_fund_id,
        sip_id: null,
        goal_id: null,
        txn_date: txnDate,
        txn_type: "redemption",
        amount_inr: status === "success" ? plan.amount_inr : 0,
        units: status === "success" ? roundTo(plan.amount_inr / Math.max(nav, 1), 4) : 0,
        nav_at_txn: nav,
        status,
        channel: "app",
        payment_mode: "bank_transfer",
      });
    } else if (plan.plan_type === "stp" && plan.target_fund_id) {
      // STP redemption from liquid
      transactions.push({
        txn_id: `TXN_${String(txnSeq++).padStart(7, "0")}`,
        investor_id: plan.investor_id,
        fund_id: plan.source_fund_id,
        sip_id: null, goal_id: null,
        txn_date: txnDate,
        txn_type: "redemption",
        amount_inr: status === "success" ? plan.amount_inr : 0,
        units: status === "success" ? roundTo(plan.amount_inr / Math.max(nav, 1), 4) : 0,
        nav_at_txn: nav,
        status, channel: "app", payment_mode: "bank_transfer",
      });
      // STP purchase into equity fund (settled next day)
      if (status === "success") {
        const tNav = navForFundOnDate(plan.target_fund_id, txnDate);
        transactions.push({
          txn_id: `TXN_${String(txnSeq++).padStart(7, "0")}`,
          investor_id: plan.investor_id,
          fund_id: plan.target_fund_id,
          sip_id: null, goal_id: null,
          txn_date: addDays(txnDate, 1),
          txn_type: "stp_purchase",
          amount_inr: plan.amount_inr,
          units: roundTo(plan.amount_inr / Math.max(tNav, 1), 4),
          nav_at_txn: tNav,
          status: "success", channel: "app", payment_mode: "internal_transfer",
        });
      }
    }
  }
}
console.log(`  SWP/STP transactions added. Total transactions so far: ${transactions.length.toLocaleString()}`);
// transactions.csv is written AFTER Step 6 so goal_ids can be linked first.

// ════════════════════════════════════════════════════════════════
// STEP 6: GOALS (~65,000 rows)
// ════════════════════════════════════════════════════════════════

console.log("\n🔷 Step 6: Generating goals.csv...");

interface Goal {
  goal_id: string;
  investor_id: string;
  goal_type: string;
  target_amount_inr: number;
  target_date: string;
  monthly_sip_needed_inr: number;
  current_value_inr: number;
  created_date: string;
  status: string;
  created_by: string;
  flagged_at_risk_date: string | null;
  achieved_date: string | null;
}

const GOAL_TYPES = [
  { type: "retirement",       weight: 0.28, targetMin: 5_000_000,  targetMax: 50_000_000, horizonMin: 10, horizonMax: 30 },
  { type: "wealth_creation",  weight: 0.22, targetMin: 1_000_000,  targetMax: 20_000_000, horizonMin: 3,  horizonMax: 15 },
  { type: "tax_saving",       weight: 0.18, targetMin: 150_000,    targetMax: 150_000,    horizonMin: 1,  horizonMax: 3  },
  { type: "education",        weight: 0.12, targetMin: 1_000_000,  targetMax: 10_000_000, horizonMin: 5,  horizonMax: 18 },
  { type: "home_purchase",    weight: 0.08, targetMin: 2_000_000,  targetMax: 20_000_000, horizonMin: 3,  horizonMax: 10 },
  { type: "emergency_fund",   weight: 0.07, targetMin: 300_000,    targetMax: 1_000_000,  horizonMin: 1,  horizonMax: 2  },
  { type: "vacation",         weight: 0.05, targetMin: 200_000,    targetMax: 1_000_000,  horizonMin: 1,  horizonMax: 3  },
];

const goals: Goal[] = [];
const goalCount = 65_000;

// Build investor → transactions map for current_value estimation
const investorTxnAmounts = new Map<string, number>();
for (const t of transactions) {
  if (t.status === "success" && t.txn_type !== "redemption") {
    investorTxnAmounts.set(t.investor_id, (investorTxnAmounts.get(t.investor_id) ?? 0) + t.amount_inr);
  }
}

for (let i = 0; i < goalCount; i++) {
  const inv = pick(investedInvestors);
  if (!inv.first_investment_date) continue;

  const goalDef = weightedPick(GOAL_TYPES, GOAL_TYPES.map(g => g.weight));
  const createdDate = randomDateBetween(
    inv.first_investment_date > DATE_START ? inv.first_investment_date : DATE_START,
    addMonths(DATE_END, -1)
  );

  const targetAmount = randInt(goalDef.targetMin, goalDef.targetMax);
  const horizonYears = randInt(goalDef.horizonMin, goalDef.horizonMax);
  const targetDate   = addMonths(createdDate, horizonYears * 12);

  // Monthly SIP needed: simplified PMT calculation (12% annual return assumption)
  const monthsLeft = Math.max(1, diffMonths(createdDate, targetDate));
  const monthlyRate = 0.01; // 12% / 12
  const sipNeeded   = Math.round(
    (targetAmount * monthlyRate) / (Math.pow(1 + monthlyRate, monthsLeft) - 1)
  );

  // Current value: proportional to investor's total invested
  const totalInvested = investorTxnAmounts.get(inv.investor_id) ?? 0;
  const goalShare     = goalDef.type === "tax_saving" ? 1.0 : clamp(rand(), 0.1, 0.6);
  const currentValue  = Math.round(totalInvested * goalShare * clamp(1 + normalRand(0.08, 0.15), 0.7, 1.8));

  // Status: realistic weighted distribution per goal type.
  // Previous formula (expectedProgress = targetAmount × (1 - monthsLeft/horizonYears*12)) always
  // evaluated to 0 since goals are created within the window, making all goals appear on_track.
  const status = goalDef.type === "tax_saving" && createdDate < "2026-03-31"
    ? (rand() < 0.45 ? "achieved" : rand() < 0.78 ? "on_track" : "at_risk")
    : goalDef.type === "emergency_fund" || goalDef.type === "vacation"
    // Short-horizon goals: higher achieved rate, more polarised
    ? weightedPick(["on_track","at_risk","off_track","achieved"], [0.52, 0.20, 0.16, 0.12])
    // Long-horizon goals (retirement, education, wealth): advisory pushes people toward on_track
    // but real advisory platforms show ~55-60% on_track
    : weightedPick(["on_track","at_risk","off_track"], [0.57, 0.24, 0.19]);

  const achievedDate    = status === "achieved" ? randomDateBetween(createdDate, DATE_END) : null;
  const flaggedAtRisk   = (status === "at_risk" || status === "off_track")
    ? randomDateBetween(createdDate, DATE_END) : null;

  goals.push({
    goal_id: `GOL_${String(i + 1).padStart(6, "0")}`,
    investor_id: inv.investor_id,
    goal_type: goalDef.type,
    target_amount_inr: targetAmount,
    target_date: targetDate,
    monthly_sip_needed_inr: sipNeeded,
    current_value_inr: currentValue,
    created_date: createdDate,
    status,
    created_by: weightedPick(["money_mitr","advisor","self"], [0.45, 0.30, 0.25]),
    flagged_at_risk_date: flaggedAtRisk,
    achieved_date: achievedDate,
  });
}

writeCsv("goals.csv",
  ["goal_id","investor_id","goal_type","target_amount_inr","target_date",
   "monthly_sip_needed_inr","current_value_inr","created_date","status",
   "created_by","flagged_at_risk_date","achieved_date"],
  goals
);

// ════════════════════════════════════════════════════════════════
// GOAL → TRANSACTION LINKAGE (post-processing pass)
// On FundsIndia's advisory platform ~45% of SIPs are explicitly goal-linked.
// Goals are generated after transactions (needs investorTxnAmounts), so we
// mutate the in-memory transactions array here before writing the CSV.
// ════════════════════════════════════════════════════════════════

// Fund category affinity per goal type — matches how FundsIndia advisors map goals to funds.
const GOAL_FUND_AFFINITY: Record<string, string[]> = {
  retirement:      ["equity", "elss", "daaf", "hybrid"],
  wealth_creation: ["equity", "daaf", "hybrid"],
  tax_saving:      ["elss"],
  education:       ["equity", "daaf"],
  home_purchase:   ["equity", "daaf", "debt"],
  emergency_fund:  ["liquid", "debt"],
  vacation:        ["liquid", "debt"],
};

// Build investor → goals lookup
const investorGoalMap = new Map<string, Goal[]>();
for (const g of goals) {
  if (!investorGoalMap.has(g.investor_id)) investorGoalMap.set(g.investor_id, []);
  investorGoalMap.get(g.investor_id)!.push(g);
}

// Map each SIP to a goal (45% of SIPs, matched by category affinity + timing)
const sipGoalLink = new Map<string, string>(); // sip_id → goal_id
for (const sip of sips) {
  if (rand() > 0.45) continue;
  const invGoals = investorGoalMap.get(sip.investor_id);
  if (!invGoals || invGoals.length === 0) continue;

  const fund = fundById.get(sip.fund_id)!;
  const sipRef = sip.start_date >= DATE_START ? sip.start_date : DATE_START;
  const affinity = GOAL_FUND_AFFINITY[fund.category] ? [] :
    Object.entries(GOAL_FUND_AFFINITY).filter(([, cats]) => cats.includes(fund.category)).map(([t]) => t);

  // Prefer goals created before the SIP started and with matching category affinity
  const eligible = invGoals.filter(g => {
    const timeOk = g.created_date <= sipRef || sip.start_date < DATE_START;
    const catOk  = (GOAL_FUND_AFFINITY[g.goal_type] ?? []).includes(fund.category);
    return timeOk && catOk;
  });

  const pool = eligible.length > 0
    ? eligible
    : invGoals.filter(g => g.created_date <= sipRef || sip.start_date < DATE_START);
  if (pool.length > 0) sipGoalLink.set(sip.sip_id, pick(pool).goal_id);
}

// Apply goal_ids to SIP installment transactions
let linkedSipTxns = 0;
let linkedLumpTxns = 0;
for (const txn of transactions) {
  if (txn.txn_type === "sip_installment" && txn.sip_id && sipGoalLink.has(txn.sip_id)) {
    txn.goal_id = sipGoalLink.get(txn.sip_id)!;
    linkedSipTxns++;
  }
  // Also link ~22% of lumpsums to goals (one-time top-ups toward a goal)
  if (txn.txn_type === "lumpsum" && rand() < 0.22) {
    const invGoals = investorGoalMap.get(txn.investor_id);
    if (invGoals && invGoals.length > 0) {
      const fund = fundById.get(txn.fund_id)!;
      const eligible = invGoals.filter(g =>
        (GOAL_FUND_AFFINITY[g.goal_type] ?? []).includes(fund.category) &&
        g.created_date <= txn.txn_date
      );
      if (eligible.length > 0) { txn.goal_id = pick(eligible).goal_id; linkedLumpTxns++; }
    }
  }
}

console.log(`\n  Goal linkage: ${sipGoalLink.size} SIPs linked (${(sipGoalLink.size/sips.length*100).toFixed(1)}%)`);
console.log(`    SIP installments with goal_id: ${linkedSipTxns.toLocaleString()}`);
console.log(`    Lumpsums with goal_id: ${linkedLumpTxns.toLocaleString()}`);

// Now write transactions.csv — includes goal_ids set above.
transactions.sort((a, b) => a.txn_date.localeCompare(b.txn_date));
writeCsv("transactions.csv",
  ["txn_id","investor_id","fund_id","sip_id","goal_id",
   "txn_date","txn_type","amount_inr","units","nav_at_txn",
   "status","channel","payment_mode"],
  transactions
);

// ════════════════════════════════════════════════════════════════
// STEP 7: COMMS LOG (~300,000 rows)
// ════════════════════════════════════════════════════════════════

console.log("\n🔷 Step 7: Generating comms_log.csv...");

interface Comm {
  comm_id: string;
  investor_id: string;
  channel: string;
  campaign_type: string;
  sent_at: string;
  delivered: boolean;
  opened: boolean;
  clicked: boolean;
  converted: boolean;
  action_taken: string | null;
}

const CAMPAIGN_TYPES = [
  { type: "welcome_series",         channel_bias: "email", open_rate: 0.35, click_rate: 0.08, conv_rate: 0.04 },
  { type: "sip_nudge",              channel_bias: "push",  open_rate: 0.20, click_rate: 0.06, conv_rate: 0.021 },
  { type: "portfolio_review",       channel_bias: "email", open_rate: 0.22, click_rate: 0.05, conv_rate: 0.010 },
  { type: "fund_recommendation",    channel_bias: "email", open_rate: 0.24, click_rate: 0.053, conv_rate: 0.018 },
  { type: "tax_saving",             channel_bias: "email", open_rate: 0.28, click_rate: 0.085, conv_rate: 0.034 },
  { type: "market_alert",           channel_bias: "push",  open_rate: 0.22, click_rate: 0.040, conv_rate: 0.008 },
  { type: "kyc_reminder",           channel_bias: "sms",   open_rate: 0.18, click_rate: 0.030, conv_rate: 0.020 },
  { type: "dormant_activation",     channel_bias: "email", open_rate: 0.15, click_rate: 0.030, conv_rate: 0.015 },
  { type: "step_up_nudge",          channel_bias: "push",  open_rate: 0.18, click_rate: 0.035, conv_rate: 0.012 },
  { type: "nominee_reminder",       channel_bias: "push",  open_rate: 0.16, click_rate: 0.020, conv_rate: 0.005 },
  { type: "wealth_conversations",   channel_bias: "email", open_rate: 0.25, click_rate: 0.040, conv_rate: 0.008 },
  { type: "pre_redemption",         channel_bias: "push",  open_rate: 0.40, click_rate: 0.120, conv_rate: 0.060 },
  { type: "elss_lapse_warning",     channel_bias: "email", open_rate: 0.32, click_rate: 0.100, conv_rate: 0.040 },
  { type: "market_commentary",      channel_bias: "email", open_rate: 0.22, click_rate: 0.035, conv_rate: 0.008 },
];

const commsLog: Comm[] = [];
let commSeq = 1;
const targetComms = 300_000;

// Campaign sends per month (distributed across investor base and campaign types)
// Each investor gets ~8-12 communications per year = 1/month
let commsSoFar = 0;

for (const [y, m] of months) {
  const isElss = isElssSeason(dateStr(y, m, 15));
  const isKyc  = isKycCrisisMonth(y, m);
  const isOctCorr = (y === 2024 && m === 10);

  // Monthly target comms (ramp up over the period)
  const monthlyTarget = Math.round(targetComms / 24);

  // Pick campaign types for this month
  const monthCampaigns: typeof CAMPAIGN_TYPES[0][] = [];
  // Always include portfolio_review (quarterly)
  if (m % 3 === 1) monthCampaigns.push(CAMPAIGN_TYPES.find(c => c.type === "portfolio_review")!);
  // ELSS season: heavy tax-saving + elss_lapse_warning
  if (isElss) {
    monthCampaigns.push(CAMPAIGN_TYPES.find(c => c.type === "tax_saving")!);
    monthCampaigns.push(CAMPAIGN_TYPES.find(c => c.type === "tax_saving")!); // 2× weight
    if (m === 2 || m === 3) monthCampaigns.push(CAMPAIGN_TYPES.find(c => c.type === "elss_lapse_warning")!);
  }
  // KYC crisis months: heavy kyc_reminder
  if (isKyc) monthCampaigns.push(...Array(3).fill(CAMPAIGN_TYPES.find(c => c.type === "kyc_reminder")!));
  // Oct 2024 correction: market_alert (planted story)
  if (isOctCorr) {
    monthCampaigns.push(CAMPAIGN_TYPES.find(c => c.type === "market_alert")!);
    monthCampaigns.push(CAMPAIGN_TYPES.find(c => c.type === "market_commentary")!);
  }
  // Always: sip_nudge, fund_recommendation, wealth_conversations
  monthCampaigns.push(CAMPAIGN_TYPES.find(c => c.type === "sip_nudge")!);
  monthCampaigns.push(CAMPAIGN_TYPES.find(c => c.type === "fund_recommendation")!);
  monthCampaigns.push(CAMPAIGN_TYPES.find(c => c.type === "wealth_conversations")!);
  // Random others
  monthCampaigns.push(pick(CAMPAIGN_TYPES));

  const sendsThisMonth = Math.min(monthlyTarget, targetComms - commsSoFar);

  // Only send to investors activated by this month (prevents pre-signup comms).
  const monthEndStr = dateStr(y, m, daysInMonth(y, m));
  const activatedByMonth = activatedInvestors.filter(
    inv => (inv.account_activated_date ?? inv.signup_date) <= monthEndStr
  );
  if (activatedByMonth.length === 0) { commsSoFar += sendsThisMonth; continue; }

  // Activated investors are always KYC-verified (you can't activate without KYC).
  // KYC reminders must target the non-activated pool who are stuck in KYC limbo.
  // Dormant activation targets investors who signed up but never invested.
  const kycStuckPool = trimmedInvestors.filter(
    inv => inv.kyc_status !== "verified" &&
           inv.kyc_submitted_date !== null &&
           inv.signup_date <= monthEndStr
  );
  const dormantPool  = activatedByMonth.filter(inv => !inv.is_active);
  const activePool   = activatedByMonth.filter(inv => inv.is_active);

  for (let i = 0; i < sendsThisMonth; i++) {
    const campaign = pick(monthCampaigns);

    // Route each campaign type to its appropriate target segment.
    const pool = campaign.type === "kyc_reminder"       ? (kycStuckPool.length > 0 ? kycStuckPool : activatedByMonth) :
                 campaign.type === "dormant_activation"  ? (dormantPool.length > 0 ? dormantPool : activatedByMonth) :
                 campaign.type === "pre_redemption"      ? (activePool.length > 0 ? activePool : activatedByMonth) :
                 activatedByMonth;
    const inv = pick(pool);

    const sentDay  = randInt(1, daysInMonth(y, m));
    let   sentDateStr = dateStr(y, m, sentDay);
    // Same-month signup edge case: don't send a comm before the investor signed up.
    if (sentDateStr < inv.signup_date) sentDateStr = inv.signup_date;
    const sentHour = randInt(8, 21);
    const sentAt   = `${sentDateStr} ${String(sentHour).padStart(2, "0")}:${String(randInt(0, 59)).padStart(2, "0")}:00`;

    const channel = weightedPick(
      ["email","push","sms","whatsapp"],
      campaign.channel_bias === "email" ? [0.60, 0.20, 0.12, 0.08] :
      campaign.channel_bias === "push"  ? [0.25, 0.50, 0.15, 0.10] :
      campaign.channel_bias === "sms"   ? [0.20, 0.20, 0.50, 0.10] :
                                          [0.40, 0.30, 0.15, 0.15]
    );

    // Push: ~70% delivery (battery optimization + OS-level throttling reduce effective rate)
    const delivered = rand() < (channel === "email" ? 0.96 : channel === "push" ? 0.70 : 0.95);

    // Oct 2024 market alert: open rate 34% vs 22% baseline (planted story 2)
    const openRateBoost = isOctCorr && campaign.type === "market_alert" ? 1.55 : 1.0;
    const opened    = delivered && rand() < campaign.open_rate * openRateBoost;
    const clicked   = opened    && rand() < campaign.click_rate;
    const converted = clicked   && rand() < campaign.conv_rate;

    const actionTaken = converted
      ? weightedPick(["sip_created","lumpsum_done","goal_created","no_action"], [0.45, 0.32, 0.15, 0.08])
      : null;

    commsLog.push({
      comm_id: `CM_${String(commSeq++).padStart(7, "0")}`,
      investor_id: inv.investor_id,
      channel,
      campaign_type: campaign.type,
      sent_at: sentAt,
      delivered,
      opened,
      clicked,
      converted,
      action_taken: actionTaken,
    });
    commsSoFar++;
  }
  if (commsSoFar >= targetComms) break;
}

writeCsv("comms_log.csv",
  ["comm_id","investor_id","channel","campaign_type","sent_at",
   "delivered","opened","clicked","converted","action_taken"],
  commsLog
);

// ════════════════════════════════════════════════════════════════
// STAGE 3 VALIDATION SUMMARY
// ════════════════════════════════════════════════════════════════

const taxSavingComms      = commsLog.filter(c => c.campaign_type === "tax_saving");
const marketAlertComms    = commsLog.filter(c => c.campaign_type === "market_alert");
const taxSavingOpenRate   = taxSavingComms.filter(c => c.opened).length / Math.max(1, taxSavingComms.length);
const marketAlertOct2024  = marketAlertComms.filter(c => c.sent_at.startsWith("2024-10"));
const oct2024OpenRate     = marketAlertOct2024.filter(c => c.opened).length / Math.max(1, marketAlertOct2024.length);
const kycReminderComms    = commsLog.filter(c => c.campaign_type === "kyc_reminder" && c.sent_at.startsWith("2024-0"));

console.log("\n📊 Stage 3 Summary:");
console.log(`  Systematic Plans: ${systematicPlans.length.toLocaleString()}`);
console.log(`  Goals: ${goals.length.toLocaleString()}`);
console.log(`    On-track: ${goals.filter(g => g.status === "on_track").length.toLocaleString()}`);
console.log(`    At-risk:  ${goals.filter(g => g.status === "at_risk").length.toLocaleString()}`);
console.log(`    Achieved: ${goals.filter(g => g.status === "achieved").length.toLocaleString()}`);
console.log(`  Comms: ${commsLog.length.toLocaleString()} total`);
console.log(`    Tax-saving open rate: ${(taxSavingOpenRate * 100).toFixed(1)}% (target 28%)`);
console.log(`    Oct 2024 market-alert open rate: ${(oct2024OpenRate * 100).toFixed(1)}% (target 34%)`);
console.log(`    Jun-Jul KYC reminders: ${kycReminderComms.length.toLocaleString()}`);

// ════════════════════════════════════════════════════════════════
// STEP 8: ADVISORY SESSIONS (~20,000 rows)
// ════════════════════════════════════════════════════════════════

console.log("\n🔷 Step 8: Generating advisory_sessions.csv...");

interface AdvisorySession {
  session_id: string;
  investor_id: string;
  session_date: string;
  advisor_type: string;
  session_type: string;
  duration_min: number;
  recommendation_type: string;
  outcome: string;
  portfolio_value_at_time: number;
  triggered_by: string;
}

const advisorySessions: AdvisorySession[] = [];
const sessionCount = 20_000;

const SESSION_TYPES = [
  { type: "goal_planning",     advisor_bias: "money_mitr",     weight: 0.28 },
  { type: "portfolio_review",  advisor_bias: "both",           weight: 0.25 },
  { type: "fund_selection",    advisor_bias: "both",           weight: 0.20 },
  { type: "risk_assessment",   advisor_bias: "money_mitr",     weight: 0.12 },
  { type: "pre_redemption_call",advisor_bias: "human_advisor", weight: 0.15 },
];

for (let i = 0; i < sessionCount; i++) {
  const inv = pick(investedInvestors);
  if (!inv.first_investment_date) continue;

  const sessionDef = weightedPick(SESSION_TYPES, SESSION_TYPES.map(s => s.weight));
  const sessionDate = randomDateBetween(
    inv.first_investment_date > DATE_START ? inv.first_investment_date : DATE_START,
    DATE_END
  );

  // Advisor type
  const advisorType = sessionDef.advisor_bias === "money_mitr"    ? "money_mitr" :
                      sessionDef.advisor_bias === "human_advisor"  ? "human_advisor" :
                      weightedPick(["money_mitr","human_advisor"], [0.58, 0.42]);

  const durationMin = advisorType === "money_mitr"
    ? randInt(3, 12)
    : randInt(12, 48);

  // Pre-redemption call outcome: 55% follow = don't redeem (planted story 7)
  const outcome = sessionDef.type === "pre_redemption_call"
    ? weightedPick(["followed","partial","ignored"], [0.55, 0.10, 0.35])
    : weightedPick(["followed","partial","ignored"], [0.48, 0.22, 0.30]);

  const portfolioValue = (investorTxnAmounts.get(inv.investor_id) ?? 50_000) *
    clamp(1 + normalRand(0.10, 0.20), 0.7, 2.0);

  advisorySessions.push({
    session_id: `ADV_${String(i + 1).padStart(5, "0")}`,
    investor_id: inv.investor_id,
    session_date: sessionDate,
    advisor_type: advisorType,
    session_type: sessionDef.type,
    duration_min: durationMin,
    recommendation_type: weightedPick(
      ["increase_sip","fund_switch","start_sip","add_elss","rebalance","stay_invested"],
      [0.25, 0.20, 0.18, 0.15, 0.12, 0.10]
    ),
    outcome,
    portfolio_value_at_time: Math.round(portfolioValue),
    // pre_redemption_call is by definition triggered by a live redemption request.
    // Other session types are initiated by various channels.
    triggered_by: sessionDef.type === "pre_redemption_call"
      ? "redemption_request"
      : weightedPick(
          ["investor_initiated","comms_click","system_alert","redemption_request"],
          [0.40, 0.35, 0.15, 0.10]
        ),
  });
}

writeCsv("advisory_sessions.csv",
  ["session_id","investor_id","session_date","advisor_type","session_type",
   "duration_min","recommendation_type","outcome","portfolio_value_at_time","triggered_by"],
  advisorySessions
);

// ════════════════════════════════════════════════════════════════
// STEP 9: SUPPORT TICKETS (~10,000 rows)
// ════════════════════════════════════════════════════════════════

console.log("\n🔷 Step 9: Generating support_tickets.csv...");

interface SupportTicket {
  ticket_id: string;
  investor_id: string;
  created_at: string;
  resolved_at: string | null;
  category: string;
  channel: string;
  priority: string;
  status: string;
  resolution_hours: number | null;
  nps_score: number | null;
}

const supportTickets: SupportTicket[] = [];
const ticketCount = 10_000;

const TICKET_CATEGORIES = [
  { cat: "kyc",          baseWeight: 0.20, kycCrisisWeight: 0.45, resolutionMean: 48,  resolutionStd: 24 },
  { cat: "sip_failure",  baseWeight: 0.22, kycCrisisWeight: 0.15, resolutionMean: 12,  resolutionStd: 8  },
  { cat: "bank_mandate", baseWeight: 0.18, kycCrisisWeight: 0.12, resolutionMean: 24,  resolutionStd: 12 },
  { cat: "redemption",   baseWeight: 0.15, kycCrisisWeight: 0.10, resolutionMean: 18,  resolutionStd: 10 },
  { cat: "login",        baseWeight: 0.08, kycCrisisWeight: 0.06, resolutionMean: 1.5, resolutionStd: 1  },
  { cat: "statement",    baseWeight: 0.07, kycCrisisWeight: 0.04, resolutionMean: 6,   resolutionStd: 4  },
  { cat: "complaint",    baseWeight: 0.05, kycCrisisWeight: 0.04, resolutionMean: 72,  resolutionStd: 36 },
  { cat: "other",        baseWeight: 0.05, kycCrisisWeight: 0.04, resolutionMean: 24,  resolutionStd: 12 },
];

for (let i = 0; i < ticketCount; i++) {
  const inv = pick(activatedInvestors);
  const createdAt = randomDateBetween(
    inv.account_activated_date! > DATE_START ? inv.account_activated_date! : DATE_START,
    DATE_END
  );

  const ym = createdAt.slice(0, 7);
  const [cy, cm] = ym.split("-").map(Number);
  const inKycCrisis = isKycCrisisMonth(cy, cm);

  const weights = inKycCrisis
    ? TICKET_CATEGORIES.map(c => c.kycCrisisWeight)
    : TICKET_CATEGORIES.map(c => c.baseWeight);
  const catDef = weightedPick(TICKET_CATEGORIES, weights);

  const resolutionHours = clamp(normalRand(catDef.resolutionMean, catDef.resolutionStd), 0.5, 240);
  const status = rand() < 0.83 ? "resolved" : rand() < 0.60 ? "escalated" : "open";
  const resolvedAt = status === "resolved"
    ? addDays(createdAt, Math.ceil(resolutionHours / 24))
    : status === "escalated"
    ? addDays(createdAt, Math.ceil(resolutionHours * 1.5 / 24))
    : null;
  // NPS: resolved tickets still get low scores from unhappy customers
  const npsScore = status === "resolved"   ? weightedPick([1,2,3,4,5,6,7,8,9,10],[0.03,0.04,0.05,0.07,0.08,0.10,0.16,0.22,0.17,0.08]) :
                   status === "escalated"  ? weightedPick([0,1,2,3,4,5,6],[0.12,0.15,0.20,0.22,0.16,0.10,0.05]) : null;

  supportTickets.push({
    ticket_id: `TKT_${String(i + 1).padStart(5, "0")}`,
    investor_id: inv.investor_id,
    created_at: `${createdAt} ${String(randInt(8, 20)).padStart(2, "0")}:${String(randInt(0, 59)).padStart(2, "0")}:00`,
    resolved_at: resolvedAt ? `${resolvedAt} ${String(randInt(8, 20)).padStart(2, "0")}:${String(randInt(0, 59)).padStart(2, "0")}:00` : null,
    category: catDef.cat,
    channel: weightedPick(["in_app","phone","email","chat"], [0.38, 0.32, 0.20, 0.10]),
    priority: weightedPick(["high","medium","low"], [0.20, 0.50, 0.30]),
    status,
    resolution_hours: roundTo(resolutionHours, 1),
    nps_score: npsScore,
  });
}

writeCsv("support_tickets.csv",
  ["ticket_id","investor_id","created_at","resolved_at","category",
   "channel","priority","status","resolution_hours","nps_score"],
  supportTickets
);

const kycTicketsJunJul  = supportTickets.filter(t => t.category === "kyc" && (t.created_at.startsWith("2024-06") || t.created_at.startsWith("2024-07")));
const kycTicketsNormal  = supportTickets.filter(t => t.category === "kyc" && !t.created_at.startsWith("2024-06") && !t.created_at.startsWith("2024-07"));
const preRdmCallFollowed = advisorySessions.filter(a => a.session_type === "pre_redemption_call" && a.outcome === "followed");
const preRdmCallTotal    = advisorySessions.filter(a => a.session_type === "pre_redemption_call");

console.log(`  Support Tickets: ${supportTickets.length.toLocaleString()}`);
console.log(`    KYC tickets Jun-Jul: ${kycTicketsJunJul.length} vs ${(kycTicketsNormal.length / 22).toFixed(0)}/month avg (${(kycTicketsJunJul.length / (kycTicketsNormal.length / 22)).toFixed(1)}× spike — target ~1.8×)`);
console.log(`  Advisory Sessions: ${advisorySessions.length.toLocaleString()}`);
console.log(`    Pre-redemption call retention: ${(preRdmCallFollowed.length / Math.max(1, preRdmCallTotal.length) * 100).toFixed(1)}% (target 55%)`);

// ════════════════════════════════════════════════════════════════
// STEP 10: USER EVENTS (~1,500,000 rows) — Mixpanel-style
// Uses streaming writes (chunks of 50K) to avoid memory limits
// ════════════════════════════════════════════════════════════════

console.log("\n🔷 Step 10: Generating user_events.csv (streaming)...");

const UE_HEADERS = [
  "event_id","event_name","investor_id","anonymous_id","session_id",
  "timestamp","platform","page_path","source_medium",
  "fund_id","fund_category","amc_name",
  "calculator_type","calc_input_amount","calc_result_amount",
  "article_slug","campaign_type","search_query",
  "amount_inr","sip_id","goal_type","step_name","drop_reason",
];

writeCsvHeader("user_events.csv", UE_HEADERS);

let ueSeq = 1;
let ueTotal = 0;
let ueBuffer: Record<string, unknown>[] = [];

function flushUeBuffer() {
  if (ueBuffer.length === 0) return;
  writeCsvChunk("user_events.csv", UE_HEADERS, ueBuffer);
  ueTotal += ueBuffer.length;
  ueBuffer = [];
}

function addEvent(e: Record<string, unknown>) {
  e.event_id = `EV_${String(ueSeq++).padStart(7, "0")}`;
  ueBuffer.push(e);
  if (ueBuffer.length >= 50_000) flushUeBuffer();
}

function ts(date: string, hour: number, minute: number): string {
  return `${date} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}
function randTs(date: string): string {
  return ts(date, randInt(8, 22), randInt(0, 59));
}
function sessionId(): string {
  return `sess_${String(randInt(1, 9999999)).padStart(7, "0")}`;
}
function anonId(investorId: string | null): string {
  return investorId ? investorId.replace("INV", "anon") : `anon_${String(randInt(1, 999999)).padStart(6, "0")}`;
}
// India Android market share ~92%, iOS ~5-6%. Web sessions make up the rest.
function platform(): string {
  return weightedPick(["android","ios","web"], [0.62, 0.06, 0.32]);
}

const FUND_SEARCH_QUERIES = [
  "best SIP 2024","top midcap fund","ELSS tax saving","sbi mutual fund",
  "parag parikh flexi","high return mutual fund","low risk fund","nifty 50 index",
  "best equity fund","debt fund short term","balanced advantage","small cap fund",
  "nippon india","hdfc mid cap","best fund for 5 years","blue chip fund",
  "SIP 1000 per month","which fund is better","tax saving mutual fund 80C",
  "kotak emerging equity",
];

// 1. ONBOARDING EVENTS — for new investors (signed up during window)
const newInvestors = trimmedInvestors.filter(inv => inv.signup_date >= DATE_START);
for (const inv of newInvestors) {
  const sessId = sessionId();
  const plat   = platform();
  const signupDate = inv.signup_date;
  const baseHour   = randInt(9, 21);

  // Discovery events before signup (if acquisition_channel is calculator)
  if (inv.acquisition_channel === "calculator") {
    const calcTypes = ["sip_calculator","lumpsum_calculator","retirement_calculator","step_up_sip_calculator"];
    const calcType  = pick(calcTypes);
    const calcDate  = addDays(signupDate, -randInt(0, 2));
    const inputAmt  = Math.round(clamp(Math.exp(normalRand(7.8, 0.7)), 500, 20_000) / 500) * 500;
    const duration  = randInt(6, 18);
    const result    = Math.round(inputAmt * duration * 12 * 1.12);

    addEvent({ event_name: "calculator_opened",    investor_id: null, anonymous_id: anonId(inv.investor_id), session_id: sessId, timestamp: randTs(calcDate), platform: plat, calculator_type: calcType, page_path: `/${calcType}` });
    addEvent({ event_name: "calculator_computed",  investor_id: null, anonymous_id: anonId(inv.investor_id), session_id: sessId, timestamp: randTs(calcDate), platform: plat, calculator_type: calcType, calc_input_amount: inputAmt, calc_result_amount: result, page_path: `/${calcType}` });
    addEvent({ event_name: "calculator_invest_cta_clicked", investor_id: null, anonymous_id: anonId(inv.investor_id), session_id: sessId, timestamp: randTs(calcDate), platform: plat, calculator_type: calcType, calc_result_amount: result, page_path: `/${calcType}`, source_medium: "calculator" });
  }

  // Academy browsing before signup
  if (rand() < 0.25) {
    const articles = ["how-to-start-investing-in-sips","what-is-mutual-fund","elss-funds-tax-benefits","difference-between-direct-regular","how-to-choose-mutual-funds"];
    const article  = pick(articles);
    addEvent({ event_name: "academy_article_viewed", investor_id: null, anonymous_id: anonId(inv.investor_id), session_id: sessionId(), timestamp: randTs(addDays(signupDate, -randInt(0, 3))), platform: plat, article_slug: article, page_path: `/academy/${article}`, source_medium: inv.acquisition_channel });
  }

  // Signup
  // investor_id is set even at signup_started so funnel queries work end-to-end.
  // The anonymous_id still carries the pre-identification token for session stitching.
  addEvent({ event_name: "signup_started",      investor_id: inv.investor_id, anonymous_id: anonId(inv.investor_id), session_id: sessId, timestamp: ts(signupDate, baseHour, 0), platform: plat, page_path: "/register", source_medium: inv.acquisition_channel });

  // PAN step
  const panDate = inv.pan_confirmed_date;
  const panSess = sessionId();
  addEvent({ event_name: "pan_step_loaded",     investor_id: inv.investor_id, anonymous_id: anonId(inv.investor_id), session_id: panSess, timestamp: ts(panDate, randInt(9, 20), 0), platform: plat, page_path: "/onboarding/pan" });
  addEvent({ event_name: "pan_confirmed",       investor_id: inv.investor_id, anonymous_id: anonId(inv.investor_id), session_id: panSess, timestamp: ts(panDate, randInt(9, 20), 5), platform: plat, page_path: "/onboarding/pan", step_name: "pan" });

  // KYC / FATCA
  if (inv.kyc_submitted_date) {
    const kycSess = sessionId();
    const kycDate = inv.kyc_submitted_date;
    addEvent({ event_name: "kyc_details_submitted", investor_id: inv.investor_id, anonymous_id: anonId(inv.investor_id), session_id: kycSess, timestamp: ts(kycDate, randInt(9, 20), 10), platform: plat, page_path: "/onboarding/kyc", step_name: "kyc" });
    addEvent({ event_name: "fatca_submitted",        investor_id: inv.investor_id, anonymous_id: anonId(inv.investor_id), session_id: kycSess, timestamp: ts(kycDate, randInt(9, 20), 15), platform: plat, page_path: "/onboarding/fatca", step_name: "fatca" });

    if (inv.kyc_status === "on_hold") {
      addEvent({ event_name: "kyc_on_hold",           investor_id: inv.investor_id, anonymous_id: anonId(inv.investor_id), session_id: kycSess, timestamp: ts(kycDate, randInt(9, 20), 20), platform: plat, page_path: "/onboarding/kyc", step_name: "kyc", drop_reason: "pan_aadhaar_mismatch" });
    }
  }

  // Bank verification
  if (inv.bank_verified_date) {
    const bankSess = sessionId();
    const bankDate = inv.bank_verified_date;
    addEvent({ event_name: "bank_auto_detect_started", investor_id: inv.investor_id, anonymous_id: anonId(inv.investor_id), session_id: bankSess, timestamp: ts(bankDate, randInt(9, 20), 0), platform: plat, page_path: "/onboarding/bank" });
    if (inv.bank_link_method === "upi_auto_detect") {
      addEvent({ event_name: "bank_auto_detect_success", investor_id: inv.investor_id, anonymous_id: anonId(inv.investor_id), session_id: bankSess, timestamp: ts(bankDate, randInt(9, 20), 2), platform: plat, page_path: "/onboarding/bank/fetch" });
    }
    addEvent({ event_name: "bank_verified", investor_id: inv.investor_id, anonymous_id: anonId(inv.investor_id), session_id: bankSess, timestamp: ts(bankDate, randInt(9, 20), 5), platform: plat, page_path: "/onboarding/bank/fetch", step_name: "bank" });
  }

  // Account activation
  if (inv.account_activated_date) {
    const actDate = inv.account_activated_date;
    addEvent({ event_name: "account_activated", investor_id: inv.investor_id, anonymous_id: anonId(inv.investor_id), session_id: sessionId(), timestamp: ts(actDate, randInt(9, 20), 0), platform: plat, page_path: "/onboarding/registration-completion", step_name: "activated" });
    if (rand() < 0.20) {
      addEvent({ event_name: "demat_cta_clicked", investor_id: inv.investor_id, anonymous_id: anonId(inv.investor_id), session_id: sessionId(), timestamp: ts(actDate, randInt(9, 20), 5), platform: plat, page_path: "/onboarding/registration-completion" });
    }
  }
}

flushUeBuffer();
console.log(`  Onboarding events: ${ueTotal.toLocaleString()}`);
const afterOnboarding = ueTotal;

// 1b. BLOCKED HIGH-INTENT DISCOVERY — users can browse funds and start SIP
// flows after signup, but cannot complete purchase until KYC + bank
// verification are done. These events deliberately do not create SIPs,
// transactions, account activations, or first investments.
const blockedHighIntentInvestors = shuffle(
  trimmedInvestors.filter(inv =>
    inv.account_activated_date === null &&
    (inv.kyc_status !== "verified" || inv.bank_verified_date === null) &&
    inv.signup_date <= DATE_END
  )
).slice(0, 2200);

for (const inv of blockedHighIntentInvestors) {
  const startDate = (inv.kyc_submitted_date && inv.kyc_submitted_date > DATE_START)
    ? inv.kyc_submitted_date
    : DATE_START;
  const intentDate = randomDateBetween(startDate <= DATE_END ? startDate : DATE_START, DATE_END);
  const fundId = pickFundWeighted(isElssSeason(intentDate) && rand() < 0.18);
  const fund = fundById.get(fundId)!;
  const sessId = sessionId();
  const plat = platform();
  const intentHour = randInt(9, 20);
  const blocker = inv.kyc_status !== "verified" ? "kyc_pending" : "bank_verification_required";
  const stepName = inv.kyc_status !== "verified" ? "kyc_required" : "bank_verification";

  addEvent({
    event_name: "fund_searched",
    investor_id: inv.investor_id,
    anonymous_id: anonId(inv.investor_id),
    session_id: sessId,
    timestamp: ts(intentDate, intentHour, 0),
    platform: plat,
    search_query: pick(FUND_SEARCH_QUERIES),
    page_path: "/search",
    source_medium: inv.acquisition_channel,
  });
  addEvent({
    event_name: "fund_page_viewed",
    investor_id: inv.investor_id,
    anonymous_id: anonId(inv.investor_id),
    session_id: sessId,
    timestamp: ts(intentDate, intentHour, 3),
    platform: plat,
    page_path: `/s/${fundId}`,
    source_medium: "search",
    fund_id: fundId,
    fund_category: fund.category,
    amc_name: fund.amc_name,
  });
  if (rand() < 0.38) {
    addEvent({
      event_name: "fund_watchlisted",
      investor_id: inv.investor_id,
      anonymous_id: anonId(inv.investor_id),
      session_id: sessId,
      timestamp: ts(intentDate, intentHour, 5),
      platform: plat,
      fund_id: fundId,
      fund_category: fund.category,
      amc_name: fund.amc_name,
    });
  }
  addEvent({
    event_name: "sip_flow_started",
    investor_id: inv.investor_id,
    anonymous_id: anonId(inv.investor_id),
    session_id: sessId,
    timestamp: ts(intentDate, intentHour, 8),
    platform: plat,
    page_path: "/user/mf/invest",
    fund_id: fundId,
    fund_category: fund.category,
    amc_name: fund.amc_name,
    source_medium: "fund_page",
  });
  if (blocker === "bank_verification_required" && rand() < 0.72) {
    addEvent({
      event_name: "sip_amount_entered",
      investor_id: inv.investor_id,
      anonymous_id: anonId(inv.investor_id),
      session_id: sessId,
      timestamp: ts(intentDate, intentHour, 10),
      platform: plat,
      page_path: "/user/mf/sip/amount",
      amount_inr: pickSipAmount(false),
      sip_id: null,
    });
  }
  addEvent({
    event_name: "sip_flow_abandoned",
    investor_id: inv.investor_id,
    anonymous_id: anonId(inv.investor_id),
    session_id: sessId,
    timestamp: ts(intentDate, intentHour, 12),
    platform: plat,
    page_path: "/user/mf/sip/confirm",
    step_name: stepName,
    drop_reason: blocker,
    fund_id: fundId,
    fund_category: fund.category,
    amc_name: fund.amc_name,
  });
}

flushUeBuffer();
console.log(`  Blocked high-intent events: ${(ueTotal - afterOnboarding).toLocaleString()} across ${blockedHighIntentInvestors.length.toLocaleString()} investors`);
const afterBlockedIntent = ueTotal;

// 2. SIP FLOW EVENTS — from sips table
// For each SIP: sip_flow_started → sip_fund_selected → sip_amount_entered → sip_created
// For abandoned: sip_flow_started → sip_flow_abandoned
const sipFlowAbandonedCount = Math.round(sips.length * 0.30); // 30% start but abandon

for (const sip of sips) {
  const inv = investorById.get(sip.investor_id);
  if (!inv) continue;

  // Pre-window SIPs (started before Jun 2024) have no creation flow events —
  // the investor set them up years ago. Emitting sip_created dated to Jun 1 2024
  // would create a massive false spike on day 1 of the dataset.
  // We still emit sip_cancelled if they cancelled during the window.
  if (sip.start_date < DATE_START) {
    if (sip.status === "cancelled" && sip.end_date && sip.end_date >= DATE_START) {
      addEvent({ event_name: "sip_cancelled", investor_id: sip.investor_id, anonymous_id: anonId(sip.investor_id), session_id: sessionId(), timestamp: randTs(sip.end_date), platform: platform(), sip_id: sip.sip_id, fund_id: sip.fund_id, drop_reason: sip.cancellation_reason ?? "unknown" });
    }
    continue;
  }

  const flowDate = addDays(sip.start_date, -randInt(0, 3));
  const validDate = flowDate >= DATE_START ? flowDate : DATE_START;
  const sessId = sessionId();
  const plat   = platform();
  const fund   = fundById.get(sip.fund_id)!;
  const sourceMedium = inv.acquisition_channel;

  addEvent({ event_name: "sip_flow_started",    investor_id: sip.investor_id, anonymous_id: anonId(sip.investor_id), session_id: sessId, timestamp: ts(validDate, randInt(9, 21), 0), platform: plat, page_path: "/user/mf/invest", fund_id: sip.fund_id, fund_category: fund.category, amc_name: fund.amc_name, source_medium: sourceMedium });
  addEvent({ event_name: "sip_fund_selected",   investor_id: sip.investor_id, anonymous_id: anonId(sip.investor_id), session_id: sessId, timestamp: ts(validDate, randInt(9, 21), 2), platform: plat, page_path: "/user/mf/sip/fund", fund_id: sip.fund_id, fund_category: fund.category });
  addEvent({ event_name: "sip_amount_entered",  investor_id: sip.investor_id, anonymous_id: anonId(sip.investor_id), session_id: sessId, timestamp: ts(validDate, randInt(9, 21), 4), platform: plat, page_path: "/user/mf/sip/amount", amount_inr: sip.amount_inr, sip_id: sip.sip_id });
  addEvent({ event_name: "sip_created",         investor_id: sip.investor_id, anonymous_id: anonId(sip.investor_id), session_id: sessId, timestamp: ts(sip.start_date, randInt(9, 21), 8), platform: plat, page_path: "/user/mf/sip/confirm", fund_id: sip.fund_id, amount_inr: sip.amount_inr, sip_id: sip.sip_id, fund_category: fund.category });

  // Cancelled SIPs also get a cancelled event
  if (sip.status === "cancelled" && sip.end_date) {
    addEvent({ event_name: "sip_cancelled", investor_id: sip.investor_id, anonymous_id: anonId(sip.investor_id), session_id: sessionId(), timestamp: randTs(sip.end_date), platform: plat, sip_id: sip.sip_id, fund_id: sip.fund_id, drop_reason: sip.cancellation_reason ?? "unknown" });
  }
}

// Add abandoned SIP flows (30% of sip count but no sip_created event)
for (let i = 0; i < sipFlowAbandonedCount; i++) {
  const inv = pick(activatedInvestors);
  const date = randomDateBetween(
    inv.account_activated_date! >= DATE_START ? inv.account_activated_date! : DATE_START,
    DATE_END
  );
  const fundId = pickFundWeighted();
  const fund   = fundById.get(fundId)!;
  const sessId = sessionId();
  const plat   = platform();
  const abandonStep = weightedPick(
    ["amount_entered","date_selected","mandate_authorization"],
    [0.30, 0.25, 0.45]
  );

  addEvent({ event_name: "sip_flow_started",   investor_id: inv.investor_id, anonymous_id: anonId(inv.investor_id), session_id: sessId, timestamp: ts(date, randInt(9, 21), 0), platform: plat, fund_id: fundId, fund_category: fund.category });
  if (abandonStep !== "amount_entered") {
    addEvent({ event_name: "sip_amount_entered", investor_id: inv.investor_id, anonymous_id: anonId(inv.investor_id), session_id: sessId, timestamp: ts(date, randInt(9, 21), 3), platform: plat, amount_inr: pickSipAmount(false), sip_id: null });
  }
  addEvent({ event_name: "sip_flow_abandoned", investor_id: inv.investor_id, anonymous_id: anonId(inv.investor_id), session_id: sessId, timestamp: ts(date, randInt(9, 21), 5), platform: plat, step_name: abandonStep, drop_reason: weightedPick(["distracted","bank_issue","not_sure","technical_error"], [0.35, 0.28, 0.22, 0.15]) });
}

flushUeBuffer();
console.log(`  SIP flow events: ${(ueTotal - afterBlockedIntent).toLocaleString()}`);
const afterSip = ueTotal;

// 3. FUND PAGE VIEWS — active investors browsing
// Each active investor: ~4 fund page views per month
// Sample: process every 3rd month per investor to keep volume manageable
const fundViewMonths = allMonths(DATE_START, DATE_END).filter((_, idx) => idx % 2 === 0); // every other month
for (const inv of activatedInvestors.filter((_, idx) => idx % 3 === 0)) { // every 3rd investor
  for (const [y, m] of fundViewMonths) {
    if (inv.account_activated_date! > dateStr(y, m, daysInMonth(y, m))) continue;
    const viewCount = randInt(2, 6);
    const sessId = sessionId();
    for (let v = 0; v < viewCount; v++) {
      const date    = randomDateInMonth(y, m);
      const fundId  = pickFundWeighted(isElssSeason(date) && rand() < 0.20);
      const fund    = fundById.get(fundId)!;
      const source  = weightedPick(
        ["recommended_funds","fi_select","trending_now","category_page","search","email_link","investor_favourites"],
        [0.25, 0.20, 0.15, 0.13, 0.12, 0.10, 0.05]
      );
      // ~30% of fund page views are preceded by a search (source = "search")
      if (source === "search") {
        addEvent({ event_name: "fund_searched", investor_id: inv.investor_id, anonymous_id: anonId(inv.investor_id), session_id: sessId, timestamp: randTs(date), platform: platform(), search_query: pick(FUND_SEARCH_QUERIES), page_path: "/search" });
      }

      addEvent({ event_name: "fund_page_viewed", investor_id: inv.investor_id, anonymous_id: anonId(inv.investor_id), session_id: sessId, timestamp: randTs(date), platform: platform(), page_path: `/s/${fundId}`, fund_id: fundId, fund_category: fund.category, amc_name: fund.amc_name, source_medium: source });

      // 9% of views → watchlist
      if (rand() < 0.09) {
        addEvent({ event_name: "fund_watchlisted", investor_id: inv.investor_id, anonymous_id: anonId(inv.investor_id), session_id: sessId, timestamp: randTs(date), platform: platform(), fund_id: fundId, fund_category: fund.category });
      }
    }
  }
}

flushUeBuffer();
console.log(`  Fund discovery events: ${(ueTotal - afterSip).toLocaleString()}`);
const afterDiscovery = ueTotal;

// 4. CAMPAIGN INTERACTION EVENTS — from comms_log (opened + clicked rows)
const openedComms  = commsLog.filter(c => c.opened);
const clickedComms = commsLog.filter(c => c.clicked);

for (const comm of openedComms) {
  // Email/push opens happen on devices (android/ios/web), not on a channel called "email".
  // The channel is captured in campaign_type + source_medium, not the platform field.
  addEvent({ event_name: "email_opened", investor_id: comm.investor_id, anonymous_id: anonId(comm.investor_id), session_id: sessionId(), timestamp: comm.sent_at, platform: platform(), campaign_type: comm.campaign_type, source_medium: "campaign" });
}
for (const comm of clickedComms) {
  addEvent({ event_name: "email_link_clicked", investor_id: comm.investor_id, anonymous_id: anonId(comm.investor_id), session_id: sessionId(), timestamp: comm.sent_at, platform: platform(), campaign_type: comm.campaign_type, source_medium: "campaign" });
}

flushUeBuffer();
console.log(`  Campaign interaction events: ${(ueTotal - afterDiscovery).toLocaleString()}`);
const afterCampaign = ueTotal;

// 5. REDEMPTION FLOW EVENTS
const redemptions = transactions.filter(t => t.txn_type === "redemption");
for (const txn of redemptions) {
  const inv    = investorById.get(txn.investor_id);
  if (!inv) continue;
  const sessId = sessionId();
  const plat   = platform();

  addEvent({ event_name: "redemption_initiated", investor_id: txn.investor_id, anonymous_id: anonId(txn.investor_id), session_id: sessId, timestamp: ts(txn.txn_date, randInt(9, 18), 0), platform: plat, fund_id: txn.fund_id, amount_inr: txn.amount_inr });

  // Pre-redemption call flow (40% of redemptions get an intervention)
  if (rand() < 0.40) {
    addEvent({ event_name: "pre_redemption_call_offered", investor_id: txn.investor_id, anonymous_id: anonId(txn.investor_id), session_id: sessId, timestamp: ts(txn.txn_date, randInt(9, 18), 2), platform: plat, fund_id: txn.fund_id });
    // 55% accept the call (planted story 7)
    if (rand() < 0.55) {
      addEvent({ event_name: "pre_redemption_call_accepted",  investor_id: txn.investor_id, anonymous_id: anonId(txn.investor_id), session_id: sessId, timestamp: ts(txn.txn_date, randInt(9, 18), 3), platform: plat });
      addEvent({ event_name: "redemption_cancelled",          investor_id: txn.investor_id, anonymous_id: anonId(txn.investor_id), session_id: sessId, timestamp: ts(txn.txn_date, randInt(10, 19), 0), platform: plat, fund_id: txn.fund_id });
    } else {
      addEvent({ event_name: "pre_redemption_call_declined",  investor_id: txn.investor_id, anonymous_id: anonId(txn.investor_id), session_id: sessId, timestamp: ts(txn.txn_date, randInt(9, 18), 3), platform: plat });
      addEvent({ event_name: "redemption_completed",          investor_id: txn.investor_id, anonymous_id: anonId(txn.investor_id), session_id: sessId, timestamp: ts(txn.txn_date, randInt(10, 20), 0), platform: plat, fund_id: txn.fund_id, amount_inr: txn.amount_inr });
    }
  } else {
    addEvent({ event_name: "redemption_completed",            investor_id: txn.investor_id, anonymous_id: anonId(txn.investor_id), session_id: sessId, timestamp: ts(txn.txn_date, randInt(10, 20), 0), platform: plat, fund_id: txn.fund_id, amount_inr: txn.amount_inr });
  }
}

// 6. GOAL CREATION EVENTS
for (const goal of goals.filter((_, idx) => idx % 2 === 0)) { // sample 50%
  addEvent({ event_name: "goal_created", investor_id: goal.investor_id, anonymous_id: anonId(goal.investor_id), session_id: sessionId(), timestamp: randTs(goal.created_date), platform: platform(), goal_type: goal.goal_type, page_path: "/user/mf/goals" });
}

// 7. DASHBOARD + POST-LOGIN NAVIGATION EVENTS (sample)
const navInvestors = activatedInvestors.filter((_, idx) => idx % 5 === 0); // 20%
for (const inv of navInvestors) {
  for (const [y, m] of months.filter((_, idx) => idx % 3 === 0)) { // every 3rd month
    if (inv.account_activated_date! > dateStr(y, m, 28)) continue;
    const date = randomDateInMonth(y, m);
    const sessId = sessionId();
    addEvent({ event_name: "dashboard_visited",    investor_id: inv.investor_id, anonymous_id: anonId(inv.investor_id), session_id: sessId, timestamp: randTs(date), platform: platform(), page_path: "/user" });
    addEvent({ event_name: "portfolio_visited",    investor_id: inv.investor_id, anonymous_id: anonId(inv.investor_id), session_id: sessId, timestamp: randTs(date), platform: platform(), page_path: "/user/mf/portfolio" });
  }
}

flushUeBuffer();
console.log(`  Redemption + goal + navigation events: ${(ueTotal - afterCampaign).toLocaleString()}`);

// ════════════════════════════════════════════════════════════════
// FINAL SUMMARY
// ════════════════════════════════════════════════════════════════

console.log(`\n📊 FINAL GENERATION SUMMARY`);
console.log(`${"═".repeat(50)}`);
console.log(`  funds.csv              ${funds.length.toLocaleString().padStart(10)} rows`);
console.log(`  investors.csv          ${trimmedInvestors.length.toLocaleString().padStart(10)} rows`);
console.log(`  sips.csv               ${sips.length.toLocaleString().padStart(10)} rows`);
console.log(`  transactions.csv       ${transactions.length.toLocaleString().padStart(10)} rows`);
console.log(`  systematic_plans.csv   ${systematicPlans.length.toLocaleString().padStart(10)} rows`);
console.log(`  goals.csv              ${goals.length.toLocaleString().padStart(10)} rows`);
console.log(`  comms_log.csv          ${commsLog.length.toLocaleString().padStart(10)} rows`);
console.log(`  advisory_sessions.csv  ${advisorySessions.length.toLocaleString().padStart(10)} rows`);
console.log(`  support_tickets.csv    ${supportTickets.length.toLocaleString().padStart(10)} rows`);
console.log(`  user_events.csv        ${ueTotal.toLocaleString().padStart(10)} rows`);
const totalRows = funds.length + trimmedInvestors.length + sips.length + transactions.length +
  systematicPlans.length + goals.length + commsLog.length + advisorySessions.length +
  supportTickets.length + ueTotal;
console.log(`${"─".repeat(50)}`);
console.log(`  TOTAL                  ${totalRows.toLocaleString().padStart(10)} rows`);

console.log("\n📌 Key Calibration Checks:");
console.log(`  NACH failure:          ${(transactions.filter(t => t.txn_type === "sip_installment" && t.payment_mode === "nach" && t.status === "failed").length / Math.max(1, transactions.filter(t => t.txn_type === "sip_installment" && t.payment_mode === "nach").length) * 100).toFixed(1)}% (target 6.2%)`);
console.log(`  UPI failure:           ${(transactions.filter(t => t.txn_type === "sip_installment" && t.payment_mode === "upi" && t.status === "failed").length / Math.max(1, transactions.filter(t => t.txn_type === "sip_installment" && t.payment_mode === "upi").length) * 100).toFixed(1)}% (target 1.9%)`);
console.log(`  Oct 2024 alert opens:  ${(commsLog.filter(c => c.campaign_type === "market_alert" && c.sent_at.startsWith("2024-10") && c.opened).length / Math.max(1, commsLog.filter(c => c.campaign_type === "market_alert" && c.sent_at.startsWith("2024-10")).length) * 100).toFixed(1)}% (target 34%)`);
console.log(`  Pre-redemption retention: ${(advisorySessions.filter(a => a.session_type === "pre_redemption_call" && a.outcome === "followed").length / Math.max(1, advisorySessions.filter(a => a.session_type === "pre_redemption_call").length) * 100).toFixed(1)}% (target 55%)`);
console.log(`  ELSS SIP Jan-Mar spike: ${(sips.filter(s => fundById.get(s.fund_id)?.category === "elss" && isElssSeason(s.start_date)).length / 6 / Math.max(1, sips.filter(s => fundById.get(s.fund_id)?.category === "elss" && !isElssSeason(s.start_date)).length / 18)).toFixed(1)}× (target 3.2×)`);

console.log(`\n✅ All 10 CSV files written to ${OUT_DIR}`);
console.log("   Next: npx tsx scripts/setup-fundsindia.ts");
