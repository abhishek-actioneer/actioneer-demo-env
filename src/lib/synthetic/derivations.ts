/**
 * Cross-table derivations for the holistic business mock.
 *
 * Each function reads bookings__live rows added in the current tick window
 * (above bookingIdWatermark) plus any context from seed views, and emits
 * derived rows into the corresponding __live shard.
 *
 * Run by tick.ts in DAG order: bookings → economics, surveys, partner shifts,
 * comms, ads, payouts.
 */

import type { DuckDBConnection } from "@duckdb/node-api";
import { createRng } from "./rng";
import { sqlLiteral } from "./generators";

// ── booking_unit_economics (1:1 per new booking) ────────────────────────────
// Commission rates by service_tier (matches seed averages):
//   premium ~30-32%, extended ~28-30%, standard ~27-29%, quick ~25-27%
const COMMISSION_RATES: Record<string, [number, number]> = {
  premium: [0.30, 0.32],
  extended: [0.28, 0.30],
  standard: [0.27, 0.29],
  quick: [0.25, 0.27],
};

export async function deriveBookingEconomics(
  conn: DuckDBConnection,
  bookingIdWatermark: number,
  seed: number,
): Promise<number> {
  const r = await conn.run(`
    SELECT booking_id, booking_date, service_type, service_tier,
           payment_status, payment_method, booking_value, discount_pct, offer_type
    FROM bookings__live
    WHERE booking_id > ${bookingIdWatermark}
  `);
  const rows = await r.getRows();
  if (rows.length === 0) return 0;

  const rng = createRng(seed);
  const valueRows: string[] = [];
  for (const row of rows) {
    const bookingId = Number(row[0]);
    const bookingDate = formatDate(row[1]);
    const serviceType = String(row[2] ?? "");
    const tier = String(row[3] ?? "standard");
    const paymentStatus = String(row[4] ?? "");
    const paymentMethod = String(row[5] ?? "upi");
    const grossValue = Number(row[6] ?? 0);
    const discountPct = Number(row[7] ?? 0);
    const offerType = String(row[8] ?? "none");

    const [minRate, maxRate] = COMMISSION_RATES[tier] ?? [0.27, 0.29];
    const commissionRate = rng.float(minRate, maxRate, 4);
    const commissionEarned = round(grossValue * commissionRate, 2);
    const partnerPayout = round(grossValue - commissionEarned, 2);
    const paymentProcessingFee = paymentMethod === "card" ? round(grossValue * 0.018, 2) : paymentMethod === "wallet" ? round(grossValue * 0.012, 2) : 0;
    const gstOnCommission = round(commissionEarned * 0.18, 2);
    const promoDiscountFunded = offerType === "discount" || offerType === "cashback" ? round((grossValue * discountPct) / 100, 2) : 0;
    const referralRewardCost = offerType === "referral_bonus" ? 100 : 0;
    const supportCostAllocated = paymentStatus === "refunded" ? rng.float(15, 30, 2) : rng.float(5, 12, 2);
    const contributionMargin = round(commissionEarned - paymentProcessingFee - gstOnCommission - promoDiscountFunded - referralRewardCost - supportCostAllocated, 2);
    const cmPct = grossValue > 0 ? round(contributionMargin / grossValue, 4) : 0;

    valueRows.push(`(${bookingId}, '${bookingDate}', '${escape(serviceType)}', '${tier}', '${paymentStatus}', '${paymentMethod}', ${grossValue}, ${commissionRate}, ${commissionEarned}, ${partnerPayout}, ${paymentProcessingFee}, ${gstOnCommission}, ${promoDiscountFunded}, ${referralRewardCost}, ${supportCostAllocated}, ${contributionMargin}, ${cmPct})`);
  }

  return chunkInsert(conn, "raw_booking_unit_economics__live",
    "booking_id, booking_date, service_type, service_tier, payment_status, payment_method, gross_booking_value, commission_rate, commission_earned, partner_payout, payment_processing_fee, gst_on_commission, promo_discount_funded, referral_reward_cost, support_cost_allocated, contribution_margin, contribution_margin_pct",
    valueRows);
}

// ── partner_shifts (one row per partner-day with bookings) ──────────────────
export async function derivePartnerShifts(
  conn: DuckDBConnection,
  bookingIdWatermark: number,
  seed: number,
): Promise<number> {
  const r = await conn.run(`
    SELECT partner_id, booking_date, hub_id, COUNT(*) AS bookings_count, SUM(booking_value) AS gross
    FROM bookings__live
    WHERE booking_id > ${bookingIdWatermark}
    GROUP BY 1, 2, 3
  `);
  const rows = await r.getRows();
  if (rows.length === 0) return 0;

  const rng = createRng(seed);
  const watermarkR = await conn.run(`SELECT COALESCE(MAX(shift_id), 200000) FROM partner_shifts__live`);
  let nextId = Number((await watermarkR.getRows())[0][0]) + 1;
  if (nextId < 200_000) nextId = 200_000;

  const valueRows: string[] = [];
  for (const row of rows) {
    const partnerId = String(row[0] ?? "P0");
    const shiftDate = formatDate(row[1]);
    const hubId = Number(row[2] ?? 1);
    const bookingsCount = Number(row[3] ?? 0);
    const gross = Number(row[4] ?? 0);

    const completed = Math.max(1, Math.round(bookingsCount * rng.float(0.85, 0.98, 2)));
    const status = "served";
    const hours = Math.max(2, Math.min(10, bookingsCount + rng.int(1, 3)));
    const shiftStart = `0${rng.int(8, 11)}:00`.slice(-5);
    const earningsGross = round(gross * 0.72, 2);
    const commissionRate = rng.float(0.26, 0.30, 4);
    const incentive = bookingsCount >= 5 ? rng.float(50, 200, 2) : 0;
    const netEarnings = round(earningsGross + incentive, 2);

    valueRows.push(`(${nextId++}, '${partnerId}', '${shiftDate}', ${hubId}, '${status}', ${bookingsCount}, ${completed}, '${shiftStart}', ${hours}, ${earningsGross}, ${commissionRate}, ${incentive}, ${netEarnings})`);
  }

  return chunkInsert(conn, "partner_shifts__live",
    "shift_id, partner_id, shift_date, hub_id, status, bookings_assigned, bookings_completed, shift_start, shift_hours, earnings_gross, commission_rate, incentive_earned, net_earnings",
    valueRows);
}

// ── survey_responses (~20% of completed bookings) ────────────────────────────
export async function deriveSurveys(
  conn: DuckDBConnection,
  bookingIdWatermark: number,
  seed: number,
): Promise<number> {
  const r = await conn.run(`
    SELECT booking_id, customer_id, partner_id, booking_date, partner_rating, payment_status
    FROM bookings__live
    WHERE booking_id > ${bookingIdWatermark}
      AND payment_status = 'success'
  `);
  const rows = await r.getRows();
  if (rows.length === 0) return 0;

  const rng = createRng(seed);
  const watermarkR = await conn.run(`SELECT COALESCE(MAX(response_id), 100000) FROM raw_survey_responses__live`);
  let nextId = Number((await watermarkR.getRows())[0][0]) + 1;
  if (nextId < 100_000) nextId = 100_000;

  const valueRows: string[] = [];
  for (const row of rows) {
    if (!rng.bool(0.20)) continue;
    const bookingId = Number(row[0]);
    const customerId = Number(row[1]);
    const partnerId = String(row[2] ?? "P0");
    const bookingDate = formatDate(row[3]);
    const partnerRating = Number(row[4] ?? 4);

    const surveyType = rng.weighted([
      { value: "nps", weight: 50 },
      { value: "csat", weight: 30 },
      { value: "post_booking", weight: 20 },
    ]);
    // NPS: 0-10, biased toward partner rating; csat/post_booking: 1-5
    const score = surveyType === "nps"
      ? Math.max(0, Math.min(10, Math.round(partnerRating * 2 + rng.float(-1.5, 1.5, 1))))
      : Math.max(1, Math.min(5, Math.round(partnerRating + rng.float(-0.5, 0.5, 1))));
    const category = rng.weighted([
      { value: "service_quality", weight: 35 },
      { value: "value_for_money", weight: 25 },
      { value: "partner_behavior", weight: 20 },
      { value: "ease_of_booking", weight: 12 },
      { value: "app_experience", weight: 8 },
    ]);
    const submittedAt = `${bookingDate}T${String(rng.int(10, 22)).padStart(2, "0")}:00:00`;
    const timeToRespond = rng.float(2, 48, 1);

    valueRows.push(`(${nextId++}, ${customerId}, ${bookingId}, '${partnerId}', '${surveyType}', ${score}, '${category}', '${submittedAt}', ${timeToRespond})`);
  }

  return chunkInsert(conn, "raw_survey_responses__live",
    "response_id, customer_id, booking_id, partner_id, survey_type, score, category, submitted_at, time_to_respond_hours",
    valueRows);
}

// ── comms_sends (onboarding journeys + active campaigns) ────────────────────
const COMMS_CHANNELS_BY_TYPE: Record<string, string[]> = {
  onboarding: ["push", "email"],
  campaign: ["push", "sms", "email", "whatsapp"],
};
// Open/click/convert rates by channel
const CHANNEL_RATES: Record<string, { delivered: number; opened: number; clicked: number; converted: number; cost: number }> = {
  push: { delivered: 0.96, opened: 0.28, clicked: 0.12, converted: 0.04, cost: 0.05 },
  email: { delivered: 0.97, opened: 0.22, clicked: 0.08, converted: 0.03, cost: 0.10 },
  sms: { delivered: 0.99, opened: 1.0, clicked: 0.06, converted: 0.025, cost: 0.30 },
  whatsapp: { delivered: 0.95, opened: 0.55, clicked: 0.18, converted: 0.06, cost: 0.50 },
  in_app: { delivered: 1.0, opened: 0.45, clicked: 0.20, converted: 0.05, cost: 0.0 },
};

export async function deriveCommsSends(
  conn: DuckDBConnection,
  bookingIdWatermark: number,
  windowEnd: Date,
  seed: number,
): Promise<number> {
  // 1. New customers from this tick (first-time bookings) → enroll in onboarding journey
  // 2. Plus, for active campaigns matching today's date, send to ~5% of customer base
  const todayStr = formatDate(windowEnd);

  const newCustomersR = await conn.run(`
    SELECT DISTINCT customer_id, hub_id, ltv_bucket
    FROM bookings__live
    WHERE booking_id > ${bookingIdWatermark}
      AND is_first_booking = TRUE
  `);
  const newCustomers = await newCustomersR.getRows();

  const activeCampaignsR = await conn.run(`
    SELECT campaign_id, channels, target_segment, offer_type
    FROM campaigns_v2
    WHERE start_date <= DATE '${todayStr}' AND end_date >= DATE '${todayStr}'
  `);
  const campaigns = await activeCampaignsR.getRows();

  // Sample existing customer ids for engagement sends. Use a deterministic
  // ORDER BY hash() trick to get a stable, evenly-distributed sample.
  // ~1400 customers picked daily so total comms volume ≈ 10× bookings.
  const sampleCustsR = await conn.run(`
    SELECT customer_id, ltv_bucket FROM raw_customers
    ORDER BY hash(customer_id * ${seed})
    LIMIT 1500
  `);
  const sampledCusts = await sampleCustsR.getRows();

  // Fall back to "evergreen" templates if no campaigns are active for today.
  // We cycle through the most recent campaigns from seed so the offer/coupon
  // structure stays realistic. CRM dashboards want continuous activity.
  const evergreenR = await conn.run(`
    SELECT campaign_id, channels, target_segment, offer_type FROM campaigns_v2
    ORDER BY end_date DESC LIMIT 5
  `);
  const evergreen = await evergreenR.getRows();

  const rng = createRng(seed);
  const watermarkR = await conn.run(`SELECT COALESCE(MAX(send_id), 2000000) FROM raw_comms_sends__live`);
  let nextId = Number((await watermarkR.getRows())[0][0]) + 1;
  if (nextId < 2_000_000) nextId = 2_000_000;

  const valueRows: string[] = [];

  // (A) Onboarding sends: each new customer gets 2 onboarding messages today
  //     (subsequent journey steps fire on future ticks via the same logic)
  for (const cust of newCustomers) {
    const customerId = Number(cust[0]);
    const hubId = Number(cust[1] ?? 1);
    const ltvBucket = String(cust[2] ?? "low");
    for (const channel of COMMS_CHANNELS_BY_TYPE.onboarding) {
      valueRows.push(buildCommsRow({
        sendId: nextId++,
        customerId,
        channel,
        campaignId: null,
        journeyId: 1, // Welcome Series
        journeyStep: 1,
        templateName: `welcome_${channel}_step1`,
        sentAt: `${todayStr}T${String(rng.int(8, 20)).padStart(2, "0")}:${String(rng.int(0, 59)).padStart(2, "0")}:00`,
        userSegmentAtSend: "new",
        daysSinceLastBooking: 0,
        lifetimeBookingsAtSend: 1,
        predictedLtvBucket: ltvBucket,
        hubId,
        rng,
      }));
    }
  }

  // (B) Always-on engagement journeys: for each customer in our sample,
  //     fire one journey-style send today (not tied to a campaign).
  for (const cust of sampledCusts) {
    const customerId = Number(cust[0]);
    const ltvBucket = String(cust[1] ?? "medium");
    const channel = rng.weighted([
      { value: "push", weight: 50 },
      { value: "email", weight: 22 },
      { value: "whatsapp", weight: 15 },
      { value: "sms", weight: 8 },
      { value: "in_app", weight: 5 },
    ]);
    const journeyId = rng.weighted([
      { value: 2, weight: 30 },  // engagement
      { value: 3, weight: 25 },  // re-engagement
      { value: 4, weight: 20 },  // referral nudge
      { value: 5, weight: 15 },  // upsell
      { value: 6, weight: 10 },  // win-back
    ]);
    valueRows.push(buildCommsRow({
      sendId: nextId++,
      customerId,
      channel,
      campaignId: null,
      journeyId,
      journeyStep: rng.int(1, 3),
      templateName: `journey_${journeyId}_${channel}`,
      sentAt: `${todayStr}T${String(rng.int(8, 21)).padStart(2, "0")}:${String(rng.int(0, 59)).padStart(2, "0")}:00`,
      userSegmentAtSend: ltvBucket === "low" ? "active" : ltvBucket,
      daysSinceLastBooking: rng.int(0, 60),
      lifetimeBookingsAtSend: rng.int(1, 15),
      predictedLtvBucket: ltvBucket,
      hubId: rng.int(1, 5),
      rng,
    }));
  }

  // (C) Active campaign sends: for each active campaign × ~3% of customer pool.
  // If no campaigns are active today, use the 5 most recent from seed as
  // evergreen so dashboards still show campaign-level activity.
  const effectiveCampaigns = campaigns.length > 0 ? campaigns : evergreen;
  for (const camp of effectiveCampaigns) {
    const campaignId = Number(camp[0]);
    const channels = String(camp[1] ?? "push").split(",").map((s) => s.trim()).filter(Boolean);
    const offerType = String(camp[3] ?? "discount");
    const targetCount = Math.round(sampledCusts.length * 0.4); // ~3% of total customers per campaign per day
    const targets = sampledCusts.slice(0, targetCount);
    for (const cust of targets) {
      const customerId = Number(cust[0]);
      const ltvBucket = String(cust[1] ?? "medium");
      const channel = rng.choice(channels);
      if (!CHANNEL_RATES[channel]) continue;
      valueRows.push(buildCommsRow({
        sendId: nextId++,
        customerId,
        channel,
        campaignId,
        journeyId: null,
        journeyStep: 0,
        templateName: `campaign_${campaignId}_${channel}`,
        sentAt: `${todayStr}T${String(rng.int(9, 21)).padStart(2, "0")}:${String(rng.int(0, 59)).padStart(2, "0")}:00`,
        userSegmentAtSend: ltvBucket === "low" ? "active" : ltvBucket,
        daysSinceLastBooking: rng.int(1, 30),
        lifetimeBookingsAtSend: rng.int(1, 12),
        predictedLtvBucket: ltvBucket,
        hubId: rng.int(1, 5),
        rng,
        offerType,
      }));
    }
  }

  return chunkInsert(conn, "raw_comms_sends__live",
    "send_id, customer_id, channel, campaign_id, journey_id, journey_step, template_name, sent_at, delivered, opened, clicked, converted, timeToOpen, booking_id, send_cost_inr, time_to_open_min, ab_variant, frequency_cap_hit, coupon_code, user_segment_at_send, days_since_last_booking, lifetime_bookings_at_send, predicted_ltv_bucket, hub_id, unsubscribed",
    valueRows);
}

function buildCommsRow(p: {
  sendId: number; customerId: number; channel: string; campaignId: number | null;
  journeyId: number | null; journeyStep: number; templateName: string;
  sentAt: string; userSegmentAtSend: string; daysSinceLastBooking: number;
  lifetimeBookingsAtSend: number; predictedLtvBucket: string; hubId: number;
  rng: ReturnType<typeof createRng>; offerType?: string;
}): string {
  const rates = CHANNEL_RATES[p.channel];
  const delivered = p.rng.bool(rates.delivered);
  const opened = delivered && p.rng.bool(rates.opened);
  const clicked = opened && p.rng.bool(rates.clicked / Math.max(0.01, rates.opened));
  const converted = clicked && p.rng.bool(rates.converted / Math.max(0.01, rates.clicked));
  const cost = delivered ? rates.cost : 0;
  const timeToOpenMin = opened ? p.rng.int(2, 240) : null;
  const abVariant = p.rng.weighted([
    { value: "A", weight: 50 }, { value: "B", weight: 50 },
  ]);
  const couponCode = p.offerType === "discount" ? `SAVE${p.rng.int(10, 30)}` : null;
  return `(${p.sendId}, ${p.customerId}, '${p.channel}', ${p.campaignId ?? "NULL"}, ${p.journeyId ?? "NULL"}, ${p.journeyStep}, '${escape(p.templateName)}', '${p.sentAt}', ${sqlBool(delivered)}, ${sqlBool(opened)}, ${sqlBool(clicked)}, ${sqlBool(converted)}, ${sqlBool(opened)}, NULL, ${cost}, ${timeToOpenMin ?? "NULL"}, '${abVariant}', FALSE, ${couponCode ? `'${couponCode}'` : "NULL"}, '${p.userSegmentAtSend}', ${p.daysSinceLastBooking}, ${p.lifetimeBookingsAtSend}, '${p.predictedLtvBucket}', ${p.hubId}, FALSE)`;
}

// ── ad_daily_metrics (per creative × per day) ────────────────────────────────
export async function deriveAdMetrics(
  conn: DuckDBConnection,
  windowEnd: Date,
  baselineDate: Date,
  seed: number,
): Promise<number> {
  const todayStr = formatDate(windowEnd);
  const days = Math.max(0, Math.round((windowEnd.getTime() - baselineDate.getTime()) / 86_400_000));
  const growthMult = Math.pow(1.005, days);

  // Take a sample of seed creatives that ran historically, generate today's row for each
  const r = await conn.run(`
    SELECT DISTINCT ad_creative_id
    FROM raw_ad_daily_metrics_seed
    USING SAMPLE 15
  `);
  const creatives = await r.getRows();
  if (creatives.length === 0) return 0;

  const rng = createRng(seed);
  const valueRows: string[] = [];
  for (const row of creatives) {
    const creativeId = Number(row[0]);
    const impressions = Math.round(rng.int(50_000, 120_000) * growthMult * (rng.float(0.85, 1.15, 2)));
    const ctr = rng.float(0.010, 0.020, 4);
    const clicks = Math.round(impressions * ctr);
    const cpc = rng.float(3.5, 6.5, 2);
    const spend = round(clicks * cpc, 2);
    const installRate = rng.float(0.05, 0.10, 3);
    const installs = Math.round(clicks * installRate);
    const regs = Math.round(installs * rng.float(0.65, 0.80, 2));
    const firstBookings = Math.round(regs * rng.float(0.20, 0.35, 2));
    const cpi = installs > 0 ? round(spend / installs, 2) : 0;
    const cpfb = firstBookings > 0 ? round(spend / firstBookings, 2) : 0;
    const roas = round(rng.float(0.85, 1.45, 2), 2);

    valueRows.push(`('${todayStr}', ${creativeId}, ${impressions}, ${clicks}, ${spend}, ${installs}, ${regs}, ${firstBookings}, ${ctr}, ${cpc}, ${cpi}, ${cpfb}, ${roas})`);
  }

  return chunkInsert(conn, "raw_ad_daily_metrics__live",
    "date, ad_creative_id, impressions, clicks, spend_inr, installs, registrations, first_bookings, ctr, cpc_inr, cpi_inr, cpfb_inr, roas",
    valueRows);
}

// ── partner_payouts (Wednesday weekly roll-up) ──────────────────────────────
export async function derivePartnerPayouts(
  conn: DuckDBConnection,
  windowEnd: Date,
  seed: number,
): Promise<number> {
  // Only roll up on Wednesdays — payout date is T+3 from week-end (Sunday)
  if (windowEnd.getUTCDay() !== 3) return 0;

  const todayStr = formatDate(windowEnd);
  // Roll up shifts for the prior week (Mon-Sun)
  const r = await conn.run(`
    SELECT partner_id,
           SUM(bookings_completed) AS jobs,
           SUM(earnings_gross) AS gross,
           SUM(earnings_gross * commission_rate) AS commission,
           SUM(incentive_earned) AS incentive,
           SUM(net_earnings) AS net,
           AVG(commission_rate) AS avg_commission_rate
    FROM partner_shifts
    WHERE shift_date >= DATE '${todayStr}' - INTERVAL 10 DAY
      AND shift_date < DATE '${todayStr}' - INTERVAL 3 DAY
    GROUP BY partner_id
    HAVING SUM(bookings_completed) > 0
  `);
  const rows = await r.getRows();
  if (rows.length === 0) return 0;

  const rng = createRng(seed);
  const watermarkR = await conn.run(`SELECT COALESCE(MAX(payout_id), 50000) FROM raw_partner_payouts__live`);
  let nextId = Number((await watermarkR.getRows())[0][0]) + 1;
  if (nextId < 50_000) nextId = 50_000;

  // Compute the week range
  const weekStart = formatDate(new Date(windowEnd.getTime() - 9 * 86_400_000));
  const weekEnd = formatDate(new Date(windowEnd.getTime() - 3 * 86_400_000));

  // Inspect actual partner_payouts schema (column order matters)
  const cols = await columnsOf(conn, "raw_partner_payouts_seed");

  const valueRows: string[] = [];
  for (const row of rows) {
    const partnerId = String(row[0] ?? "P0");
    const jobs = Number(row[1] ?? 0);
    const gross = round(Number(row[2] ?? 0), 2);
    const commission = round(Number(row[3] ?? 0), 2);
    const incentive = round(Number(row[4] ?? 0), 2);
    const net = round(Number(row[5] ?? 0), 2);
    const penalty = rng.bool(0.05) ? round(rng.float(50, 200, 2), 2) : 0;

    // Build row matching the seed schema exactly. We don't know column order
    // a priori so we rely on a NULL-fill strategy — fields we don't know map to NULL.
    const filled = cols.map((c) => commonPayoutValue(c, {
      payout_id: nextId++,
      partner_id: partnerId,
      week_start: weekStart,
      week_end: weekEnd,
      payout_date: todayStr,
      jobs_completed: jobs,
      gross_earnings: gross,
      commission_paid: commission,
      incentive_paid: incentive,
      penalty_applied: penalty,
      net_payout: round(net - penalty, 2),
    }));
    valueRows.push(`(${filled.join(", ")})`);
  }

  return chunkInsert(conn, "raw_partner_payouts__live", cols.join(", "), valueRows);
}

function commonPayoutValue(col: string, vals: Record<string, unknown>): string {
  if (col in vals) return sqlLiteral(vals[col]);
  // common synonyms
  const synonyms: Record<string, string[]> = {
    payout_id: ["id"],
    week_start: ["week_start_date", "period_start"],
    week_end: ["week_end_date", "period_end"],
    payout_date: ["pay_date"],
    jobs_completed: ["bookings_completed", "completed_jobs"],
    gross_earnings: ["gross", "total_gross"],
    commission_paid: ["commission"],
    incentive_paid: ["incentive", "incentives"],
    penalty_applied: ["penalty", "penalties"],
    net_payout: ["net", "total_net"],
  };
  for (const [key, alts] of Object.entries(synonyms)) {
    if (alts.includes(col) && key in vals) return sqlLiteral(vals[key]);
  }
  return "NULL";
}

async function columnsOf(conn: DuckDBConnection, viewName: string): Promise<string[]> {
  const r = await conn.run(`SELECT * FROM ${viewName} LIMIT 0`);
  return r.columnNames();
}

// ── helpers ─────────────────────────────────────────────────────────────────
function round(n: number, places: number): number {
  const p = Math.pow(10, places);
  return Math.round(n * p) / p;
}

function escape(s: string): string {
  return s.replace(/'/g, "''");
}

function sqlBool(b: boolean): string {
  return b ? "TRUE" : "FALSE";
}

function formatDate(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "string") return v.slice(0, 10);
  if (typeof v === "object" && v !== null && "days" in (v as object)) {
    const days = Number((v as { days: number }).days);
    return new Date(days * 86_400_000).toISOString().slice(0, 10);
  }
  return String(v).slice(0, 10);
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
