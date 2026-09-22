/**
 * Sets up the Healthians DuckDB database from generated CSVs.
 *
 * Creates:
 *   - 21 raw tables from CSV files
 *   - 5 denormalized views (bookings_full, reports_full, etc.)
 *   - 8 summary / materialized tables for fast querying
 *
 * Prerequisites: Run generate-healthians.ts first to produce CSVs in data/csv/healthians/
 *
 * Usage: npx tsx scripts/setup-healthians.ts
 */

import { existsSync, unlinkSync } from "fs";
import { resolve } from "path";
import { getHealthiansViewSQL } from "../src/lib/datasets/healthians-events";

const CSV_DIR = resolve(__dirname, "../data/csv/healthians");
const DB_PATH = resolve(__dirname, "../data/healthians.duckdb");

const REQUIRED = [
  "customers.csv",
  "customer_addresses.csv",
  "customer_family_members.csv",
  "customer_lifestyle_profiles.csv",
  "phlebotomists.csv",
  "bookings.csv",
  "booking_items.csv",
  "phlebotomist_assignments.csv",
  "sample_tracking.csv",
  "reports.csv",
  "report_results.csv",
  "counseling_sessions.csv",
  "report_future_tests.csv",
  "subscriptions.csv",
  "subscription_runs.csv",
  "comms_log.csv",
  "nps_responses.csv",
  "phlebotomist_ratings.csv",
  "support_tickets.csv",
  "leads.csv",
  "user_events.csv",
];

for (const f of REQUIRED) {
  if (!existsSync(resolve(CSV_DIR, f))) {
    console.error(`❌ Missing ${f}. Run generate-healthians.ts first.`);
    process.exit(1);
  }
}

async function main() {
  if (existsSync(DB_PATH)) {
    unlinkSync(DB_PATH);
    console.log("Removed old database");
  }

  const { DuckDBInstance } = await import("@duckdb/node-api");
  const instance = await DuckDBInstance.create(DB_PATH);
  const conn = await instance.connect();

  const run = async (sql: string, label?: string) => {
    try {
      await conn.run(sql);
      if (label) console.log(`  ✓ ${label}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`SQL Error on ${label ?? "?"}: ${msg}`);
      console.error(sql.slice(0, 300));
      throw e;
    }
  };

  const query = async (sql: string): Promise<unknown> => {
    const r = await conn.runAndReadAll(sql);
    return r.getRows()[0]?.[0] ?? 0;
  };

  await run("SET memory_limit = '4GB'");
  await run("SET threads = 4");

  console.log("\n🏥 Setting up Healthians database...\n");

  // ═══════════════════════════════════════════
  // STEP 1: RAW TABLES (all materialized)
  // Materialize everything so .duckdb is self-contained.
  // ═══════════════════════════════════════════
  console.log("Step 1: Importing raw tables from CSV...");

  const SMALL_TABLES: [string, string][] = [
    ["raw_customers",              "customers.csv"],
    ["raw_customer_addresses",     "customer_addresses.csv"],
    ["raw_family_members",         "customer_family_members.csv"],
    ["raw_lifestyle_profiles",     "customer_lifestyle_profiles.csv"],
    ["raw_phlebotomists",          "phlebotomists.csv"],
    ["raw_bookings",               "bookings.csv"],
    ["raw_booking_items",          "booking_items.csv"],
    ["raw_assignments",            "phlebotomist_assignments.csv"],
    ["raw_sample_tracking",        "sample_tracking.csv"],
    ["raw_reports",                "reports.csv"],
    ["raw_counseling",             "counseling_sessions.csv"],
    ["raw_future_tests",           "report_future_tests.csv"],
    ["raw_subscriptions",          "subscriptions.csv"],
    ["raw_subscription_runs",      "subscription_runs.csv"],
    ["raw_comms_log",              "comms_log.csv"],
    ["raw_nps",                    "nps_responses.csv"],
    ["raw_phleb_ratings",          "phlebotomist_ratings.csv"],
    ["raw_support",                "support_tickets.csv"],
    ["raw_leads",                  "leads.csv"],
  ];

  for (const [name, file] of SMALL_TABLES) {
    await run(
      `CREATE OR REPLACE TABLE ${name} AS SELECT * FROM read_csv('${CSV_DIR}/${file}', auto_detect=true, ignore_errors=true)`,
      name
    );
  }

  // Large tables — streaming import
  console.log("  Materializing report_results (large table — may take ~60s)...");
  await run(`
    CREATE OR REPLACE TABLE raw_report_results AS
    SELECT * FROM read_csv('${CSV_DIR}/report_results.csv', auto_detect=true, ignore_errors=true)
  `, "raw_report_results");

  console.log("  Materializing user_events (large table — may take ~60s)...");
  await run(`
    CREATE OR REPLACE TABLE raw_user_events AS
    SELECT * FROM read_csv('${CSV_DIR}/user_events.csv', auto_detect=true, ignore_errors=true)
  `, "raw_user_events");

  // ═══════════════════════════════════════════
  // STEP 2: DENORMALIZED VIEWS
  // ═══════════════════════════════════════════
  console.log("\nStep 2: Denormalized views...");

  await run(`
    CREATE OR REPLACE VIEW bookings_full AS
    SELECT
      b.booking_id, b.customer_id, b.booking_date, b.slot_date, b.slot_band,
      b.city, b.city_tier, b.hub_id, b.primary_test_category,
      b.advertised_price_inr, b.consumables_transport_fee_inr,
      b.coupon_discount_inr, b.total_paid_inr,
      b.payment_method, b.booking_channel,
      b.patient_age, b.patient_gender, b.patient_relationship,
      b.on_time, b.delay_min, b.no_show, b.sample_rejected,
      b.tat_hours, b.tat_breach, b.report_viewed, b.time_to_view_hours,
      b.counseling_taken, b.follow_up_booked, b.billing_dispute,
      b.booking_status, b.is_first_booking, b.is_prescription_driven,
      c.archetype, c.age AS customer_age, c.age_group,
      c.gender AS customer_gender, c.state,
      c.acquisition_channel, c.chronic_condition,
      c.install_platform, c.subscription_active,
      c.customer_lifecycle_stage, c.ltv_bucket,
      c.vitamin_d_status, c.thyroid_status, c.glucose_status,
      bi.test_slug, bi.test_name, bi.test_category, bi.parameters_count, bi.item_price_inr
    FROM raw_bookings b
    LEFT JOIN raw_customers      c  ON b.customer_id  = c.customer_id
    LEFT JOIN raw_booking_items  bi ON b.booking_id   = bi.booking_id
                                    AND bi.item_type = 'primary'
  `, "bookings_full");

  await run(`
    CREATE OR REPLACE VIEW reports_full AS
    SELECT
      r.report_id, r.booking_id, r.customer_id, r.report_date,
      r.health_score, r.health_score_category,
      r.critical_params_count, r.borderline_params_count, r.abnormal_params_count,
      r.report_viewed, r.time_to_view_hours, r.report_view_platform,
      r.health_karma_viewed,
      c.archetype, c.age AS customer_age, c.gender AS customer_gender,
      c.city, c.city_tier, c.state, c.chronic_condition,
      b.slot_band, b.booking_channel, b.primary_test_category,
      b.tat_hours, b.tat_breach, b.on_time
    FROM raw_reports r
    LEFT JOIN raw_customers c ON r.customer_id = c.customer_id
    LEFT JOIN raw_bookings  b ON r.booking_id  = b.booking_id
  `, "reports_full");

  await run(`
    CREATE OR REPLACE VIEW phlebotomist_full AS
    SELECT
      pa.assignment_id, pa.booking_id, pa.customer_id, pa.phlebotomist_id,
      pa.on_time, pa.delay_min, pa.no_show, pa.collection_duration_min,
      pa.communication_issue, pa.customer_request_repeated,
      p.city AS phleb_city, p.city_tier AS phleb_tier,
      p.experience_months, p.certification_level, p.avg_rating,
      b.slot_date, b.slot_band,
      b.city AS booking_city, b.city_tier AS booking_tier
    FROM raw_assignments pa
    LEFT JOIN raw_phlebotomists p ON pa.phlebotomist_id = p.phlebotomist_id
    LEFT JOIN raw_bookings      b ON pa.booking_id      = b.booking_id
  `, "phlebotomist_full");

  await run(`
    CREATE OR REPLACE VIEW comms_full AS
    SELECT
      cl.send_id, cl.customer_id, cl.booking_id, cl.channel, cl.campaign_type,
      cl.sent_at, cl.delivered, cl.opened, cl.clicked, cl.converted,
      cl.send_cost_inr, cl.user_segment_at_send, cl.days_since_last_booking,
      c.city, c.city_tier, c.archetype, c.acquisition_channel, c.is_active
    FROM raw_comms_log cl
    LEFT JOIN raw_customers c ON cl.customer_id = c.customer_id
  `, "comms_full");

  await run(`
    CREATE OR REPLACE VIEW support_full AS
    SELECT
      st.ticket_id, st.customer_id, st.booking_id,
      st.opened_at, st.resolved_at, st.resolution_days,
      st.channel, st.category, st.city, st.city_tier,
      st.root_cause, st.escalated, st.resolution, st.nps_after_resolution,
      c.archetype, c.chronic_condition, c.is_active
    FROM raw_support st
    LEFT JOIN raw_customers c ON st.customer_id = c.customer_id
  `, "support_full");

  // Keep setup output aligned with the runtime dataset config. The original
  // core views above are recreated here with the expanded columns, and the
  // extra event-ready views are added for segments, funnels, and explorer.
  for (const sql of getHealthiansViewSQL()) {
    const match = sql.match(/CREATE\s+OR\s+REPLACE\s+VIEW\s+(\w+)/i);
    await run(sql, match?.[1] ?? "expanded_healthians_view");
  }

  // ═══════════════════════════════════════════
  // STEP 3: SUMMARY TABLES
  // ═══════════════════════════════════════════
  console.log("\nStep 3: Summary tables...");

  await run(`
    CREATE OR REPLACE TABLE daily_company_kpis AS
    SELECT
      b.slot_date::DATE                              AS date,
      COUNT(*)                                       AS bookings,
      SUM(b.total_paid_inr)                          AS gmv,
      SUM(b.total_paid_inr - b.coupon_discount_inr) AS revenue,
      COUNT(*) FILTER
        (WHERE b.is_first_booking = true)            AS new_customers,
      COUNT(*) FILTER
        (WHERE b.booking_status = 'completed'
          AND NOT b.no_show AND NOT b.sample_rejected) AS completions,
      CAST(COUNT(*) FILTER (WHERE b.on_time = true) AS DOUBLE)
        / NULLIF(COUNT(*) FILTER (WHERE NOT b.no_show), 0) * 100 AS on_time_pct,
      AVG(b.tat_hours) FILTER
        (WHERE b.booking_status = 'completed'
          AND NOT b.no_show AND NOT b.sample_rejected) AS avg_tat_hours
    FROM raw_bookings b
    GROUP BY 1
    ORDER BY 1
  `, "daily_company_kpis");

  await run(`
    CREATE OR REPLACE TABLE city_monthly_kpis AS
    SELECT
      b.city,
      b.city_tier,
      CAST(strftime(b.slot_date::DATE, '%Y-%m') || '-01' AS DATE) AS month,
      COUNT(*)                                          AS bookings,
      SUM(b.total_paid_inr)                             AS gmv,
      CAST(COUNT(*) FILTER (WHERE b.on_time = true) AS DOUBLE)
        / NULLIF(COUNT(*) FILTER (WHERE NOT b.no_show), 0) * 100  AS on_time_pct,
      AVG(b.tat_hours) FILTER (WHERE NOT b.no_show)    AS avg_tat,
      CAST(COUNT(*) FILTER (WHERE b.sample_rejected = true) AS DOUBLE)
        / NULLIF(COUNT(*), 0) * 100                   AS rejection_rate
    FROM raw_bookings b
    GROUP BY 1, 2, 3
    ORDER BY 3, 1
  `, "city_monthly_kpis");

  await run(`
    CREATE OR REPLACE TABLE test_popularity AS
    SELECT
      bi.test_slug, bi.test_name, bi.test_category,
      CAST(strftime(b.slot_date::DATE, '%Y-%m') || '-01' AS DATE) AS month,
      COUNT(*)                                          AS booking_count,
      SUM(bi.item_price_inr)                            AS total_revenue
    FROM raw_booking_items bi
    LEFT JOIN raw_bookings b ON bi.booking_id = b.booking_id
    GROUP BY 1, 2, 3, 4
    ORDER BY 4, 6 DESC
  `, "test_popularity");

  await run(`
    CREATE OR REPLACE TABLE funnel_metrics AS
    SELECT
      b.booking_channel,
      CAST(strftime(b.slot_date::DATE, '%Y-%m') || '-01' AS DATE) AS month,
      COUNT(*)                                           AS total_bookings,
      COUNT(*) FILTER (WHERE NOT b.no_show)              AS collections,
      COUNT(*) FILTER (WHERE NOT b.sample_rejected)      AS accepted_samples,
      COUNT(*) FILTER (WHERE b.report_viewed = true)     AS reports_viewed,
      COUNT(*) FILTER (WHERE b.counseling_taken = true)  AS counseling_taken,
      COUNT(*) FILTER (WHERE b.follow_up_booked = true)  AS follow_ups_booked,
      CAST(COUNT(*) FILTER (WHERE b.report_viewed = true) AS DOUBLE)
        / NULLIF(COUNT(*) FILTER (WHERE NOT b.no_show AND NOT b.sample_rejected), 0) * 100
        AS report_view_rate,
      CAST(COUNT(*) FILTER (WHERE b.counseling_taken = true) AS DOUBLE)
        / NULLIF(COUNT(*) FILTER (WHERE b.report_viewed = true), 0) * 100
        AS counseling_conversion_rate
    FROM raw_bookings b
    GROUP BY 1, 2
    ORDER BY 2, 1
  `, "funnel_metrics");

  await run(`
    CREATE OR REPLACE TABLE retention_cohorts AS
    SELECT
      CAST(strftime(c.signup_date::DATE, '%Y-%m') || '-01' AS DATE) AS cohort_month,
      CAST(strftime(b.slot_date::DATE, '%Y-%m') || '-01' AS DATE)   AS activity_month,
      DATEDIFF('month', c.signup_date::DATE, b.slot_date::DATE)     AS months_since_signup,
      COUNT(DISTINCT c.customer_id)                                  AS active_customers,
      COUNT(DISTINCT b.booking_id)                                   AS bookings
    FROM raw_customers c
    LEFT JOIN raw_bookings b ON c.customer_id = b.customer_id
    WHERE c.signup_date >= '2024-04-01'
      AND b.slot_date IS NOT NULL
    GROUP BY 1, 2, 3
    ORDER BY 1, 3
  `, "retention_cohorts");

  await run(`
    CREATE OR REPLACE TABLE phlebotomist_performance AS
    SELECT
      pa.phlebotomist_id,
      p.city, p.city_tier, p.certification_level,
      CAST(strftime(b.slot_date::DATE, '%Y-%m') || '-01' AS DATE) AS month,
      COUNT(*)                                            AS collections,
      CAST(COUNT(*) FILTER (WHERE pa.on_time = true) AS DOUBLE)
        / NULLIF(COUNT(*), 0) * 100                     AS on_time_pct,
      AVG(pr.rating)                                     AS avg_rating,
      COUNT(*) FILTER (WHERE b.sample_rejected = true)   AS rejection_count
    FROM raw_assignments pa
    LEFT JOIN raw_phlebotomists  p  ON pa.phlebotomist_id = p.phlebotomist_id
    LEFT JOIN raw_bookings       b  ON pa.booking_id      = b.booking_id
    LEFT JOIN raw_phleb_ratings  pr ON pa.booking_id      = pr.booking_id
    GROUP BY 1, 2, 3, 4, 5
    ORDER BY 5, 1
  `, "phlebotomist_performance");

  await run(`
    CREATE OR REPLACE TABLE campaign_performance AS
    SELECT
      cl.campaign_type,
      cl.channel,
      CAST(strftime(cl.sent_at::TIMESTAMP, '%Y-%m') || '-01' AS DATE) AS month,
      COUNT(*)                                            AS sends,
      COUNT(*) FILTER (WHERE cl.delivered = true)         AS delivered,
      COUNT(*) FILTER (WHERE cl.opened = true)            AS opened,
      COUNT(*) FILTER (WHERE cl.clicked = true)           AS clicked,
      COUNT(*) FILTER (WHERE cl.converted = true)         AS converted,
      CAST(COUNT(*) FILTER (WHERE cl.opened = true) AS DOUBLE)
        / NULLIF(COUNT(*) FILTER (WHERE cl.delivered = true), 0) * 100 AS open_rate,
      CAST(COUNT(*) FILTER (WHERE cl.clicked = true) AS DOUBLE)
        / NULLIF(COUNT(*) FILTER (WHERE cl.opened = true), 0) * 100    AS click_rate,
      CAST(COUNT(*) FILTER (WHERE cl.converted = true) AS DOUBLE)
        / NULLIF(COUNT(*) FILTER (WHERE cl.delivered = true), 0) * 100 AS conv_rate,
      SUM(cl.send_cost_inr)                               AS total_cost_inr
    FROM raw_comms_log cl
    GROUP BY 1, 2, 3
    ORDER BY 3, 1
  `, "campaign_performance");

  await run(`
    CREATE OR REPLACE TABLE clinical_summary AS
    SELECT
      c.city_tier,
      rr.test_slug,
      rr.parameter_name,
      COUNT(*)                                               AS total_results,
      CAST(COUNT(*) FILTER (WHERE rr.is_abnormal = true) AS DOUBLE)
        / NULLIF(COUNT(*), 0) * 100                        AS abnormal_pct,
      CAST(COUNT(*) FILTER (WHERE rr.is_critical = true) AS DOUBLE)
        / NULLIF(COUNT(*), 0) * 100                        AS critical_pct,
      AVG(rr.parameter_value::DOUBLE)                       AS avg_value,
      MEDIAN(rr.parameter_value::DOUBLE)                    AS median_value
    FROM raw_report_results rr
    LEFT JOIN raw_customers c ON rr.customer_id = c.customer_id
    GROUP BY 1, 2, 3
    ORDER BY 5 DESC
  `, "clinical_summary");

  // ═══════════════════════════════════════════
  // STEP 4: VERIFY
  // ═══════════════════════════════════════════
  console.log("\nStep 4: Verifying...");

  const counts = await Promise.all([
    query("SELECT COUNT(*) FROM raw_customers"),
    query("SELECT COUNT(*) FROM raw_bookings"),
    query("SELECT COUNT(*) FROM raw_reports"),
    query("SELECT COUNT(*) FROM raw_report_results"),
    query("SELECT COUNT(*) FROM raw_user_events"),
    query("SELECT COUNT(*) FROM raw_comms_log"),
    query("SELECT COUNT(*) FROM raw_phlebotomists"),
    query("SELECT COUNT(*) FROM daily_company_kpis"),
    query("SELECT COUNT(*) FROM campaign_performance"),
    query("SELECT COUNT(*) FROM clinical_summary"),
  ]);

  console.log(`  customers:            ${Number(counts[0]).toLocaleString()}`);
  console.log(`  bookings:             ${Number(counts[1]).toLocaleString()}`);
  console.log(`  reports:              ${Number(counts[2]).toLocaleString()}`);
  console.log(`  report_results:       ${Number(counts[3]).toLocaleString()}`);
  console.log(`  user_events:          ${Number(counts[4]).toLocaleString()}`);
  console.log(`  comms_log:            ${Number(counts[5]).toLocaleString()}`);
  console.log(`  phlebotomists:        ${Number(counts[6]).toLocaleString()}`);
  console.log(`  daily_kpis rows:      ${Number(counts[7]).toLocaleString()}`);
  console.log(`  campaign_perf rows:   ${Number(counts[8]).toLocaleString()}`);
  console.log(`  clinical_summary rows:${Number(counts[9]).toLocaleString()}`);

  await run("CHECKPOINT");

  console.log(`\n✅ Database ready: ${DB_PATH}`);
  console.log("   5 views + 8 summary tables created.\n");
}

main().catch(e => { console.error("Setup failed:", e); process.exit(1); });
