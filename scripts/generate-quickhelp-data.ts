/**
 * Generates enriched quick home-help dataset from raw Zomato Kaggle data.
 * Reframes food delivery as on-demand house help:
 *   - Orders → Bookings
 *   - Delivery partners → Service partners / Helpers
 *   - Order types → Service types (cleaning, mopping, dishes, etc.)
 *   - Delivery time → Arrival time (10-min SLA)
 *   - New: service_duration, expected_arrival, assigned_at
 *
 * Input:  data/csv/zomato_raw.csv  (45K rows from Kaggle)
 * Output: data/csv/bookings.csv, partner_shifts.csv, campaigns.csv, customers.csv
 *
 * Usage: npx tsx scripts/generate-quickhelp-data.ts
 */

import { parse } from "csv-parse/sync";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

// ── Paths ──
const RAW_PATH = resolve(__dirname, "../data/csv/zomato_raw.csv");
const OUT_DIR = resolve(__dirname, "../data/csv");

// ── Deterministic seeded random ──
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

// ── Read raw data ──
console.log("Reading raw Zomato data (used as base signal for geo + partner patterns)...");
const rawCsv = readFileSync(RAW_PATH, "utf-8");
const rawRows: Record<string, string>[] = parse(rawCsv, {
  columns: true,
  skip_empty_lines: true,
  trim: true,
});
console.log(`  ${rawRows.length} raw rows loaded`);

// ══════════════════════════════════════════════════════════
// SERVICE CATALOG — Snabbit home-help services
// ══════════════════════════════════════════════════════════

// Tier → services, duration, price range
interface ServiceDef {
  name: string;
  tier: "quick" | "standard" | "extended" | "premium";
  duration_min: number;     // typical service duration
  price_min: number;
  price_max: number;
  price_mean: number;
  price_std: number;
}

const SERVICE_CATALOG: ServiceDef[] = [
  // Quick tasks (30 min) — ~25% of bookings
  { name: "Dishes & Utensils", tier: "quick", duration_min: 30, price_min: 149, price_max: 299, price_mean: 199, price_std: 30 },
  { name: "Dusting", tier: "quick", duration_min: 30, price_min: 149, price_max: 249, price_mean: 179, price_std: 25 },
  { name: "Folding & Organizing", tier: "quick", duration_min: 30, price_min: 149, price_max: 299, price_mean: 199, price_std: 30 },
  { name: "Ironing", tier: "quick", duration_min: 30, price_min: 149, price_max: 299, price_mean: 219, price_std: 30 },

  // Standard tasks (60 min) — ~40% of bookings
  { name: "Sweeping & Mopping", tier: "standard", duration_min: 60, price_min: 299, price_max: 499, price_mean: 349, price_std: 40 },
  { name: "Kitchen Cleaning", tier: "standard", duration_min: 60, price_min: 299, price_max: 499, price_mean: 379, price_std: 40 },
  { name: "Bathroom Cleaning", tier: "standard", duration_min: 60, price_min: 299, price_max: 499, price_mean: 399, price_std: 40 },
  { name: "Chopping & Kitchen Prep", tier: "standard", duration_min: 60, price_min: 299, price_max: 449, price_mean: 349, price_std: 35 },
  { name: "Laundry", tier: "standard", duration_min: 60, price_min: 299, price_max: 499, price_mean: 369, price_std: 40 },
  { name: "Window Cleaning", tier: "standard", duration_min: 60, price_min: 299, price_max: 449, price_mean: 349, price_std: 35 },

  // Extended tasks (90 min) — ~20% of bookings
  { name: "Full House Cleaning", tier: "extended", duration_min: 90, price_min: 449, price_max: 699, price_mean: 549, price_std: 50 },
  { name: "Kitchen Cabinet Cleaning", tier: "extended", duration_min: 90, price_min: 399, price_max: 699, price_mean: 499, price_std: 50 },
  { name: "Fridge Surface Cleaning", tier: "extended", duration_min: 90, price_min: 399, price_max: 649, price_mean: 479, price_std: 50 },
  { name: "Fan Cleaning", tier: "extended", duration_min: 90, price_min: 399, price_max: 599, price_mean: 449, price_std: 40 },

  // Premium tasks (120 min) — ~15% of bookings
  { name: "Deep Cleaning", tier: "premium", duration_min: 120, price_min: 699, price_max: 1499, price_mean: 999, price_std: 150 },
  { name: "Move-in/Move-out Cleaning", tier: "premium", duration_min: 120, price_min: 799, price_max: 1499, price_mean: 1099, price_std: 150 },
  { name: "After-Party Clean", tier: "premium", duration_min: 120, price_min: 699, price_max: 1299, price_mean: 899, price_std: 120 },
  { name: "Complete Wardrobe Cleaning", tier: "premium", duration_min: 120, price_min: 699, price_max: 1199, price_mean: 849, price_std: 100 },
];

// Map raw order_type → service tier for distribution
// Meal (~55%) → standard, Snack (~20%) → quick, Drinks (~15%) → extended, Buffet (~10%) → premium
function mapToServiceTier(rawOrderType: string): "quick" | "standard" | "extended" | "premium" {
  const t = rawOrderType.toLowerCase().trim();
  if (t === "snack") return "quick";
  if (t === "meal") return "standard";
  if (t === "drinks") return "extended";
  if (t === "buffet") return "premium";
  return "standard";
}

function pickServiceFromTier(tier: "quick" | "standard" | "extended" | "premium"): ServiceDef {
  const options = SERVICE_CATALOG.filter(s => s.tier === tier);
  return pick(options);
}

function servicePrice(svc: ServiceDef): number {
  return clamp(Math.round(normalRand(svc.price_mean, svc.price_std)), svc.price_min, svc.price_max);
}

// ── Step 1: K-means clustering for hubs ──
// Use delivery locations (customer locations) as hub coverage areas
interface Point { lat: number; lng: number; }

function kMeans(points: Point[], k: number, iterations = 20) {
  const step = Math.floor(points.length / k);
  const centroids: Point[] = [];
  for (let i = 0; i < k; i++) {
    centroids.push({ ...points[i * step] });
  }
  const assignments = new Array(points.length).fill(0);
  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < points.length; i++) {
      let minDist = Infinity;
      for (let c = 0; c < k; c++) {
        const d = (points[i].lat - centroids[c].lat) ** 2 + (points[i].lng - centroids[c].lng) ** 2;
        if (d < minDist) { minDist = d; assignments[i] = c; }
      }
    }
    const sums = Array.from({ length: k }, () => ({ lat: 0, lng: 0, count: 0 }));
    for (let i = 0; i < points.length; i++) {
      sums[assignments[i]].lat += points[i].lat;
      sums[assignments[i]].lng += points[i].lng;
      sums[assignments[i]].count++;
    }
    for (let c = 0; c < k; c++) {
      if (sums[c].count > 0) {
        centroids[c].lat = sums[c].lat / sums[c].count;
        centroids[c].lng = sums[c].lng / sums[c].count;
      }
    }
  }
  return { assignments, centroids };
}

// Cluster on delivery (customer) locations
const custPoints: Point[] = rawRows.map(r => ({
  lat: parseFloat(r.Delivery_location_latitude) || 0,
  lng: parseFloat(r.Delivery_location_longitude) || 0,
}));

const NUM_HUBS = 18;
console.log(`Clustering into ${NUM_HUBS} service hubs...`);
const { assignments: hubAssignments, centroids: _hubCentroids } = kMeans(custPoints, NUM_HUBS);

const HUB_NAMES = [
  "Koramangala Hub", "Indiranagar Hub", "Whitefield Hub", "HSR Layout Hub",
  "Electronic City Hub", "Jayanagar Hub", "MG Road Hub", "Rajajinagar Hub",
  "Marathahalli Hub", "Hebbal Hub", "JP Nagar Hub", "Banashankari Hub",
  "Malleswaram Hub", "Yelahanka Hub", "Sarjapur Hub", "BTM Layout Hub",
  "Peenya Hub", "Basavanagudi Hub",
];

const AREAS = [
  "South Bangalore", "East Bangalore", "East Bangalore", "South Bangalore",
  "South Bangalore", "South Bangalore", "Central Bangalore", "West Bangalore",
  "East Bangalore", "North Bangalore", "South Bangalore", "South Bangalore",
  "West Bangalore", "North Bangalore", "East Bangalore", "South Bangalore",
  "West Bangalore", "South Bangalore",
];

// ══════════════════════════════════════════════════════════
// CAMPAIGNS — reframed for home help
// ══════════════════════════════════════════════════════════

interface Campaign {
  campaign_id: number;
  campaign_name: string;
  campaign_type: string;
  discount_pct: number;
  start_date: string;
  end_date: string;
  city: string | null;
  budget_inr: number;
}

const CAMPAIGNS: Campaign[] = [
  { campaign_id: 1, campaign_name: "Independence Day Home Refresh", campaign_type: "discount", discount_pct: 15, start_date: "2024-08-13", end_date: "2024-08-17", city: null, budget_inr: 200000 },
  { campaign_id: 2, campaign_name: "Monsoon Clean-Up", campaign_type: "free_visit", discount_pct: 0, start_date: "2024-08-20", end_date: "2024-09-05", city: null, budget_inr: 300000 },
  { campaign_id: 3, campaign_name: "Onam Home Makeover", campaign_type: "discount", discount_pct: 20, start_date: "2024-09-10", end_date: "2024-09-16", city: "Metropolitian", budget_inr: 150000 },
  { campaign_id: 4, campaign_name: "Back to Routine", campaign_type: "cashback", discount_pct: 10, start_date: "2024-09-15", end_date: "2024-09-30", city: "Metropolitian", budget_inr: 250000 },
  { campaign_id: 5, campaign_name: "Navratri Sparkle", campaign_type: "discount", discount_pct: 15, start_date: "2024-10-03", end_date: "2024-10-12", city: null, budget_inr: 200000 },
  { campaign_id: 6, campaign_name: "Dussehra Deep Clean", campaign_type: "free_visit", discount_pct: 0, start_date: "2024-10-10", end_date: "2024-10-14", city: null, budget_inr: 180000 },
  { campaign_id: 7, campaign_name: "Diwali Deep Clean", campaign_type: "discount", discount_pct: 30, start_date: "2024-10-25", end_date: "2024-11-05", city: null, budget_inr: 500000 },
  { campaign_id: 8, campaign_name: "Post-Diwali Reset", campaign_type: "cashback", discount_pct: 10, start_date: "2024-11-06", end_date: "2024-11-15", city: null, budget_inr: 100000 },
  { campaign_id: 9, campaign_name: "Children's Day Special", campaign_type: "discount", discount_pct: 15, start_date: "2024-11-14", end_date: "2024-11-16", city: null, budget_inr: 80000 },
  { campaign_id: 10, campaign_name: "Weekend Refresh", campaign_type: "free_visit", discount_pct: 0, start_date: "2024-11-22", end_date: "2024-11-24", city: "Urban", budget_inr: 120000 },
  { campaign_id: 11, campaign_name: "Black Friday Home Sale", campaign_type: "discount", discount_pct: 25, start_date: "2024-11-29", end_date: "2024-12-01", city: null, budget_inr: 200000 },
  { campaign_id: 12, campaign_name: "Winter Wellness", campaign_type: "cashback", discount_pct: 10, start_date: "2024-12-01", end_date: "2024-12-15", city: null, budget_inr: 250000 },
  { campaign_id: 13, campaign_name: "Christmas Party Clean", campaign_type: "discount", discount_pct: 20, start_date: "2024-12-22", end_date: "2024-12-26", city: null, budget_inr: 300000 },
  { campaign_id: 14, campaign_name: "New Year Fresh Start", campaign_type: "discount", discount_pct: 25, start_date: "2024-12-28", end_date: "2025-01-02", city: null, budget_inr: 400000 },
  { campaign_id: 15, campaign_name: "New Year Resolution Clean", campaign_type: "cashback", discount_pct: 10, start_date: "2025-01-03", end_date: "2025-01-10", city: "Metropolitian", budget_inr: 150000 },
  { campaign_id: 16, campaign_name: "Republic Day Offer", campaign_type: "discount", discount_pct: 20, start_date: "2025-01-24", end_date: "2025-01-28", city: null, budget_inr: 200000 },
  { campaign_id: 17, campaign_name: "Referral Drive Aug", campaign_type: "referral", discount_pct: 0, start_date: "2024-08-01", end_date: "2024-08-31", city: null, budget_inr: 350000 },
  { campaign_id: 18, campaign_name: "Referral Drive Oct", campaign_type: "referral", discount_pct: 0, start_date: "2024-10-01", end_date: "2024-10-31", city: null, budget_inr: 350000 },
  { campaign_id: 19, campaign_name: "Quick Task Discount", campaign_type: "discount", discount_pct: 20, start_date: "2024-09-20", end_date: "2024-09-25", city: null, budget_inr: 100000 },
  { campaign_id: 20, campaign_name: "Premium Clean Week", campaign_type: "discount", discount_pct: 15, start_date: "2024-11-08", end_date: "2024-11-12", city: "Metropolitian", budget_inr: 120000 },
  { campaign_id: 21, campaign_name: "Late Night Helper", campaign_type: "free_visit", discount_pct: 0, start_date: "2024-12-15", end_date: "2024-12-21", city: "Metropolitian", budget_inr: 80000 },
  { campaign_id: 22, campaign_name: "Pongal Home Prep", campaign_type: "discount", discount_pct: 15, start_date: "2025-01-13", end_date: "2025-01-17", city: null, budget_inr: 150000 },
  { campaign_id: 23, campaign_name: "Lohri Celebration Clean", campaign_type: "cashback", discount_pct: 10, start_date: "2025-01-13", end_date: "2025-01-14", city: "Semi-Urban", budget_inr: 60000 },
  { campaign_id: 24, campaign_name: "Move-in Season Special", campaign_type: "discount", discount_pct: 10, start_date: "2025-01-28", end_date: "2025-01-31", city: null, budget_inr: 100000 },
  { campaign_id: 25, campaign_name: "Free Visit Weekends", campaign_type: "free_visit", discount_pct: 0, start_date: "2024-10-05", end_date: "2024-10-20", city: "Semi-Urban", budget_inr: 90000 },
];

// ══════════════════════════════════════════════════════════
// CUSTOMER POOL
// ══════════════════════════════════════════════════════════

const NUM_CUSTOMERS = 12000;
const customerWeights: number[] = [];
for (let i = 0; i < NUM_CUSTOMERS; i++) {
  customerWeights.push(1 / Math.pow(i + 1, 0.8));
}
const totalCustWeight = customerWeights.reduce((a, b) => a + b, 0);
const customerCdf: number[] = [];
let cumWeight = 0;
for (const w of customerWeights) {
  cumWeight += w / totalCustWeight;
  customerCdf.push(cumWeight);
}
function pickCustomerId(): number {
  const r = rand();
  for (let i = 0; i < customerCdf.length; i++) {
    if (r <= customerCdf[i]) return i + 1;
  }
  return NUM_CUSTOMERS;
}

// ══════════════════════════════════════════════════════════
// DATE & TIME UTILITIES
// ══════════════════════════════════════════════════════════

const TARGET_MONTHS = [
  { year: 2024, month: 8, mult: 0.9, label: "Aug" },
  { year: 2024, month: 9, mult: 0.95, label: "Sep" },
  { year: 2024, month: 10, mult: 1.3, label: "Oct" },   // Diwali deep clean surge
  { year: 2024, month: 11, mult: 1.2, label: "Nov" },
  { year: 2024, month: 12, mult: 1.15, label: "Dec" },   // holiday guests
  { year: 2025, month: 1, mult: 0.95, label: "Jan" },
];

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}
function dayOfWeek(y: number, m: number, d: number): number {
  return new Date(y, m - 1, d).getDay();
}
function dateStr(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Generate a booking time (hour:minute) — peak hours 8-11am and 5-8pm
function generateBookingTime(): string {
  // Bimodal: morning peak (8-11) and evening peak (17-20)
  const isMorning = rand() < 0.55;
  let hour: number;
  if (isMorning) {
    hour = randInt(7, 12);
  } else {
    hour = randInt(16, 21);
  }
  const minute = pick([0, 0, 15, 30, 30, 45]);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

// ══════════════════════════════════════════════════════════
// PAYMENT
// ══════════════════════════════════════════════════════════

const PAYMENT_METHODS = ["upi", "card", "wallet", "cod"];
const PAYMENT_WEIGHTS = [45, 25, 20, 10];

function isPaymentOutageDate(d: string): boolean {
  return d >= "2024-10-15" && d <= "2024-10-17";
}

function paymentStatus(method: string, date: string): string {
  if (isPaymentOutageDate(date)) {
    if (method === "upi" || method === "card") {
      return rand() < 0.18 ? "failed" : (rand() < 0.03 ? "pending" : "success");
    }
  }
  const r = rand();
  if (r < 0.025) return "failed";
  if (r < 0.035) return "pending";
  return "success";
}

// ══════════════════════════════════════════════════════════
// CAMPAIGN MATCHING
// ══════════════════════════════════════════════════════════

function matchCampaign(date: string, city: string): number | null {
  const matching = CAMPAIGNS.filter(c => {
    if (date < c.start_date || date > c.end_date) return false;
    if (c.city && c.city !== city) return false;
    return true;
  });
  if (matching.length === 0) return null;
  if (rand() < 0.4) return pick(matching).campaign_id;
  return null;
}

// ══════════════════════════════════════════════════════════
// GENERATE BOOKINGS
// ══════════════════════════════════════════════════════════

console.log("Generating bookings...");

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
  assigned_at: string;          // time partner was dispatched
  arrived_at: string;           // time partner reached customer
  arrival_time_min: number;     // minutes from booking to arrival (SLA = 10 min)
  expected_arrival_min: number; // SLA target
  on_time: boolean;             // arrived within expected
  weather: string;
  traffic_density: string;
  back_to_back: number;         // consecutive bookings for this partner
  festival: string;
  payment_method: string;
  payment_status: string;
  is_first_booking: boolean;
  rescheduled: boolean;
  partner_reassigned: boolean;
  campaign_id: number | null;
}

const bookings: BookingRow[] = [];
const customerFirstBooking = new Map<number, string>();
const customerBookingCount = new Map<number, number>();
let bookingId = 1;

for (const tm of TARGET_MONTHS) {
  const maxDay = daysInMonth(tm.year, tm.month);
  const sampleSize = Math.round(42000 * tm.mult);

  for (let s = 0; s < sampleSize; s++) {
    const rawIdx = Math.floor(rand() * rawRows.length);
    const raw = rawRows[rawIdx];
    const hubIdx = hubAssignments[rawIdx];

    const day = randInt(1, maxDay);
    const date = dateStr(tm.year, tm.month, day);
    const dow = dayOfWeek(tm.year, tm.month, day);
    const isWeekend = dow === 0 || dow === 6;

    // Map raw order type to service tier
    const rawOt = (raw.Type_of_order || "Meal").trim();
    const tier = mapToServiceTier(rawOt);

    // December: more weekend premium bookings (holiday guests cleaning)
    if (tm.month === 12) {
      if ((tier === "standard" || tier === "quick") && !isWeekend && rand() < 0.12) continue;
    } else {
      // Normal: slight weekday boost (working professionals)
      if (tier === "standard" && isWeekend && rand() < 0.05) continue;
    }

    const isDiwali = date >= "2024-10-25" && date <= "2024-11-05";
    const service = pickServiceFromTier(tier);
    const custId = pickCustomerId();
    const payMethod = weightedPick(PAYMENT_METHODS, PAYMENT_WEIGHTS);
    const payStat = paymentStatus(payMethod, date);

    // Arrival time — base from raw delivery time, scaled down to 10-min SLA context
    // Raw delivery times are 15-50 min; we scale to 6-18 min range (home help arrives faster)
    const rawDeliveryMin = parseInt(raw["Time_taken (min)"] || "30") || 30;
    let arrivalMin = Math.round(clamp(rawDeliveryMin * 0.35, 5, 20));

    // Expected arrival is ~10 min (SLA), with hub-distance variance
    const expectedArrival = randInt(8, 12);

    // HSR Layout and Electronic City: +3-6 min (underperforming hubs)
    if (hubIdx === 3 || hubIdx === 4) {
      arrivalMin += randInt(3, 6);
    }
    // Diwali: partners stretched, +4-8 min
    if (isDiwali) {
      arrivalMin += randInt(3, 7);
    }

    const onTime = arrivalMin <= expectedArrival;

    // Booking time and assignment time
    const bookTime = generateBookingTime();
    // Partner assigned 1-3 min after booking
    const assignDelay = randInt(1, 3);
    const bookHour = parseInt(bookTime.split(":")[0]);
    const bookMinute = parseInt(bookTime.split(":")[1]);
    const assignTotalMin = bookHour * 60 + bookMinute + assignDelay;
    const assignHour = Math.floor(assignTotalMin / 60) % 24;
    const assignMinute = assignTotalMin % 60;
    const assignedAt = `${String(assignHour).padStart(2, "0")}:${String(assignMinute).padStart(2, "0")}`;

    // Arrival time
    const arrivalTotalMin = assignTotalMin + arrivalMin;
    const arrivalHour = Math.floor(arrivalTotalMin / 60) % 24;
    const arrivalMinute = arrivalTotalMin % 60;
    const arrivedAt = `${String(arrivalHour).padStart(2, "0")}:${String(arrivalMinute).padStart(2, "0")}`;

    // Reschedule: ~3% baseline, higher for premium
    const rescheduled = rand() < (tier === "premium" ? 0.06 : 0.03);
    // Partner reassignment: ~5% baseline, higher during Diwali
    const reassigned = rand() < (isDiwali ? 0.12 : 0.05);

    // Track first booking
    const prevFirst = customerFirstBooking.get(custId);
    if (!prevFirst || date < prevFirst) customerFirstBooking.set(custId, date);
    customerBookingCount.set(custId, (customerBookingCount.get(custId) || 0) + 1);

    bookings.push({
      booking_id: bookingId++,
      booking_date: date,
      booking_time: bookTime,
      customer_id: custId,
      customer_lat: parseFloat(raw.Delivery_location_latitude) || 0,
      customer_lng: parseFloat(raw.Delivery_location_longitude) || 0,
      service_type: service.name,
      service_tier: tier,
      service_duration_min: service.duration_min,
      booking_value: servicePrice(service),
      hub_id: hubIdx + 1,
      hub_name: HUB_NAMES[hubIdx],
      area: AREAS[hubIdx],
      city: (raw.City || "Metropolitian").trim(),
      partner_id: (raw.Delivery_person_ID || `PARTNER${randInt(1, 1200)}`).trim(),
      partner_age: parseInt(raw.Delivery_person_Age) || randInt(20, 45),
      partner_rating: parseFloat(raw.Delivery_person_Ratings) || 4.0,
      assigned_at: assignedAt,
      arrived_at: arrivedAt,
      arrival_time_min: arrivalMin,
      expected_arrival_min: expectedArrival,
      on_time: onTime,
      weather: (raw.Weather_conditions || "Sunny").trim(),
      traffic_density: (raw.Road_traffic_density || "Medium").trim(),
      back_to_back: parseInt(raw.multiple_deliveries) || 0,
      festival: isDiwali ? "Diwali" : (raw.Festival || "No").trim(),
      payment_method: payMethod,
      payment_status: payStat,
      is_first_booking: false, // fixed in second pass
      rescheduled,
      partner_reassigned: reassigned,
      campaign_id: matchCampaign(date, (raw.City || "Metropolitian").trim()),
    });
  }
}

// Diwali spike: extra bookings (deep clean surge)
const diwaliBase = bookings.filter(b => b.booking_date >= "2024-10-25" && b.booking_date <= "2024-11-05");
const extraDiwali = Math.round(diwaliBase.length * 0.8);
console.log(`  Adding ${extraDiwali} extra Diwali bookings...`);
for (let i = 0; i < extraDiwali; i++) {
  const base = diwaliBase[Math.floor(rand() * diwaliBase.length)];
  const day = randInt(25, 31);
  const date = dateStr(2024, 10, day);
  // Diwali extras skew toward premium/extended (deep cleaning)
  const tier = rand() < 0.5 ? "premium" : "extended";
  const svc = pickServiceFromTier(tier);

  bookings.push({
    ...base,
    booking_id: bookingId++,
    booking_date: date,
    customer_id: pickCustomerId(),
    service_type: svc.name,
    service_tier: tier,
    service_duration_min: svc.duration_min,
    booking_value: servicePrice(svc),
    arrival_time_min: base.arrival_time_min + randInt(2, 5),
    on_time: false, // most Diwali extras are late
    payment_method: weightedPick(PAYMENT_METHODS, PAYMENT_WEIGHTS),
    payment_status: paymentStatus(weightedPick(PAYMENT_METHODS, PAYMENT_WEIGHTS), date),
    campaign_id: 7,
    is_first_booking: false,
    partner_reassigned: rand() < 0.15,
  });
}

// Sort by date
bookings.sort((a, b) => a.booking_date.localeCompare(b.booking_date));

// Fix is_first_booking
const custFirstSeen = new Map<number, string>();
for (const b of bookings) {
  const seen = custFirstSeen.get(b.customer_id);
  if (!seen || b.booking_date < seen) custFirstSeen.set(b.customer_id, b.booking_date);
}
for (const b of bookings) {
  b.is_first_booking = b.booking_date === custFirstSeen.get(b.customer_id)!;
}

// Retention cliff: Aug cohort drops after Month 3
const augCustomers = new Set<number>();
for (const b of bookings) {
  if (b.booking_date.startsWith("2024-08")) augCustomers.add(b.customer_id);
}
const filtered: BookingRow[] = [];
for (const b of bookings) {
  if (augCustomers.has(b.customer_id) && b.booking_date >= "2024-11-01" && !b.is_first_booking) {
    if (rand() < 0.40) continue;
  }
  filtered.push(b);
}
for (let i = 0; i < filtered.length; i++) filtered[i].booking_id = i + 1;

console.log(`  Total bookings: ${filtered.length}`);

// ══════════════════════════════════════════════════════════
// PARTNER SHIFTS
// ══════════════════════════════════════════════════════════

console.log("Generating partner shifts...");

const partnerIds = [...new Set(filtered.map(b => b.partner_id))];
const partnerHubCount = new Map<string, Map<number, number>>();
for (const b of filtered) {
  if (!partnerHubCount.has(b.partner_id)) partnerHubCount.set(b.partner_id, new Map());
  const hm = partnerHubCount.get(b.partner_id)!;
  hm.set(b.hub_id, (hm.get(b.hub_id) || 0) + 1);
}
const partnerPrimaryHub = new Map<string, number>();
for (const [pid, hm] of partnerHubCount) {
  let maxHub = 1, maxCount = 0;
  for (const [h, c] of hm) { if (c > maxCount) { maxCount = c; maxHub = h; } }
  partnerPrimaryHub.set(pid, maxHub);
}

const partnerDateBookings = new Map<string, Map<string, number>>();
for (const b of filtered) {
  if (!partnerDateBookings.has(b.partner_id)) partnerDateBookings.set(b.partner_id, new Map());
  const dm = partnerDateBookings.get(b.partner_id)!;
  dm.set(b.booking_date, (dm.get(b.booking_date) || 0) + 1);
}

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

const shifts: ShiftRow[] = [];
let shiftId = 1;

for (const pid of partnerIds) {
  const dateMap = partnerDateBookings.get(pid) || new Map();
  const hub = partnerPrimaryHub.get(pid) || 1;

  for (const [date, count] of dateMap) {
    const bookingsAssigned = Math.max(count, randInt(3, 8));
    const shiftHours = pick([4, 6, 8]);
    const startHour = randInt(7, 20 - shiftHours);
    shifts.push({
      shift_id: shiftId++,
      partner_id: pid,
      shift_date: date,
      hub_id: hub,
      status: "served",
      bookings_assigned: bookingsAssigned,
      bookings_completed: count,
      shift_start: `${String(startHour).padStart(2, "0")}:00`,
      shift_hours: shiftHours,
    });
  }

  // Skipped/canceled shifts (~25% extra)
  const numExtra = Math.round(dateMap.size * 0.25);
  for (let e = 0; e < numExtra; e++) {
    const tm = pick(TARGET_MONTHS);
    const day = randInt(1, daysInMonth(tm.year, tm.month));
    const date = dateStr(tm.year, tm.month, day);
    const isDiwali = date >= "2024-10-25" && date <= "2024-11-05";
    shifts.push({
      shift_id: shiftId++,
      partner_id: pid,
      shift_date: date,
      hub_id: hub,
      status: isDiwali ? (rand() < 0.65 ? "skipped" : "canceled") : (rand() < 0.6 ? "skipped" : "canceled"),
      bookings_assigned: randInt(3, 8),
      bookings_completed: 0,
      shift_start: `${String(randInt(7, 18)).padStart(2, "0")}:00`,
      shift_hours: pick([4, 6, 8]),
    });
  }
}

// Extra skips for underperforming hubs
const underperformingHubs = [4, 5];
const underperformingPartners = partnerIds.filter(
  pid => underperformingHubs.includes(partnerPrimaryHub.get(pid) || 0)
);
for (const pid of underperformingPartners) {
  const extraSkips = randInt(5, 12);
  for (let i = 0; i < extraSkips; i++) {
    const tm = pick(TARGET_MONTHS);
    const day = randInt(1, daysInMonth(tm.year, tm.month));
    shifts.push({
      shift_id: shiftId++,
      partner_id: pid,
      shift_date: dateStr(tm.year, tm.month, day),
      hub_id: partnerPrimaryHub.get(pid) || 4,
      status: rand() < 0.7 ? "skipped" : "canceled",
      bookings_assigned: randInt(3, 6),
      bookings_completed: 0,
      shift_start: `${String(randInt(7, 18)).padStart(2, "0")}:00`,
      shift_hours: pick([4, 6]),
    });
  }
}

console.log(`  Total shifts: ${shifts.length}`);

// ══════════════════════════════════════════════════════════
// CUSTOMERS TABLE
// ══════════════════════════════════════════════════════════

console.log("Generating customers...");

interface CustomerRow {
  customer_id: number;
  signup_date: string;
  city: string;
  preferred_payment: string;
  is_active: boolean;
}

const custCities = new Map<number, string>();
const custPayments = new Map<number, string>();
for (const b of filtered) {
  if (!custCities.has(b.customer_id)) custCities.set(b.customer_id, b.city);
  if (!custPayments.has(b.customer_id)) custPayments.set(b.customer_id, b.payment_method);
}

const customers: CustomerRow[] = [];
const allCustIds = new Set(filtered.map(b => b.customer_id));

for (const cid of allCustIds) {
  const firstBooking = custFirstSeen.get(cid) || "2024-08-01";
  const fo = new Date(firstBooking);
  fo.setDate(fo.getDate() - randInt(1, 30));
  const signupDate = fo.toISOString().slice(0, 10);
  const lastBooking = filtered
    .filter(b => b.customer_id === cid)
    .sort((a, b) => b.booking_date.localeCompare(a.booking_date))[0]?.booking_date || "2024-08-01";
  const isActive = lastBooking >= "2024-12-01";

  customers.push({
    customer_id: cid,
    signup_date: signupDate,
    city: custCities.get(cid) || "Metropolitian",
    preferred_payment: custPayments.get(cid) || "upi",
    is_active: isActive,
  });
}

console.log(`  Total customers: ${customers.length}`);

// ══════════════════════════════════════════════════════════
// WRITE OUTPUT
// ══════════════════════════════════════════════════════════

console.log("\nWriting output files...");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toCsv(rows: any[]): string {
  if (rows.length === 0) return "";
  const keys = Object.keys(rows[0]);
  const header = keys.join(",");
  const lines = rows.map(r =>
    keys.map(k => {
      const v = r[k];
      if (v === null || v === undefined) return "";
      if (typeof v === "string" && (v.includes(",") || v.includes('"'))) {
        return `"${v.replace(/"/g, '""')}"`;
      }
      return String(v);
    }).join(",")
  );
  return header + "\n" + lines.join("\n") + "\n";
}

writeFileSync(resolve(OUT_DIR, "bookings.csv"), toCsv(filtered));
console.log(`  bookings.csv: ${filtered.length} rows`);

writeFileSync(resolve(OUT_DIR, "partner_shifts.csv"), toCsv(shifts));
console.log(`  partner_shifts.csv: ${shifts.length} rows`);

writeFileSync(resolve(OUT_DIR, "campaigns.csv"), toCsv(CAMPAIGNS));
console.log(`  campaigns.csv: ${CAMPAIGNS.length} rows`);

writeFileSync(resolve(OUT_DIR, "customers.csv"), toCsv(customers));
console.log(`  customers.csv: ${customers.length} rows`);

// ══════════════════════════════════════════════════════════
// SUMMARY
// ══════════════════════════════════════════════════════════

const totalGMV = filtered.reduce((s, b) => s + b.booking_value, 0);
const uniqueCustomers = allCustIds.size;
const uniquePartners = new Set(filtered.map(b => b.partner_id)).size;
const onTimeCount = filtered.filter(b => b.on_time).length;
const successCount = filtered.filter(b => b.payment_status === "success").length;
const failedCount = filtered.filter(b => b.payment_status === "failed").length;
const rescheduledCount = filtered.filter(b => b.rescheduled).length;
const reassignedCount = filtered.filter(b => b.partner_reassigned).length;

// Service mix
const tierCounts: Record<string, number> = {};
for (const b of filtered) tierCounts[b.service_tier] = (tierCounts[b.service_tier] || 0) + 1;

console.log("\n=== Dataset Summary ===");
console.log(`  Bookings:       ${filtered.length.toLocaleString()}`);
console.log(`  Customers:      ${uniqueCustomers.toLocaleString()}`);
console.log(`  Partners:       ${uniquePartners.toLocaleString()}`);
console.log(`  Hubs:           ${NUM_HUBS}`);
console.log(`  Campaigns:      ${CAMPAIGNS.length}`);
console.log(`  Shifts:         ${shifts.length.toLocaleString()}`);
console.log(`  Total GMV:      INR ${(totalGMV / 10000000).toFixed(2)} Cr`);
console.log(`  Avg Booking:    INR ${Math.round(totalGMV / filtered.length)}`);
console.log(`  On-Time %:      ${(onTimeCount * 100 / filtered.length).toFixed(1)}%`);
console.log(`  Payment OK:     ${(successCount * 100 / filtered.length).toFixed(1)}%`);
console.log(`  Payment Fail:   ${(failedCount * 100 / filtered.length).toFixed(1)}%`);
console.log(`  Rescheduled:    ${(rescheduledCount * 100 / filtered.length).toFixed(1)}%`);
console.log(`  Reassigned:     ${(reassignedCount * 100 / filtered.length).toFixed(1)}%`);
console.log(`  Service Mix:    quick=${tierCounts.quick || 0}  standard=${tierCounts.standard || 0}  extended=${tierCounts.extended || 0}  premium=${tierCounts.premium || 0}`);
console.log(`  Date Range:     2024-08-01 to 2025-01-31`);
console.log(`\nService catalog: ${SERVICE_CATALOG.length} service types across 4 tiers`);
console.log(`\nPlanted anomalies:`);
console.log(`  1. Payment outage: Oct 15-17 (UPI/card failure spike)`);
console.log(`  2. Diwali surge: Oct 25 - Nov 5 (deep clean demand spike, arrival delays)`);
console.log(`  3. HSR/EC Hub: +3-6 min arrival, higher partner skip rates`);
console.log(`  4. Retention cliff: Aug cohort drops 40% after Month 3`);
console.log(`  5. December weekend flip: more premium weekend bookings (holiday guests)`);
console.log(`  6. Diwali partner reassignment spike: 12% vs 5% baseline`);
console.log(`\nDone! Files written to: ${OUT_DIR}`);
