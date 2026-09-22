/**
 * Post-setup validation for Quick Help DuckDB.
 * Runs SQL checks against the actual database to verify cross-table
 * consistency, FK integrity, aggregation grounding, and business logic.
 *
 * Usage: npx tsx scripts/validate-quickhelp-db.ts
 */
import { DuckDBInstance } from "@duckdb/node-api";
import { resolve } from "path";

const DB_PATH = resolve(__dirname, "../data/quickhelp.duckdb");

async function main() {
  const instance = await DuckDBInstance.create(DB_PATH);
  const conn = await instance.connect();

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  async function query(sql: string) {
    const result = await conn.run(sql);
    return result.getRows();
  }

  async function val(sql: string): Promise<number> {
    const rows = await query(sql);
    return Number(rows[0][0]);
  }

  async function check(name: string, sql: string, expect: (v: number) => boolean, desc?: string) {
    try {
      const v = await val(sql);
      const ok = expect(v);
      if (ok) {
        console.log(`  ✅ ${name}${desc ? ` (${desc}: ${v})` : ""}`);
        passed++;
      } else {
        console.log(`  ❌ ${name} — got ${v}${desc ? ` (${desc})` : ""}`);
        failed++;
        failures.push(name);
      }
    } catch (err: any) {
      console.log(`  ❌ ${name} — ERROR: ${err.message?.slice(0, 120)}`);
      failed++;
      failures.push(name);
    }
  }

  async function checkEq(name: string, sql1: string, sql2: string) {
    try {
      const [v1, v2] = await Promise.all([val(sql1), val(sql2)]);
      const ok = Math.abs(v1 - v2) < 0.01;
      if (ok) {
        console.log(`  ✅ ${name} (${v1})`);
        passed++;
      } else {
        console.log(`  ❌ ${name} — ${v1} vs ${v2} (diff: ${(v1 - v2).toFixed(2)})`);
        failed++;
        failures.push(name);
      }
    } catch (err: any) {
      console.log(`  ❌ ${name} — ERROR: ${err.message?.slice(0, 120)}`);
      failed++;
      failures.push(name);
    }
  }

  console.log("\n═══════════════════════════════════════");
  console.log("  QUICK HELP DATABASE VALIDATION");
  console.log("═══════════════════════════════════════\n");

  // ── 1. ROW COUNTS ──
  console.log("── Row Counts ──");
  await check("bookings count", "SELECT COUNT(*) FROM bookings", v => v > 200000, "rows");
  await check("customers count", "SELECT COUNT(*) FROM raw_customers", v => v === 18000, "rows");
  await check("comms_full count", "SELECT COUNT(*) FROM comms_full", v => v > 1500000, "rows");
  await check("partner_shifts count", "SELECT COUNT(*) FROM partner_shifts", v => v > 140000, "rows");
  await check("ad_full count", "SELECT COUNT(*) FROM ad_full", v => v > 4000, "rows");
  await check("attribution_full count", "SELECT COUNT(*) FROM attribution_full", v => v === 18000, "rows");
  await check("bookings_economics count", "SELECT COUNT(*) FROM bookings_economics", v => v > 200000, "rows");
  await check("funnel_events count", "SELECT COUNT(*) FROM raw_funnel_events", v => v > 80000, "rows");
  await check("daily_sessions count", "SELECT COUNT(*) FROM raw_daily_sessions", v => v > 600000, "rows");
  await check("referrals_full count", "SELECT COUNT(*) FROM referrals_full", v => v > 2500, "rows");
  await check("survey_full count", "SELECT COUNT(*) FROM survey_full", v => v > 55000, "rows");
  await check("partner_payouts count", "SELECT COUNT(*) FROM raw_partner_payouts", v => v > 25000, "rows");
  await check("weekly_company_kpis count", "SELECT COUNT(*) FROM weekly_company_kpis", v => v >= 50, "rows");
  await check("monthly_company_kpis count", "SELECT COUNT(*) FROM monthly_company_kpis", v => v >= 12, "rows");

  // ── 2. DENORMALIZED VIEW CARDINALITY ──
  console.log("\n── Denormalized View Cardinality ──");
  await checkEq("bookings_economics 1:1 with bookings",
    "SELECT COUNT(*) FROM bookings",
    "SELECT COUNT(*) FROM bookings_economics");
  await check("survey_full ⊆ bookings (all booking_ids exist)",
    "SELECT COUNT(*) FROM survey_full s LEFT JOIN raw_bookings b USING (booking_id) WHERE b.booking_id IS NULL",
    v => v === 0, "orphans");
  await check("referrals_full referrer_ids exist",
    "SELECT COUNT(*) FROM referrals_full WHERE referrer_customer_id NOT IN (SELECT customer_id FROM raw_customers)",
    v => v === 0, "orphans");

  // ── 3. FK INTEGRITY ──
  console.log("\n── FK Integrity ──");
  await check("funnel_events.customer_id → customers",
    "SELECT COUNT(*) FROM raw_funnel_events f WHERE f.customer_id NOT IN (SELECT customer_id FROM raw_customers)",
    v => v === 0, "orphans");
  await check("daily_sessions.customer_id → customers",
    "SELECT COUNT(DISTINCT customer_id) FROM raw_daily_sessions WHERE customer_id NOT IN (SELECT customer_id FROM raw_customers)",
    v => v === 0, "orphans");
  await check("survey_responses.booking_id → bookings (success only)",
    "SELECT COUNT(*) FROM raw_survey_responses s JOIN raw_bookings b USING (booking_id) WHERE b.payment_status != 'success'",
    v => v === 0, "non-success surveys");
  await check("partner_payouts.partner_id → partner_shifts",
    "SELECT COUNT(DISTINCT partner_id) FROM raw_partner_payouts WHERE partner_id NOT IN (SELECT DISTINCT partner_id FROM partner_shifts)",
    v => v === 0, "orphans");
  await check("bookings_economics.booking_id → bookings",
    "SELECT COUNT(*) FROM raw_booking_unit_economics WHERE booking_id NOT IN (SELECT booking_id FROM raw_bookings)",
    v => v === 0, "orphans");

  // ── 4. AGGREGATION GROUNDING (KPIs match source data) ──
  console.log("\n── KPI Grounding ──");

  // Weekly GMV
  await check("weekly_kpis.gmv = SUM(bookings.value) per week",
    `SELECT COUNT(*) FROM (
      SELECT w.week_start, w.gmv,
        (SELECT SUM(booking_value) FROM raw_bookings
         WHERE DATE_TRUNC('week', booking_date::DATE) = w.week_start) AS actual_gmv
      FROM weekly_company_kpis w
    ) t WHERE ABS(t.gmv - t.actual_gmv) > 1`,
    v => v === 0, "mismatched weeks");

  // Weekly revenue = SUM(commission_earned) for success
  await check("weekly_kpis.revenue = SUM(commission_earned) per week",
    `SELECT COUNT(*) FROM (
      SELECT w.week_start, w.revenue,
        (SELECT SUM(commission_earned) FROM raw_booking_unit_economics
         WHERE payment_status = 'success'
         AND DATE_TRUNC('week', booking_date::DATE) = w.week_start) AS actual_rev
      FROM weekly_company_kpis w
    ) t WHERE ABS(t.revenue - COALESCE(t.actual_rev, 0)) > 1`,
    v => v === 0, "mismatched weeks");

  // Monthly GMV aggregates from weekly
  await check("monthly_kpis.gmv = SUM(weekly_kpis.gmv) per month",
    `SELECT COUNT(*) FROM (
      SELECT m.month, m.gmv,
        (SELECT SUM(gmv) FROM weekly_company_kpis
         WHERE DATE_TRUNC('month', week_start::DATE) = m.month) AS weekly_sum
      FROM monthly_company_kpis m
    ) t WHERE ABS(t.gmv - t.weekly_sum) > 1`,
    v => v === 0, "mismatched months");

  // ── 5. UNIT ECONOMICS ARITHMETIC ──
  console.log("\n── Unit Economics Arithmetic ──");

  // CM = commission - processing - promo - referral - support
  await check("contribution_margin arithmetic (sample 1000)",
    `SELECT COUNT(*) FROM (
      SELECT booking_id,
        commission_earned - payment_processing_fee - promo_discount_funded - referral_reward_cost - support_cost_allocated AS expected_cm,
        contribution_margin AS actual_cm
      FROM raw_booking_unit_economics
      LIMIT 1000
    ) t WHERE ABS(t.expected_cm - t.actual_cm) > 0.01`,
    v => v === 0, "wrong CM rows");

  // gross_booking_value matches bookings.booking_value
  await check("gross_booking_value = bookings.booking_value (all rows)",
    `SELECT COUNT(*) FROM raw_booking_unit_economics e
     JOIN raw_bookings b USING (booking_id)
     WHERE ABS(e.gross_booking_value - b.booking_value) > 0.01`,
    v => v === 0, "mismatches");

  // partner_payouts.gross_earnings = SUM(partner_payout) for same partner+week
  await check("partner_payouts.gross matches booking economics (sample 50)",
    `SELECT COUNT(*) FROM (
      SELECT pp.payout_id, pp.partner_id, pp.payout_week_start, pp.gross_earnings,
        (SELECT SUM(e.partner_payout) FROM raw_booking_unit_economics e
         JOIN raw_bookings b USING (booking_id)
         WHERE b.partner_id = pp.partner_id
         AND b.payment_status = 'success'
         AND DATE_TRUNC('week', b.booking_date::DATE) = pp.payout_week_start::DATE) AS actual_gross
      FROM raw_partner_payouts pp
      ORDER BY pp.payout_id LIMIT 50
    ) t WHERE ABS(COALESCE(t.gross_earnings, 0) - COALESCE(t.actual_gross, 0)) > 1`,
    v => v === 0, "mismatched payouts");

  // ── 6. FUNNEL INTEGRITY ──
  console.log("\n── Funnel Integrity ──");

  // Every customer has signup_complete
  await check("every customer has signup_complete event",
    `SELECT COUNT(*) FROM raw_customers c
     WHERE c.customer_id NOT IN (
       SELECT customer_id FROM raw_funnel_events WHERE event_type = 'signup_complete'
     )`,
    v => v === 0, "missing signups");

  // Funnel timestamps monotonic per customer
  await check("funnel timestamps monotonic per customer",
    `SELECT COUNT(*) FROM (
      SELECT customer_id, event_at,
        LAG(event_at) OVER (PARTITION BY customer_id ORDER BY event_id) AS prev_at
      FROM raw_funnel_events
    ) t WHERE t.prev_at IS NOT NULL AND t.event_at < t.prev_at`,
    v => v === 0, "out-of-order events");

  // Funnel conversion rates roughly match expectations
  const signups = await val("SELECT COUNT(DISTINCT customer_id) FROM raw_funnel_events WHERE event_type = 'signup_complete'");
  const profileDone = await val("SELECT COUNT(DISTINCT customer_id) FROM raw_funnel_events WHERE event_type = 'profile_done'");
  const firstBooking = await val("SELECT COUNT(DISTINCT customer_id) FROM raw_funnel_events WHERE event_type = 'first_booking'");
  const profileRate = profileDone / signups * 100;
  const bookingRate = firstBooking / signups * 100;
  console.log(`  ℹ️  Funnel rates: signup→profile ${profileRate.toFixed(1)}% (expect ~85%), signup→booking ${bookingRate.toFixed(1)}% (expect ~40-50%)`);

  // ── 7. DAILY SESSIONS INTEGRITY ──
  console.log("\n── Daily Sessions ──");

  // booked=true days actually have bookings
  await check("booked=true matches actual booking dates (sample 500)",
    `SELECT COUNT(*) FROM (
      SELECT s.customer_id, s.session_date
      FROM raw_daily_sessions s
      WHERE s.booked = true
      LIMIT 500
    ) t WHERE NOT EXISTS (
      SELECT 1 FROM raw_bookings b
      WHERE b.customer_id = t.customer_id AND b.booking_date = t.session_date
    )`,
    v => v === 0, "false booked flags");

  // No sessions before signup
  await check("no sessions before customer signup_date (sample 500)",
    `SELECT COUNT(*) FROM (
      SELECT s.customer_id, s.session_date, c.signup_date
      FROM raw_daily_sessions s
      JOIN raw_customers c USING (customer_id)
      LIMIT 500
    ) t WHERE t.session_date < t.signup_date`,
    v => v === 0, "pre-signup sessions");

  // ── 8. SURVEY INTEGRITY ──
  console.log("\n── Survey Integrity ──");
  await check("NPS scores 0-10",
    "SELECT COUNT(*) FROM raw_survey_responses WHERE survey_type = 'nps' AND (score < 0 OR score > 10)",
    v => v === 0, "out-of-range");
  await check("CSAT scores 1-5",
    "SELECT COUNT(*) FROM raw_survey_responses WHERE survey_type IN ('csat', 'post_booking') AND (score < 1 OR score > 5)",
    v => v === 0, "out-of-range");
  await check("survey submitted_at after booking date",
    `SELECT COUNT(*) FROM raw_survey_responses s
     JOIN raw_bookings b USING (booking_id)
     WHERE s.submitted_at::DATE < b.booking_date`,
    v => v === 0, "before-booking surveys");

  // NPS score calculation
  const npsRows = await query(`
    SELECT
      COUNT(CASE WHEN score >= 9 THEN 1 END) AS promoters,
      COUNT(CASE WHEN score <= 6 THEN 1 END) AS detractors,
      COUNT(*) AS total
    FROM raw_survey_responses WHERE survey_type = 'nps'
  `);
  const nps = ((Number(npsRows[0][0]) - Number(npsRows[0][1])) / Number(npsRows[0][2]) * 100).toFixed(1);
  console.log(`  ℹ️  Computed NPS: ${nps} (from ${npsRows[0][2]} responses)`);

  // ── 9. REFERRAL INTEGRITY ──
  console.log("\n── Referral Integrity ──");
  await check("converted referrals have referee_customer_id",
    "SELECT COUNT(*) FROM raw_referrals WHERE status = 'converted' AND referee_customer_id IS NULL",
    v => v === 0, "null referees");
  await check("unconverted referrals have null referee_customer_id",
    "SELECT COUNT(*) FROM raw_referrals WHERE status = 'unconverted' AND referee_customer_id IS NOT NULL",
    v => v === 0, "non-null referees");
  await check("referral reward_status valid",
    "SELECT COUNT(*) FROM raw_referrals WHERE reward_status NOT IN ('pending', 'credited', 'expired')",
    v => v === 0, "invalid status");

  // ── 10. SUMMARY TABLE CONSISTENCY ──
  console.log("\n── Summary Table Consistency ──");

  // funnel_conversion_metrics matches raw funnel_events
  await check("funnel_conversion_metrics signup count matches raw",
    `SELECT ABS(
      (SELECT SUM(customers) FROM funnel_conversion_metrics WHERE stage = 'signup_complete') -
      (SELECT COUNT(DISTINCT customer_id) FROM raw_funnel_events WHERE event_type = 'signup_complete')
    )`,
    v => v === 0, "mismatch");

  // service_unit_economics total CM matches raw
  await check("service_unit_economics total CM matches raw booking_unit_economics",
    `SELECT ABS(
      (SELECT SUM(total_contribution_margin) FROM service_unit_economics) -
      (SELECT SUM(contribution_margin) FROM raw_booking_unit_economics WHERE payment_status = 'success')
    )`,
    v => v < 1, "difference");

  // retention cohorts: month 0 should have 100% retention
  await check("retention cohort month 0 = 100% for all cohorts",
    "SELECT COUNT(*) FROM weekly_retention_cohorts WHERE months_since_signup = 0 AND retention_pct < 99",
    v => v === 0, "below 100%");

  // ── 11. BUSINESS LOGIC SANITY ──
  console.log("\n── Business Logic Sanity ──");

  await check("take rate between 20-35%",
    "SELECT AVG(take_rate) * 100 FROM weekly_company_kpis",
    v => v >= 20 && v <= 35, "avg take rate %");

  await check("contribution margin % between 15-35%",
    "SELECT AVG(contribution_margin_pct) * 100 FROM weekly_company_kpis WHERE contribution_margin_pct > 0",
    v => v >= 15 && v <= 35, "avg CM %");

  await check("completion rate between 80-99%",
    "SELECT AVG(completion_rate) FROM weekly_company_kpis",
    v => v >= 80 && v <= 99, "avg completion %");

  await check("on_time_pct between 30-70%",
    "SELECT AVG(on_time_pct) FROM weekly_company_kpis",
    v => v >= 30 && v <= 70, "avg on-time %");

  await check("blended CAC > 0 and < ₹5000",
    "SELECT AVG(blended_cac) FROM weekly_company_kpis WHERE blended_cac > 0",
    v => v > 0 && v < 5000, "avg CAC");

  await check("NPS between -100 and 100",
    "SELECT AVG(nps_score) FROM weekly_company_kpis WHERE nps_score != 0",
    v => v >= -100 && v <= 100, "avg NPS");

  await check("LTV:CAC ratio between 0.5 and 10",
    "SELECT AVG(ltv_cac_ratio) FROM monthly_company_kpis WHERE ltv_cac_ratio > 0",
    v => v >= 0.5 && v <= 10, "avg ratio");

  await check("partner churn rate between 0-30%",
    "SELECT AVG(partner_churn_rate) FROM monthly_company_kpis WHERE partner_churn_rate > 0",
    v => v >= 0 && v <= 30, "avg %");

  await check("customer churn rate between 10-80%",
    "SELECT AVG(customer_churn_rate) FROM monthly_company_kpis WHERE customer_churn_rate > 0",
    v => v >= 10 && v <= 80, "avg %");

  // ── 12. DATE RANGE SANITY ──
  console.log("\n── Date Range ──");
  await check("bookings date range starts Feb 2025",
    "SELECT EXTRACT(YEAR FROM MIN(booking_date::DATE)) * 100 + EXTRACT(MONTH FROM MIN(booking_date::DATE)) FROM raw_bookings",
    v => v === 202502, "YYYYMM");
  await check("bookings date range ends Feb 2026",
    "SELECT EXTRACT(YEAR FROM MAX(booking_date::DATE)) * 100 + EXTRACT(MONTH FROM MAX(booking_date::DATE)) FROM raw_bookings",
    v => v === 202602, "YYYYMM");
  await check("funnel_events within date range",
    "SELECT COUNT(*) FROM raw_funnel_events WHERE event_at::DATE < '2025-02-01' OR event_at::DATE > '2026-03-01'",
    v => v === 0, "out-of-range");
  await check("daily_sessions within date range",
    "SELECT COUNT(*) FROM raw_daily_sessions WHERE session_date < '2025-02-01' OR session_date > '2026-02-28'",
    v => v === 0, "out-of-range");

  // ══════════════════════════════════════
  // FINAL REPORT
  // ══════════════════════════════════════

  console.log("\n═══════════════════════════════════════");
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log("═══════════════════════════════════════");

  if (failed > 0) {
    console.log("\nFailed checks:");
    failures.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
  } else {
    console.log("\nAll checks passed! Dataset is consistent.");
  }
}

main().catch((err) => {
  console.error("Validation failed:", err);
  process.exit(1);
});
