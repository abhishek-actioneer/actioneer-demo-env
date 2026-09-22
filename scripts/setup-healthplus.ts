/**
 * Sets up the Health+ (e-pharmacy + diagnostics + teleconsult) DuckDB database
 * from source CSVs.
 *
 * Health+ is a fictional Indian digital-health superapp. The source data is
 * Tata 1mg-shaped; every real-brand reference ("Tata 1mg" / "1mg" and the
 * Tata Neu loyalty ecosystem — tata_neu / neucoins / neu_linked) is scrubbed
 * to the fictional Health+ brand during ingestion. Third-party product and
 * manufacturer names (Cipla, Sun Pharma, Neurobion, Neutrogena, …) are real
 * medicines sold on any pharmacy and are intentionally kept.
 *
 * Creates:
 *   - Raw views from CSV files (brand-scrubbed)
 *   - Denormalized tables (orders_full, order_items_full, customers_full,
 *     lab_bookings_full, lab_samples via lab_bookings_full, consults_full,
 *     rx_verifications_full, campaign_contacts_full, inventory_full, grn_full,
 *     purchase_orders_full, refills_full, cart_abandonments_full) + dimension tables
 *   - 18 summary/materialized tables for fast querying
 *
 * Prerequisites: CSVs must exist in data/csv/healthplus/
 *
 * Usage: npx tsx scripts/setup-healthplus.ts
 */

import { existsSync, unlinkSync } from "fs";
import { resolve } from "path";

const CSV_DIR = process.env.HEALTHPLUS_CSV_DIR ?? resolve(__dirname, "../data/csv/healthplus");
const DB_PATH = process.env.HEALTHPLUS_DB_PATH ?? resolve(__dirname, "../data/healthplus.duckdb");

const requiredFiles = [
  "customers.csv", "patients.csv", "orders.csv", "order_items.csv", "skus.csv",
  "rx_verifications.csv", "refill_subscriptions.csv", "lab_bookings.csv",
  "lab_booking_items.csv", "lab_samples.csv", "labs.csv", "phlebotomists.csv",
  "consults.csv", "campaigns.csv", "campaign_contacts.csv", "fulfillment_centers.csv",
  "vendors.csv", "purchase_orders.csv", "grn_lines.csv", "inventory_snapshots.csv",
  "calendar_events.csv", "cart_abandonments.csv",
];

for (const f of requiredFiles) {
  if (!existsSync(resolve(CSV_DIR, f))) {
    console.error(`❌ Missing ${f} in ${CSV_DIR}`);
    process.exit(1);
  }
}

// Brand scrub: "Tata 1mg X" and "1mg X" → "Health+ X". Applied to name/manufacturer
// columns via nested replace (order matters — strip "Tata 1mg" first).
const scrub = (col: string) => `replace(replace(${col}, 'Tata 1mg', 'Health+'), '1mg', 'Health+')`;

async function main() {
  if (existsSync(DB_PATH)) {
    unlinkSync(DB_PATH);
    console.log("Removed old database");
  }

  const { DuckDBInstance } = await import("@duckdb/node-api");
  const instance = await DuckDBInstance.create(DB_PATH);
  const conn = await instance.connect();

  const run = async (sql: string) => {
    try {
      await conn.run(sql);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`SQL Error: ${msg}`);
      console.error(`SQL: ${sql.slice(0, 240)}...`);
      throw e;
    }
  };
  const query = async (sql: string): Promise<string> => {
    const reader = await conn.runAndReadAll(sql);
    const rows = reader.getRows();
    return rows.length > 0 ? String(rows[0][0]) : "0";
  };

  await run("SET memory_limit = '4GB'");
  await run("SET threads = 4");

  console.log("\n💊  Setting up Health+ database...\n");

  // ═══════════════════════════════════════════════════════
  // STEP 1: RAW VIEWS FROM CSV (brand-scrubbed)
  // ═══════════════════════════════════════════════════════
  console.log("Step 1: Creating brand-scrubbed raw views...");

  const csv = (t: string) => `read_csv('${CSV_DIR}/${t}.csv', auto_detect=true, ignore_errors=true)`;

  // Plain passthrough views (no brand strings inside)
  const plain: [string, string][] = [
    ["raw_patients", "patients"],
    ["raw_order_items", "order_items"],
    ["raw_rx_verifications_base", "rx_verifications"], // prescription_source scrubbed below
    ["raw_refill_subscriptions", "refill_subscriptions"],
    ["raw_lab_bookings", "lab_bookings"],
    ["raw_lab_booking_items", "lab_booking_items"],
    ["raw_lab_samples", "lab_samples"],
    ["raw_phlebotomists", "phlebotomists"],
    ["raw_consults", "consults"],
    ["raw_campaigns", "campaigns"],
    ["raw_campaign_contacts", "campaign_contacts"],
    ["raw_purchase_orders", "purchase_orders"],
    ["raw_grn_lines", "grn_lines"],
    ["raw_inventory_snapshots", "inventory_snapshots"],
    ["raw_calendar_events", "calendar_events"],
  ];
  for (const [view, file] of plain) {
    await run(`CREATE OR REPLACE VIEW ${view} AS SELECT * FROM ${csv(file)}`);
  }

  // customers: scrub acquisition_channel loyalty value, rename neu_linked → superapp_linked
  await run(`
    CREATE OR REPLACE VIEW raw_customers AS
    SELECT * EXCLUDE (neu_linked)
      REPLACE (CASE WHEN acquisition_channel = 'tata_neu' THEN 'super_app' ELSE acquisition_channel END AS acquisition_channel),
      neu_linked AS superapp_linked
    FROM ${csv("customers")}
  `);

  // orders: scrub channel/payment/carrier values, rename neucoins_* → coins_*
  await run(`
    CREATE OR REPLACE VIEW raw_orders AS
    SELECT * EXCLUDE (neucoins_earned, neucoins_redeemed)
      REPLACE (
        CASE WHEN channel = 'tata_neu' THEN 'super_app' ELSE channel END AS channel,
        CASE WHEN payment_mode = 'neucoins_mix' THEN 'coins_mix' ELSE payment_mode END AS payment_mode,
        ${scrub("carrier")} AS carrier
      ),
      neucoins_earned AS coins_earned,
      neucoins_redeemed AS coins_redeemed
    FROM ${csv("orders")}
  `);

  // rx_verifications: scrub prescription_source '1mg_consult' → 'healthplus_consult'
  await run(`
    CREATE OR REPLACE VIEW raw_rx_verifications AS
    SELECT * REPLACE (
      CASE WHEN prescription_source = '1mg_consult' THEN 'healthplus_consult' ELSE prescription_source END AS prescription_source
    ) FROM raw_rx_verifications_base
  `);

  // cart_abandonments: scrub channel value tata_neu → super_app (same convention as orders)
  await run(`
    CREATE OR REPLACE VIEW raw_cart_abandonments AS
    SELECT * REPLACE (
      CASE WHEN channel = 'tata_neu' THEN 'super_app' ELSE channel END AS channel
    ) FROM ${csv("cart_abandonments")}
  `);

  // skus: scrub sku_name + manufacturer
  await run(`
    CREATE OR REPLACE VIEW raw_skus AS
    SELECT * REPLACE (${scrub("sku_name")} AS sku_name, ${scrub("manufacturer")} AS manufacturer)
    FROM ${csv("skus")}
  `);
  // labs: scrub lab_name
  await run(`CREATE OR REPLACE VIEW raw_labs AS SELECT * REPLACE (${scrub("lab_name")} AS lab_name) FROM ${csv("labs")}`);
  // fulfillment_centers: scrub facility_name
  await run(`CREATE OR REPLACE VIEW raw_fulfillment_centers AS SELECT * REPLACE (${scrub("facility_name")} AS facility_name) FROM ${csv("fulfillment_centers")}`);
  // vendors: scrub vendor_name
  await run(`CREATE OR REPLACE VIEW raw_vendors AS SELECT * REPLACE (${scrub("vendor_name")} AS vendor_name) FROM ${csv("vendors")}`);

  console.log("  ✓ 22 raw views created (brand-scrubbed)");

  // ═══════════════════════════════════════════════════════
  // STEP 2: DIMENSION TABLES (materialized as-is)
  // ═══════════════════════════════════════════════════════
  console.log("Step 2: Materializing dimension tables...");
  await run(`CREATE OR REPLACE TABLE products AS SELECT * FROM raw_skus`);
  await run(`CREATE OR REPLACE TABLE fulfillment_centers AS SELECT * FROM raw_fulfillment_centers`);
  await run(`CREATE OR REPLACE TABLE labs AS SELECT * FROM raw_labs`);
  await run(`CREATE OR REPLACE TABLE phlebotomists AS SELECT * FROM raw_phlebotomists`);
  await run(`CREATE OR REPLACE TABLE vendors AS SELECT * FROM raw_vendors`);
  await run(`CREATE OR REPLACE TABLE patients AS SELECT * FROM raw_patients`);
  await run(`CREATE OR REPLACE TABLE campaigns AS SELECT * FROM raw_campaigns`);
  await run(`CREATE OR REPLACE TABLE calendar_seasonality AS SELECT * FROM raw_calendar_events`);
  console.log("  ✓ 8 dimension tables");

  // ═══════════════════════════════════════════════════════
  // STEP 3: DENORMALIZED TABLES
  // ═══════════════════════════════════════════════════════
  console.log("Step 3: Creating denormalized tables...");

  // orders_full — order-grained primary analytics table (orders + customer + FC)
  await run(`
    CREATE OR REPLACE TABLE orders_full AS
    SELECT
      o.*,
      c.acquisition_channel,
      c.care_plan_member,
      c.care_plan_start,
      c.chronic_flag AS customer_chronic_flag,
      c.primary_therapy,
      c.superapp_linked,
      c.age AS customer_age,
      c.gender AS customer_gender,
      c.app_platform,
      c.notif_opt_in,
      c.signup_date AS customer_signup_date,
      fc.facility_name,
      fc.facility_type,
      fc.temperature_controlled
    FROM raw_orders o
    LEFT JOIN raw_customers c ON o.customer_id = c.customer_id
    LEFT JOIN raw_fulfillment_centers fc ON o.fc_id = fc.facility_id
  `);
  console.log("  ✓ orders_full");

  // order_items_full — item-grained (order_items + order context + sku)
  await run(`
    CREATE OR REPLACE TABLE order_items_full AS
    SELECT
      oi.*,
      o.order_ts,
      o.customer_id,
      o.order_kind,
      o.city AS order_city,
      o.state AS order_state,
      o.city_tier AS order_city_tier,
      o.channel,
      o.status AS order_status,
      o.demand_theme AS order_demand_theme,
      s.sku_name,
      s.manufacturer,
      s.schedule_class,
      s.cold_chain,
      s.demand_theme AS sku_demand_theme
    FROM raw_order_items oi
    JOIN raw_orders o ON oi.order_id = o.order_id
    LEFT JOIN raw_skus s ON oi.sku_id = s.sku_id
  `);
  console.log("  ✓ order_items_full");

  // lab_bookings_full — booking + customer + patient + phlebotomist + sample + lab
  await run(`
    CREATE OR REPLACE TABLE lab_bookings_full AS
    SELECT
      lb.*,
      c.acquisition_channel,
      c.care_plan_member,
      c.chronic_flag AS customer_chronic_flag,
      c.city_tier AS customer_city_tier,
      p.relationship AS patient_relationship,
      p.age AS patient_age,
      p.gender AS patient_gender,
      ph.phlebotomist_name,
      ph.on_time_rate AS phlebo_on_time_rate,
      ph.rating AS phlebo_rating,
      s.lab_id,
      s.transport_mode,
      s.sample_rejected,
      s.rejection_reason AS sample_rejection_reason,
      s.promised_tat_hours,
      s.actual_tat_hours,
      s.tat_breach,
      s.abnormal_flag_count,
      l.lab_name,
      l.lab_type,
      l.nabl_accredited
    FROM raw_lab_bookings lb
    LEFT JOIN raw_customers c ON lb.customer_id = c.customer_id
    LEFT JOIN raw_patients p ON lb.patient_id = p.patient_id
    LEFT JOIN raw_phlebotomists ph ON lb.phlebotomist_id = ph.phlebotomist_id
    LEFT JOIN raw_lab_samples s ON lb.booking_id = s.booking_id
    LEFT JOIN raw_labs l ON s.lab_id = l.lab_id
  `);
  console.log("  ✓ lab_bookings_full");

  // consults_full — consult + customer context
  await run(`
    CREATE OR REPLACE TABLE consults_full AS
    SELECT
      co.*,
      c.acquisition_channel,
      c.care_plan_member,
      c.chronic_flag AS customer_chronic_flag,
      c.primary_therapy,
      c.city,
      c.state,
      c.city_tier,
      c.age AS customer_age,
      c.gender AS customer_gender
    FROM raw_consults co
    LEFT JOIN raw_customers c ON co.customer_id = c.customer_id
  `);
  console.log("  ✓ consults_full");

  // rx_verifications_full — rx verification + order context
  await run(`
    CREATE OR REPLACE TABLE rx_verifications_full AS
    SELECT
      rv.*,
      o.customer_id,
      o.order_ts,
      o.order_kind,
      o.demand_theme,
      o.city,
      o.state,
      o.city_tier,
      o.rx_required,
      o.status AS order_status
    FROM raw_rx_verifications rv
    LEFT JOIN raw_orders o ON rv.order_id = o.order_id
  `);
  console.log("  ✓ rx_verifications_full");

  // campaign_contacts_full — contact + campaign + customer context (338K rows)
  await run(`
    CREATE OR REPLACE TABLE campaign_contacts_full AS
    SELECT
      cc.*,
      cmp.campaign_name,
      cmp.target_segment,
      cmp.primary_channel,
      c.care_plan_member,
      c.chronic_flag AS customer_chronic_flag,
      c.primary_therapy,
      c.city_tier,
      c.acquisition_channel
    FROM raw_campaign_contacts cc
    LEFT JOIN raw_campaigns cmp ON cc.campaign_id = cmp.campaign_id
    LEFT JOIN raw_customers c ON cc.customer_id = c.customer_id
  `);
  console.log("  ✓ campaign_contacts_full");

  // refills_full — refill subscription + customer + primary sku
  await run(`
    CREATE OR REPLACE TABLE refills_full AS
    SELECT
      r.*,
      c.city_tier,
      c.care_plan_member,
      c.acquisition_channel,
      s.sku_name AS primary_sku_name,
      s.manufacturer AS primary_sku_manufacturer
    FROM raw_refill_subscriptions r
    LEFT JOIN raw_customers c ON r.customer_id = c.customer_id
    LEFT JOIN raw_skus s ON r.primary_sku_id = s.sku_id
  `);
  console.log("  ✓ refills_full");

  // inventory_full — weekly snapshot + sku + fc
  await run(`
    CREATE OR REPLACE TABLE inventory_full AS
    SELECT
      inv.*,
      s.sku_name,
      s.manufacturer,
      s.schedule_class,
      s.is_private_label,
      s.cold_chain,
      fc.facility_name,
      fc.facility_type,
      fc.state AS fc_state
    FROM raw_inventory_snapshots inv
    LEFT JOIN raw_skus s ON inv.sku_id = s.sku_id
    LEFT JOIN raw_fulfillment_centers fc ON inv.fc_id = fc.facility_id
  `);
  console.log("  ✓ inventory_full");

  // grn_full — goods receipt line + vendor + fc + sku
  await run(`
    CREATE OR REPLACE TABLE grn_full AS
    SELECT
      g.*,
      v.vendor_name,
      v.vendor_type,
      v.otif_score,
      v.avg_lead_time_days,
      fc.facility_name,
      s.sku_name,
      s.category AS sku_category
    FROM raw_grn_lines g
    LEFT JOIN raw_vendors v ON g.vendor_id = v.vendor_id
    LEFT JOIN raw_fulfillment_centers fc ON g.fc_id = fc.facility_id
    LEFT JOIN raw_skus s ON g.sku_id = s.sku_id
  `);
  console.log("  ✓ grn_full");

  // purchase_orders_full — PO + vendor + fc
  await run(`
    CREATE OR REPLACE TABLE purchase_orders_full AS
    SELECT
      po.*,
      v.vendor_name,
      v.vendor_type,
      v.otif_score,
      v.avg_lead_time_days,
      fc.facility_name,
      fc.facility_type
    FROM raw_purchase_orders po
    LEFT JOIN raw_vendors v ON po.vendor_id = v.vendor_id
    LEFT JOIN raw_fulfillment_centers fc ON po.fc_id = fc.facility_id
  `);
  console.log("  ✓ purchase_orders_full");

  // cart_abandonments_full — abandoned/recovered carts + customer context.
  // recovered = customer placed a follow-up order (recovery_order_id set);
  // recovery_hours = cart-to-order elapsed time.
  await run(`
    CREATE OR REPLACE TABLE cart_abandonments_full AS
    SELECT
      ca.*,
      c.acquisition_channel,
      c.care_plan_member,
      c.chronic_flag AS customer_chronic_flag,
      c.primary_therapy,
      c.city_tier,
      c.age AS customer_age,
      c.gender AS customer_gender
    FROM raw_cart_abandonments ca
    LEFT JOIN raw_customers c ON ca.customer_id = c.customer_id
  `);
  console.log("  ✓ cart_abandonments_full");

  // ═══════════════════════════════════════════════════════
  // STEP 3b: CUSTOMERS_FULL ENTITY TABLE
  //
  // Per-customer rollup — the clean user-grained table for SEGMENTS and
  // campaign targeting. Enriches the customer master with order behaviour,
  // refill/lab/consult activity, and campaign responsiveness. As-of 2026-05-31.
  // ═══════════════════════════════════════════════════════
  console.log("Step 3b: Creating customers_full entity table...");
  await run(`
    CREATE OR REPLACE TABLE customers_full AS
    WITH order_agg AS (
      SELECT
        customer_id,
        COUNT(*) AS orders_count,
        COUNT(*) FILTER (WHERE status = 'delivered') AS delivered_orders,
        COUNT(*) FILTER (WHERE status IN ('cancelled_customer','cancelled_rx_invalid','rto','returned')) AS failed_orders,
        COUNT(*) FILTER (WHERE order_kind = 'chronic_refill') AS chronic_refill_orders,
        COUNT(*) FILTER (WHERE order_kind = 'acute') AS acute_orders,
        COUNT(*) FILTER (WHERE order_kind = 'wellness') AS wellness_orders,
        SUM(paid_amount) FILTER (WHERE status = 'delivered') AS gmv_delivered,
        AVG(paid_amount) FILTER (WHERE status = 'delivered') AS avg_order_value_calc,
        SUM(coins_earned) AS coins_earned_total,
        SUM(coins_redeemed) AS coins_redeemed_total,
        MAX(order_ts) AS last_order_ts_calc
      FROM raw_orders
      GROUP BY customer_id
    ),
    refill_agg AS (
      SELECT customer_id,
        COUNT(*) AS refill_subscriptions,
        COUNT(*) FILTER (WHERE status = 'active') AS active_refills
      FROM raw_refill_subscriptions GROUP BY customer_id
    ),
    lab_agg AS (
      SELECT customer_id,
        COUNT(*) AS lab_bookings_count,
        COUNT(*) FILTER (WHERE status = 'completed') AS lab_completed_count,
        SUM(total_paid) AS lab_gmv
      FROM raw_lab_bookings GROUP BY customer_id
    ),
    consult_agg AS (
      SELECT customer_id, COUNT(*) AS consults_count, SUM(fee_paid) AS consult_fees_paid
      FROM raw_consults GROUP BY customer_id
    ),
    campaign_agg AS (
      SELECT customer_id,
        COUNT(*) AS campaigns_received,
        SUM(CAST(delivered AS INT)) AS campaigns_delivered,
        SUM(CAST(opened AS INT)) AS campaigns_opened,
        SUM(CAST(converted AS INT)) AS campaigns_converted
      FROM raw_campaign_contacts GROUP BY customer_id
    )
    SELECT
      c.*,
      COALESCE(oa.orders_count, 0) AS orders_count_actual,
      COALESCE(oa.delivered_orders, 0) AS delivered_orders,
      COALESCE(oa.failed_orders, 0) AS failed_orders,
      COALESCE(oa.chronic_refill_orders, 0) AS chronic_refill_orders,
      COALESCE(oa.acute_orders, 0) AS acute_orders,
      COALESCE(oa.wellness_orders, 0) AS wellness_orders,
      COALESCE(oa.gmv_delivered, 0) AS gmv_delivered,
      oa.avg_order_value_calc,
      COALESCE(oa.coins_earned_total, 0) AS coins_earned_total,
      COALESCE(oa.coins_redeemed_total, 0) AS coins_redeemed_total,
      oa.last_order_ts_calc,
      CASE WHEN oa.last_order_ts_calc IS NOT NULL
        THEN date_diff('day', CAST(oa.last_order_ts_calc AS DATE), DATE '2026-05-31') END AS days_since_last_order,
      COALESCE(ra.refill_subscriptions, 0) AS refill_subscriptions,
      COALESCE(ra.active_refills, 0) AS active_refills,
      COALESCE(la.lab_bookings_count, 0) AS lab_bookings_count,
      COALESCE(la.lab_completed_count, 0) AS lab_completed_count,
      COALESCE(la.lab_gmv, 0) AS lab_gmv,
      COALESCE(cca.consults_count, 0) AS consults_count,
      COALESCE(cca.consult_fees_paid, 0) AS consult_fees_paid,
      COALESCE(cam.campaigns_received, 0) AS campaigns_received,
      COALESCE(cam.campaigns_delivered, 0) AS campaigns_delivered,
      COALESCE(cam.campaigns_opened, 0) AS campaigns_opened,
      COALESCE(cam.campaigns_converted, 0) AS campaigns_converted
    FROM raw_customers c
    LEFT JOIN order_agg oa ON c.customer_id = oa.customer_id
    LEFT JOIN refill_agg ra ON c.customer_id = ra.customer_id
    LEFT JOIN lab_agg la ON c.customer_id = la.customer_id
    LEFT JOIN consult_agg cca ON c.customer_id = cca.customer_id
    LEFT JOIN campaign_agg cam ON c.customer_id = cam.customer_id
  `);
  console.log("  ✓ customers_full (38K customer-level rows)");

  // ═══════════════════════════════════════════════════════
  // STEP 4: SUMMARY TABLES
  // ═══════════════════════════════════════════════════════
  console.log("Step 4: Creating summary tables...");
  const monthExpr = (col: string) => `CAST(strftime(CAST(${col} AS DATE), '%Y-%m') || '-01' AS DATE)`;

  // 1. Company-level monthly KPIs (board rollup)
  await run(`
    CREATE OR REPLACE TABLE monthly_company_kpis AS
    SELECT
      ${monthExpr("order_ts")} AS month,
      COUNT(*) AS total_orders,
      COUNT(*) FILTER (WHERE status = 'delivered') AS delivered_orders,
      SUM(paid_amount) FILTER (WHERE status = 'delivered') AS gmv,
      AVG(paid_amount) FILTER (WHERE status = 'delivered') AS aov,
      SUM(discount_amount) FILTER (WHERE status = 'delivered') AS total_discount,
      COUNT(*) FILTER (WHERE is_first_order = true) AS new_customer_orders,
      COUNT(*) FILTER (WHERE rx_required = true) AS rx_orders,
      COUNT(*) FILTER (WHERE has_cold_chain = true) AS cold_chain_orders,
      COUNT(*) FILTER (WHERE order_kind = 'chronic_refill') AS chronic_refill_orders,
      CAST(COUNT(*) FILTER (WHERE sla_met = 1) AS DOUBLE) / NULLIF(COUNT(*) FILTER (WHERE sla_met IS NOT NULL), 0) * 100 AS sla_met_pct,
      CAST(COUNT(*) FILTER (WHERE status = 'delivered') AS DOUBLE) / COUNT(*) * 100 AS delivery_success_pct,
      SUM(coins_redeemed) AS coins_redeemed
    FROM raw_orders GROUP BY 1 ORDER BY 1
  `);
  console.log("  ✓ monthly_company_kpis");

  // 2. GMV by order kind
  await run(`
    CREATE OR REPLACE TABLE monthly_gmv_by_kind AS
    SELECT ${monthExpr("order_ts")} AS month, order_kind,
      COUNT(*) AS orders,
      SUM(paid_amount) FILTER (WHERE status = 'delivered') AS gmv,
      AVG(paid_amount) FILTER (WHERE status = 'delivered') AS aov
    FROM raw_orders GROUP BY 1, 2 ORDER BY 1, 2
  `);
  console.log("  ✓ monthly_gmv_by_kind");

  // 3. Demand theme monthly
  await run(`
    CREATE OR REPLACE TABLE demand_theme_monthly AS
    SELECT ${monthExpr("order_ts")} AS month, demand_theme,
      COUNT(*) AS orders,
      SUM(paid_amount) FILTER (WHERE status = 'delivered') AS gmv
    FROM raw_orders GROUP BY 1, 2 ORDER BY 1, 2
  `);
  console.log("  ✓ demand_theme_monthly");

  // 4. Category performance (item-grained)
  await run(`
    CREATE OR REPLACE TABLE category_performance AS
    SELECT category,
      COUNT(*) AS item_lines,
      SUM(qty) AS units,
      SUM(line_total) AS revenue,
      AVG(discount_pct) AS avg_discount_pct,
      CAST(COUNT(*) FILTER (WHERE is_private_label = true) AS DOUBLE) / COUNT(*) * 100 AS private_label_pct,
      CAST(COUNT(*) FILTER (WHERE is_substituted = true) AS DOUBLE) / COUNT(*) * 100 AS substitution_pct
    FROM raw_order_items GROUP BY 1 ORDER BY revenue DESC
  `);
  console.log("  ✓ category_performance");

  // 5. Channel performance
  await run(`
    CREATE OR REPLACE TABLE channel_performance AS
    SELECT channel,
      COUNT(*) AS orders,
      SUM(paid_amount) FILTER (WHERE status = 'delivered') AS gmv,
      AVG(paid_amount) FILTER (WHERE status = 'delivered') AS aov,
      CAST(COUNT(*) FILTER (WHERE status = 'delivered') AS DOUBLE) / COUNT(*) * 100 AS delivery_success_pct,
      CAST(COUNT(*) FILTER (WHERE is_first_order = true) AS DOUBLE) / COUNT(*) * 100 AS first_order_pct
    FROM raw_orders GROUP BY 1 ORDER BY orders DESC
  `);
  console.log("  ✓ channel_performance");

  // 6. City / tier KPIs monthly
  await run(`
    CREATE OR REPLACE TABLE city_tier_kpis AS
    SELECT city, city_tier, ${monthExpr("order_ts")} AS month,
      COUNT(*) AS orders,
      SUM(paid_amount) FILTER (WHERE status = 'delivered') AS gmv,
      AVG(paid_amount) FILTER (WHERE status = 'delivered') AS aov
    FROM raw_orders GROUP BY 1, 2, 3 ORDER BY 3, 1
  `);
  console.log("  ✓ city_tier_kpis");

  // 7. Fulfillment SLA by FC + service tier
  await run(`
    CREATE OR REPLACE TABLE fulfillment_sla AS
    SELECT
      o.fc_id, fc.facility_name, fc.facility_type, o.service_tier,
      COUNT(*) AS orders,
      CAST(COUNT(*) FILTER (WHERE o.sla_met = 1) AS DOUBLE) / NULLIF(COUNT(*) FILTER (WHERE o.sla_met IS NOT NULL), 0) * 100 AS sla_met_pct,
      AVG(o.delivery_hours) AS avg_delivery_hours,
      CAST(COUNT(*) FILTER (WHERE o.status = 'rto') AS DOUBLE) / COUNT(*) * 100 AS rto_pct,
      CAST(COUNT(*) FILTER (WHERE o.status = 'returned') AS DOUBLE) / COUNT(*) * 100 AS return_pct
    FROM raw_orders o
    LEFT JOIN raw_fulfillment_centers fc ON o.fc_id = fc.facility_id
    GROUP BY 1, 2, 3, 4 ORDER BY orders DESC
  `);
  console.log("  ✓ fulfillment_sla");

  // 8. Rx verification KPIs monthly
  await run(`
    CREATE OR REPLACE TABLE rx_verification_kpis AS
    SELECT ${monthExpr("submitted_at")} AS month,
      COUNT(*) AS submitted,
      COUNT(*) FILTER (WHERE outcome = 'approved') AS approved,
      COUNT(*) FILTER (WHERE outcome = 'rejected') AS rejected,
      CAST(COUNT(*) FILTER (WHERE outcome = 'approved') AS DOUBLE) / COUNT(*) * 100 AS approval_rate_pct,
      AVG(tat_minutes) AS avg_tat_minutes
    FROM raw_rx_verifications GROUP BY 1 ORDER BY 1
  `);
  console.log("  ✓ rx_verification_kpis");

  // 9. Rx rejection reasons
  await run(`
    CREATE OR REPLACE TABLE rx_rejection_reasons AS
    SELECT rejection_reason, COUNT(*) AS rejections
    FROM raw_rx_verifications WHERE outcome = 'rejected' AND rejection_reason <> ''
    GROUP BY 1 ORDER BY rejections DESC
  `);
  console.log("  ✓ rx_rejection_reasons");

  // 10. Lab booking funnel monthly
  await run(`
    CREATE OR REPLACE TABLE lab_booking_funnel_monthly AS
    SELECT ${monthExpr("booking_ts")} AS month, booking_type,
      COUNT(*) AS bookings,
      COUNT(*) FILTER (WHERE status = 'completed') AS completed,
      COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
      COUNT(*) FILTER (WHERE status = 'failed_collection') AS failed_collection,
      SUM(total_paid) FILTER (WHERE status = 'completed') AS gmv
    FROM raw_lab_bookings GROUP BY 1, 2 ORDER BY 1, 2
  `);
  console.log("  ✓ lab_booking_funnel_monthly");

  // 11. Lab TAT / quality summary
  await run(`
    CREATE OR REPLACE TABLE lab_tat_summary AS
    SELECT l.lab_id, l.lab_name, l.lab_type, l.city, l.nabl_accredited,
      COUNT(*) AS samples,
      CAST(COUNT(*) FILTER (WHERE s.tat_breach = true) AS DOUBLE) / COUNT(*) * 100 AS tat_breach_pct,
      CAST(COUNT(*) FILTER (WHERE s.sample_rejected = true) AS DOUBLE) / COUNT(*) * 100 AS sample_rejection_pct,
      AVG(s.actual_tat_hours) AS avg_actual_tat_hours,
      AVG(s.promised_tat_hours) AS avg_promised_tat_hours
    FROM raw_lab_samples s
    LEFT JOIN raw_labs l ON s.lab_id = l.lab_id
    GROUP BY 1, 2, 3, 4, 5 ORDER BY samples DESC
  `);
  console.log("  ✓ lab_tat_summary");

  // 12. Consult summary by specialty
  await run(`
    CREATE OR REPLACE TABLE consult_summary AS
    SELECT specialty,
      COUNT(*) AS consults,
      CAST(COUNT(*) FILTER (WHERE rx_issued = true) AS DOUBLE) / COUNT(*) * 100 AS rx_issued_pct,
      AVG(response_time_min) AS avg_response_time_min,
      AVG(fee_paid) AS avg_fee,
      SUM(fee_paid) AS total_fees
    FROM raw_consults GROUP BY 1 ORDER BY consults DESC
  `);
  console.log("  ✓ consult_summary");

  // 13. Campaign performance
  await run(`
    CREATE OR REPLACE TABLE campaign_performance AS
    SELECT
      cc.campaign_id, cmp.campaign_name, cc.campaign_type, cc.channel,
      COUNT(*) AS sent,
      SUM(CAST(cc.delivered AS INT)) AS delivered,
      SUM(CAST(cc.opened AS INT)) AS opened,
      SUM(CAST(cc.clicked AS INT)) AS clicked,
      SUM(CAST(cc.converted AS INT)) AS converted,
      CAST(SUM(CAST(cc.delivered AS INT)) AS DOUBLE) / COUNT(*) * 100 AS delivery_pct,
      CAST(SUM(CAST(cc.opened AS INT)) AS DOUBLE) / NULLIF(SUM(CAST(cc.delivered AS INT)), 0) * 100 AS open_rate_pct,
      CAST(SUM(CAST(cc.converted AS INT)) AS DOUBLE) / NULLIF(SUM(CAST(cc.delivered AS INT)), 0) * 100 AS conversion_rate_pct,
      SUM(cc.conversion_value) AS revenue
    FROM raw_campaign_contacts cc
    LEFT JOIN raw_campaigns cmp ON cc.campaign_id = cmp.campaign_id
    GROUP BY 1, 2, 3, 4 ORDER BY sent DESC
  `);
  console.log("  ✓ campaign_performance");

  // 14. Refill subscription summary
  await run(`
    CREATE OR REPLACE TABLE refill_summary AS
    SELECT therapy, status,
      COUNT(*) AS subscriptions,
      AVG(cadence_days) AS avg_cadence_days
    FROM raw_refill_subscriptions GROUP BY 1, 2 ORDER BY subscriptions DESC
  `);
  console.log("  ✓ refill_summary");

  // 15. Inventory health by category + FC
  await run(`
    CREATE OR REPLACE TABLE inventory_health AS
    SELECT inv.category, inv.fc_id, fc.facility_name, fc.facility_type,
      COUNT(*) AS snapshots,
      CAST(SUM(inv.stockout_flag) AS DOUBLE) / COUNT(*) * 100 AS stockout_rate_pct,
      AVG(inv.weeks_of_cover) AS avg_weeks_of_cover,
      SUM(inv.near_expiry_units) AS near_expiry_units,
      SUM(inv.demand_units) AS total_demand_units
    FROM raw_inventory_snapshots inv
    LEFT JOIN raw_fulfillment_centers fc ON inv.fc_id = fc.facility_id
    GROUP BY 1, 2, 3, 4 ORDER BY stockout_rate_pct DESC
  `);
  console.log("  ✓ inventory_health");

  // 16. Vendor scorecard
  await run(`
    CREATE OR REPLACE TABLE vendor_scorecard AS
    WITH po AS (
      SELECT vendor_id, COUNT(*) AS po_count, SUM(total_value) AS po_value,
        COUNT(*) FILTER (WHERE status = 'partially_received') AS partial_pos
      FROM raw_purchase_orders GROUP BY vendor_id
    ),
    grn AS (
      SELECT vendor_id, COUNT(*) AS grn_lines,
        CAST(COUNT(*) FILTER (WHERE qc_status = 'passed') AS DOUBLE) / COUNT(*) * 100 AS qc_pass_pct,
        CAST(COUNT(*) FILTER (WHERE qc_status = 'damaged_rejected') AS DOUBLE) / COUNT(*) * 100 AS qc_reject_pct
      FROM raw_grn_lines GROUP BY vendor_id
    )
    SELECT v.vendor_id, v.vendor_name, v.vendor_type, v.otif_score, v.avg_lead_time_days,
      COALESCE(po.po_count, 0) AS po_count,
      COALESCE(po.po_value, 0) AS po_value,
      COALESCE(po.partial_pos, 0) AS partial_pos,
      COALESCE(grn.grn_lines, 0) AS grn_lines,
      grn.qc_pass_pct,
      grn.qc_reject_pct
    FROM raw_vendors v
    LEFT JOIN po ON v.vendor_id = po.vendor_id
    LEFT JOIN grn ON v.vendor_id = grn.vendor_id
    ORDER BY po_value DESC
  `);
  console.log("  ✓ vendor_scorecard");

  // 17. Acquisition cohort monthly
  await run(`
    CREATE OR REPLACE TABLE acquisition_monthly AS
    SELECT ${monthExpr("signup_date")} AS signup_month, acquisition_channel,
      COUNT(*) AS new_customers,
      COUNT(*) FILTER (WHERE care_plan_member = true) AS care_plan_members,
      COUNT(*) FILTER (WHERE chronic_flag = true) AS chronic_customers,
      AVG(total_spend) AS avg_lifetime_spend
    FROM raw_customers GROUP BY 1, 2 ORDER BY 1, 2
  `);
  console.log("  ✓ acquisition_monthly");

  // 18. Cart abandonment & recovery monthly (by channel)
  await run(`
    CREATE OR REPLACE TABLE cart_abandonment_monthly AS
    SELECT ${monthExpr("cart_ts")} AS month, channel,
      COUNT(*) AS carts,
      COUNT(*) FILTER (WHERE status = 'recovered') AS recovered,
      COUNT(*) FILTER (WHERE status = 'abandoned') AS abandoned,
      CAST(COUNT(*) FILTER (WHERE status = 'recovered') AS DOUBLE) / COUNT(*) * 100 AS recovery_rate_pct,
      SUM(cart_value) AS cart_value_total,
      SUM(cart_value) FILTER (WHERE status = 'recovered') AS recovered_value,
      SUM(cart_value) FILTER (WHERE status = 'abandoned') AS lost_value,
      AVG(recovery_hours) FILTER (WHERE status = 'recovered') AS avg_recovery_hours
    FROM raw_cart_abandonments GROUP BY 1, 2 ORDER BY 1, 2
  `);
  console.log("  ✓ cart_abandonment_monthly");

  // ═══════════════════════════════════════════════════════
  // STEP 5: VERIFY + BRAND SCRUB CHECK
  // ═══════════════════════════════════════════════════════
  console.log("\nStep 5: Verifying...");
  const customers = await query("SELECT COUNT(*) FROM customers_full");
  const orders = await query("SELECT COUNT(*) FROM orders_full");
  const items = await query("SELECT COUNT(*) FROM order_items_full");
  const labs = await query("SELECT COUNT(*) FROM lab_bookings_full");
  const consults = await query("SELECT COUNT(*) FROM consults_full");
  const rx = await query("SELECT COUNT(*) FROM rx_verifications_full");
  const contacts = await query("SELECT COUNT(*) FROM campaign_contacts_full");
  const carts = await query("SELECT COUNT(*) FROM cart_abandonments_full");
  console.log(`  Customers: ${Number(customers).toLocaleString()}`);
  console.log(`  Orders: ${Number(orders).toLocaleString()}`);
  console.log(`  Order items: ${Number(items).toLocaleString()}`);
  console.log(`  Lab bookings: ${Number(labs).toLocaleString()}`);
  console.log(`  Consults: ${Number(consults).toLocaleString()}`);
  console.log(`  Rx verifications: ${Number(rx).toLocaleString()}`);
  console.log(`  Campaign contacts: ${Number(contacts).toLocaleString()}`);
  console.log(`  Cart abandonments: ${Number(carts).toLocaleString()}`);

  // Brand scrub verification — no 'tata'/'1mg'/'neucoins'/'tata_neu' anywhere user-visible
  const leak = await query(`
    SELECT
      (SELECT COUNT(*) FROM products WHERE sku_name ILIKE '%1mg%' OR sku_name ILIKE '%tata%' OR manufacturer ILIKE '%1mg%' OR manufacturer ILIKE '%tata 1mg%')
    + (SELECT COUNT(*) FROM labs WHERE lab_name ILIKE '%1mg%' OR lab_name ILIKE '%tata%')
    + (SELECT COUNT(*) FROM fulfillment_centers WHERE facility_name ILIKE '%1mg%' OR facility_name ILIKE '%tata%')
    + (SELECT COUNT(*) FROM vendors WHERE vendor_name ILIKE '%1mg%' OR vendor_name ILIKE '%tata%')
    + (SELECT COUNT(*) FROM orders_full WHERE carrier ILIKE '%1mg%' OR channel = 'tata_neu' OR payment_mode = 'neucoins_mix')
    + (SELECT COUNT(*) FROM rx_verifications_full WHERE prescription_source ILIKE '%1mg%')
    + (SELECT COUNT(*) FROM cart_abandonments_full WHERE channel = 'tata_neu')
  `);
  if (Number(leak) > 0) {
    console.error(`❌ Brand scrub incomplete — ${leak} rows still reference Tata/1mg/neucoins`);
    process.exit(1);
  }
  console.log("  ✓ Brand scrub verified — no Tata/1mg/neucoins references remain");

  // ═══════════════════════════════════════════════════════
  // STEP 6: DROP CSV-BACKED RAW VIEWS (make DB self-contained)
  // ═══════════════════════════════════════════════════════
  console.log("\nStep 6: Dropping CSV-backed raw views...");
  const rawViews = [
    "raw_customers", "raw_patients", "raw_orders", "raw_order_items", "raw_skus",
    "raw_rx_verifications", "raw_rx_verifications_base", "raw_refill_subscriptions",
    "raw_lab_bookings", "raw_lab_booking_items", "raw_lab_samples", "raw_labs",
    "raw_phlebotomists", "raw_consults", "raw_campaigns", "raw_campaign_contacts",
    "raw_fulfillment_centers", "raw_vendors", "raw_purchase_orders", "raw_grn_lines",
    "raw_inventory_snapshots", "raw_calendar_events", "raw_cart_abandonments",
  ];
  for (const v of rawViews) await run(`DROP VIEW IF EXISTS ${v}`);
  console.log(`  ✓ Dropped ${rawViews.length} raw views`);

  await run("CHECKPOINT");

  console.log(`\n✅ Health+ database ready at: ${DB_PATH}`);
  console.log("   13 denormalized tables + 8 dimensions + 18 summary tables (all materialized, no CSV dependency).\n");
}

main().catch((e) => {
  console.error("Setup failed:", e);
  process.exit(1);
});
