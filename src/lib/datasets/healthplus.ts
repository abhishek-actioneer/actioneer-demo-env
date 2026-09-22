import type { EventDefinition } from "../explorer-types";
import type { DatasetConfig } from "./types";

// ══════════════════════════════════════════════════════════
// Health+ — fictional Indian digital-health superapp
// (e-pharmacy + diagnostics + teleconsult). Tata 1mg-shaped source data,
// brand-scrubbed to "Health+" by scripts/setup-healthplus.ts.
// ══════════════════════════════════════════════════════════

// ── EVENT PROPERTIES (for Analytics Explorer / funnel builder) ──
// Every column below is real on the referenced table.

const ORDER_PROPERTIES: EventDefinition["properties"] = [
  { column: "order_kind", displayName: "Order Kind", type: "string", cardinalityHint: "low" },
  { column: "demand_theme", displayName: "Demand Theme", type: "string", cardinalityHint: "medium" },
  { column: "channel", displayName: "Channel", type: "string", cardinalityHint: "low" },
  { column: "payment_mode", displayName: "Payment Mode", type: "string", cardinalityHint: "low" },
  { column: "service_tier", displayName: "Service Tier", type: "string", cardinalityHint: "low" },
  { column: "status", displayName: "Order Status", type: "string", cardinalityHint: "low" },
  { column: "city", displayName: "City", type: "string", cardinalityHint: "medium" },
  { column: "state", displayName: "State", type: "string", cardinalityHint: "medium" },
  { column: "city_tier", displayName: "City Tier", type: "string", cardinalityHint: "low" },
  { column: "rx_required", displayName: "Rx Required", type: "string", cardinalityHint: "low" },
  { column: "has_cold_chain", displayName: "Cold Chain", type: "string", cardinalityHint: "low" },
  { column: "cod_flag", displayName: "Cash on Delivery", type: "string", cardinalityHint: "low" },
  { column: "is_first_order", displayName: "First Order", type: "string", cardinalityHint: "low" },
  { column: "carrier", displayName: "Carrier", type: "string", cardinalityHint: "low" },
  { column: "facility_type", displayName: "Facility Type", type: "string", cardinalityHint: "low" },
  { column: "acquisition_channel", displayName: "Acquisition Channel", type: "string", cardinalityHint: "low" },
  { column: "care_plan_member", displayName: "Care Plan Member", type: "string", cardinalityHint: "low" },
  { column: "primary_therapy", displayName: "Primary Therapy", type: "string", cardinalityHint: "medium" },
];

const LAB_PROPERTIES: EventDefinition["properties"] = [
  { column: "booking_type", displayName: "Booking Type", type: "string", cardinalityHint: "low" },
  { column: "booking_source", displayName: "Booking Source", type: "string", cardinalityHint: "low" },
  { column: "demand_theme", displayName: "Demand Theme", type: "string", cardinalityHint: "medium" },
  { column: "status", displayName: "Booking Status", type: "string", cardinalityHint: "low" },
  { column: "city", displayName: "City", type: "string", cardinalityHint: "medium" },
  { column: "lab_type", displayName: "Lab Type", type: "string", cardinalityHint: "low" },
  { column: "transport_mode", displayName: "Transport Mode", type: "string", cardinalityHint: "low" },
  { column: "tat_breach", displayName: "TAT Breach", type: "string", cardinalityHint: "low" },
  { column: "sample_rejected", displayName: "Sample Rejected", type: "string", cardinalityHint: "low" },
  { column: "patient_relationship", displayName: "Patient Relationship", type: "string", cardinalityHint: "low" },
  { column: "care_plan_member", displayName: "Care Plan Member", type: "string", cardinalityHint: "low" },
];

const CONSULT_PROPERTIES: EventDefinition["properties"] = [
  { column: "specialty", displayName: "Specialty", type: "string", cardinalityHint: "medium" },
  { column: "consult_source", displayName: "Consult Source", type: "string", cardinalityHint: "low" },
  { column: "rx_issued", displayName: "Rx Issued", type: "string", cardinalityHint: "low" },
  { column: "city_tier", displayName: "City Tier", type: "string", cardinalityHint: "low" },
  { column: "care_plan_member", displayName: "Care Plan Member", type: "string", cardinalityHint: "low" },
];

const RX_PROPERTIES: EventDefinition["properties"] = [
  { column: "prescription_source", displayName: "Prescription Source", type: "string", cardinalityHint: "low" },
  { column: "outcome", displayName: "Outcome", type: "string", cardinalityHint: "low" },
  { column: "rejection_reason", displayName: "Rejection Reason", type: "string", cardinalityHint: "low" },
  { column: "order_kind", displayName: "Order Kind", type: "string", cardinalityHint: "low" },
  { column: "demand_theme", displayName: "Demand Theme", type: "string", cardinalityHint: "medium" },
];

const CAMPAIGN_PROPERTIES: EventDefinition["properties"] = [
  { column: "campaign_type", displayName: "Campaign Type", type: "string", cardinalityHint: "low" },
  { column: "channel", displayName: "Channel", type: "string", cardinalityHint: "low" },
  { column: "campaign_name", displayName: "Campaign Name", type: "string", cardinalityHint: "medium" },
  { column: "conversion_type", displayName: "Conversion Type", type: "string", cardinalityHint: "low" },
  { column: "care_plan_member", displayName: "Care Plan Member", type: "string", cardinalityHint: "low" },
  { column: "primary_therapy", displayName: "Primary Therapy", type: "string", cardinalityHint: "medium" },
];

const CART_PROPERTIES: EventDefinition["properties"] = [
  { column: "demand_theme", displayName: "Demand Theme", type: "string", cardinalityHint: "medium" },
  { column: "channel", displayName: "Channel", type: "string", cardinalityHint: "low" },
  { column: "status", displayName: "Cart Status", type: "string", cardinalityHint: "low" },
  { column: "city", displayName: "City", type: "string", cardinalityHint: "medium" },
  { column: "city_tier", displayName: "City Tier", type: "string", cardinalityHint: "low" },
  { column: "acquisition_channel", displayName: "Acquisition Channel", type: "string", cardinalityHint: "low" },
  { column: "care_plan_member", displayName: "Care Plan Member", type: "string", cardinalityHint: "low" },
  { column: "primary_therapy", displayName: "Primary Therapy", type: "string", cardinalityHint: "medium" },
];

// ══════════════════════════════════════════════════════════
// EVENTS CATALOG
// funnelEligible events carry a real per-event timestamp AND customer_id.
// ══════════════════════════════════════════════════════════

const HEALTHPLUS_EVENTS: EventDefinition[] = [
  // ── COMMERCE / ORDERS ──
  { id: "order_placed", displayName: "Order Placed", category: "Commerce", table: "orders_full", dateColumn: "order_ts", countColumn: "*", valueColumn: "paid_amount", properties: ORDER_PROPERTIES },
  { id: "first_order", displayName: "First Order", category: "Commerce", table: "orders_full", dateColumn: "order_ts", countColumn: "*", valueColumn: "paid_amount", filterSQL: "is_first_order = true", properties: ORDER_PROPERTIES },
  { id: "chronic_refill_order", displayName: "Chronic Refill Order", category: "Commerce", table: "orders_full", dateColumn: "order_ts", countColumn: "*", valueColumn: "paid_amount", filterSQL: "order_kind = 'chronic_refill'", properties: ORDER_PROPERTIES },
  { id: "acute_order", displayName: "Acute Order", category: "Commerce", table: "orders_full", dateColumn: "order_ts", countColumn: "*", valueColumn: "paid_amount", filterSQL: "order_kind = 'acute'", properties: ORDER_PROPERTIES },
  { id: "wellness_order", displayName: "Wellness Order", category: "Commerce", table: "orders_full", dateColumn: "order_ts", countColumn: "*", valueColumn: "paid_amount", filterSQL: "order_kind = 'wellness'", properties: ORDER_PROPERTIES },
  { id: "rx_order", displayName: "Prescription Order", category: "Commerce", table: "orders_full", dateColumn: "order_ts", countColumn: "*", valueColumn: "paid_amount", filterSQL: "rx_required = true", properties: ORDER_PROPERTIES },
  { id: "cold_chain_order", displayName: "Cold-Chain Order", category: "Commerce", table: "orders_full", dateColumn: "order_ts", countColumn: "*", valueColumn: "paid_amount", filterSQL: "has_cold_chain = true", properties: ORDER_PROPERTIES },

  // ── FULFILLMENT / LOGISTICS ──
  { id: "order_delivered", displayName: "Order Delivered", category: "Fulfillment", table: "orders_full", dateColumn: "delivered_ts", countColumn: "*", valueColumn: "paid_amount", filterSQL: "status = 'delivered'", properties: ORDER_PROPERTIES },
  { id: "order_sla_met", displayName: "Delivered On-SLA", category: "Fulfillment", table: "orders_full", dateColumn: "delivered_ts", countColumn: "*", filterSQL: "status = 'delivered' AND sla_met = 1", properties: ORDER_PROPERTIES },
  { id: "order_rto", displayName: "Return to Origin (RTO)", category: "Fulfillment", table: "orders_full", dateColumn: "order_ts", countColumn: "*", filterSQL: "status = 'rto'", properties: ORDER_PROPERTIES },
  { id: "order_returned", displayName: "Order Returned", category: "Fulfillment", table: "orders_full", dateColumn: "order_ts", countColumn: "*", filterSQL: "status = 'returned'", properties: ORDER_PROPERTIES },
  { id: "order_cancelled", displayName: "Order Cancelled", category: "Fulfillment", table: "orders_full", dateColumn: "order_ts", countColumn: "*", filterSQL: "status IN ('cancelled_customer','cancelled_rx_invalid')", properties: ORDER_PROPERTIES },

  // ── PRESCRIPTION VERIFICATION ──
  { id: "rx_submitted", displayName: "Rx Submitted", category: "Rx Verification", table: "rx_verifications_full", dateColumn: "submitted_at", countColumn: "*", properties: RX_PROPERTIES },
  { id: "rx_approved", displayName: "Rx Approved", category: "Rx Verification", table: "rx_verifications_full", dateColumn: "verified_at", countColumn: "*", filterSQL: "outcome = 'approved'", properties: RX_PROPERTIES },
  { id: "rx_rejected", displayName: "Rx Rejected", category: "Rx Verification", table: "rx_verifications_full", dateColumn: "verified_at", countColumn: "*", filterSQL: "outcome = 'rejected'", properties: RX_PROPERTIES },

  // ── DIAGNOSTICS / LABS ──
  { id: "lab_booked", displayName: "Lab Test Booked", category: "Diagnostics", table: "lab_bookings_full", dateColumn: "booking_ts", countColumn: "*", valueColumn: "total_paid", properties: LAB_PROPERTIES },
  { id: "home_collection_booked", displayName: "Home Collection Booked", category: "Diagnostics", table: "lab_bookings_full", dateColumn: "booking_ts", countColumn: "*", valueColumn: "total_paid", filterSQL: "booking_type = 'home_collection'", properties: LAB_PROPERTIES },
  { id: "lab_completed", displayName: "Lab Booking Completed", category: "Diagnostics", table: "lab_bookings_full", dateColumn: "booking_ts", countColumn: "*", valueColumn: "total_paid", filterSQL: "status = 'completed'", properties: LAB_PROPERTIES },
  { id: "lab_cancelled", displayName: "Lab Booking Cancelled", category: "Diagnostics", table: "lab_bookings_full", dateColumn: "booking_ts", countColumn: "*", filterSQL: "status IN ('cancelled','failed_collection')", properties: LAB_PROPERTIES },
  { id: "lab_tat_breach", displayName: "Report TAT Breach", category: "Diagnostics", table: "lab_bookings_full", dateColumn: "booking_ts", countColumn: "*", filterSQL: "tat_breach = true", properties: LAB_PROPERTIES },

  // ── TELECONSULT ──
  { id: "consult_completed", displayName: "Teleconsult Completed", category: "Teleconsult", table: "consults_full", dateColumn: "consult_ts", countColumn: "*", valueColumn: "fee_paid", properties: CONSULT_PROPERTIES },
  { id: "consult_rx_issued", displayName: "Consult Rx Issued", category: "Teleconsult", table: "consults_full", dateColumn: "consult_ts", countColumn: "*", filterSQL: "rx_issued = true", properties: CONSULT_PROPERTIES },

  // ── GROWTH / CAMPAIGNS ──
  { id: "campaign_sent", displayName: "Campaign Message Sent", category: "Growth", table: "campaign_contacts_full", dateColumn: "sent_ts", countColumn: "*", properties: CAMPAIGN_PROPERTIES },
  { id: "campaign_delivered", displayName: "Campaign Delivered", category: "Growth", table: "campaign_contacts_full", dateColumn: "sent_ts", countColumn: "*", filterSQL: "delivered = true", properties: CAMPAIGN_PROPERTIES },
  { id: "campaign_opened", displayName: "Campaign Opened", category: "Growth", table: "campaign_contacts_full", dateColumn: "sent_ts", countColumn: "*", filterSQL: "opened = true", properties: CAMPAIGN_PROPERTIES },
  { id: "campaign_converted", displayName: "Campaign Converted", category: "Growth", table: "campaign_contacts_full", dateColumn: "sent_ts", countColumn: "*", valueColumn: "conversion_value", filterSQL: "converted = true", properties: CAMPAIGN_PROPERTIES },

  // ── CART / CHECKOUT ──
  { id: "cart_abandoned", displayName: "Cart Abandoned", category: "Cart Recovery", table: "cart_abandonments_full", dateColumn: "cart_ts", countColumn: "*", valueColumn: "cart_value", properties: CART_PROPERTIES },
  { id: "cart_recovered", displayName: "Cart Recovered", category: "Cart Recovery", table: "cart_abandonments_full", dateColumn: "cart_ts", countColumn: "*", valueColumn: "cart_value", filterSQL: "status = 'recovered'", properties: CART_PROPERTIES },
];

export const healthplusDataset: DatasetConfig = {
  id: "healthplus",
  label: "E-Pharmacy & Health",
  companyName: "Health+",
  dbFile: "data/healthplus.duckdb",
  sourceType: "csv",
  primaryTable: "orders_full",
  // Segments are a set of customers, so Users/Composition tabs and preview
  // resolve against the customer-level table (one row per customer with rolled-up
  // order/lab/consult/refill/campaign behaviour), not the order-grained primaryTable.
  entityTable: "customers_full",
  userIdField: "customer_id",
  dateField: "order_ts",
  dateRange: { start: "2024-06-01", end: "2026-05-31" },
  currency: "₹",
  entityName: "customers",
  events: HEALTHPLUS_EVENTS,

  reportMeta: {
    totalEvents: "2.61L orders · 7.03L order items · 1.86L Rx checks",
    totalUsers: "38K customers · 40K lab bookings · 14K consults",
    dateRangeLabel: "Jun 2024 – May 2026",
    dbName: "healthplus.duckdb",
  },

  suggestedPrompts: [
    "How has monthly GMV and AOV trended across chronic-refill, acute, and wellness orders?",
    "What is our delivery SLA-met rate by service tier and fulfillment center?",
    "What is the prescription verification approval rate, and what are the top rejection reasons?",
    "How is the diagnostics funnel converting — home-collection bookings to completed reports — and where are TAT breaches concentrated?",
    "Which retention campaigns drive the highest conversion rate and revenue per message?",
    "Which customer segments are lapsing on chronic refills, and how large is the winback opportunity?",
    "What is our checkout cart-abandonment recovery rate by channel, and how much GMV are we losing to abandoned carts?",
  ],

  welcomeSubtitle: "Ask about e-pharmacy GMV, delivery SLAs, prescription verification, diagnostics operations, teleconsult, retention campaigns, and supply chain.",

  // ═══════════════════════════════════════════════════════
  // SYSTEM CONTEXT (LLM persona)
  // ═══════════════════════════════════════════════════════
  systemContext: `You are Actioneer, an AI-powered analytics assistant for Health+, a digital-health superapp in India spanning e-pharmacy, diagnostics, and teleconsultation.

Dataset: ~2.61 lakh orders + 7.03 lakh order items + 1.86 lakh prescription verifications + 40K lab bookings + 14K teleconsults + 4.57 lakh campaign contacts + 1.47 lakh abandoned carts, Jun 2024 – May 2026.
Today's date in this dataset: 2026-05-31.
- 38K customers across Metro / Tier-2 / Tier-3 cities; a large chronic-care base (diabetes, hypertension, cardiac, thyroid) driving recurring refill demand
- Three verticals: e-pharmacy (medicines, OTC, health products, devices), diagnostics (home collection + centre visits), and teleconsult
- Fulfilled from 63 facilities (fulfillment centers, dark stores, retail stores) with own + partner labs and a 700-strong phlebotomist network
- Currency in INR (₹)

You cover six analytics domains:
1. COMMERCE & GMV — order volume, GMV, AOV, discount mix by order kind (chronic_refill / acute / wellness), category, and channel
2. FULFILLMENT & LOGISTICS — delivery success, SLA-met rate, service-tier performance, RTO/returns by fulfillment center
3. PRESCRIPTION & COMPLIANCE — Rx verification approval rate, rejection reasons, verification TAT
4. DIAGNOSTICS — lab booking funnel, home-collection operations, sample TAT breaches and rejections, phlebotomist performance
5. GROWTH & RETENTION — acquisition channels, chronic-refill adherence and winback, Care Plan membership, campaign conversion, checkout cart-abandonment recovery
6. SUPPLY CHAIN — inventory health (stockouts, weeks of cover, near-expiry), vendor OTIF and QC, purchase orders

Response guidelines:
- Use markdown: headers, tables, bullet points, bold for emphasis
- Cite specific numbers from query results — never hallucinate data
- Revenue/GMV = delivered orders only (status='delivered'); never count cancelled/RTO orders as revenue
- Currency in INR (₹)`,

  // ═══════════════════════════════════════════════════════
  // DOMAIN HINTS (injected into SQL generation prompts)
  // ═══════════════════════════════════════════════════════
  domainHints: `
1. AS-OF DATE: Treat this dataset as of DATE '2026-05-31'. Anchor all relative windows ("last 12 months", "YTD", "last 90 days") on this date.
2. USE orders_full for any order-level query — pre-joined with customer attributes (acquisition_channel, care_plan_member, primary_therapy, superapp_linked) and the fulfillment center (facility_name, facility_type). Never hand-join order tables.
3. USE customers_full for SEGMENTS and per-customer targeting (one row per customer with rolled-up behaviour: orders_count_actual, delivered_orders, gmv_delivered, chronic_refill_orders, active_refills, days_since_last_order, lab_bookings_count, consults_count, campaigns_converted). orders_full is order-grained and double-counts repeat buyers — do NOT build customer segments on it directly; use customers_full or SELECT DISTINCT customer_id.
4. USE order_items_full for SKU/basket/category analysis — pre-joined with order context and product master (sku_name, manufacturer, schedule_class).
5. USE lab_bookings_full for diagnostics — pre-joined with customer, patient, phlebotomist, sample (tat_breach, actual_tat_hours, sample_rejected), and lab (lab_name, lab_type, nabl_accredited).
6. USE consults_full for teleconsult, rx_verifications_full for prescription checks, campaign_contacts_full for CRM/campaign analysis, refills_full for subscription analysis. All pre-joined with customer context.
7. ORDER KINDS: chronic_refill (recurring maintenance meds — the dominant volume), acute (short-term illness), wellness (vitamins/OTC/devices). Chronic refills are the retention engine.
8. ORDER STATUS: 'delivered' (success), 'cancelled_customer', 'cancelled_rx_invalid' (failed Rx check), 'rto' (return to origin — undelivered), 'returned' (post-delivery return). GMV/revenue = SUM(paid_amount) WHERE status='delivered'. paid_amount is net of discount; mrp_total is gross.
9. SLA: sla_met is 1 (met), 0 (missed), or NULL (non-delivered orders). SLA-met rate = COUNT(*) FILTER (sla_met=1) / COUNT(*) FILTER (sla_met IS NOT NULL). delivery_hours = order-to-delivery elapsed hours. service_tier: instant, same_day, next_day, standard (NULL when not applicable).
10. CHANNELS: app, web, store (retail), super_app (partner superapp — the scrubbed loyalty channel). payment_mode: upi, cod, card, netbanking, coins_mix (loyalty-points blend). Loyalty points are coins_earned / coins_redeemed (per order) and coins_earned_total / coins_redeemed_total (per customer).
11. DEMAND THEMES: diabetes, hypertension, cardiac, thyroid, respiratory_chronic (chronic); fever, respiratory, gastro, derma, pain_other (acute); vitamins, wellness (wellness). Chronic themes drive refill behaviour.
12. PRESCRIPTIONS (rx_verifications_full): every rx_required order needs verification. outcome is 'approved' or 'rejected'. prescription_source: uploaded, past_prescription, healthplus_consult (came from an in-app teleconsult). rejection_reason (when rejected): rx_expired, qty_exceeds_prescribed, illegible_prescription, prescriber_not_verifiable, mismatched_patient. tat_minutes = verification turnaround.
13. DIAGNOSTICS (lab_bookings_full): booking_type is home_collection (phlebotomist visit) or centre_visit. booking_source: monitoring (chronic follow-up), elective, seasonal, post_pharmacy (cross-sell after a med order), post_report. status: completed, cancelled, failed_collection. TAT: promised_tat_hours vs actual_tat_hours; tat_breach = true when actual > promised. sample_rejected with rejection_reason (hemolyzed_sample, clotted_sample, insufficient_volume, labeling_error). abnormal_flag_count = out-of-range results. Patients (via patient_relationship) may differ from the booking customer — a customer books for self/spouse/parent/child.
14. TELECONSULT (consults_full): specialty (General Physician dominant, plus Cardiology, Diabetology, Dermatology, etc.). consult_source: organic, post_report (booked after an abnormal lab result). rx_issued = a prescription was written (feeds pharmacy + rx_verifications prescription_source='healthplus_consult'). fee_paid (0 = free consult), response_time_min.
15. CAMPAIGNS (campaign_contacts_full): campaign_type includes refill_reminder, refill_reminder_whatsapp, winback, crosssell_lab, seasonal_blast, care_plan_upsell. channel: push, whatsapp, email. Funnel booleans: delivered → opened → clicked → converted. conversion_type: order, lab_booking, care_plan (NULL when not converted). conversion_value = attributed revenue. Conversion rate = converted / delivered.
16. RETENTION / REFILLS (refills_full / customers_full): refill_subscriptions with status active/paused/cancelled and cadence_days. Lapsing-chronic = customers with active_refills>0 and days_since_last_order past their cadence — prime winback targets.
17. CUSTOMER SEGMENTS (customers_full): care_plan_member (paid membership), chronic_flag (has a chronic condition), primary_therapy, lab_user_flag, consult_user_flag, city_tier (Metro / Tier-2 / Tier-3), acquisition_channel (organic_seo, app_store, performance_ads, super_app, referral, store_walkin). total_orders/total_spend/avg_order_value are lifetime; the *_calc / *_actual columns are recomputed from the order table as-of the data window.
18. SUPPLY CHAIN: inventory_full / inventory_health (weekly per-SKU-per-FC snapshots: on_hand_units, demand_units, stockout_flag, weeks_of_cover, near_expiry_units). purchase_orders_full + grn_full (goods receipt: qc_status passed/passed_with_deviation/short_received/damaged_rejected). vendor_scorecard (otif_score, lead time, QC pass rate). fulfillment_centers: facility_type fulfillment_center / dark_store / retail_store.
19. CURRENCY is INR (₹). All monetary columns (paid_amount, mrp_total, discount_amount, line_total, total_paid, fee_paid, conversion_value, po_value) are absolute INR.
20. SEASONALITY: calendar_seasonality has demand multipliers (dengue/monsoon fever, Delhi NCR pollution, New Year checkup surge, fiscal-year-end 80D tax rush, festive windows) — use overall_multiplier and category_effects to explain demand spikes.
21. CART RECOVERY (cart_abandonments_full): abandoned checkout carts, one row per cart. status is 'abandoned' or 'recovered' (customer later placed an order — recovery_order_id set, recovery_hours = cart-to-order elapsed time). cart_value = INR value of the abandoned cart. Recovery rate = COUNT(*) FILTER (status='recovered') / COUNT(*). Pre-joined with customer context (acquisition_channel, care_plan_member, customer_chronic_flag, primary_therapy, city_tier). Overall recovery ~25%. Use for checkout drop-off, recovery-rate, and lost-GMV analysis.
22. SUMMARY TABLES — prefer these for broad aggregations:
    - COMMERCE: monthly_company_kpis, monthly_gmv_by_kind, demand_theme_monthly, category_performance, channel_performance, city_tier_kpis
    - FULFILLMENT: fulfillment_sla
    - RX: rx_verification_kpis, rx_rejection_reasons
    - DIAGNOSTICS: lab_booking_funnel_monthly, lab_tat_summary
    - TELECONSULT: consult_summary
    - GROWTH/RETENTION: campaign_performance, refill_summary, acquisition_monthly, cart_abandonment_monthly
    - SUPPLY CHAIN: inventory_health, vendor_scorecard
    Use orders_full / order_items_full / lab_bookings_full for custom cohort or cross-dimensional queries not covered by summary tables.
`,

  summaryTableHint: `Use summary tables when they can answer the question:
- COMMERCE: monthly_company_kpis (board rollup), monthly_gmv_by_kind, demand_theme_monthly, category_performance (by item category), channel_performance, city_tier_kpis
- FULFILLMENT: fulfillment_sla (by FC + service tier)
- RX: rx_verification_kpis (by month), rx_rejection_reasons
- DIAGNOSTICS: lab_booking_funnel_monthly (by month, booking type), lab_tat_summary (by lab)
- TELECONSULT: consult_summary (by specialty)
- GROWTH/RETENTION: campaign_performance (by campaign/channel), refill_summary, acquisition_monthly, cart_abandonment_monthly (checkout recovery by month/channel)
- SUPPLY CHAIN: inventory_health (by category/FC), vendor_scorecard
Use orders_full, order_items_full, customers_full, lab_bookings_full for custom drill-down or cohort queries.`,

  // ═══════════════════════════════════════════════════════
  // SCHEMA CONTEXT (for LLM SQL generation)
  // ═══════════════════════════════════════════════════════
  schemaContext: `DATABASE ENGINE: DuckDB (use DuckDB SQL dialect). Currency is INR (₹). Data window Jun 2024 – May 2026, as-of 2026-05-31.

═══ DENORMALIZED TABLES (USE THESE FOR QUERIES) ═══

TABLE: orders_full (~2.61L rows) — USE for order-level queries. Pre-joined: orders + customer + fulfillment center.
  - order_id, customer_id            VARCHAR
  - order_ts                         TIMESTAMP  -- order placed
  - order_kind                       VARCHAR    -- chronic_refill | acute | wellness
  - demand_theme                     VARCHAR    -- diabetes, hypertension, fever, vitamins, ...
  - city, state                      VARCHAR
  - city_tier                        VARCHAR    -- Metro | Tier-2 | Tier-3
  - item_count                       INTEGER
  - mrp_total, paid_amount, discount_amount  DOUBLE  -- INR (paid_amount = net revenue; GMV = SUM(paid_amount) WHERE status='delivered')
  - rx_required, has_cold_chain, cod_flag, is_first_order  BOOLEAN
  - channel                          VARCHAR    -- app | web | store | super_app
  - payment_mode                     VARCHAR    -- upi | cod | card | netbanking | coins_mix
  - coins_earned, coins_redeemed     INTEGER    -- loyalty points
  - status                           VARCHAR    -- delivered | cancelled_customer | cancelled_rx_invalid | rto | returned
  - service_tier                     VARCHAR    -- instant | same_day | next_day | standard | NULL
  - carrier                          VARCHAR    -- Health+ Fleet | Delhivery | Blue Dart | ...
  - promised_ts, packed_ts, dispatched_ts, delivered_ts  TIMESTAMP
  - sla_met                          INTEGER    -- 1 met | 0 missed | NULL (non-delivered)
  - delivery_hours                   DOUBLE
  - return_reason                    VARCHAR
  - fc_id, fc_city, facility_name, facility_type, temperature_controlled  -- fulfillment center
  - acquisition_channel, care_plan_member, primary_therapy, superapp_linked, customer_age, customer_gender  -- customer attrs

TABLE: customers_full (38K rows) — USE for SEGMENTS / per-customer targeting. One row per customer.
  - customer_id, customer_name, gender, age, city, state, city_tier  -- master
  - signup_date, acquisition_channel, app_platform, notif_opt_in, superapp_linked
  - care_plan_member, care_plan_start, chronic_flag, primary_therapy   BOOLEAN/VARCHAR
  - total_orders, total_spend, avg_order_value, first_order_date, last_order_date, lab_user_flag, consult_user_flag  -- lifetime (from source)
  - orders_count_actual, delivered_orders, failed_orders               INTEGER  -- recomputed from orders
  - chronic_refill_orders, acute_orders, wellness_orders               INTEGER
  - gmv_delivered, avg_order_value_calc, coins_earned_total, coins_redeemed_total  DOUBLE/INTEGER
  - last_order_ts_calc              TIMESTAMP
  - days_since_last_order           INTEGER  -- vs 2026-05-31 (recency / lapse detection)
  - refill_subscriptions, active_refills  INTEGER
  - lab_bookings_count, lab_completed_count, lab_gmv, consults_count, consult_fees_paid  -- cross-vertical usage
  - campaigns_received, campaigns_delivered, campaigns_opened, campaigns_converted  INTEGER

TABLE: order_items_full (~6.91L rows) — USE for SKU/category/basket. Pre-joined: order_items + order + product.
  - item_id, order_id, sku_id, category (rx_medicine|otc_medicine|health_product|device), qty, mrp, discount_pct, unit_price, line_total
  - is_private_label, is_substituted  BOOLEAN
  - order_ts, customer_id, order_kind, order_city, order_state, order_city_tier, channel, order_status, order_demand_theme
  - sku_name, manufacturer, schedule_class (H|H1|OTC|LAB), cold_chain

TABLE: lab_bookings_full (~38K rows) — diagnostics. Pre-joined: booking + customer + patient + phlebotomist + sample + lab.
  - booking_id, customer_id, patient_id, booking_ts, slot_date, slot_window, booking_type (home_collection|centre_visit), booking_source (monitoring|elective|seasonal|post_pharmacy|post_report), demand_theme, city, state, status (completed|cancelled|failed_collection), total_mrp, total_paid
  - patient_relationship (self|spouse|parent|child), patient_age, patient_gender
  - phlebotomist_name, phlebo_on_time_rate, phlebo_rating
  - lab_id, lab_name, lab_type (own|partner), nabl_accredited, transport_mode (bike_rider|drone)
  - promised_tat_hours, actual_tat_hours, tat_breach, sample_rejected, sample_rejection_reason, abnormal_flag_count
  - acquisition_channel, care_plan_member, customer_chronic_flag, customer_city_tier

TABLE: rx_verifications_full (~1.83L rows) — prescription checks. Pre-joined with order context.
  - rx_verification_id, order_id, prescription_source (uploaded|past_prescription|healthplus_consult), pharmacist_id, submitted_at, verified_at, tat_minutes, outcome (approved|rejected), rejection_reason
  - customer_id, order_ts, order_kind, demand_theme, city, state, city_tier, rx_required, order_status

TABLE: consults_full (~14K rows) — teleconsult. Pre-joined with customer.
  - consult_id, customer_id, consult_ts, specialty, consult_source (organic|post_report), source_booking_id, fee_paid, response_time_min, rx_issued, followup_messages
  - care_plan_member, customer_chronic_flag, primary_therapy, city, state, city_tier, customer_age, customer_gender

TABLE: campaign_contacts_full (~3.38L rows) — CRM. Pre-joined with campaign + customer.
  - contact_id, campaign_id, campaign_type, customer_id, sent_ts, channel (push|whatsapp|email), delivered, opened, clicked, converted (BOOLEAN funnel), conversion_type (order|lab_booking|care_plan|NULL), conversion_value
  - campaign_name, target_segment, primary_channel, care_plan_member, customer_chronic_flag, primary_therapy, city_tier, acquisition_channel

TABLE: refills_full — subscriptions: subscription_id, customer_id, primary_sku_id, therapy, cadence_days, start_date, status (active|paused|cancelled), next_refill_date, primary_sku_name, city_tier, care_plan_member
TABLE: inventory_full — weekly: week_start, fc_id, sku_id, category, demand_theme, on_hand_units, demand_units, receipts_units, stockout_flag, weeks_of_cover, near_expiry_units, sku_name, manufacturer, facility_name, facility_type
TABLE: grn_full — goods receipt: grn_id, fc_id, sku_id, vendor_id, qty, po_id, unit_cost, line_value, received_date, expiry_date, qc_status (passed|passed_with_deviation|short_received|damaged_rejected), vendor_name, otif_score
TABLE: purchase_orders_full — po_id, fc_id, vendor_id, line_count, total_qty, total_value, po_date, expected_date, status (closed|partially_received), vendor_name

TABLE: cart_abandonments_full (~1.47L rows) — abandoned checkout carts. Pre-joined with customer context.
  - cart_id, customer_id, cart_ts (TIMESTAMP, cart created), item_count, cart_value (DOUBLE, INR)
  - demand_theme, channel (app|web|store|super_app), city, state, city_tier
  - status                           VARCHAR   -- 'abandoned' | 'recovered'
  - recovery_order_id                VARCHAR   -- the order placed if recovered (NULL when abandoned)
  - recovery_hours                   DOUBLE    -- cart-to-order elapsed hours (NULL when abandoned)
  - acquisition_channel, care_plan_member, customer_chronic_flag, primary_therapy, customer_age, customer_gender  -- customer attrs
  Recovery rate = COUNT(*) FILTER (status='recovered') / COUNT(*). Lost GMV = SUM(cart_value) WHERE status='abandoned'.

═══ DIMENSION TABLES ═══
products (137 SKUs: sku_name, category, demand_theme, schedule_class, mrp, manufacturer, cold_chain, is_private_label)
fulfillment_centers (63: facility_name, facility_type, city, state, temperature_controlled)
labs (41: lab_name, lab_type, city, nabl_accredited, is_reference_lab, daily_capacity_samples)
phlebotomists (700: name, city, on_time_rate, rating, is_active)
vendors (104: vendor_name, vendor_type, otif_score, avg_lead_time_days, payment_terms_days)
patients (63K: patient_id, customer_id, relationship, age, gender, known_allergies)
campaigns (15: campaign_name, campaign_type, primary_channel, start_date, end_date, target_segment)
calendar_seasonality (23: event_name, start_date, end_date, overall_multiplier, category_effects)

═══ SUMMARY TABLES (prefer for broad aggregations) ═══
monthly_company_kpis, monthly_gmv_by_kind, demand_theme_monthly, category_performance, channel_performance, city_tier_kpis,
fulfillment_sla, rx_verification_kpis, rx_rejection_reasons, lab_booking_funnel_monthly, lab_tat_summary, consult_summary,
campaign_performance, refill_summary, acquisition_monthly, inventory_health, vendor_scorecard, cart_abandonment_monthly

RULES:
- GMV/revenue = SUM(paid_amount) WHERE status='delivered'. Never count cancelled/rto orders as revenue.
- For customer segments use customers_full (one row per customer). orders_full double-counts repeat buyers.
- Date-bucket with CAST(strftime(CAST(ts AS DATE), '%Y-%m') || '-01' AS DATE). Anchor relative windows on 2026-05-31.
- Currency is INR — use ₹ symbol.`,

  // ═══════════════════════════════════════════════════════
  // AGENT SPECS (deep research mode) — canonical 6 core agent IDs
  // ═══════════════════════════════════════════════════════
  queryDescriptions: {
    "data-quality": [
      "NULL rates & field completeness across orders, customers, and order items",
      "Referential integrity between orders, customers, and fulfillment centers",
      "Outliers in paid_amount, delivery_hours, and discount_amount",
    ],
    "daily-metrics": [
      "Monthly GMV, order volume, and AOV by order kind",
      "Delivery success and SLA-met rate trend",
      "New vs repeat customer order mix over time",
    ],
    "cohort-retention": [
      "Signup-cohort retention: repeat purchase rate by acquisition month",
      "Chronic-refill adherence: lapse rate vs subscription cadence",
      "Care Plan membership impact on order frequency and spend",
    ],
    "rev-opt": [
      "Category and private-label revenue mix",
      "Discount depth vs margin by demand theme",
      "Campaign conversion and revenue per message by channel",
    ],
    "user-segmentation": [
      "Chronic vs acute vs wellness customer value and frequency",
      "Care Plan members vs non-members: spend and cross-vertical usage",
      "Lab / consult adopters vs pharmacy-only customers",
    ],
    "geographic": [
      "City-tier order and GMV concentration",
      "Fulfillment center SLA and RTO performance by city",
      "Lab TAT and phlebotomist on-time performance by city",
    ],
  },

  multiAgentPrompt: `data-quality|1|Check NULL rates and completeness across orders_full, customers_full, and order_items_full
data-quality|2|Validate status/sla_met consistency: only delivered orders should have sla_met set (1/0), others NULL
data-quality|3|Check for outliers in paid_amount, delivery_hours, and discount_amount

daily-metrics|1|Monthly GMV, order volume and AOV by order_kind — use monthly_gmv_by_kind
daily-metrics|2|Delivery success and SLA-met rate trend — use monthly_company_kpis
daily-metrics|3|New vs repeat order mix by month: is_first_order share over time

cohort-retention|1|Signup-cohort acquisition and lifetime spend by channel — use acquisition_monthly
cohort-retention|2|Chronic-refill lapse: customers_full with active_refills>0 and days_since_last_order beyond cadence — use refill_summary
cohort-retention|3|Care Plan impact: order frequency and spend for care_plan_member=true vs false in customers_full

rev-opt|1|Category and private-label revenue mix — use category_performance
rev-opt|2|Discount depth vs GMV by demand_theme — use demand_theme_monthly
rev-opt|3|Campaign conversion rate and revenue per message by channel — use campaign_performance

user-segmentation|1|Value and frequency by order kind mix (chronic/acute/wellness) in customers_full
user-segmentation|2|Care Plan members vs non-members: spend and cross-vertical (lab/consult) usage
user-segmentation|3|Lab/consult adopters vs pharmacy-only: compare gmv_delivered and retention

geographic|1|City-tier order and GMV concentration — use city_tier_kpis
geographic|2|Fulfillment center SLA and RTO by facility — use fulfillment_sla
geographic|3|Lab TAT breach and rejection by lab and city — use lab_tat_summary`,

  // No viewSQL — all tables are pre-materialized in the .duckdb file by setup-healthplus.ts.
  summaryTableSQL: [],
};
