/**
 * Synthesis plan for the quickhelp sample dataset.
 *
 * Day 1 scope: bookings only. Generates ~200 bookings/day matching observed
 * channel/service/hub distributions. Foreign keys point to existing customers
 * (we sample customer_ids from the seed).
 *
 * Future days (per plan doc):
 *   - funnel_events__live (with forward-carried D14/D30 cohorts)
 *   - comms_full__live, daily_sessions__live
 *   - summary table __live shards
 */

import type { SyntheticPlan } from "../types";

export const quickhelpSynthetic: SyntheticPlan = {
  datasetId: "quickhelp",
  enabled: true,
  cadence: { intervalHours: 24, syntheticHoursPerTick: 24 },

  tables: [
    {
      name: "bookings",
      mode: "generate",
      // Seed ends Feb 28 2026 with ~620 bookings/day. Synthetic continues with
      // +0.5%/day compound growth, weekly seasonality (weekend dip ~15%,
      // weekday peak ~10%), ±8% noise, 5% spike days at 1.25×.
      volume: {
        baselineRate: 620,
        growthRatePerDay: 0.005,
        noisePct: 0.08,
        spikeProbability: 0.05,
        spikeMultiplier: 1.25,
        minRows: 100,
      },
      idSpace: { column: "booking_id", startAt: 10_000_000 },
      columns: {
        // booking_id handled via idSpace
        booking_date: { kind: "tickWindow", granularity: "date" },
        booking_time: { kind: "tickWindow", granularity: "time" },
        booking_value: { kind: "uniformFloat", min: 199, max: 1599, precision: 2 },

        customer_id: { kind: "uniformInt", min: 1, max: 18000 },
        customer_lat: { kind: "uniformFloat", min: 12.85, max: 13.15, precision: 4 },
        customer_lng: { kind: "uniformFloat", min: 77.50, max: 77.75, precision: 4 },
        signup_date: { kind: "constant", value: "2025-06-01" }, // joined column; rough
        preferred_payment: {
          kind: "weightedChoice",
          choices: [
            { value: "upi", weight: 60 },
            { value: "card", weight: 20 },
            { value: "cash", weight: 12 },
            { value: "wallet", weight: 8 },
          ],
        },
        is_active: { kind: "boolean", trueProbability: 0.72 },
        acquisition_source: {
          kind: "weightedChoice",
          choices: [
            { value: "organic", weight: 30 },
            { value: "google", weight: 28 },
            { value: "meta", weight: 22 },
            { value: "referral", weight: 12 },
            { value: "whatsapp", weight: 8 },
          ],
        },
        ltv_bucket: {
          kind: "weightedChoice",
          choices: [
            { value: "low", weight: 45 },
            { value: "medium", weight: 32 },
            { value: "high", weight: 18 },
            { value: "whale", weight: 5 },
          ],
        },

        service_type: {
          kind: "weightedChoice",
          choices: [
            { value: "Sweeping & Mopping", weight: 22 },
            { value: "Deep Cleaning", weight: 14 },
            { value: "Bathroom Cleaning", weight: 12 },
            { value: "Kitchen Cleaning", weight: 10 },
            { value: "Sofa Cleaning", weight: 7 },
            { value: "Carpet Cleaning", weight: 5 },
            { value: "Cooking", weight: 9 },
            { value: "Laundry", weight: 8 },
            { value: "Dishwashing", weight: 7 },
            { value: "Pest Control", weight: 6 },
          ],
        },
        service_tier: {
          kind: "weightedChoice",
          choices: [
            { value: "quick", weight: 30 },
            { value: "standard", weight: 45 },
            { value: "extended", weight: 18 },
            { value: "premium", weight: 7 },
          ],
        },
        service_duration_min: { kind: "uniformInt", min: 30, max: 120 },

        hub_id: { kind: "uniformInt", min: 1, max: 5 },
        hub_name: {
          kind: "weightedChoice",
          choices: [
            { value: "Koramangala Hub", weight: 25 },
            { value: "Indiranagar Hub", weight: 22 },
            { value: "BTM Layout Hub", weight: 20 },
            { value: "Sarjapur Hub", weight: 18 },
            { value: "Yelahanka Hub", weight: 15 },
          ],
        },
        area: { kind: "constant", value: "Bangalore" },
        city: {
          kind: "weightedChoice",
          choices: [
            { value: "Metropolitian", weight: 60 },
            { value: "Urban", weight: 30 },
            { value: "Semi-Urban", weight: 10 },
          ],
        },

        partner_id: { kind: "sequentialId", prefix: "P", startAt: 1 },
        partner_age: { kind: "uniformInt", min: 22, max: 55 },
        partner_rating: { kind: "uniformFloat", min: 3.5, max: 5.0, precision: 1 },

        assigned_at: { kind: "tickWindow", granularity: "time" },
        arrived_at: { kind: "tickWindow", granularity: "time" },
        arrival_time_min: { kind: "uniformInt", min: 5, max: 25 },
        expected_arrival_min: { kind: "constant", value: 10 },
        on_time: { kind: "boolean", trueProbability: 0.78 },

        rescheduled: { kind: "boolean", trueProbability: 0.06 },
        partner_reassigned: { kind: "boolean", trueProbability: 0.04 },
        back_to_back: { kind: "uniformInt", min: 0, max: 4 },

        weather: {
          kind: "weightedChoice",
          choices: [
            { value: "Sunny", weight: 50 },
            { value: "Cloudy", weight: 25 },
            { value: "Rainy", weight: 15 },
            { value: "Foggy", weight: 5 },
            { value: "Windy", weight: 3 },
            { value: "Stormy", weight: 2 },
          ],
        },
        traffic_density: {
          kind: "weightedChoice",
          choices: [
            { value: "Low", weight: 25 },
            { value: "Medium", weight: 45 },
            { value: "High", weight: 25 },
            { value: "Jam", weight: 5 },
          ],
        },
        festival: { kind: "constant", value: "No" },

        payment_method: {
          kind: "weightedChoice",
          choices: [
            { value: "upi", weight: 60 },
            { value: "card", weight: 20 },
            { value: "cash", weight: 12 },
            { value: "wallet", weight: 8 },
          ],
        },
        payment_status: {
          kind: "weightedChoice",
          choices: [
            { value: "success", weight: 92 },
            { value: "failed", weight: 6 },
            { value: "refunded", weight: 2 },
          ],
        },

        is_first_booking: { kind: "boolean", trueProbability: 0.18 },

        campaign_id: { kind: "constant", value: null },
        campaign_name: { kind: "constant", value: null },
        campaign_type: { kind: "constant", value: null },
        discount_pct: { kind: "constant", value: null },
        offer_type: { kind: "constant", value: "none" },
        target_segment: { kind: "constant", value: null },
      },
    },
  ],

  postTick: {
    invalidateCaches: ["metrics", "explorer", "entity-catalog"],
  },
};

// ── daily_sessions derived from bookings ─────────────────────────────────────
// One session row per new booking's customer on the booking date. Captures
// the "active customer" signal for engagement summaries.
quickhelpSynthetic.tables.push({
  name: "daily_sessions",
  mode: "oneToOneFromBookings",
  probability: 1.0,
  columns: {
    // customer_id and session_date populated from bookings row in the tick
    session_count: { kind: "uniformInt", min: 1, max: 4 },
    screens_viewed: { kind: "uniformInt", min: 3, max: 25 },
    minutes_active: { kind: "uniformInt", min: 2, max: 35 },
    searched: { kind: "boolean", trueProbability: 0.55 },
    booked: { kind: "constant", value: true },
    viewed_offers: { kind: "boolean", trueProbability: 0.4 },
    platform: {
      kind: "weightedChoice",
      choices: [
        { value: "ios", weight: 45 },
        { value: "android", weight: 55 },
      ],
    },
  },
});
