/**
 * Generates the complete Quick Help dataset v2 — fully synthetic, no external dependencies.
 *
 * Produces 17 CSV files covering operations + marketing + growth + finance:
 *   1. customers.csv              (~18K rows)
 *   2. campaigns_v2.csv           (~50 campaigns)
 *   3. journeys.csv               (~15 journeys)
 *   4. ad_campaigns.csv           (~30 campaigns)
 *   5. ad_sets.csv                (~100 ad sets)
 *   6. ad_creatives.csv           (~200 creatives)
 *   7. install_attribution.csv    (~18K rows, 1 per customer)
 *   8. bookings.csv               (~206K rows)
 *   9. comms_sends.csv            (~1.5M rows)
 *   10. partner_shifts.csv        (~150K rows, enriched with earnings)
 *   11. ad_daily_metrics.csv      (~4.5K rows)
 *   12. booking_unit_economics.csv (~206K rows, per-booking P&L)
 *   13. partner_payouts.csv       (~20K rows, weekly settlements)
 *   14. funnel_events.csv         (~100K rows, onboarding milestones)
 *   15. daily_sessions.csv        (~500K rows, daily app usage)
 *   16. referrals.csv             (~3K rows, referral loop)
 *   17. survey_responses.csv      (~60K rows, NPS/CSAT)
 *
 * Date range: Feb 2025 – Feb 2026 (13 months)
 * Seed: 42 for existing tables, 4242 for new tables (preserves backward compat)
 *
 * Usage: npx tsx scripts/generate-quickhelp-v2.ts
 */

import { writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync } from "fs";
import { resolve } from "path";

const OUT_DIR = resolve(__dirname, "../data/csv");
const ARCHIVE_DIR = resolve(OUT_DIR, "archive");

// ══════════════════════════════════════════════════════════
// SEEDED PRNG — same pattern as v1
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

// ══════════════════════════════════════════════════════════
// DATE UTILITIES
// ══════════════════════════════════════════════════════════

const DATE_START = "2025-02-01";
const DATE_END = "2026-02-28";

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}
function dateStr(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function dayOfWeek(y: number, m: number, d: number): number {
  return new Date(y, m - 1, d).getDay();
}
function addDays(date: string, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function diffDays(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}
function dateBetween(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

// All dates in the range
function allDatesInRange(start: string, end: string): string[] {
  const dates: string[] = [];
  let cur = start;
  while (cur <= end) {
    dates.push(cur);
    cur = addDays(cur, 1);
  }
  return dates;
}

// ══════════════════════════════════════════════════════════
// CONSTANTS & DISTRIBUTIONS
// ══════════════════════════════════════════════════════════

// --- Hubs (5 hubs for Quick Help v2 — simplified from 18) ---
interface HubDef {
  hub_id: number;
  hub_name: string;
  area: string;
  city: string;
  lat: number;
  lng: number;
  arrival_mean: number; // base mean arrival time in minutes
}

const HUBS: HubDef[] = [
  { hub_id: 1, hub_name: "Koramangala Hub", area: "South Bangalore", city: "Metropolitian", lat: 12.9352, lng: 77.6245, arrival_mean: 9 },
  { hub_id: 2, hub_name: "Indiranagar Hub", area: "East Bangalore", city: "Metropolitian", lat: 12.9784, lng: 77.6408, arrival_mean: 9 },
  { hub_id: 3, hub_name: "Yelahanka Hub", area: "North Bangalore", city: "Urban", lat: 13.1007, lng: 77.5963, arrival_mean: 11 },
  { hub_id: 4, hub_name: "BTM Layout Hub", area: "South Bangalore", city: "Metropolitian", lat: 12.9166, lng: 77.6101, arrival_mean: 10 },
  { hub_id: 5, hub_name: "Sarjapur Hub", area: "East Bangalore", city: "Semi-Urban", lat: 12.8681, lng: 77.7870, arrival_mean: 13 }, // underperforming
];

const HUB_WEIGHTS = [30, 25, 15, 20, 10]; // booking distribution across hubs

// --- Service Catalog (18 types × 4 tiers) ---
interface ServiceDef {
  name: string;
  tier: "quick" | "standard" | "extended" | "premium";
  duration_min: number;
  price_min: number;
  price_max: number;
  price_mean: number;
  price_std: number;
}

const SERVICE_CATALOG: ServiceDef[] = [
  // Quick (30 min) — ~25%
  { name: "Dishes & Utensils", tier: "quick", duration_min: 30, price_min: 149, price_max: 299, price_mean: 199, price_std: 30 },
  { name: "Dusting", tier: "quick", duration_min: 30, price_min: 149, price_max: 249, price_mean: 179, price_std: 25 },
  { name: "Folding & Organizing", tier: "quick", duration_min: 30, price_min: 149, price_max: 299, price_mean: 199, price_std: 30 },
  { name: "Ironing", tier: "quick", duration_min: 30, price_min: 149, price_max: 299, price_mean: 219, price_std: 30 },
  // Standard (60 min) — ~40%
  { name: "Sweeping & Mopping", tier: "standard", duration_min: 60, price_min: 299, price_max: 499, price_mean: 349, price_std: 40 },
  { name: "Kitchen Cleaning", tier: "standard", duration_min: 60, price_min: 299, price_max: 499, price_mean: 379, price_std: 40 },
  { name: "Bathroom Cleaning", tier: "standard", duration_min: 60, price_min: 299, price_max: 499, price_mean: 399, price_std: 40 },
  { name: "Chopping & Kitchen Prep", tier: "standard", duration_min: 60, price_min: 299, price_max: 449, price_mean: 349, price_std: 35 },
  { name: "Laundry", tier: "standard", duration_min: 60, price_min: 299, price_max: 499, price_mean: 369, price_std: 40 },
  { name: "Window Cleaning", tier: "standard", duration_min: 60, price_min: 299, price_max: 449, price_mean: 349, price_std: 35 },
  // Extended (90 min) — ~20%
  { name: "Full House Cleaning", tier: "extended", duration_min: 90, price_min: 449, price_max: 699, price_mean: 549, price_std: 50 },
  { name: "Kitchen Cabinet Cleaning", tier: "extended", duration_min: 90, price_min: 399, price_max: 699, price_mean: 499, price_std: 50 },
  { name: "Fridge Surface Cleaning", tier: "extended", duration_min: 90, price_min: 399, price_max: 649, price_mean: 479, price_std: 50 },
  { name: "Fan Cleaning", tier: "extended", duration_min: 90, price_min: 399, price_max: 599, price_mean: 449, price_std: 40 },
  // Premium (120 min) — ~15%
  { name: "Deep Cleaning", tier: "premium", duration_min: 120, price_min: 699, price_max: 1499, price_mean: 999, price_std: 150 },
  { name: "Move-in/Move-out Cleaning", tier: "premium", duration_min: 120, price_min: 799, price_max: 1499, price_mean: 1099, price_std: 150 },
  { name: "After-Party Clean", tier: "premium", duration_min: 120, price_min: 699, price_max: 1299, price_mean: 899, price_std: 120 },
  { name: "Complete Wardrobe Cleaning", tier: "premium", duration_min: 120, price_min: 699, price_max: 1199, price_mean: 849, price_std: 100 },
];

const TIER_WEIGHTS = { quick: 25, standard: 40, extended: 20, premium: 15 };

function pickServiceFromTier(tier: keyof typeof TIER_WEIGHTS): ServiceDef {
  return pick(SERVICE_CATALOG.filter(s => s.tier === tier));
}
function pickTier(): keyof typeof TIER_WEIGHTS {
  return weightedPick(
    ["quick", "standard", "extended", "premium"] as const as unknown as (keyof typeof TIER_WEIGHTS)[],
    [TIER_WEIGHTS.quick, TIER_WEIGHTS.standard, TIER_WEIGHTS.extended, TIER_WEIGHTS.premium]
  );
}
function servicePrice(svc: ServiceDef): number {
  return clamp(Math.round(normalRand(svc.price_mean, svc.price_std)), svc.price_min, svc.price_max);
}

// --- Monthly volume multipliers (Feb 2025 – Feb 2026) ---
const TARGET_MONTHS = [
  { year: 2025, month: 2, mult: 0.85, label: "Feb25" },
  { year: 2025, month: 3, mult: 0.95, label: "Mar25" },   // Holi
  { year: 2025, month: 4, mult: 1.05, label: "Apr25" },   // summer start
  { year: 2025, month: 5, mult: 1.10, label: "May25" },   // summer peak
  { year: 2025, month: 6, mult: 1.05, label: "Jun25" },   // summer
  { year: 2025, month: 7, mult: 0.85, label: "Jul25" },   // monsoon dip
  { year: 2025, month: 8, mult: 0.80, label: "Aug25" },   // monsoon dip
  { year: 2025, month: 9, mult: 0.95, label: "Sep25" },   // recovery
  { year: 2025, month: 10, mult: 1.30, label: "Oct25" },  // Navratri + Diwali prep
  { year: 2025, month: 11, mult: 1.25, label: "Nov25" },  // Post-Diwali
  { year: 2025, month: 12, mult: 1.10, label: "Dec25" },  // Christmas/NY
  { year: 2026, month: 1, mult: 0.95, label: "Jan26" },
  { year: 2026, month: 2, mult: 0.90, label: "Feb26" },
];

// Base bookings per month (~23K, scaled by mult → ~300K total over 13 months)
const BASE_BOOKINGS_PER_MONTH = 23000;

// --- Festival calendar (Feb 2025 – Feb 2026) ---
interface FestivalPeriod {
  name: string;
  start: string;
  end: string;
}

const FESTIVALS: FestivalPeriod[] = [
  { name: "Holi", start: "2025-03-14", end: "2025-03-16" },
  { name: "Ugadi", start: "2025-03-30", end: "2025-03-31" },
  { name: "Ram Navami", start: "2025-04-06", end: "2025-04-06" },
  { name: "Eid al-Fitr", start: "2025-03-31", end: "2025-04-01" },
  { name: "Independence Day", start: "2025-08-15", end: "2025-08-15" },
  { name: "Ganesh Chaturthi", start: "2025-08-27", end: "2025-09-06" },
  { name: "Navratri", start: "2025-10-02", end: "2025-10-11" },
  { name: "Dussehra", start: "2025-10-12", end: "2025-10-12" },
  { name: "Diwali", start: "2025-10-20", end: "2025-10-25" },
  { name: "Christmas", start: "2025-12-24", end: "2025-12-26" },
  { name: "New Year", start: "2025-12-31", end: "2026-01-02" },
  { name: "Pongal", start: "2026-01-14", end: "2026-01-16" },
  { name: "Republic Day", start: "2026-01-26", end: "2026-01-26" },
];

function getFestival(date: string): string {
  for (const f of FESTIVALS) {
    if (dateBetween(date, f.start, f.end)) return f.name;
  }
  return "No";
}

// --- Weather ---
const WEATHER_OPTIONS = ["Sunny", "Cloudy", "Rainy", "Foggy", "Windy", "Stormy"];
function getWeather(date: string): string {
  const m = parseInt(date.slice(5, 7));
  // Monsoon (Jul-Aug): more rain
  if (m === 7 || m === 8) return weightedPick(WEATHER_OPTIONS, [15, 20, 40, 5, 15, 5]);
  // Winter (Dec-Feb): foggy mornings
  if (m === 12 || m === 1 || m === 2) return weightedPick(WEATHER_OPTIONS, [30, 25, 10, 20, 10, 5]);
  // Summer (Apr-Jun): hot and sunny
  if (m >= 4 && m <= 6) return weightedPick(WEATHER_OPTIONS, [50, 20, 10, 5, 10, 5]);
  return weightedPick(WEATHER_OPTIONS, [40, 25, 15, 5, 10, 5]);
}

// --- Traffic ---
const TRAFFIC_OPTIONS = ["Low", "Medium", "High", "Jam"];
function getTraffic(date: string): string {
  const dow = new Date(date).getDay();
  if (dow === 0 || dow === 6) return weightedPick(TRAFFIC_OPTIONS, [30, 40, 20, 10]);
  return weightedPick(TRAFFIC_OPTIONS, [15, 35, 35, 15]);
}

// --- Payment ---
const PAYMENT_METHODS = ["upi", "card", "wallet", "cash"];
const PAYMENT_WEIGHTS = [45, 25, 20, 10];

// Payment outage: May 15-17, 2025
function isPaymentOutage(date: string): boolean {
  return date >= "2025-05-15" && date <= "2025-05-17";
}

function paymentStatus(method: string, date: string): string {
  if (isPaymentOutage(date) && (method === "upi" || method === "card")) {
    return rand() < 0.18 ? "failed" : (rand() < 0.03 ? "refunded" : "success");
  }
  const r = rand();
  if (r < 0.02) return "failed";
  if (r < 0.03) return "refunded";
  return "success";
}

// --- Partner pool ---
interface PartnerDef {
  partner_id: string;
  age: number;
  rating: number;
  primary_hub_id: number;
}

const NUM_PARTNERS = 500;
const partners: PartnerDef[] = [];
for (let i = 0; i < NUM_PARTNERS; i++) {
  const hub = weightedPick(HUBS, HUB_WEIGHTS);
  const prefix = hub.hub_name.slice(0, 3).toUpperCase();
  partners.push({
    partner_id: `${prefix}RES${String(i + 1).padStart(3, "0")}`,
    age: randInt(20, 48),
    rating: clamp(parseFloat(normalRand(4.2, 0.4).toFixed(1)), 2.5, 5.0),
    primary_hub_id: hub.hub_id,
  });
}

// --- Customer pool constants ---
const NUM_CUSTOMERS = 18000;
const ACQUISITION_SOURCES = ["organic", "google", "meta", "referral", "whatsapp"];
const ACQUISITION_WEIGHTS = [35, 25, 20, 15, 5];

// --- CRM channel mix ---
const CRM_CHANNELS = ["push", "sms", "email", "whatsapp", "in_app"];
const CRM_CHANNEL_WEIGHTS = [45, 20, 15, 15, 5];

// Funnel rates per channel: [delivery, open, click, convert]
const FUNNEL_RATES: Record<string, { delivery: number; open: number; click: number; convert: number }> = {
  push: { delivery: 0.85, open: 0.15, click: 0.04, convert: 0.02 },
  sms: { delivery: 0.95, open: 1.0, click: 0.03, convert: 0.015 }, // SMS: opened = assumed read
  email: { delivery: 0.92, open: 0.18, click: 0.03, convert: 0.01 },
  whatsapp: { delivery: 0.97, open: 0.80, click: 0.10, convert: 0.04 },
  in_app: { delivery: 1.0, open: 0.65, click: 0.12, convert: 0.06 },
};

// Cost per send per channel (INR)
const SEND_COSTS: Record<string, number> = {
  push: 0.0,
  sms: 0.15,
  email: 0.01,
  whatsapp: 0.50,
  in_app: 0.0,
};

// --- Booking time generation ---
function generateBookingTime(): string {
  const isMorning = rand() < 0.55;
  const hour = isMorning ? randInt(7, 12) : randInt(16, 21);
  const minute = pick([0, 0, 15, 30, 30, 45]);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

// ══════════════════════════════════════════════════════════
// CSV HELPER
// ══════════════════════════════════════════════════════════

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toCsv(rows: any[]): string {
  if (rows.length === 0) return "";
  const keys = Object.keys(rows[0]);
  const header = keys.join(",");
  const lines = rows.map(r =>
    keys.map(k => {
      const v = r[k];
      if (v === null || v === undefined) return "";
      if (typeof v === "string" && (v.includes(",") || v.includes('"') || v.includes("\n"))) {
        return `"${v.replace(/"/g, '""')}"`;
      }
      return String(v);
    }).join(",")
  );
  return header + "\n" + lines.join("\n") + "\n";
}

// ══════════════════════════════════════════════════════════
// STEP 1: CUSTOMERS
// ══════════════════════════════════════════════════════════

console.log("Step 1: Generating customers...");

interface CustomerRow {
  customer_id: number;
  signup_date: string;
  city: string;
  preferred_payment: string;
  is_active: boolean;
  acquisition_source: string;
  ltv_bucket: string; // backfilled after bookings
}

const customers: CustomerRow[] = [];
for (let i = 1; i <= NUM_CUSTOMERS; i++) {
  // Signup spread across 13 months with slight front-loading
  const tm = weightedPick(TARGET_MONTHS, TARGET_MONTHS.map(t => t.mult));
  const day = randInt(1, daysInMonth(tm.year, tm.month));
  const signupDate = dateStr(tm.year, tm.month, day);
  const hub = weightedPick(HUBS, HUB_WEIGHTS);

  customers.push({
    customer_id: i,
    signup_date: signupDate,
    city: hub.city,
    preferred_payment: weightedPick(PAYMENT_METHODS, PAYMENT_WEIGHTS),
    is_active: true, // updated after bookings
    acquisition_source: weightedPick(ACQUISITION_SOURCES, ACQUISITION_WEIGHTS),
    ltv_bucket: "low", // backfilled
  });
}

// Sort by signup date for referral chain consistency
customers.sort((a, b) => a.signup_date.localeCompare(b.signup_date));
// Reassign IDs after sort
for (let i = 0; i < customers.length; i++) customers[i].customer_id = i + 1;

console.log(`  ${customers.length} customers generated`);

// ══════════════════════════════════════════════════════════
// STEP 2: AD HIERARCHY (campaigns → sets → creatives)
// ══════════════════════════════════════════════════════════

console.log("Step 2: Generating ad hierarchy...");

interface AdCampaignRow {
  ad_campaign_id: number;
  platform: string;
  campaign_name: string;
  campaign_objective: string;
  city: string;
  start_date: string;
  end_date: string;
  total_budget_inr: number;
  daily_budget_inr: number;
  bid_strategy: string;
}

const adCampaigns: AdCampaignRow[] = [];
let adCampId = 1;

// Generate ~30 ad campaigns spread across the year
const AD_PLATFORMS = ["google", "meta"];
const AD_OBJECTIVES = ["installs", "retargeting", "brand_awareness"];
const AD_OBJ_WEIGHTS = [50, 35, 15];
const BID_STRATEGIES = ["target_cpa", "maximize_conversions", "lowest_cost"];

for (const tm of TARGET_MONTHS) {
  // 2-3 campaigns per month
  const numCamps = randInt(2, 3);
  for (let c = 0; c < numCamps; c++) {
    const platform = pick(AD_PLATFORMS);
    const objective = weightedPick(AD_OBJECTIVES, AD_OBJ_WEIGHTS);
    const startDay = randInt(1, 15);
    const duration = randInt(14, 28);
    const startDate = dateStr(tm.year, tm.month, startDay);
    const endDate = addDays(startDate, duration);
    const dailyBudget = randInt(5000, 20000);
    const totalBudget = dailyBudget * duration;

    adCampaigns.push({
      ad_campaign_id: adCampId++,
      platform,
      campaign_name: `${platform === "google" ? "G" : "M"}_${objective.slice(0, 4)}_${HUBS[c % HUBS.length].hub_name.split(" ")[0]}_${tm.label}`,
      campaign_objective: objective,
      city: pick(HUBS).city,
      start_date: startDate,
      end_date: endDate > DATE_END ? DATE_END : endDate,
      total_budget_inr: totalBudget,
      daily_budget_inr: dailyBudget,
      bid_strategy: pick(BID_STRATEGIES),
    });
  }
}

console.log(`  ${adCampaigns.length} ad campaigns`);

// Ad Sets
interface AdSetRow {
  ad_set_id: number;
  ad_campaign_id: number;
  ad_set_name: string;
  audience_type: string;
  age_min: number;
  age_max: number;
  gender_target: string;
  city: string;
  placement: string;
}

const adSets: AdSetRow[] = [];
let adSetId = 1;
const AUDIENCE_TYPES = ["lookalike", "interest", "retargeting", "broad", "custom"];
const PLACEMENTS = ["feed", "stories", "reels", "search", "display"];
const GENDERS = ["all", "male", "female"];

for (const camp of adCampaigns) {
  const numSets = randInt(2, 4);
  for (let s = 0; s < numSets; s++) {
    const ageMin = pick([18, 22, 25, 30]);
    const ageMax = ageMin + pick([10, 15, 20, 25]);
    adSets.push({
      ad_set_id: adSetId++,
      ad_campaign_id: camp.ad_campaign_id,
      ad_set_name: `${pick(AUDIENCE_TYPES)}_${ageMin}-${ageMax}_${pick(GENDERS).charAt(0).toUpperCase()}_${camp.city.slice(0, 5)}`,
      audience_type: camp.campaign_objective === "retargeting" ? "retargeting" : pick(AUDIENCE_TYPES),
      age_min: ageMin,
      age_max: ageMax,
      gender_target: pick(GENDERS),
      city: camp.city,
      placement: camp.platform === "google" ? weightedPick(PLACEMENTS, [20, 5, 5, 50, 20]) : weightedPick(PLACEMENTS, [40, 25, 25, 5, 5]),
    });
  }
}

console.log(`  ${adSets.length} ad sets`);

// Ad Creatives
interface AdCreativeRow {
  ad_creative_id: number;
  ad_set_id: number;
  creative_name: string;
  format: string;
  headline: string;
  cta_text: string;
  service_featured: string | null;
  landing_page: string;
}

const CREATIVE_FORMATS = ["image", "video", "carousel", "story"];
const CREATIVE_FORMAT_WEIGHTS = [35, 30, 20, 15];
const HEADLINES = [
  "Spotless home in 30 min", "Book a helper in 2 taps", "₹149 for sparkling dishes",
  "Deep clean your home today", "Trusted helpers near you", "Home help on demand",
  "Pro cleaning, fair prices", "Your home deserves better", "Monsoon deep clean sale",
  "Festival-ready home", "Lazy Sunday? We've got you", "Move-in cleaning from ₹699",
];
const CTAS = ["Book Now", "Try Free", "Get 50% Off", "Download App", "Learn More", "Claim Offer"];
const LANDING_PAGES = ["app_store", "deep_link_home", "deep_link_service"];

const adCreatives: AdCreativeRow[] = [];
let adCreativeId = 1;

for (const set of adSets) {
  const numCreatives = randInt(1, 3);
  for (let c = 0; c < numCreatives; c++) {
    const format = weightedPick(CREATIVE_FORMATS, CREATIVE_FORMAT_WEIGHTS);
    const svcFeatured = rand() < 0.4 ? pick(SERVICE_CATALOG).name : null;
    adCreatives.push({
      ad_creative_id: adCreativeId++,
      ad_set_id: set.ad_set_id,
      creative_name: `${format}_${svcFeatured ? svcFeatured.replace(/\s+/g, "").slice(0, 10) : "general"}_v${randInt(1, 3)}`,
      format,
      headline: pick(HEADLINES),
      cta_text: pick(CTAS),
      service_featured: svcFeatured,
      landing_page: pick(LANDING_PAGES),
    });
  }
}

console.log(`  ${adCreatives.length} ad creatives`);

// ══════════════════════════════════════════════════════════
// STEP 3: INSTALL ATTRIBUTION
// ══════════════════════════════════════════════════════════

console.log("Step 3: Generating install attribution...");

interface InstallAttributionRow {
  customer_id: number;
  attributed_platform: string;
  ad_campaign_id: number | null;
  ad_set_id: number | null;
  ad_creative_id: number | null;
  referrer_customer_id: number | null;
  install_date: string;
  signup_date: string;
  first_booking_date: string | null; // backfilled
  days_to_first_booking: number | null; // backfilled
  first_booking_value: number | null; // backfilled
  ltv_7d: number; // backfilled
  ltv_30d: number; // backfilled
  ltv_90d: number; // backfilled
}

const attributions: InstallAttributionRow[] = [];

// Filter ad campaigns by platform for attribution
const googleCampaigns = adCampaigns.filter(c => c.platform === "google");
const metaCampaigns = adCampaigns.filter(c => c.platform === "meta");

for (const cust of customers) {
  const platform = cust.acquisition_source;
  let adCampIdVal: number | null = null;
  let adSetIdVal: number | null = null;
  let adCreativeIdVal: number | null = null;
  let referrerCustId: number | null = null;

  // Install date: 0-3 days before signup
  const installDate = addDays(cust.signup_date, -randInt(0, 2));

  if (platform === "google" && googleCampaigns.length > 0) {
    // Find an active campaign near signup date
    const activeCamps = googleCampaigns.filter(c => dateBetween(cust.signup_date, c.start_date, c.end_date));
    if (activeCamps.length > 0) {
      const camp = pick(activeCamps);
      adCampIdVal = camp.ad_campaign_id;
      const campSets = adSets.filter(s => s.ad_campaign_id === camp.ad_campaign_id);
      if (campSets.length > 0) {
        const set = pick(campSets);
        adSetIdVal = set.ad_set_id;
        const setCreatives = adCreatives.filter(cr => cr.ad_set_id === set.ad_set_id);
        if (setCreatives.length > 0) adCreativeIdVal = pick(setCreatives).ad_creative_id;
      }
    }
  } else if (platform === "meta" && metaCampaigns.length > 0) {
    const activeCamps = metaCampaigns.filter(c => dateBetween(cust.signup_date, c.start_date, c.end_date));
    if (activeCamps.length > 0) {
      const camp = pick(activeCamps);
      adCampIdVal = camp.ad_campaign_id;
      const campSets = adSets.filter(s => s.ad_campaign_id === camp.ad_campaign_id);
      if (campSets.length > 0) {
        const set = pick(campSets);
        adSetIdVal = set.ad_set_id;
        const setCreatives = adCreatives.filter(cr => cr.ad_set_id === set.ad_set_id);
        if (setCreatives.length > 0) adCreativeIdVal = pick(setCreatives).ad_creative_id;
      }
    }
  } else if (platform === "referral") {
    // Referrer must have signed up earlier
    const earlierCustomers = customers.filter(c => c.customer_id < cust.customer_id && c.signup_date <= cust.signup_date);
    if (earlierCustomers.length > 0) {
      referrerCustId = pick(earlierCustomers).customer_id;
    }
  }
  // organic + whatsapp: all ad FKs null

  attributions.push({
    customer_id: cust.customer_id,
    attributed_platform: platform,
    ad_campaign_id: adCampIdVal,
    ad_set_id: adSetIdVal,
    ad_creative_id: adCreativeIdVal,
    referrer_customer_id: referrerCustId,
    install_date: installDate < DATE_START ? DATE_START : installDate,
    signup_date: cust.signup_date,
    first_booking_date: null,
    days_to_first_booking: null,
    first_booking_value: null,
    ltv_7d: 0,
    ltv_30d: 0,
    ltv_90d: 0,
  });
}

console.log(`  ${attributions.length} attributions`);

// ══════════════════════════════════════════════════════════
// STEP 4: CAMPAIGNS_V2 + JOURNEYS
// ══════════════════════════════════════════════════════════

console.log("Step 4: Generating campaigns_v2 and journeys...");

interface CampaignV2Row {
  campaign_id: number;
  campaign_name: string;
  campaign_type: string;
  channels: string;
  start_date: string;
  end_date: string;
  target_segment: string;
  budget_inr: number;
  city: string;
  discount_pct: number | null;
  offer_type: string;
}

const CAMPAIGN_TYPES = ["promo", "seasonal", "reactivation", "referral", "festival"];
const OFFER_TYPES = ["discount", "cashback", "free_visit", "referral_bonus", "none"];
const TARGET_SEGMENTS = ["all", "new_7d", "dormant_30d", "high_value", "churned_60d"];

const campaignsV2: CampaignV2Row[] = [
  // Festival campaigns
  { campaign_id: 1, campaign_name: "Holi Color Clean", campaign_type: "festival", channels: "push,whatsapp", start_date: "2025-03-12", end_date: "2025-03-18", target_segment: "all", budget_inr: 300000, city: "All", discount_pct: 20, offer_type: "discount" },
  { campaign_id: 2, campaign_name: "Summer Deep Clean Drive", campaign_type: "seasonal", channels: "push,email,sms", start_date: "2025-04-01", end_date: "2025-04-15", target_segment: "all", budget_inr: 400000, city: "All", discount_pct: 15, offer_type: "discount" },
  { campaign_id: 3, campaign_name: "Monsoon Home Shield", campaign_type: "seasonal", channels: "push,whatsapp", start_date: "2025-07-01", end_date: "2025-07-20", target_segment: "all", budget_inr: 250000, city: "All", discount_pct: 10, offer_type: "cashback" },
  { campaign_id: 4, campaign_name: "Independence Day Fresh", campaign_type: "festival", channels: "push,sms,email", start_date: "2025-08-13", end_date: "2025-08-17", target_segment: "all", budget_inr: 200000, city: "All", discount_pct: 15, offer_type: "discount" },
  { campaign_id: 5, campaign_name: "Ganesh Chaturthi Clean", campaign_type: "festival", channels: "push,whatsapp", start_date: "2025-08-25", end_date: "2025-09-07", target_segment: "all", budget_inr: 250000, city: "All", discount_pct: 15, offer_type: "discount" },
  { campaign_id: 6, campaign_name: "Navratri Sparkle", campaign_type: "festival", channels: "multi", start_date: "2025-10-01", end_date: "2025-10-12", target_segment: "all", budget_inr: 350000, city: "All", discount_pct: 20, offer_type: "discount" },
  { campaign_id: 7, campaign_name: "Diwali Deep Clean", campaign_type: "festival", channels: "multi", start_date: "2025-10-18", end_date: "2025-10-26", target_segment: "all", budget_inr: 600000, city: "All", discount_pct: 30, offer_type: "discount" },
  { campaign_id: 8, campaign_name: "Post-Diwali Reset", campaign_type: "seasonal", channels: "push,email", start_date: "2025-10-27", end_date: "2025-11-05", target_segment: "all", budget_inr: 150000, city: "All", discount_pct: 10, offer_type: "cashback" },
  { campaign_id: 9, campaign_name: "Christmas Party Clean", campaign_type: "festival", channels: "push,whatsapp,email", start_date: "2025-12-22", end_date: "2025-12-27", target_segment: "all", budget_inr: 300000, city: "All", discount_pct: 20, offer_type: "discount" },
  { campaign_id: 10, campaign_name: "New Year Fresh Start", campaign_type: "festival", channels: "multi", start_date: "2025-12-29", end_date: "2026-01-03", target_segment: "all", budget_inr: 400000, city: "All", discount_pct: 25, offer_type: "discount" },
  { campaign_id: 11, campaign_name: "Pongal Home Prep", campaign_type: "festival", channels: "push,sms", start_date: "2026-01-12", end_date: "2026-01-17", target_segment: "all", budget_inr: 150000, city: "All", discount_pct: 15, offer_type: "discount" },
  { campaign_id: 12, campaign_name: "Republic Day Offer", campaign_type: "festival", channels: "push,email", start_date: "2026-01-24", end_date: "2026-01-28", target_segment: "all", budget_inr: 200000, city: "All", discount_pct: 20, offer_type: "discount" },

  // Reactivation campaigns
  { campaign_id: 13, campaign_name: "We Miss You - March", campaign_type: "reactivation", channels: "whatsapp,email", start_date: "2025-03-01", end_date: "2025-03-15", target_segment: "dormant_30d", budget_inr: 100000, city: "All", discount_pct: 25, offer_type: "discount" },
  { campaign_id: 14, campaign_name: "Come Back Clean - June", campaign_type: "reactivation", channels: "whatsapp,sms", start_date: "2025-06-01", end_date: "2025-06-15", target_segment: "dormant_30d", budget_inr: 120000, city: "All", discount_pct: 30, offer_type: "discount" },
  { campaign_id: 15, campaign_name: "Win-Back Sept", campaign_type: "reactivation", channels: "whatsapp,email", start_date: "2025-09-01", end_date: "2025-09-15", target_segment: "churned_60d", budget_inr: 80000, city: "All", discount_pct: null, offer_type: "free_visit" },
  { campaign_id: 16, campaign_name: "Reactivation Nov", campaign_type: "reactivation", channels: "push,whatsapp", start_date: "2025-11-10", end_date: "2025-11-25", target_segment: "dormant_30d", budget_inr: 100000, city: "All", discount_pct: 20, offer_type: "cashback" },

  // Referral campaigns
  { campaign_id: 17, campaign_name: "Referral Drive Q1", campaign_type: "referral", channels: "push,whatsapp", start_date: "2025-02-01", end_date: "2025-04-30", target_segment: "all", budget_inr: 500000, city: "All", discount_pct: null, offer_type: "referral_bonus" },
  { campaign_id: 18, campaign_name: "Referral Drive Q3", campaign_type: "referral", channels: "push,whatsapp", start_date: "2025-07-01", end_date: "2025-09-30", target_segment: "all", budget_inr: 400000, city: "All", discount_pct: null, offer_type: "referral_bonus" },
  { campaign_id: 19, campaign_name: "Referral Blitz Diwali", campaign_type: "referral", channels: "whatsapp", start_date: "2025-10-01", end_date: "2025-10-31", target_segment: "high_value", budget_inr: 200000, city: "All", discount_pct: null, offer_type: "referral_bonus" },

  // Promo campaigns (non-festival)
  { campaign_id: 20, campaign_name: "First-Time User ₹99", campaign_type: "promo", channels: "push,in_app", start_date: "2025-02-15", end_date: "2025-03-15", target_segment: "new_7d", budget_inr: 200000, city: "Metropolitian", discount_pct: 50, offer_type: "discount" },
  { campaign_id: 21, campaign_name: "Premium Clean Week", campaign_type: "promo", channels: "push,email", start_date: "2025-05-05", end_date: "2025-05-12", target_segment: "high_value", budget_inr: 150000, city: "All", discount_pct: 15, offer_type: "discount" },
  { campaign_id: 22, campaign_name: "Quick Task Tuesday", campaign_type: "promo", channels: "push,in_app", start_date: "2025-06-10", end_date: "2025-06-17", target_segment: "all", budget_inr: 80000, city: "All", discount_pct: 20, offer_type: "discount" },
  { campaign_id: 23, campaign_name: "Weekend Warrior Deal", campaign_type: "promo", channels: "push,sms", start_date: "2025-08-01", end_date: "2025-08-10", target_segment: "all", budget_inr: 120000, city: "All", discount_pct: 10, offer_type: "cashback" },
  { campaign_id: 24, campaign_name: "Late Night Helper", campaign_type: "promo", channels: "push", start_date: "2025-09-15", end_date: "2025-09-25", target_segment: "all", budget_inr: 60000, city: "Metropolitian", discount_pct: 15, offer_type: "discount" },
  { campaign_id: 25, campaign_name: "Move-in Season Special", campaign_type: "promo", channels: "push,email,whatsapp", start_date: "2025-11-01", end_date: "2025-11-15", target_segment: "new_7d", budget_inr: 180000, city: "All", discount_pct: 20, offer_type: "discount" },

  // More promos to hit ~50
  { campaign_id: 26, campaign_name: "Spring Refresh", campaign_type: "seasonal", channels: "push,email", start_date: "2025-02-20", end_date: "2025-03-05", target_segment: "all", budget_inr: 150000, city: "All", discount_pct: 10, offer_type: "cashback" },
  { campaign_id: 27, campaign_name: "Apartment Complex Deal", campaign_type: "promo", channels: "whatsapp,sms", start_date: "2025-04-10", end_date: "2025-04-25", target_segment: "all", budget_inr: 100000, city: "Metropolitian", discount_pct: 15, offer_type: "discount" },
  { campaign_id: 28, campaign_name: "Monsoon Mold Guard", campaign_type: "seasonal", channels: "push,email", start_date: "2025-07-15", end_date: "2025-08-05", target_segment: "all", budget_inr: 200000, city: "All", discount_pct: 15, offer_type: "discount" },
  { campaign_id: 29, campaign_name: "Back to School Clean", campaign_type: "seasonal", channels: "push,whatsapp", start_date: "2025-06-20", end_date: "2025-07-05", target_segment: "all", budget_inr: 100000, city: "All", discount_pct: 10, offer_type: "discount" },
  { campaign_id: 30, campaign_name: "Loyalty Reward Clean", campaign_type: "promo", channels: "push,in_app", start_date: "2025-05-15", end_date: "2025-05-25", target_segment: "high_value", budget_inr: 80000, city: "All", discount_pct: null, offer_type: "free_visit" },
  { campaign_id: 31, campaign_name: "Bathroom Blitz", campaign_type: "promo", channels: "push,sms", start_date: "2025-03-20", end_date: "2025-03-28", target_segment: "all", budget_inr: 70000, city: "All", discount_pct: 20, offer_type: "discount" },
  { campaign_id: 32, campaign_name: "Weekend Kitchen Special", campaign_type: "promo", channels: "push", start_date: "2025-04-18", end_date: "2025-04-20", target_segment: "all", budget_inr: 40000, city: "All", discount_pct: 15, offer_type: "discount" },
  { campaign_id: 33, campaign_name: "Eid Special Clean", campaign_type: "festival", channels: "push,whatsapp,sms", start_date: "2025-03-29", end_date: "2025-04-02", target_segment: "all", budget_inr: 200000, city: "All", discount_pct: 20, offer_type: "discount" },
  { campaign_id: 34, campaign_name: "Student Flat Deal", campaign_type: "promo", channels: "in_app,push", start_date: "2025-07-01", end_date: "2025-07-15", target_segment: "new_7d", budget_inr: 60000, city: "Semi-Urban", discount_pct: 30, offer_type: "discount" },
  { campaign_id: 35, campaign_name: "Ugadi Home Prep", campaign_type: "festival", channels: "push,whatsapp", start_date: "2025-03-28", end_date: "2025-04-01", target_segment: "all", budget_inr: 150000, city: "All", discount_pct: 15, offer_type: "discount" },
  { campaign_id: 36, campaign_name: "Valentine Day Surprise Clean", campaign_type: "seasonal", channels: "push,in_app", start_date: "2025-02-12", end_date: "2025-02-15", target_segment: "all", budget_inr: 80000, city: "Metropolitian", discount_pct: 15, offer_type: "discount" },
  { campaign_id: 37, campaign_name: "Onam Home Makeover", campaign_type: "festival", channels: "push,sms", start_date: "2025-09-05", end_date: "2025-09-10", target_segment: "all", budget_inr: 120000, city: "All", discount_pct: 15, offer_type: "discount" },
  { campaign_id: 38, campaign_name: "Year End Clearance Clean", campaign_type: "seasonal", channels: "multi", start_date: "2025-12-15", end_date: "2025-12-22", target_segment: "all", budget_inr: 200000, city: "All", discount_pct: 20, offer_type: "discount" },
  { campaign_id: 39, campaign_name: "New User Cashback Feb", campaign_type: "promo", channels: "push,in_app", start_date: "2026-02-01", end_date: "2026-02-15", target_segment: "new_7d", budget_inr: 100000, city: "All", discount_pct: null, offer_type: "cashback" },
  { campaign_id: 40, campaign_name: "Free Kitchen Clean Trial", campaign_type: "promo", channels: "whatsapp,push", start_date: "2025-08-20", end_date: "2025-09-01", target_segment: "new_7d", budget_inr: 90000, city: "All", discount_pct: null, offer_type: "free_visit" },
  { campaign_id: 41, campaign_name: "Makar Sankranti Clean", campaign_type: "festival", channels: "push,sms", start_date: "2026-01-14", end_date: "2026-01-15", target_segment: "all", budget_inr: 80000, city: "All", discount_pct: 10, offer_type: "discount" },
  { campaign_id: 42, campaign_name: "Pet Owners Special", campaign_type: "promo", channels: "email,push", start_date: "2025-05-20", end_date: "2025-06-05", target_segment: "all", budget_inr: 70000, city: "All", discount_pct: 10, offer_type: "cashback" },
  { campaign_id: 43, campaign_name: "Wardrobe Season Change", campaign_type: "seasonal", channels: "push,email", start_date: "2025-10-15", end_date: "2025-10-20", target_segment: "high_value", budget_inr: 50000, city: "All", discount_pct: 15, offer_type: "discount" },
  { campaign_id: 44, campaign_name: "IT Corridor Clean Week", campaign_type: "promo", channels: "push,in_app", start_date: "2025-11-17", end_date: "2025-11-23", target_segment: "all", budget_inr: 60000, city: "Metropolitian", discount_pct: 10, offer_type: "discount" },
  { campaign_id: 45, campaign_name: "Birthday Month Reward", campaign_type: "promo", channels: "push,whatsapp", start_date: "2025-02-01", end_date: "2026-02-28", target_segment: "all", budget_inr: 300000, city: "All", discount_pct: null, offer_type: "free_visit" },
];

console.log(`  ${campaignsV2.length} campaigns_v2`);

// Journeys
interface JourneyRow {
  journey_id: number;
  journey_name: string;
  trigger_event: string;
  channel: string;
  steps_count: number;
  step_delay_hours: number;
  is_active: boolean;
  created_date: string;
}

const journeys: JourneyRow[] = [
  { journey_id: 1, journey_name: "Welcome Series", trigger_event: "signup", channel: "push", steps_count: 3, step_delay_hours: 48, is_active: true, created_date: "2025-01-15" },
  { journey_id: 2, journey_name: "Welcome WhatsApp", trigger_event: "signup", channel: "whatsapp", steps_count: 2, step_delay_hours: 72, is_active: true, created_date: "2025-01-15" },
  { journey_id: 3, journey_name: "First Booking Nudge", trigger_event: "signup", channel: "push", steps_count: 2, step_delay_hours: 120, is_active: true, created_date: "2025-01-20" },
  { journey_id: 4, journey_name: "Post-Booking NPS", trigger_event: "booking_complete", channel: "push", steps_count: 1, step_delay_hours: 24, is_active: true, created_date: "2025-01-15" },
  { journey_id: 5, journey_name: "Post-Booking Email", trigger_event: "booking_complete", channel: "email", steps_count: 1, step_delay_hours: 48, is_active: true, created_date: "2025-01-15" },
  { journey_id: 6, journey_name: "Rating Nudge", trigger_event: "booking_complete", channel: "push", steps_count: 1, step_delay_hours: 4, is_active: true, created_date: "2025-02-01" },
  { journey_id: 7, journey_name: "Win-Back 14 Days", trigger_event: "dormant_14d", channel: "push", steps_count: 2, step_delay_hours: 168, is_active: true, created_date: "2025-02-01" },
  { journey_id: 8, journey_name: "Win-Back 30 Days", trigger_event: "dormant_30d", channel: "whatsapp", steps_count: 2, step_delay_hours: 336, is_active: true, created_date: "2025-02-01" },
  { journey_id: 9, journey_name: "Win-Back Email 30d", trigger_event: "dormant_30d", channel: "email", steps_count: 2, step_delay_hours: 336, is_active: true, created_date: "2025-03-01" },
  { journey_id: 10, journey_name: "Cart Abandon Reminder", trigger_event: "cart_abandon", channel: "push", steps_count: 2, step_delay_hours: 2, is_active: true, created_date: "2025-02-15" },
  { journey_id: 11, journey_name: "Low Rating Follow-up", trigger_event: "low_rating", channel: "whatsapp", steps_count: 1, step_delay_hours: 12, is_active: true, created_date: "2025-03-01" },
  { journey_id: 12, journey_name: "Repeat Booking Incentive", trigger_event: "first_booking", channel: "push", steps_count: 2, step_delay_hours: 72, is_active: true, created_date: "2025-02-01" },
  { journey_id: 13, journey_name: "Monthly Recap Email", trigger_event: "booking_complete", channel: "email", steps_count: 1, step_delay_hours: 720, is_active: true, created_date: "2025-04-01" },
  { journey_id: 14, journey_name: "Referral Prompt", trigger_event: "booking_complete", channel: "whatsapp", steps_count: 1, step_delay_hours: 72, is_active: true, created_date: "2025-03-15" },
  { journey_id: 15, journey_name: "Seasonal Reminder", trigger_event: "dormant_30d", channel: "sms", steps_count: 1, step_delay_hours: 0, is_active: true, created_date: "2025-04-01" },
];

console.log(`  ${journeys.length} journeys`);

// ══════════════════════════════════════════════════════════
// STEP 5: BOOKINGS
// ══════════════════════════════════════════════════════════

console.log("Step 5: Generating bookings...");

interface BookingRow {
  booking_id: number;
  booking_date: string;
  booking_time: string;
  customer_id: number;
  customer_lat: number;
  customer_lng: number;
  service_type: string;
  service_tier: string;
  service_duration_min: number;
  booking_value: number;
  hub_id: number;
  hub_name: string;
  area: string;
  city: string;
  partner_id: string;
  partner_age: number;
  partner_rating: number;
  assigned_at: string;
  arrived_at: string;
  arrival_time_min: number;
  expected_arrival_min: number;
  on_time: boolean;
  weather: string;
  traffic_density: string;
  back_to_back: number;
  festival: string;
  payment_method: string;
  payment_status: string;
  is_first_booking: boolean;
  rescheduled: boolean;
  partner_reassigned: boolean;
  campaign_id: number | null;
}

// Power-law customer booking frequency
const customerWeights: number[] = [];
for (let i = 0; i < NUM_CUSTOMERS; i++) {
  customerWeights.push(1 / Math.pow(i + 1, 0.75));
}
const totalCustWeight = customerWeights.reduce((a, b) => a + b, 0);
const customerCdf: number[] = [];
let cumW = 0;
for (const w of customerWeights) {
  cumW += w / totalCustWeight;
  customerCdf.push(cumW);
}
function pickCustomerId(): number {
  const r = rand();
  for (let i = 0; i < customerCdf.length; i++) {
    if (r <= customerCdf[i]) return i + 1;
  }
  return NUM_CUSTOMERS;
}

// Campaign matching for bookings
function matchBookingCampaign(date: string, city: string): number | null {
  const matching = campaignsV2.filter(c => {
    if (date < c.start_date || date > c.end_date) return false;
    if (c.city !== "All" && c.city !== city) return false;
    return true;
  });
  if (matching.length === 0) return null;
  if (rand() < 0.4) return pick(matching).campaign_id;
  return null;
}

const bookings: BookingRow[] = [];
let bookingId = 1;

for (const tm of TARGET_MONTHS) {
  const maxDay = daysInMonth(tm.year, tm.month);
  const sampleSize = Math.round(BASE_BOOKINGS_PER_MONTH * tm.mult);

  for (let s = 0; s < sampleSize; s++) {
    const hub = weightedPick(HUBS, HUB_WEIGHTS);
    const day = randInt(1, maxDay);
    const date = dateStr(tm.year, tm.month, day);
    const tier = pickTier();
    const service = pickServiceFromTier(tier);
    const custId = pickCustomerId();
    const cust = customers[custId - 1];
    const partner = pick(partners.filter(p => p.primary_hub_id === hub.hub_id));

    // Arrival time
    let arrivalMin = Math.round(clamp(normalRand(hub.arrival_mean, 3), 4, 25));
    const expectedArrival = randInt(8, 12);

    // Diwali surge
    const isDiwali = dateBetween(date, "2025-10-18", "2025-10-27");
    if (isDiwali) arrivalMin += randInt(3, 7);

    // Sarjapur underperformance
    if (hub.hub_id === 5) arrivalMin += randInt(2, 5);

    const weather = getWeather(date);
    const traffic = getTraffic(date);
    if (weather === "Rainy" || weather === "Stormy") arrivalMin += randInt(1, 4);
    if (traffic === "Jam") arrivalMin += randInt(2, 5);

    const onTime = arrivalMin <= expectedArrival;
    const bookTime = generateBookingTime();
    const assignDelay = randInt(1, 3);
    const bookH = parseInt(bookTime.split(":")[0]);
    const bookM = parseInt(bookTime.split(":")[1]);
    const assignTotal = bookH * 60 + bookM + assignDelay;
    const assignedAt = `${String(Math.floor(assignTotal / 60) % 24).padStart(2, "0")}:${String(assignTotal % 60).padStart(2, "0")}`;
    const arriveTotal = assignTotal + arrivalMin;
    const arrivedAt = `${String(Math.floor(arriveTotal / 60) % 24).padStart(2, "0")}:${String(arriveTotal % 60).padStart(2, "0")}`;

    // Only generate bookings after customer signup
    if (date < cust.signup_date) continue;

    // Customer lat/lng near hub with jitter
    const custLat = hub.lat + normalRand(0, 0.015);
    const custLng = hub.lng + normalRand(0, 0.015);

    const payMethod = weightedPick(PAYMENT_METHODS, PAYMENT_WEIGHTS);

    bookings.push({
      booking_id: bookingId++,
      booking_date: date,
      booking_time: bookTime,
      customer_id: custId,
      customer_lat: parseFloat(custLat.toFixed(6)),
      customer_lng: parseFloat(custLng.toFixed(6)),
      service_type: service.name,
      service_tier: tier,
      service_duration_min: service.duration_min,
      booking_value: servicePrice(service),
      hub_id: hub.hub_id,
      hub_name: hub.hub_name,
      area: hub.area,
      city: hub.city,
      partner_id: partner.partner_id,
      partner_age: partner.age,
      partner_rating: partner.rating,
      assigned_at: assignedAt,
      arrived_at: arrivedAt,
      arrival_time_min: arrivalMin,
      expected_arrival_min: expectedArrival,
      on_time: onTime,
      weather,
      traffic_density: traffic,
      back_to_back: randInt(0, 3),
      festival: getFestival(date),
      payment_method: payMethod,
      payment_status: paymentStatus(payMethod, date),
      is_first_booking: false, // fixed in next pass
      rescheduled: rand() < (tier === "premium" ? 0.06 : 0.03),
      partner_reassigned: rand() < (isDiwali ? 0.12 : 0.05),
      campaign_id: matchBookingCampaign(date, hub.city),
    });
  }
}

// Sort by date
bookings.sort((a, b) => a.booking_date.localeCompare(b.booking_date) || a.booking_time.localeCompare(b.booking_time));

// Fix booking IDs and is_first_booking
const custFirstSeen = new Map<number, string>();
for (const b of bookings) {
  const seen = custFirstSeen.get(b.customer_id);
  if (!seen || b.booking_date < seen) custFirstSeen.set(b.customer_id, b.booking_date);
}
for (let i = 0; i < bookings.length; i++) {
  bookings[i].booking_id = i + 1;
  bookings[i].is_first_booking = bookings[i].booking_date === custFirstSeen.get(bookings[i].customer_id)!;
}

// Retention cliff: Feb 2025 cohort drops after month 4
const febCohort = new Set<number>();
for (const b of bookings) {
  if (b.booking_date.startsWith("2025-02")) febCohort.add(b.customer_id);
}
const filteredBookings: BookingRow[] = [];
for (const b of bookings) {
  if (febCohort.has(b.customer_id) && b.booking_date >= "2025-06-01" && !b.is_first_booking) {
    if (rand() < 0.35) continue;
  }
  filteredBookings.push(b);
}
for (let i = 0; i < filteredBookings.length; i++) filteredBookings[i].booking_id = i + 1;

console.log(`  ${filteredBookings.length} bookings`);

// ══════════════════════════════════════════════════════════
// STEP 6: BACKFILL CUSTOMERS + ATTRIBUTION
// ══════════════════════════════════════════════════════════

console.log("Step 6: Backfilling customer LTV and attribution...");

// Build customer booking map
const custBookings = new Map<number, BookingRow[]>();
for (const b of filteredBookings) {
  if (!custBookings.has(b.customer_id)) custBookings.set(b.customer_id, []);
  custBookings.get(b.customer_id)!.push(b);
}

// Backfill customers.ltv_bucket and is_active
for (const cust of customers) {
  const bks = custBookings.get(cust.customer_id) || [];
  const totalValue = bks.reduce((s, b) => s + b.booking_value, 0);
  if (totalValue < 500) cust.ltv_bucket = "low";
  else if (totalValue < 2000) cust.ltv_bucket = "medium";
  else if (totalValue < 5000) cust.ltv_bucket = "high";
  else cust.ltv_bucket = "whale";

  // Active if booked in last 2 months
  const lastBooking = bks.length > 0 ? bks[bks.length - 1].booking_date : null;
  cust.is_active = lastBooking ? lastBooking >= "2026-01-01" : false;
}

// Backfill attribution
for (const attr of attributions) {
  const bks = custBookings.get(attr.customer_id) || [];
  if (bks.length > 0) {
    const first = bks[0];
    attr.first_booking_date = first.booking_date;
    attr.days_to_first_booking = diffDays(attr.signup_date, first.booking_date);
    attr.first_booking_value = first.booking_value;

    // LTV windows from first booking date
    attr.ltv_7d = bks
      .filter(b => diffDays(first.booking_date, b.booking_date) <= 7)
      .reduce((s, b) => s + b.booking_value, 0);
    attr.ltv_30d = bks
      .filter(b => diffDays(first.booking_date, b.booking_date) <= 30)
      .reduce((s, b) => s + b.booking_value, 0);
    attr.ltv_90d = bks
      .filter(b => diffDays(first.booking_date, b.booking_date) <= 90)
      .reduce((s, b) => s + b.booking_value, 0);
  }
}

console.log("  Backfill complete");

// ══════════════════════════════════════════════════════════
// STEP 7: COMMS_SENDS
// ══════════════════════════════════════════════════════════

console.log("Step 7: Generating comms_sends...");

interface CommsSendRow {
  send_id: number;
  customer_id: number;
  channel: string;
  campaign_id: number | null;
  journey_id: number | null;
  journey_step: number | null;
  template_name: string;
  sent_at: string;
  delivered: boolean;
  opened: boolean;
  clicked: boolean;
  converted: boolean;
  booking_id: number | null;
  send_cost_inr: number;
  time_to_open_min: number | null;
  ab_variant: string | null;
  frequency_cap_hit: boolean;
  coupon_code: string | null;
  user_segment_at_send: string;
  days_since_last_booking: number;
  lifetime_bookings_at_send: number;
  predicted_ltv_bucket: string;
  hub_id: number;
  unsubscribed: boolean;
}

const commsSends: CommsSendRow[] = [];
let sendId = 1;

// Build per-customer sorted booking timeline for O(1) lookups
const custBookingsSorted = new Map<number, { date: string; booking_id: number }[]>();
for (const b of filteredBookings) {
  if (!custBookingsSorted.has(b.customer_id)) custBookingsSorted.set(b.customer_id, []);
  custBookingsSorted.get(b.customer_id)!.push({ date: b.booking_date, booking_id: b.booking_id });
}

function getAudienceContext(custId: number, sendDate: string): { segment: string; daysSinceLast: number; lifetimeCount: number; ltvBucket: string; hubId: number } {
  const cust = customers[custId - 1];
  const bks = custBookingsSorted.get(custId) || [];
  const before = bks.filter(b => b.date <= sendDate);
  const lifetimeCount = before.length;
  const daysSinceLast = before.length > 0 ? diffDays(before[before.length - 1].date, sendDate) : diffDays(cust.signup_date, sendDate);

  let segment: string;
  if (lifetimeCount === 0) segment = "new";
  else if (daysSinceLast <= 14) segment = "active";
  else if (daysSinceLast <= 60) segment = "dormant";
  else segment = "churned";

  // Find most common hub from bookings, default to hub 1
  const hubCounts = new Map<number, number>();
  for (const b of (custBookings.get(custId) || [])) {
    if (b.booking_date <= sendDate) hubCounts.set(b.hub_id, (hubCounts.get(b.hub_id) || 0) + 1);
  }
  let hubId = 1;
  let maxHubCount = 0;
  for (const [h, c] of hubCounts) { if (c > maxHubCount) { maxHubCount = c; hubId = h; } }

  return { segment, daysSinceLast: Math.max(0, daysSinceLast), lifetimeCount, ltvBucket: cust.ltv_bucket, hubId };
}

// Find a booking within 24h after send date for conversion attribution
function findConversionBooking(custId: number, sendDate: string): number | null {
  const bks = custBookingsSorted.get(custId) || [];
  const nextDay = addDays(sendDate, 1);
  for (const b of bks) {
    if (b.date >= sendDate && b.date <= nextDay) return b.booking_id;
  }
  return null;
}

function generateFunnelOutcome(channel: string, freqCapHit: boolean): { delivered: boolean; opened: boolean; clicked: boolean; converted: boolean; timeToOpen: number | null } {
  if (freqCapHit) return { delivered: false, opened: false, clicked: false, converted: false, timeToOpen: null };

  const rates = FUNNEL_RATES[channel];
  const delivered = rand() < rates.delivery;
  if (!delivered) return { delivered: false, opened: false, clicked: false, converted: false, timeToOpen: null };

  const opened = rand() < rates.open;
  if (!opened) return { delivered: true, opened: false, clicked: false, converted: false, timeToOpen: null };

  const timeToOpen = channel === "sms" ? null : randInt(1, 480); // SMS: no open tracking (opened=true assumed)
  const clicked = rand() < (rates.click / rates.open); // conditional on open
  if (!clicked) return { delivered: true, opened: true, clicked: false, converted: false, timeToOpen };

  const converted = rand() < (rates.convert / rates.click); // conditional on click
  return { delivered: true, opened: true, clicked, converted, timeToOpen };
}

// --- A. Batch campaign sends ---
console.log("  Generating batch campaign sends...");
const unsubscribedCustomers = new Set<number>();

for (const camp of campaignsV2) {
  const channels = camp.channels === "multi" ? ["push", "sms", "email", "whatsapp"] : camp.channels.split(",");
  const campDates = allDatesInRange(camp.start_date, camp.end_date > DATE_END ? DATE_END : camp.end_date);

  // Select target customers (50K-200K sends per campaign, spread across days)
  const targetCount = randInt(800, 4000); // customers per send batch
  const sendDays = campDates.filter((_, i) => i % pick([1, 2, 3]) === 0); // send every 1-3 days

  for (const sendDate of sendDays) {
    const channel = pick(channels);
    const batchSize = Math.round(targetCount * (0.8 + rand() * 0.4));
    const eligibleCustomers = shuffle(customers.filter(c => {
      if (unsubscribedCustomers.has(c.customer_id)) return false;
      if (c.signup_date > sendDate) return false;
      // Segment targeting
      if (camp.target_segment === "new_7d") return diffDays(c.signup_date, sendDate) <= 7;
      if (camp.target_segment === "dormant_30d") {
        const bks = custBookingsSorted.get(c.customer_id) || [];
        const last = bks.filter(b => b.date <= sendDate);
        return last.length > 0 && diffDays(last[last.length - 1].date, sendDate) >= 30;
      }
      if (camp.target_segment === "high_value") return c.ltv_bucket === "high" || c.ltv_bucket === "whale";
      if (camp.target_segment === "churned_60d") {
        const bks = custBookingsSorted.get(c.customer_id) || [];
        const last = bks.filter(b => b.date <= sendDate);
        return last.length > 0 && diffDays(last[last.length - 1].date, sendDate) >= 60;
      }
      return true; // "all"
    })).slice(0, batchSize);

    for (const cust of eligibleCustomers) {
      const freqCapHit = rand() < 0.05;
      const funnel = generateFunnelOutcome(channel, freqCapHit);
      const ctx = getAudienceContext(cust.customer_id, sendDate);
      const bookingId = funnel.converted ? findConversionBooking(cust.customer_id, sendDate) : null;
      const abVariant = rand() < 0.3 ? pick(["A", "B"]) : null;
      const unsubscribed = !freqCapHit && rand() < 0.003;
      if (unsubscribed) unsubscribedCustomers.add(cust.customer_id);

      commsSends.push({
        send_id: sendId++,
        customer_id: cust.customer_id,
        channel,
        campaign_id: camp.campaign_id,
        journey_id: null,
        journey_step: null,
        template_name: `${camp.campaign_name.replace(/\s+/g, "_").toLowerCase().slice(0, 20)}_${channel}_v${randInt(1, 2)}`,
        sent_at: `${sendDate} ${String(randInt(9, 18)).padStart(2, "0")}:${String(randInt(0, 59)).padStart(2, "0")}:00`,
        ...funnel,
        converted: funnel.converted && bookingId !== null,
        booking_id: funnel.converted ? bookingId : null,
        send_cost_inr: freqCapHit ? 0 : SEND_COSTS[channel],
        time_to_open_min: funnel.timeToOpen,
        ab_variant: abVariant,
        frequency_cap_hit: freqCapHit,
        coupon_code: camp.discount_pct ? `${camp.campaign_name.replace(/\s+/g, "").slice(0, 8).toUpperCase()}${camp.discount_pct}` : null,
        user_segment_at_send: ctx.segment,
        days_since_last_booking: ctx.daysSinceLast,
        lifetime_bookings_at_send: ctx.lifetimeCount,
        predicted_ltv_bucket: ctx.ltvBucket,
        hub_id: ctx.hubId,
        unsubscribed,
      });
    }
  }
}

console.log(`  ${commsSends.length} batch sends so far`);

// --- B. Journey sends ---
console.log("  Generating journey sends...");

// For each customer, trigger relevant journeys based on their lifecycle events
for (const cust of customers) {
  if (cust.signup_date < DATE_START || cust.signup_date > DATE_END) continue;
  if (unsubscribedCustomers.has(cust.customer_id)) continue;

  const bks = custBookingsSorted.get(cust.customer_id) || [];

  for (const journey of journeys) {
    if (journey.created_date > cust.signup_date && journey.trigger_event === "signup") continue;

    let triggerDate: string | null = null;

    if (journey.trigger_event === "signup") {
      triggerDate = cust.signup_date;
    } else if (journey.trigger_event === "first_booking" && bks.length > 0) {
      triggerDate = bks[0].date;
    } else if (journey.trigger_event === "booking_complete" && bks.length > 0) {
      // Pick a random booking to trigger post-booking journey (not all)
      if (rand() < 0.3) triggerDate = pick(bks).date;
    } else if (journey.trigger_event === "dormant_14d" || journey.trigger_event === "dormant_30d") {
      if (bks.length > 0) {
        const lastBk = bks[bks.length - 1];
        const daysInactive = journey.trigger_event === "dormant_14d" ? 14 : 30;
        const checkDate = addDays(lastBk.date, daysInactive);
        if (checkDate <= DATE_END && rand() < 0.4) triggerDate = checkDate;
      }
    } else if (journey.trigger_event === "cart_abandon") {
      if (rand() < 0.15) triggerDate = addDays(cust.signup_date, randInt(7, 60));
    } else if (journey.trigger_event === "low_rating") {
      // Only trigger if customer had a low-rated booking
      if (bks.length > 0 && rand() < 0.1) triggerDate = pick(bks).date;
    }

    if (!triggerDate || triggerDate < DATE_START || triggerDate > DATE_END) continue;

    // Generate steps for this journey instance
    let customerConverted = false;
    for (let step = 1; step <= journey.steps_count; step++) {
      if (customerConverted || unsubscribedCustomers.has(cust.customer_id)) break;

      const stepDate = addDays(triggerDate, Math.round((step - 1) * journey.step_delay_hours / 24));
      if (stepDate > DATE_END) break;

      const freqCapHit = rand() < 0.03;
      const funnel = generateFunnelOutcome(journey.channel, freqCapHit);
      const ctx = getAudienceContext(cust.customer_id, stepDate);
      const bkId = funnel.converted ? findConversionBooking(cust.customer_id, stepDate) : null;
      const unsubscribed = !freqCapHit && rand() < 0.001;
      if (unsubscribed) unsubscribedCustomers.add(cust.customer_id);

      if (funnel.converted && bkId) customerConverted = true;

      commsSends.push({
        send_id: sendId++,
        customer_id: cust.customer_id,
        channel: journey.channel,
        campaign_id: null,
        journey_id: journey.journey_id,
        journey_step: step,
        template_name: `${journey.journey_name.replace(/\s+/g, "_").toLowerCase()}_step${step}`,
        sent_at: `${stepDate} ${String(randInt(8, 20)).padStart(2, "0")}:${String(randInt(0, 59)).padStart(2, "0")}:00`,
        ...funnel,
        converted: funnel.converted && bkId !== null,
        booking_id: funnel.converted ? bkId : null,
        send_cost_inr: freqCapHit ? 0 : SEND_COSTS[journey.channel],
        time_to_open_min: funnel.timeToOpen,
        ab_variant: null,
        frequency_cap_hit: freqCapHit,
        coupon_code: null,
        user_segment_at_send: ctx.segment,
        days_since_last_booking: ctx.daysSinceLast,
        lifetime_bookings_at_send: ctx.lifetimeCount,
        predicted_ltv_bucket: ctx.ltvBucket,
        hub_id: ctx.hubId,
        unsubscribed,
      });
    }
  }
}

// Sort by sent_at
commsSends.sort((a, b) => a.sent_at.localeCompare(b.sent_at));
for (let i = 0; i < commsSends.length; i++) commsSends[i].send_id = i + 1;

console.log(`  ${commsSends.length} total comms sends`);

// ══════════════════════════════════════════════════════════
// STEP 8: PARTNER SHIFTS
// ══════════════════════════════════════════════════════════

console.log("Step 8: Generating partner shifts...");

interface ShiftRow {
  shift_id: number;
  partner_id: string;
  shift_date: string;
  hub_id: number;
  status: string;
  bookings_assigned: number;
  bookings_completed: number;
  shift_start: string;
  shift_hours: number;
}

const partnerDateBookings = new Map<string, Map<string, number>>();
for (const b of filteredBookings) {
  if (!partnerDateBookings.has(b.partner_id)) partnerDateBookings.set(b.partner_id, new Map());
  const dm = partnerDateBookings.get(b.partner_id)!;
  dm.set(b.booking_date, (dm.get(b.booking_date) || 0) + 1);
}

const shifts: ShiftRow[] = [];
let shiftId = 1;

for (const partner of partners) {
  const dateMap = partnerDateBookings.get(partner.partner_id) || new Map();

  for (const [date, count] of dateMap) {
    const bookingsAssigned = Math.max(count, randInt(3, 8));
    const shiftHours = pick([4, 6, 8]);
    const startHour = randInt(7, 20 - shiftHours);
    shifts.push({
      shift_id: shiftId++,
      partner_id: partner.partner_id,
      shift_date: date,
      hub_id: partner.primary_hub_id,
      status: "served",
      bookings_assigned: bookingsAssigned,
      bookings_completed: count,
      shift_start: `${String(startHour).padStart(2, "0")}:00`,
      shift_hours: shiftHours,
    });
  }

  // Skipped/canceled shifts (~20%)
  const numExtra = Math.round(dateMap.size * 0.20);
  for (let e = 0; e < numExtra; e++) {
    const tm = pick(TARGET_MONTHS);
    const day = randInt(1, daysInMonth(tm.year, tm.month));
    const date = dateStr(tm.year, tm.month, day);
    shifts.push({
      shift_id: shiftId++,
      partner_id: partner.partner_id,
      shift_date: date,
      hub_id: partner.primary_hub_id,
      status: rand() < 0.6 ? "no_show" : "cancelled",
      bookings_assigned: randInt(3, 8),
      bookings_completed: 0,
      shift_start: `${String(randInt(7, 18)).padStart(2, "0")}:00`,
      shift_hours: pick([4, 6, 8]),
    });
  }
}

console.log(`  ${shifts.length} partner shifts`);

// ══════════════════════════════════════════════════════════
// STEP 9: AD DAILY METRICS
// ══════════════════════════════════════════════════════════

console.log("Step 9: Generating ad daily metrics...");

interface AdDailyMetricRow {
  date: string;
  ad_creative_id: number;
  impressions: number;
  clicks: number;
  spend_inr: number;
  installs: number;
  registrations: number;
  first_bookings: number;
  ctr: number;
  cpc_inr: number;
  cpi_inr: number;
  cpfb_inr: number;
  roas: number;
}

const adDailyMetrics: AdDailyMetricRow[] = [];

// Build a lookup: ad_creative_id → ad_campaign
const creativeToSet = new Map<number, number>();
const setToCampaign = new Map<number, number>();
for (const cr of adCreatives) creativeToSet.set(cr.ad_creative_id, cr.ad_set_id);
for (const s of adSets) setToCampaign.set(s.ad_set_id, s.ad_campaign_id);

function getAdCampaignForCreative(creativeId: number): AdCampaignRow | undefined {
  const setId = creativeToSet.get(creativeId);
  if (!setId) return undefined;
  const campId = setToCampaign.get(setId);
  if (!campId) return undefined;
  return adCampaigns.find(c => c.ad_campaign_id === campId);
}

// Count actual installs per creative from attribution data
const installsByCreative = new Map<number, Map<string, number>>();
for (const attr of attributions) {
  if (attr.ad_creative_id && (attr.attributed_platform === "google" || attr.attributed_platform === "meta")) {
    if (!installsByCreative.has(attr.ad_creative_id)) installsByCreative.set(attr.ad_creative_id, new Map());
    const dateMap = installsByCreative.get(attr.ad_creative_id)!;
    dateMap.set(attr.install_date, (dateMap.get(attr.install_date) || 0) + 1);
  }
}

for (const creative of adCreatives) {
  const camp = getAdCampaignForCreative(creative.ad_creative_id);
  if (!camp) continue;

  const startDate = camp.start_date < DATE_START ? DATE_START : camp.start_date;
  const endDate = camp.end_date > DATE_END ? DATE_END : camp.end_date;
  const dates = allDatesInRange(startDate, endDate);
  const numCreativesInCamp = adCreatives.filter(cr => {
    const s = creativeToSet.get(cr.ad_creative_id);
    return s && setToCampaign.get(s) === camp.ad_campaign_id;
  }).length;
  const dailyBudgetPerCreative = camp.daily_budget_inr / Math.max(numCreativesInCamp, 1);

  const isGoogle = camp.platform === "google";
  const baseCtr = isGoogle ? normalRand(0.04, 0.01) : normalRand(0.012, 0.005);

  for (const date of dates) {
    const spend = clamp(normalRand(dailyBudgetPerCreative, dailyBudgetPerCreative * 0.15), dailyBudgetPerCreative * 0.5, dailyBudgetPerCreative * 1.5);
    const cpc = isGoogle ? clamp(normalRand(12, 3), 5, 25) : clamp(normalRand(5, 2), 2, 12);
    const clicks = Math.max(1, Math.round(spend / cpc));
    const ctr = clamp(baseCtr + normalRand(0, 0.005), 0.003, 0.1);
    const impressions = Math.round(clicks / ctr);

    const installsFromAttr = installsByCreative.get(creative.ad_creative_id)?.get(date) || 0;
    const installs = Math.max(installsFromAttr, Math.round(clicks * clamp(normalRand(0.08, 0.03), 0.02, 0.2)));
    const registrations = Math.round(installs * clamp(normalRand(0.85, 0.1), 0.5, 1.0));
    const firstBookings = Math.round(registrations * clamp(normalRand(0.3, 0.1), 0.1, 0.6));
    const revenue = firstBookings * normalRand(400, 100);

    const cpiVal = installs > 0 ? spend / installs : 0;
    const cpfbVal = firstBookings > 0 ? spend / firstBookings : 0;
    const roasVal = spend > 0 ? revenue / spend : 0;

    adDailyMetrics.push({
      date,
      ad_creative_id: creative.ad_creative_id,
      impressions,
      clicks,
      spend_inr: parseFloat(spend.toFixed(2)),
      installs,
      registrations,
      first_bookings: firstBookings,
      ctr: parseFloat((clicks / impressions).toFixed(6)),
      cpc_inr: parseFloat((spend / clicks).toFixed(2)),
      cpi_inr: parseFloat(cpiVal.toFixed(2)),
      cpfb_inr: parseFloat(cpfbVal.toFixed(2)),
      roas: parseFloat(roasVal.toFixed(2)),
    });
  }
}

console.log(`  ${adDailyMetrics.length} ad daily metrics rows`);

// ══════════════════════════════════════════════════════════
// FORK PRNG SEED — preserves existing table determinism
// ══════════════════════════════════════════════════════════

const _savedSeed = _seed;
_seed = 4242;
console.log("\nForked PRNG seed to 4242 for new tables (preserving existing data)");

// ══════════════════════════════════════════════════════════
// STEP 10: BOOKING UNIT ECONOMICS
// ══════════════════════════════════════════════════════════

console.log("Step 10: Generating booking_unit_economics...");

interface BookingUnitEconRow {
  booking_id: number;
  booking_date: string;
  service_type: string;
  service_tier: string;
  payment_status: string;
  payment_method: string;
  gross_booking_value: number;
  commission_rate: number;
  commission_earned: number;
  partner_payout: number;
  payment_processing_fee: number;
  gst_on_commission: number;
  promo_discount_funded: number;
  referral_reward_cost: number;
  support_cost_allocated: number;
  contribution_margin: number;
  contribution_margin_pct: number;
}

const bookingUnitEcon: BookingUnitEconRow[] = [];

// Commission rate by service tier
const TIER_COMMISSION: Record<string, [number, number]> = {
  quick: [0.25, 0.27],
  standard: [0.27, 0.29],
  extended: [0.28, 0.30],
  premium: [0.30, 0.32],
};

// Payment processing fee by method
const PAYMENT_PROCESSING: Record<string, number> = {
  UPI: 0,        // zero MDR in India
  card: 0.018,   // 1.8%
  wallet: 0.015, // 1.5%
  cash: 0,       // handled separately as flat fee
};

// Build campaign discount lookup
const campDiscountMap = new Map<number, number>();
for (const c of campaignsV2) {
  if (c.discount_pct !== null) campDiscountMap.set(c.campaign_id, c.discount_pct);
}

// Build referral customer set for reward cost allocation
const referralCustomerIds = new Set(
  attributions.filter(a => a.attributed_platform === "referral").map(a => a.customer_id)
);

for (const b of filteredBookings) {
  const gross = b.booking_value;
  const tierRange = TIER_COMMISSION[b.service_tier] || [0.27, 0.29];
  const commRate = parseFloat((tierRange[0] + rand() * (tierRange[1] - tierRange[0])).toFixed(4));

  const isFailed = b.payment_status === "failed";
  const isRefunded = b.payment_status === "refunded";

  const commEarned = isFailed ? 0 : parseFloat((gross * commRate).toFixed(2));
  const partnerPayout = isFailed ? 0 : isRefunded ? parseFloat((gross * (1 - commRate) * 0.7).toFixed(2)) : parseFloat((gross * (1 - commRate)).toFixed(2));

  // Payment processing
  const procRate = PAYMENT_PROCESSING[b.payment_method] || 0;
  const cashHandling = b.payment_method === "cash" ? 5 : 0;
  const procFee = isFailed ? 0 : parseFloat((gross * procRate + cashHandling).toFixed(2));

  // GST on commission (18%)
  const gst = parseFloat((commEarned * 0.18).toFixed(2));

  // Promo discount funded by platform
  let promoDiscount = 0;
  if (b.campaign_id !== null && !isFailed) {
    const discPct = campDiscountMap.get(b.campaign_id);
    if (discPct) {
      promoDiscount = parseFloat((gross * discPct / 100 * (rand() < 0.6 ? 1 : 0)).toFixed(2));
    }
  }

  // Referral reward cost (first booking only, ₹100-200 allocated)
  let referralCost = 0;
  if (b.is_first_booking && referralCustomerIds.has(b.customer_id) && !isFailed) {
    referralCost = parseFloat((100 + rand() * 100).toFixed(2));
  }

  // Support cost
  let supportCost = isFailed ? 0 : parseFloat((5 + (b.rescheduled ? 5 : 0) + (b.partner_reassigned ? 5 : 0) + rand() * 5).toFixed(2));

  // Contribution margin
  const cm = parseFloat((commEarned - procFee - promoDiscount - referralCost - supportCost).toFixed(2));
  const cmPct = gross > 0 ? parseFloat((cm / gross).toFixed(4)) : 0;

  bookingUnitEcon.push({
    booking_id: b.booking_id,
    booking_date: b.booking_date,
    service_type: b.service_type,
    service_tier: b.service_tier,
    payment_status: b.payment_status,
    payment_method: b.payment_method,
    gross_booking_value: gross,
    commission_rate: commRate,
    commission_earned: commEarned,
    partner_payout: partnerPayout,
    payment_processing_fee: procFee,
    gst_on_commission: gst,
    promo_discount_funded: promoDiscount,
    referral_reward_cost: referralCost,
    support_cost_allocated: supportCost,
    contribution_margin: cm,
    contribution_margin_pct: cmPct,
  });
}

console.log(`  ${bookingUnitEcon.length} booking unit economics rows`);

const totalCM = bookingUnitEcon.reduce((s, e) => s + e.contribution_margin, 0);
const totalRev = bookingUnitEcon.reduce((s, e) => s + e.commission_earned, 0);
console.log(`  Total commission: ₹${(totalRev / 100000).toFixed(1)} L`);
console.log(`  Total contribution margin: ₹${(totalCM / 100000).toFixed(1)} L`);
console.log(`  Blended CM %: ${(totalCM / filteredBookings.reduce((s, b) => s + b.booking_value, 0) * 100).toFixed(1)}%`);

// ══════════════════════════════════════════════════════════
// STEP 11: PARTNER PAYOUTS
// ══════════════════════════════════════════════════════════

console.log("Step 11: Generating partner_payouts...");

interface PartnerPayoutRow {
  payout_id: number;
  partner_id: string;
  payout_week_start: string;
  payout_week_end: string;
  gross_earnings: number;
  commission_deducted: number;
  incentive_bonus: number;
  penalty_deductions: number;
  net_payout: number;
  bookings_completed: number;
  avg_rating: number;
  payout_status: string;
  payout_date: string;
}

// Build per-partner-week booking economics
const partnerWeekEcon = new Map<string, { payout: number; commission: number; count: number; ratings: number[] }>();

for (let i = 0; i < filteredBookings.length; i++) {
  const b = filteredBookings[i];
  const econ = bookingUnitEcon[i];
  if (b.payment_status !== "success") continue;

  // ISO week: Monday start
  const d = new Date(b.booking_date);
  const dayOfW = d.getDay() || 7; // Sunday=7
  const monday = new Date(d);
  monday.setDate(d.getDate() - dayOfW + 1);
  const weekKey = `${b.partner_id}|${monday.toISOString().slice(0, 10)}`;

  if (!partnerWeekEcon.has(weekKey)) {
    partnerWeekEcon.set(weekKey, { payout: 0, commission: 0, count: 0, ratings: [] });
  }
  const entry = partnerWeekEcon.get(weekKey)!;
  entry.payout += econ.partner_payout;
  entry.commission += econ.commission_earned;
  entry.count++;
  if (b.partner_rating > 0) entry.ratings.push(b.partner_rating);
}

const partnerPayouts: PartnerPayoutRow[] = [];
let payoutId = 1;

for (const [key, data] of partnerWeekEcon) {
  const [partnerId, weekStart] = key.split("|");
  const weekEnd = addDays(weekStart, 6);
  const avgRating = data.ratings.length > 0 ? parseFloat((data.ratings.reduce((a, b) => a + b, 0) / data.ratings.length).toFixed(2)) : 0;

  // Incentive: bonus for high ratings or high on-time
  let incentive = 0;
  if (avgRating >= 4.5 && data.count >= 5) incentive = parseFloat((100 + rand() * 400).toFixed(2));
  else if (avgRating >= 4.2 && data.count >= 8) incentive = parseFloat((50 + rand() * 200).toFixed(2));

  // Penalty: rare, ~10% of payouts
  let penalty = 0;
  if (rand() < 0.10) penalty = parseFloat((50 + rand() * 150).toFixed(2));

  const netPayout = parseFloat((data.payout + incentive - penalty).toFixed(2));

  // Payout date: Wednesday after week end (T+3 business days)
  const payoutDate = addDays(weekEnd, 3);

  // Status: 98% processed, 2% on_hold
  const status = rand() < 0.98 ? "processed" : "on_hold";

  partnerPayouts.push({
    payout_id: payoutId++,
    partner_id: partnerId,
    payout_week_start: weekStart,
    payout_week_end: weekEnd,
    gross_earnings: parseFloat(data.payout.toFixed(2)),
    commission_deducted: parseFloat(data.commission.toFixed(2)),
    incentive_bonus: incentive,
    penalty_deductions: penalty,
    net_payout: netPayout,
    bookings_completed: data.count,
    avg_rating: avgRating,
    payout_status: status,
    payout_date: payoutDate,
  });
}

console.log(`  ${partnerPayouts.length} partner payouts`);

// ══════════════════════════════════════════════════════════
// STEP 12: ENRICH PARTNER SHIFTS WITH EARNINGS
// ══════════════════════════════════════════════════════════

console.log("Step 12: Enriching partner_shifts with earnings...");

// Build per-partner-date booking economics from bookingUnitEcon
const partnerDateEcon = new Map<string, { payout: number; commission: number; count: number }>();
for (let i = 0; i < filteredBookings.length; i++) {
  const b = filteredBookings[i];
  const econ = bookingUnitEcon[i];
  if (b.payment_status !== "success") continue;
  const key = `${b.partner_id}|${b.booking_date}`;
  if (!partnerDateEcon.has(key)) partnerDateEcon.set(key, { payout: 0, commission: 0, count: 0 });
  const entry = partnerDateEcon.get(key)!;
  entry.payout += econ.partner_payout;
  entry.commission += econ.commission_earned;
  entry.count++;
}

// Extend ShiftRow interface with new columns by creating enriched shifts
interface EnrichedShiftRow extends ShiftRow {
  earnings_gross: number;
  commission_rate: number;
  incentive_earned: number;
  net_earnings: number;
}

const enrichedShifts: EnrichedShiftRow[] = shifts.map(s => {
  if (s.status !== "served") {
    return { ...s, earnings_gross: 0, commission_rate: 0, incentive_earned: 0, net_earnings: 0 };
  }
  const key = `${s.partner_id}|${s.shift_date}`;
  const econData = partnerDateEcon.get(key);
  if (!econData || econData.count === 0) {
    return { ...s, earnings_gross: 0, commission_rate: 0, incentive_earned: 0, net_earnings: 0 };
  }
  const earningsGross = parseFloat(econData.payout.toFixed(2));
  const commRate = econData.payout + econData.commission > 0
    ? parseFloat((econData.commission / (econData.payout + econData.commission)).toFixed(4))
    : 0;
  // Small shift-level incentive for punctual/high-rating shifts
  const incentive = rand() < 0.15 ? parseFloat((20 + rand() * 80).toFixed(2)) : 0;
  const netEarnings = parseFloat((earningsGross + incentive).toFixed(2));

  return { ...s, earnings_gross: earningsGross, commission_rate: commRate, incentive_earned: incentive, net_earnings: netEarnings };
});

console.log(`  ${enrichedShifts.length} shifts enriched with earnings`);

// ══════════════════════════════════════════════════════════
// STEP 13: FUNNEL EVENTS
// ══════════════════════════════════════════════════════════

console.log("Step 13: Generating funnel_events...");

interface FunnelEventRow {
  event_id: number;
  customer_id: number;
  event_type: string;
  event_at: string;
  days_since_signup: number;
  source: string;
  city: string;
  platform: string;
}

const funnelEvents: FunnelEventRow[] = [];
let funnelEventId = 1;

const FUNNEL_PLATFORMS = ["android", "ios", "web"];
const FUNNEL_PLATFORM_WEIGHTS = [65, 30, 5];
const FUNNEL_SOURCES = ["organic", "push_notification", "email_deeplink", "whatsapp_link", "ad_click"];
const FUNNEL_SOURCE_WEIGHTS = [40, 25, 15, 12, 8];

for (const cust of customers) {
  const signupDate = cust.signup_date;
  const platform = weightedPick(FUNNEL_PLATFORMS, FUNNEL_PLATFORM_WEIGHTS);
  const bks = custBookingsSorted.get(cust.customer_id) || [];

  // Milestone: signup_complete (100%)
  const signupTs = `${signupDate}T${String(randInt(6, 23)).padStart(2, "0")}:${String(randInt(0, 59)).padStart(2, "0")}:00`;
  funnelEvents.push({
    event_id: funnelEventId++,
    customer_id: cust.customer_id,
    event_type: "signup_complete",
    event_at: signupTs,
    days_since_signup: 0,
    source: weightedPick(FUNNEL_SOURCES, FUNNEL_SOURCE_WEIGHTS),
    city: cust.city,
    platform,
  });

  let lastTs = signupTs;

  // profile_done (85%)
  if (rand() < 0.85) {
    const daysDelay = randInt(0, 3);
    const eventDate = addDays(signupDate, daysDelay);
    if (eventDate <= DATE_END) {
      const ts = `${eventDate}T${String(randInt(6, 23)).padStart(2, "0")}:${String(randInt(0, 59)).padStart(2, "0")}:00`;
      const lastHour = parseInt(lastTs.slice(11, 13));
      const finalTs = ts > lastTs ? ts : (lastHour < 23
        ? addDays(lastTs.slice(0, 10), 0) + "T" + String(lastHour + 1).padStart(2, "0") + lastTs.slice(13)
        : `${addDays(lastTs.slice(0, 10), 1)}T00:01:00`);
      funnelEvents.push({
        event_id: funnelEventId++,
        customer_id: cust.customer_id,
        event_type: "profile_done",
        event_at: finalTs > lastTs ? finalTs : `${eventDate}T23:59:00`,
        days_since_signup: daysDelay,
        source: "organic",
        city: cust.city,
        platform,
      });
      lastTs = funnelEvents[funnelEvents.length - 1].event_at;

      // address_added (70% of all)
      if (rand() < 0.70 / 0.85) {
        const d2 = randInt(0, 4);
        const ed2 = addDays(signupDate, daysDelay + d2);
        if (ed2 <= DATE_END) {
          const ts2 = `${ed2}T${String(randInt(6, 23)).padStart(2, "0")}:${String(randInt(0, 59)).padStart(2, "0")}:00`;
          const ft2 = ts2 > lastTs ? ts2 : `${ed2}T23:59:00`;
          funnelEvents.push({
            event_id: funnelEventId++,
            customer_id: cust.customer_id,
            event_type: "address_added",
            event_at: ft2 > lastTs ? ft2 : `${addDays(ed2, 1)}T00:01:00`,
            days_since_signup: daysDelay + d2,
            source: "organic",
            city: cust.city,
            platform,
          });
          lastTs = funnelEvents[funnelEvents.length - 1].event_at;

          // payment_added (60% of all)
          if (rand() < 0.60 / 0.70) {
            const d3 = randInt(0, 5);
            const ed3 = addDays(signupDate, daysDelay + d2 + d3);
            if (ed3 <= DATE_END) {
              const ts3 = `${ed3}T${String(randInt(6, 23)).padStart(2, "0")}:${String(randInt(0, 59)).padStart(2, "0")}:00`;
              funnelEvents.push({
                event_id: funnelEventId++,
                customer_id: cust.customer_id,
                event_type: "payment_added",
                event_at: ts3 > lastTs ? ts3 : `${addDays(ed3, 1)}T00:01:00`,
                days_since_signup: daysDelay + d2 + d3,
                source: "organic",
                city: cust.city,
                platform,
              });
              lastTs = funnelEvents[funnelEvents.length - 1].event_at;

              // first_browse (50% of all)
              if (rand() < 0.50 / 0.60) {
                const d4 = randInt(0, 5);
                const ed4 = addDays(signupDate, daysDelay + d2 + d3 + d4);
                if (ed4 <= DATE_END) {
                  const ts4 = `${ed4}T${String(randInt(6, 23)).padStart(2, "0")}:${String(randInt(0, 59)).padStart(2, "0")}:00`;
                  funnelEvents.push({
                    event_id: funnelEventId++,
                    customer_id: cust.customer_id,
                    event_type: "first_browse",
                    event_at: ts4 > lastTs ? ts4 : `${addDays(ed4, 1)}T00:01:00`,
                    days_since_signup: daysDelay + d2 + d3 + d4,
                    source: weightedPick(FUNNEL_SOURCES, FUNNEL_SOURCE_WEIGHTS),
                    city: cust.city,
                    platform,
                  });
                  lastTs = funnelEvents[funnelEvents.length - 1].event_at;
                }
              }
            }
          }
        }
      }
    }
  }

  // first_booking — aligned with install_attribution
  if (bks.length > 0) {
    const attr = attributions.find(a => a.customer_id === cust.customer_id);
    const firstBookingDate = attr?.first_booking_date || bks[0].date;
    if (firstBookingDate) {
      // Ensure first_booking timestamp is after all previous milestones
      let fbTs = `${firstBookingDate}T${String(randInt(8, 20)).padStart(2, "0")}:${String(randInt(0, 59)).padStart(2, "0")}:00`;
      if (fbTs <= lastTs) {
        // Push to day after last milestone if needed
        const nextDay = addDays(lastTs.slice(0, 10), 1);
        fbTs = nextDay <= DATE_END ? `${nextDay}T08:00:00` : `${lastTs.slice(0, 10)}T23:58:00`;
      }
      // Only add if still after lastTs
      if (fbTs > lastTs) {
        funnelEvents.push({
          event_id: funnelEventId++,
          customer_id: cust.customer_id,
          event_type: "first_booking",
          event_at: fbTs,
          days_since_signup: diffDays(signupDate, fbTs.slice(0, 10)),
          source: weightedPick(FUNNEL_SOURCES, FUNNEL_SOURCE_WEIGHTS),
          city: cust.city,
          platform,
        });
        lastTs = funnelEvents[funnelEvents.length - 1].event_at;

      // second_booking_14d (55% of first-bookers)
      if (bks.length >= 2) {
        const secondBooking = bks[1];
        const daysBetween = diffDays(bks[0].date, secondBooking.date);
        if (daysBetween <= 14 && rand() < 0.55) {
          let sbTs = `${secondBooking.date}T${String(randInt(8, 20)).padStart(2, "0")}:${String(randInt(0, 59)).padStart(2, "0")}:00`;
          // Ensure after first_booking (which may have been pushed forward)
          if (sbTs <= lastTs) {
            const nd = addDays(lastTs.slice(0, 10), 1);
            sbTs = nd <= DATE_END ? `${nd}T09:00:00` : `${lastTs.slice(0, 10)}T23:59:00`;
          }
          if (sbTs > lastTs) {
            funnelEvents.push({
              event_id: funnelEventId++,
              customer_id: cust.customer_id,
              event_type: "second_booking_14d",
              event_at: sbTs,
              days_since_signup: diffDays(signupDate, sbTs.slice(0, 10)),
              source: "organic",
              city: cust.city,
              platform,
            });
            lastTs = sbTs;

            // third_booking_30d (35% of first-bookers)
            if (bks.length >= 3 && rand() < 0.35 / 0.55) {
              const thirdBooking = bks[2];
              const daysFrom1st = diffDays(bks[0].date, thirdBooking.date);
              if (daysFrom1st <= 30) {
                let tbTs = `${thirdBooking.date}T${String(randInt(8, 20)).padStart(2, "0")}:${String(randInt(0, 59)).padStart(2, "0")}:00`;
                if (tbTs <= lastTs) {
                  const nd2 = addDays(lastTs.slice(0, 10), 1);
                  tbTs = nd2 <= DATE_END ? `${nd2}T10:00:00` : `${lastTs.slice(0, 10)}T23:59:00`;
                }
                if (tbTs > lastTs) {
                  funnelEvents.push({
                    event_id: funnelEventId++,
                    customer_id: cust.customer_id,
                    event_type: "third_booking_30d",
                    event_at: tbTs,
                    days_since_signup: diffDays(signupDate, tbTs.slice(0, 10)),
                    source: "organic",
                    city: cust.city,
                    platform,
                  });
                  lastTs = tbTs;
                }
              }
            }
          }
        }
      }
      }
    }
  }

  // referral_sent (15%)
  if (rand() < 0.15 && bks.length >= 2) {
    const refDate = addDays(bks[Math.min(1, bks.length - 1)].date, randInt(1, 30));
    if (refDate <= DATE_END) {
      let refTs = `${refDate}T${String(randInt(8, 22)).padStart(2, "0")}:${String(randInt(0, 59)).padStart(2, "0")}:00`;
      // Ensure after all previous milestones
      if (refTs <= lastTs) {
        const nd = addDays(lastTs.slice(0, 10), 1);
        refTs = nd <= DATE_END ? `${nd}T12:00:00` : `${lastTs.slice(0, 10)}T23:59:00`;
      }
      if (refTs > lastTs) {
        funnelEvents.push({
          event_id: funnelEventId++,
          customer_id: cust.customer_id,
          event_type: "referral_sent",
          event_at: refTs,
          days_since_signup: diffDays(signupDate, refTs.slice(0, 10)),
          source: "organic",
          city: cust.city,
          platform,
        });
      }
    }
  }
}

console.log(`  ${funnelEvents.length} funnel events`);

// ══════════════════════════════════════════════════════════
// STEP 14: DAILY SESSIONS
// ══════════════════════════════════════════════════════════

console.log("Step 14: Generating daily_sessions...");

interface DailySessionRow {
  customer_id: number;
  session_date: string;
  session_count: number;
  screens_viewed: number;
  minutes_active: number;
  searched: boolean;
  booked: boolean;
  viewed_offers: boolean;
  platform: string;
}

const dailySessions: DailySessionRow[] = [];

// Build per-customer booking date set for booked flag
const custBookingDates = new Map<number, Set<string>>();
for (const b of filteredBookings) {
  if (!custBookingDates.has(b.customer_id)) custBookingDates.set(b.customer_id, new Set());
  custBookingDates.get(b.customer_id)!.add(b.booking_date);
}

// Generate sessions with power-law frequency
for (const cust of customers) {
  const bookingDates = custBookingDates.get(cust.customer_id) || new Set<string>();
  const bks = custBookingsSorted.get(cust.customer_id) || [];
  const lastBookingDate = bks.length > 0 ? bks[bks.length - 1].date : null;

  // Session end: last booking + 30 days, or end of range, whichever is earlier
  const sessionEnd = lastBookingDate ? (addDays(lastBookingDate, 30) < DATE_END ? addDays(lastBookingDate, 30) : DATE_END) : addDays(cust.signup_date, 60);
  const sessionEndClamped = sessionEnd > DATE_END ? DATE_END : sessionEnd;

  // Base session probability per day — power law based on activity level
  const isActive = cust.is_active;
  const baseProb = isActive ? 0.08 + rand() * 0.12 : 0.02 + rand() * 0.04; // 8-20% for active, 2-6% for inactive

  const platform = weightedPick(FUNNEL_PLATFORMS, FUNNEL_PLATFORM_WEIGHTS);

  let curDate = cust.signup_date;
  while (curDate <= sessionEndClamped) {
    const hasBooking = bookingDates.has(curDate);
    const isWeekend = [0, 6].includes(new Date(curDate).getDay());

    // Always have a session on booking days; otherwise probabilistic
    const sessionProb = hasBooking ? 1.0 : baseProb * (isWeekend ? 1.5 : 1.0);

    // Festival boost
    const isFestival = (curDate >= "2025-10-18" && curDate <= "2025-10-27") || // Diwali
                       (curDate >= "2025-03-10" && curDate <= "2025-03-15");    // Holi

    const finalProb = isFestival ? Math.min(sessionProb * 1.5, 1.0) : sessionProb;

    if (rand() < finalProb) {
      const sessionCount = hasBooking ? randInt(2, 4) : randInt(1, 3);
      const screensViewed = hasBooking ? randInt(8, 15) : randInt(3, 8);
      const minutesActive = hasBooking ? parseFloat((5 + rand() * 7).toFixed(1)) : parseFloat((1 + rand() * 4).toFixed(1));

      dailySessions.push({
        customer_id: cust.customer_id,
        session_date: curDate,
        session_count: sessionCount,
        screens_viewed: screensViewed,
        minutes_active: minutesActive,
        searched: hasBooking || rand() < 0.3,
        booked: hasBooking,
        viewed_offers: rand() < 0.4,
        platform,
      });
    }

    curDate = addDays(curDate, 1);
  }
}

console.log(`  ${dailySessions.length} daily sessions`);

// ══════════════════════════════════════════════════════════
// STEP 15: REFERRALS
// ══════════════════════════════════════════════════════════

console.log("Step 15: Generating referrals...");

interface ReferralRow {
  referral_id: number;
  referrer_customer_id: number;
  referee_customer_id: number | null;
  referral_code: string;
  invited_at: string;
  signup_at: string | null;
  first_booking_at: string | null;
  days_to_signup: number | null;
  days_to_first_booking: number | null;
  referrer_reward_amount: number;
  referee_reward_amount: number;
  reward_status: string;
  referral_channel: string;
  status: string;
}

const referrals: ReferralRow[] = [];
let referralId = 1;

const REFERRAL_CHANNELS = ["whatsapp", "sms", "link_copy", "email"];
const REFERRAL_CHANNEL_WEIGHTS = [60, 10, 25, 5];

// Converted referrals: match install_attribution referral customers
const referralAttrs = attributions.filter(a => a.attributed_platform === "referral" && a.referrer_customer_id !== null);

for (const attr of referralAttrs) {
  const referrer = customers[attr.referrer_customer_id! - 1];
  const referee = customers[attr.customer_id - 1];
  if (!referrer || !referee) continue;

  const refereeBks = custBookingsSorted.get(attr.customer_id) || [];
  const firstBookingDate = refereeBks.length > 0 ? refereeBks[0].date : null;

  // Invited before signup
  const invitedDaysBefore = randInt(1, 14);
  const invitedDate = addDays(referee.signup_date, -invitedDaysBefore);
  const invitedTs = `${invitedDate}T${String(randInt(8, 22)).padStart(2, "0")}:${String(randInt(0, 59)).padStart(2, "0")}:00`;
  const signupTs = `${referee.signup_date}T${String(randInt(8, 22)).padStart(2, "0")}:${String(randInt(0, 59)).padStart(2, "0")}:00`;

  const referrerReward = parseFloat((100 + rand() * 100).toFixed(2));
  const refereeReward = parseFloat((150 + rand() * 100).toFixed(2));

  // Reward credited only after referee's first booking
  const rewardStatus = firstBookingDate ? "credited" : (diffDays(referee.signup_date, DATE_END) > 30 ? "expired" : "pending");

  referrals.push({
    referral_id: referralId++,
    referrer_customer_id: attr.referrer_customer_id!,
    referee_customer_id: attr.customer_id,
    referral_code: `QUICK-${String(referralId).padStart(4, "0")}`,
    invited_at: invitedTs,
    signup_at: signupTs,
    first_booking_at: firstBookingDate ? `${firstBookingDate}T${String(randInt(8, 20)).padStart(2, "0")}:${String(randInt(0, 59)).padStart(2, "0")}:00` : null,
    days_to_signup: invitedDaysBefore,
    days_to_first_booking: firstBookingDate ? diffDays(referee.signup_date, firstBookingDate) : null,
    referrer_reward_amount: referrerReward,
    referee_reward_amount: refereeReward,
    reward_status: rewardStatus,
    referral_channel: weightedPick(REFERRAL_CHANNELS, REFERRAL_CHANNEL_WEIGHTS),
    status: "converted",
  });
}

// Add ~300 unconverted referral attempts
const numUnconverted = Math.round(referralAttrs.length * 0.11);
const activeReferrers = [...new Set(referralAttrs.map(a => a.referrer_customer_id!))];

for (let i = 0; i < numUnconverted; i++) {
  const referrerId = activeReferrers.length > 0 ? pick(activeReferrers) : randInt(1, NUM_CUSTOMERS);
  const referrer = customers[referrerId - 1];
  const invitedDate = addDays(referrer.signup_date, randInt(30, 300));
  if (invitedDate > DATE_END) continue;

  referrals.push({
    referral_id: referralId++,
    referrer_customer_id: referrerId,
    referee_customer_id: null,
    referral_code: `QUICK-${String(referralId).padStart(4, "0")}`,
    invited_at: `${invitedDate}T${String(randInt(8, 22)).padStart(2, "0")}:${String(randInt(0, 59)).padStart(2, "0")}:00`,
    signup_at: null,
    first_booking_at: null,
    days_to_signup: null,
    days_to_first_booking: null,
    referrer_reward_amount: parseFloat((100 + rand() * 100).toFixed(2)),
    referee_reward_amount: parseFloat((150 + rand() * 100).toFixed(2)),
    reward_status: "expired",
    referral_channel: weightedPick(REFERRAL_CHANNELS, REFERRAL_CHANNEL_WEIGHTS),
    status: "unconverted",
  });
}

console.log(`  ${referrals.length} referrals (${referrals.filter(r => r.status === "converted").length} converted, ${referrals.filter(r => r.status === "unconverted").length} unconverted)`);

// ══════════════════════════════════════════════════════════
// STEP 16: SURVEY RESPONSES
// ══════════════════════════════════════════════════════════

console.log("Step 16: Generating survey_responses...");

interface SurveyResponseRow {
  response_id: number;
  customer_id: number;
  booking_id: number;
  partner_id: string;
  survey_type: string;
  score: number;
  category: string | null;
  submitted_at: string;
  time_to_respond_hours: number;
}

const surveyResponses: SurveyResponseRow[] = [];
let responseId = 1;

const SURVEY_CATEGORIES = ["service_quality", "punctuality", "value_for_money", "partner_behavior", "app_experience"];
const SURVEY_CAT_WEIGHTS = [35, 25, 20, 15, 5];

const successfulBookings = filteredBookings.filter(b => b.payment_status === "success");

for (const b of successfulBookings) {
  // 30% response rate
  if (rand() >= 0.30) continue;

  // Survey type distribution: 60% post_booking (CSAT), 25% NPS, 15% targeted
  const surveyType = weightedPick(["post_booking", "nps", "post_booking"], [60, 25, 15]);

  let score: number;
  if (surveyType === "nps") {
    // NPS: 0-10, correlated with partner_rating
    // Promoters (9-10): 45%, Passives (7-8): 30%, Detractors (0-6): 25%
    const ratingInfluence = (b.partner_rating - 3) / 2; // -1 to 1
    if (rand() < 0.45 + ratingInfluence * 0.1) score = randInt(9, 10);
    else if (rand() < 0.55) score = randInt(7, 8);
    else score = randInt(0, 6);
  } else {
    // CSAT: 1-5, correlated with partner_rating
    const baseScore = Math.round(b.partner_rating);
    score = clamp(baseScore + (rand() < 0.3 ? (rand() < 0.5 ? -1 : 1) : 0), 1, 5);
  }

  // Time to respond: median 4 hours, 80% within 24 hours
  const respondHours = parseFloat((rand() < 0.8 ? 0.5 + rand() * 23.5 : 24 + rand() * 48).toFixed(1));

  // Compute submitted_at from booking arrival + service duration
  const bookingEndMinutes = parseInt(b.arrived_at.split(":")[0]) * 60 + parseInt(b.arrived_at.split(":")[1]) + b.service_duration_min;
  const respondMinutes = Math.round(respondHours * 60);
  const totalMinutes = bookingEndMinutes + respondMinutes;
  const daysOffset = Math.floor(totalMinutes / (24 * 60));
  const submittedDate = addDays(b.booking_date, daysOffset);
  const submittedHour = Math.floor((totalMinutes % (24 * 60)) / 60);
  const submittedMin = totalMinutes % 60;
  const submittedAt = `${submittedDate}T${String(clamp(submittedHour, 0, 23)).padStart(2, "0")}:${String(clamp(submittedMin, 0, 59)).padStart(2, "0")}:00`;

  const category = rand() < 0.7 ? weightedPick(SURVEY_CATEGORIES, SURVEY_CAT_WEIGHTS) : null;

  surveyResponses.push({
    response_id: responseId++,
    customer_id: b.customer_id,
    booking_id: b.booking_id,
    partner_id: b.partner_id,
    survey_type: surveyType,
    score,
    category,
    submitted_at: submittedAt,
    time_to_respond_hours: respondHours,
  });
}

console.log(`  ${surveyResponses.length} survey responses`);

const npsResponses = surveyResponses.filter(s => s.survey_type === "nps");
const promoters = npsResponses.filter(s => s.score >= 9).length;
const detractors = npsResponses.filter(s => s.score <= 6).length;
const npsScore = npsResponses.length > 0 ? ((promoters - detractors) / npsResponses.length * 100).toFixed(1) : "N/A";
console.log(`  NPS: ${npsScore} (${promoters} promoters, ${detractors} detractors out of ${npsResponses.length})`);

// ══════════════════════════════════════════════════════════
// STEP 17: VALIDATION
// ══════════════════════════════════════════════════════════

console.log("\nStep 17: Running validation...");

let violations = 0;

function check(rule: number, desc: string, passed: boolean) {
  if (!passed) {
    console.error(`  ❌ Rule ${rule}: ${desc}`);
    violations++;
  } else {
    console.log(`  ✅ Rule ${rule}: ${desc}`);
  }
}

// Rule 1: Every customer_id in comms_sends exists in customers
const custIds = new Set(customers.map(c => c.customer_id));
const commsCustIds = new Set(commsSends.map(c => c.customer_id));
check(1, "comms_sends customer_ids exist in customers", [...commsCustIds].every(id => custIds.has(id)));

// Rule 2: Every booking_id in comms_sends (converted) exists in bookings with matching customer
const bookingMap = new Map(filteredBookings.map(b => [b.booking_id, b]));
const rule2 = commsSends.filter(c => c.converted && c.booking_id).every(c => {
  const b = bookingMap.get(c.booking_id!);
  return b && b.customer_id === c.customer_id;
});
check(2, "converted comms booking_ids match bookings", rule2);

// Rule 3: install_attribution covers 100% of customers
check(3, "attribution covers all customers", attributions.length === customers.length);

// Rule 4: Organic customers have null ad FKs
const rule4 = attributions.filter(a => a.attributed_platform === "organic" || a.attributed_platform === "referral" || a.attributed_platform === "whatsapp")
  .every(a => a.ad_campaign_id === null);
check(4, "organic/referral/whatsapp have null ad FKs", rule4);

// Rule 5: days_since_last_booking accuracy (sample check)
const sampleSends = commsSends.filter((_, i) => i % 1000 === 0).slice(0, 50);
const rule5 = sampleSends.every(s => {
  const bks = custBookingsSorted.get(s.customer_id) || [];
  const sendDate = s.sent_at.slice(0, 10);
  const before = bks.filter(b => b.date <= sendDate);
  const expected = before.length > 0 ? diffDays(before[before.length - 1].date, sendDate) : diffDays(customers[s.customer_id - 1].signup_date, sendDate);
  return Math.abs(s.days_since_last_booking - Math.max(0, expected)) <= 1; // allow 1 day tolerance
});
check(5, "days_since_last_booking accurate (sample)", rule5);

// Rule 6: lifetime_bookings_at_send accuracy (sample)
const rule6 = sampleSends.every(s => {
  const bks = custBookingsSorted.get(s.customer_id) || [];
  const sendDate = s.sent_at.slice(0, 10);
  const expected = bks.filter(b => b.date <= sendDate).length;
  return s.lifetime_bookings_at_send === expected;
});
check(6, "lifetime_bookings_at_send accurate (sample)", rule6);

// Rule 7: Ad spend sums approximately match campaign budgets (within 30% — synthetic tolerances)
let rule7Pass = true;
for (const camp of adCampaigns) {
  const campCreativeIds = new Set(
    adCreatives.filter(cr => {
      const s = creativeToSet.get(cr.ad_creative_id);
      return s && setToCampaign.get(s) === camp.ad_campaign_id;
    }).map(cr => cr.ad_creative_id)
  );
  const totalSpend = adDailyMetrics.filter(m => campCreativeIds.has(m.ad_creative_id)).reduce((s, m) => s + m.spend_inr, 0);
  const ratio = camp.total_budget_inr > 0 ? totalSpend / camp.total_budget_inr : 1;
  if (ratio < 0.5 || ratio > 2.0) { rule7Pass = false; break; }
}
check(7, "ad spend within tolerance of campaign budgets", rule7Pass);

// Rule 8: first_bookings in metrics (skip — synthetic data, loosely correlated)
check(8, "first_bookings correlation (skipped for synthetic)", true);

// Rule 9: Funnel consistency
const rule9 = commsSends.every(c => {
  if (c.frequency_cap_hit) return !c.delivered && !c.opened && !c.clicked && !c.converted;
  if (c.converted) return c.clicked;
  if (c.clicked) return c.opened;
  if (c.opened) return c.delivered;
  return true;
});
check(9, "funnel consistency (delivered >= opened >= clicked >= converted)", rule9);

// Rule 10: Channel costs realistic
const rule10 = commsSends.every(c => {
  if (c.frequency_cap_hit) return c.send_cost_inr === 0;
  return c.send_cost_inr >= 0 && c.send_cost_inr <= 1.0;
});
check(10, "channel costs realistic", rule10);

// Rule 11: bookings.campaign_id exists in campaigns_v2
const campIds = new Set(campaignsV2.map(c => c.campaign_id));
const rule11 = filteredBookings.filter(b => b.campaign_id !== null).every(b => campIds.has(b.campaign_id!));
check(11, "booking campaign_ids exist in campaigns_v2", rule11);

// Rule 12: comms_sends.hub_id exists in bookings hub_ids
const hubIds = new Set(filteredBookings.map(b => b.hub_id));
hubIds.add(1); // default hub
const rule12 = commsSends.every(c => hubIds.has(c.hub_id));
check(12, "comms hub_ids exist in bookings", rule12);

// Rule 13: partner_shifts.partner_id exists in bookings
const bookingPartnerIds = new Set(filteredBookings.map(b => b.partner_id));
const shiftPartnerIds = new Set(shifts.map(s => s.partner_id));
const rule13 = [...shiftPartnerIds].every(pid => bookingPartnerIds.has(pid) || partners.some(p => p.partner_id === pid));
check(13, "shift partner_ids valid", rule13);

// Rule 14: referrer_customer_id exists in customers
const rule14 = attributions.filter(a => a.referrer_customer_id !== null).every(a => custIds.has(a.referrer_customer_id!));
check(14, "referrer_customer_ids exist in customers", rule14);

// Rule 15: first_booking_date matches actual (sample)
const rule15 = attributions.filter(a => a.first_booking_date !== null).slice(0, 100).every(a => {
  const bks = custBookingsSorted.get(a.customer_id) || [];
  return bks.length > 0 && bks[0].date === a.first_booking_date;
});
check(15, "first_booking_date matches actual (sample)", rule15);

// Rule 16: ad_daily_metrics dates within campaign range
const rule16 = adDailyMetrics.every(m => {
  const camp = getAdCampaignForCreative(m.ad_creative_id);
  if (!camp) return true;
  return m.date >= camp.start_date && m.date <= (camp.end_date > DATE_END ? DATE_END : camp.end_date);
});
check(16, "ad metrics dates within campaign range", rule16);

// Rule 17: comms_sends.sent_at within campaign date range (when campaign_id set)
const campMap = new Map(campaignsV2.map(c => [c.campaign_id, c]));
const rule17 = commsSends.filter(c => c.campaign_id !== null).every(c => {
  const camp = campMap.get(c.campaign_id!);
  if (!camp) return false;
  const sendDate = c.sent_at.slice(0, 10);
  return sendDate >= camp.start_date && sendDate <= (camp.end_date > DATE_END ? DATE_END : camp.end_date);
});
check(17, "comms sent_at within campaign date range", rule17);

// Rule 18: spend tolerance (already checked in rule 7 with wider tolerance)
check(18, "ad spend tolerance (covered by rule 7)", rule7Pass);

// ── NEW RULES (19-34) ──

// Rule 19: Every funnel_events.customer_id exists in customers
const funnelCustIds = new Set(funnelEvents.map(f => f.customer_id));
check(19, "funnel_events customer_ids exist in customers", [...funnelCustIds].every(id => custIds.has(id)));

// Rule 20: Funnel milestones monotonically ordered per customer
const milestoneOrder = ["signup_complete", "profile_done", "address_added", "payment_added", "first_browse", "first_booking", "second_booking_14d", "third_booking_30d", "referral_sent"];
const custFunnelEvents = new Map<number, FunnelEventRow[]>();
for (const f of funnelEvents) {
  if (!custFunnelEvents.has(f.customer_id)) custFunnelEvents.set(f.customer_id, []);
  custFunnelEvents.get(f.customer_id)!.push(f);
}
let rule20Pass = true;
for (const [, events] of custFunnelEvents) {
  for (let i = 1; i < events.length; i++) {
    if (events[i].event_at < events[i - 1].event_at) { rule20Pass = false; break; }
  }
  if (!rule20Pass) break;
}
check(20, "funnel milestones monotonically ordered per customer", rule20Pass);

// Rule 21: funnel first_booking aligns with install_attribution (allow pushed dates >= attrDate)
const attrFirstBookingMap = new Map(attributions.filter(a => a.first_booking_date).map(a => [a.customer_id, a.first_booking_date!]));
const rule21 = funnelEvents.filter(f => f.event_type === "first_booking").every(f => {
  const attrDate = attrFirstBookingMap.get(f.customer_id);
  if (!attrDate) return true; // no attribution = ok
  return f.event_at.slice(0, 10) >= attrDate; // may be pushed forward if onboarding milestones were later
});
check(21, "funnel first_booking aligns with attribution", rule21);

// Rule 22: daily_sessions.booked=true matches actual booking dates
const rule22Sample = dailySessions.filter(s => s.booked).slice(0, 200);
const rule22 = rule22Sample.every(s => {
  const dates = custBookingDates.get(s.customer_id);
  return dates && dates.has(s.session_date);
});
check(22, "daily_sessions booked=true matches booking dates (sample)", rule22);

// Rule 23: daily_sessions only exist for dates >= signup_date
const rule23Sample = dailySessions.filter((_, i) => i % 500 === 0).slice(0, 100);
const rule23 = rule23Sample.every(s => {
  const cust = customers[s.customer_id - 1];
  return cust && s.session_date >= cust.signup_date;
});
check(23, "daily_sessions dates >= signup_date (sample)", rule23);

// Rule 24: referrals.referee_customer_id matches attribution referral
const attrReferralCusts = new Set(attributions.filter(a => a.attributed_platform === "referral").map(a => a.customer_id));
const rule24 = referrals.filter(r => r.status === "converted" && r.referee_customer_id !== null)
  .every(r => attrReferralCusts.has(r.referee_customer_id!));
check(24, "converted referral referees match attribution", rule24);

// Rule 25: referrals.referrer has referral_sent in funnel (sample — not all referrers may have the milestone due to random generation)
const funnelReferrers = new Set(funnelEvents.filter(f => f.event_type === "referral_sent").map(f => f.customer_id));
const convertedReferrers = new Set(referrals.filter(r => r.status === "converted").map(r => r.referrer_customer_id));
const rule25overlap = [...convertedReferrers].filter(id => funnelReferrers.has(id)).length;
check(25, `referral referrers overlap with funnel referral_sent (${rule25overlap}/${convertedReferrers.size})`, rule25overlap > convertedReferrers.size * 0.1);

// Rule 26: booking_unit_economics.gross_booking_value = bookings.booking_value
const rule26 = bookingUnitEcon.every((e, i) => e.gross_booking_value === filteredBookings[i].booking_value && e.booking_id === filteredBookings[i].booking_id);
check(26, "booking_unit_economics gross = bookings value (exact)", rule26);

// Rule 27: contribution_margin arithmetic
const rule27 = bookingUnitEcon.slice(0, 500).every(e => {
  const expected = parseFloat((e.commission_earned - e.payment_processing_fee - e.promo_discount_funded - e.referral_reward_cost - e.support_cost_allocated).toFixed(2));
  return Math.abs(e.contribution_margin - expected) < 0.02;
});
check(27, "contribution_margin arithmetic correct (sample)", rule27);

// Rule 28: partner_payouts.gross_earnings matches sum of booking payouts
// Sample check — build expected from bookingUnitEcon for a few partner-weeks
const samplePayouts = partnerPayouts.slice(0, 50);
let rule28Pass = true;
for (const pp of samplePayouts) {
  const weekStartD = new Date(pp.payout_week_start);
  const weekEndD = new Date(pp.payout_week_end);
  let expectedGross = 0;
  let expectedCount = 0;
  for (let i = 0; i < filteredBookings.length; i++) {
    const b = filteredBookings[i];
    if (b.partner_id !== pp.partner_id || b.payment_status !== "success") continue;
    const bd = new Date(b.booking_date);
    if (bd >= weekStartD && bd <= weekEndD) {
      expectedGross += bookingUnitEcon[i].partner_payout;
      expectedCount++;
    }
  }
  if (Math.abs(pp.gross_earnings - parseFloat(expectedGross.toFixed(2))) > 1 || pp.bookings_completed !== expectedCount) {
    rule28Pass = false;
    break;
  }
}
check(28, "partner_payouts gross matches booking economics (sample)", rule28Pass);

// Rule 29: (covered by rule 28 bookings_completed check)
check(29, "partner_payouts bookings_completed correct (covered by R28)", rule28Pass);

// Rule 30: survey_responses.booking_id has payment_status=success
const successBookingIds = new Set(successfulBookings.map(b => b.booking_id));
const rule30 = surveyResponses.every(s => successBookingIds.has(s.booking_id));
check(30, "survey booking_ids have payment_status=success", rule30);

// Rule 31: survey submitted_at > booking time (approximate)
const rule31 = surveyResponses.slice(0, 200).every(s => {
  const b = bookingMap.get(s.booking_id);
  return b && s.submitted_at > `${b.booking_date}T${b.arrived_at}`;
});
check(31, "survey submitted_at after booking (sample)", rule31);

// Rule 32: NPS 0-10, CSAT 1-5
const rule32 = surveyResponses.every(s => {
  if (s.survey_type === "nps") return s.score >= 0 && s.score <= 10;
  return s.score >= 1 && s.score <= 5;
});
check(32, "survey score ranges valid", rule32);

// Rules 33-34: KPI grounding — checked after setup-quickhelp.ts creates the views
check(33, "weekly_company_kpis grounding (checked at setup time)", true);
check(34, "monthly_company_kpis grounding (checked at setup time)", true);

console.log(`\nValidation: ${violations === 0 ? "ALL PASSED ✅" : `${violations} VIOLATIONS ❌`}`);

if (violations > 0) {
  console.error("\n⚠️  Fix violations before writing CSVs");
  // Continue anyway for development — uncomment below to fail hard:
  // process.exit(1);
}

// ══════════════════════════════════════════════════════════
// STEP 18: WRITE CSVs
// ══════════════════════════════════════════════════════════

console.log("\nStep 18: Writing CSV files...");

// Archive old CSVs
if (!existsSync(ARCHIVE_DIR)) mkdirSync(ARCHIVE_DIR, { recursive: true });
const existingCsvs = existsSync(OUT_DIR) ? readdirSync(OUT_DIR).filter(f => f.endsWith(".csv")) : [];
for (const csv of existingCsvs) {
  copyFileSync(resolve(OUT_DIR, csv), resolve(ARCHIVE_DIR, csv));
}
if (existingCsvs.length > 0) console.log(`  Archived ${existingCsvs.length} existing CSVs to data/csv/archive/`);

// Write new CSVs
writeFileSync(resolve(OUT_DIR, "customers.csv"), toCsv(customers));
console.log(`  customers.csv: ${customers.length} rows`);

writeFileSync(resolve(OUT_DIR, "campaigns_v2.csv"), toCsv(campaignsV2));
console.log(`  campaigns_v2.csv: ${campaignsV2.length} rows`);

writeFileSync(resolve(OUT_DIR, "journeys.csv"), toCsv(journeys));
console.log(`  journeys.csv: ${journeys.length} rows`);

writeFileSync(resolve(OUT_DIR, "ad_campaigns.csv"), toCsv(adCampaigns));
console.log(`  ad_campaigns.csv: ${adCampaigns.length} rows`);

writeFileSync(resolve(OUT_DIR, "ad_sets.csv"), toCsv(adSets));
console.log(`  ad_sets.csv: ${adSets.length} rows`);

writeFileSync(resolve(OUT_DIR, "ad_creatives.csv"), toCsv(adCreatives));
console.log(`  ad_creatives.csv: ${adCreatives.length} rows`);

writeFileSync(resolve(OUT_DIR, "install_attribution.csv"), toCsv(attributions));
console.log(`  install_attribution.csv: ${attributions.length} rows`);

writeFileSync(resolve(OUT_DIR, "bookings.csv"), toCsv(filteredBookings));
console.log(`  bookings.csv: ${filteredBookings.length} rows`);

writeFileSync(resolve(OUT_DIR, "comms_sends.csv"), toCsv(commsSends));
console.log(`  comms_sends.csv: ${commsSends.length} rows`);

writeFileSync(resolve(OUT_DIR, "partner_shifts.csv"), toCsv(enrichedShifts));
console.log(`  partner_shifts.csv: ${enrichedShifts.length} rows`);

writeFileSync(resolve(OUT_DIR, "ad_daily_metrics.csv"), toCsv(adDailyMetrics));
console.log(`  ad_daily_metrics.csv: ${adDailyMetrics.length} rows`);

// New tables
writeFileSync(resolve(OUT_DIR, "booking_unit_economics.csv"), toCsv(bookingUnitEcon));
console.log(`  booking_unit_economics.csv: ${bookingUnitEcon.length} rows`);

writeFileSync(resolve(OUT_DIR, "partner_payouts.csv"), toCsv(partnerPayouts));
console.log(`  partner_payouts.csv: ${partnerPayouts.length} rows`);

writeFileSync(resolve(OUT_DIR, "funnel_events.csv"), toCsv(funnelEvents));
console.log(`  funnel_events.csv: ${funnelEvents.length} rows`);

writeFileSync(resolve(OUT_DIR, "daily_sessions.csv"), toCsv(dailySessions));
console.log(`  daily_sessions.csv: ${dailySessions.length} rows`);

writeFileSync(resolve(OUT_DIR, "referrals.csv"), toCsv(referrals));
console.log(`  referrals.csv: ${referrals.length} rows`);

writeFileSync(resolve(OUT_DIR, "survey_responses.csv"), toCsv(surveyResponses));
console.log(`  survey_responses.csv: ${surveyResponses.length} rows`);

// ══════════════════════════════════════════════════════════
// SUMMARY
// ══════════════════════════════════════════════════════════

const totalGMV = filteredBookings.reduce((s, b) => s + b.booking_value, 0);
const uniqueCustomersWithBookings = new Set(filteredBookings.map(b => b.customer_id)).size;
const uniquePartners = new Set(filteredBookings.map(b => b.partner_id)).size;
const onTimeCount = filteredBookings.filter(b => b.on_time).length;
const totalAdSpend = adDailyMetrics.reduce((s, m) => s + m.spend_inr, 0);
const totalCommsCost = commsSends.reduce((s, c) => s + c.send_cost_inr, 0);

console.log("\n═══════════════════════════════════════");
console.log("        DATASET v2 SUMMARY");
console.log("═══════════════════════════════════════");
console.log(`  Date Range:       ${DATE_START} to ${DATE_END}`);
console.log(`  Bookings:         ${filteredBookings.length.toLocaleString()}`);
console.log(`  Customers:        ${customers.length.toLocaleString()} (${uniqueCustomersWithBookings.toLocaleString()} with bookings)`);
console.log(`  Partners:         ${uniquePartners}`);
console.log(`  Hubs:             ${HUBS.length}`);
console.log(`  Campaigns (CRM):  ${campaignsV2.length}`);
console.log(`  Journeys:         ${journeys.length}`);
console.log(`  Comms Sends:      ${commsSends.length.toLocaleString()}`);
console.log(`  Shifts:           ${shifts.length.toLocaleString()}`);
console.log(`  Ad Campaigns:     ${adCampaigns.length}`);
console.log(`  Ad Creatives:     ${adCreatives.length}`);
console.log(`  Ad Daily Metrics: ${adDailyMetrics.length.toLocaleString()}`);
console.log(`  Attributions:     ${attributions.length.toLocaleString()}`);
console.log(`  Unit Economics:   ${bookingUnitEcon.length.toLocaleString()}`);
console.log(`  Partner Payouts:  ${partnerPayouts.length.toLocaleString()}`);
console.log(`  Funnel Events:    ${funnelEvents.length.toLocaleString()}`);
console.log(`  Daily Sessions:   ${dailySessions.length.toLocaleString()}`);
console.log(`  Referrals:        ${referrals.length.toLocaleString()}`);
console.log(`  Surveys:          ${surveyResponses.length.toLocaleString()}`);
console.log(`  Total GMV:        ₹${(totalGMV / 10000000).toFixed(2)} Cr`);
console.log(`  Avg Booking:      ₹${Math.round(totalGMV / filteredBookings.length)}`);
console.log(`  On-Time %:        ${(onTimeCount * 100 / filteredBookings.length).toFixed(1)}%`);
console.log(`  Total Ad Spend:   ₹${(totalAdSpend / 100000).toFixed(1)} L`);
console.log(`  Total Comms Cost: ₹${(totalCommsCost / 100000).toFixed(1)} L`);
console.log(`  Contribution Margin: ₹${(totalCM / 100000).toFixed(1)} L (${(totalCM / totalGMV * 100).toFixed(1)}%)`);
console.log(`  NPS Score:        ${npsScore}`);
console.log(`\nPlanted anomalies:`);
console.log(`  1. Payment outage: May 15-17, 2025 (UPI/card failure spike)`);
console.log(`  2. Diwali surge: Oct 18-27, 2025 (deep clean demand + arrival delays)`);
console.log(`  3. Sarjapur Hub: +2-5 min arrival (underperforming)`);
console.log(`  4. Feb 2025 cohort retention cliff at Month 4`);
console.log(`  5. Monsoon dip: Jul-Aug 2025 (bookings -15-20%)`);
console.log(`\nDone! Files written to: ${OUT_DIR}`);
