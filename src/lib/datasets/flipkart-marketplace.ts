import type { DatasetConfig } from "./types";
import type { EventDefinition } from "../explorer-types";

// CSV tables exposed as plain DuckDB views.
const CSV_TABLES = [
  "customers",
  "sellers",
  "products",
  "returns",
  "reviews",
  "ad_campaigns",
  "acquisition_spend",
  "calendar_events",
] as const;

// Large fact tables: read as raw_* views, then materialized into real tables for speed.
const RAW_MATERIALIZED = ["orders", "order_items", "payments", "sessions"] as const;

const FLIPKART_EVENTS: EventDefinition[] = [
  {
    id: "session_start",
    displayName: "Session Started",
    category: "Funnel",
    table: "sessions",
    dateColumn: "session_ts",
    funnelEligible: true,
    properties: [
      { column: "channel", displayName: "Channel", type: "string", cardinalityHint: "low" },
      { column: "device", displayName: "Device", type: "string", cardinalityHint: "low" },
      { column: "browser", displayName: "Browser", type: "string", cardinalityHint: "low" },
    ],
  },
  {
    id: "add_to_cart",
    displayName: "Added to Cart",
    category: "Funnel",
    table: "sessions",
    filterSQL: "added_to_cart_flag = TRUE",
    dateColumn: "session_ts",
    funnelEligible: true,
    properties: [
      { column: "channel", displayName: "Channel", type: "string", cardinalityHint: "low" },
      { column: "device", displayName: "Device", type: "string", cardinalityHint: "low" },
      { column: "browser", displayName: "Browser", type: "string", cardinalityHint: "low" },
    ],
  },
  {
    id: "checkout_started",
    displayName: "Checkout Started",
    category: "Funnel",
    table: "sessions",
    filterSQL: "started_checkout_flag = TRUE",
    dateColumn: "session_ts",
    funnelEligible: true,
    properties: [
      { column: "channel", displayName: "Channel", type: "string", cardinalityHint: "low" },
      { column: "device", displayName: "Device", type: "string", cardinalityHint: "low" },
      { column: "browser", displayName: "Browser", type: "string", cardinalityHint: "low" },
    ],
  },
  {
    id: "order_placed",
    displayName: "Order Placed",
    category: "Orders",
    table: "orders",
    valueColumn: "gmv_inr",
    dateColumn: "order_ts",
    funnelEligible: true,
    properties: [
      { column: "order_status", displayName: "Order Status", type: "string", cardinalityHint: "low" },
      { column: "channel", displayName: "Channel", type: "string", cardinalityHint: "low" },
      { column: "device", displayName: "Device", type: "string", cardinalityHint: "low" },
      { column: "browser", displayName: "Browser", type: "string", cardinalityHint: "low" },
      { column: "payment_method", displayName: "Payment Method", type: "string", cardinalityHint: "low" },
      { column: "city", displayName: "City", type: "string", cardinalityHint: "medium" },
      { column: "state", displayName: "State", type: "string", cardinalityHint: "medium" },
      { column: "coupon_code", displayName: "Coupon", type: "string", cardinalityHint: "low" },
      { column: "is_first_order_flag", displayName: "First Order", type: "string", cardinalityHint: "low" },
    ],
  },
  {
    id: "order_delivered",
    displayName: "Order Delivered",
    category: "Orders",
    table: "orders",
    filterColumn: "order_status",
    filterValue: "Delivered",
    valueColumn: "gmv_inr",
    dateColumn: "order_ts",
    funnelEligible: true,
    properties: [
      { column: "channel", displayName: "Channel", type: "string", cardinalityHint: "low" },
      { column: "sla_met_flag", displayName: "SLA Met", type: "string", cardinalityHint: "low" },
      { column: "city", displayName: "City", type: "string", cardinalityHint: "medium" },
    ],
  },
  {
    id: "order_cancelled",
    displayName: "Order Cancelled",
    category: "Orders",
    table: "orders",
    filterColumn: "order_status",
    filterValue: "Cancelled",
    valueColumn: "gmv_inr",
    dateColumn: "order_ts",
    funnelEligible: true,
    properties: [
      { column: "channel", displayName: "Channel", type: "string", cardinalityHint: "low" },
      { column: "payment_method", displayName: "Payment Method", type: "string", cardinalityHint: "low" },
    ],
  },
  {
    id: "item_purchased",
    displayName: "Item Purchased",
    category: "Orders",
    table: "order_items",
    valueColumn: "line_gmv_inr",
    dateColumn: "order_ts",
    funnelEligible: true,
    properties: [
      { column: "category", displayName: "Category", type: "string", cardinalityHint: "low" },
      { column: "brand", displayName: "Brand", type: "string", cardinalityHint: "high" },
      { column: "item_status", displayName: "Item Status", type: "string", cardinalityHint: "low" },
      { column: "seller_id", displayName: "Seller", type: "string", cardinalityHint: "high" },
    ],
  },
  {
    id: "return_requested",
    displayName: "Return Requested",
    category: "Post-Purchase",
    table: "returns",
    valueColumn: "refund_inr",
    dateColumn: "requested_ts",
    funnelEligible: true,
    properties: [
      { column: "category", displayName: "Category", type: "string", cardinalityHint: "low" },
      { column: "reason", displayName: "Reason", type: "string", cardinalityHint: "low" },
      { column: "return_type", displayName: "Return Type", type: "string", cardinalityHint: "low" },
      { column: "resolution", displayName: "Resolution", type: "string", cardinalityHint: "low" },
    ],
  },
  {
    id: "product_review",
    displayName: "Product Review",
    category: "Post-Purchase",
    table: "reviews",
    valueColumn: "rating",
    dateColumn: "review_ts",
    funnelEligible: true,
    properties: [
      { column: "rating", displayName: "Rating", type: "number", cardinalityHint: "low" },
      { column: "category", displayName: "Category", type: "string", cardinalityHint: "low" },
      { column: "verified_purchase_flag", displayName: "Verified Purchase", type: "string", cardinalityHint: "low" },
    ],
  },
  {
    id: "payment",
    displayName: "Payment",
    category: "Payments",
    table: "payments",
    filterSQL: "payment_status IN ('Success', 'Collected')",
    valueColumn: "amount_inr",
    dateColumn: "payment_ts",
    funnelEligible: true,
    properties: [
      { column: "method", displayName: "Method", type: "string", cardinalityHint: "low" },
      { column: "gateway", displayName: "Gateway", type: "string", cardinalityHint: "low" },
      { column: "payment_status", displayName: "Payment Status", type: "string", cardinalityHint: "low" },
    ],
  },
];

export const flipkartMarketplaceDataset: DatasetConfig = {
  id: "flipkart-marketplace",
  label: "E-Commerce",
  companyName: "Flipkart",
  dbFile: "data/flipkart-marketplace.duckdb",
  sourceType: "csv",

  primaryTable: "orders",
  userIdField: "customer_id",
  dateField: "order_ts",
  dateRange: { start: "2024-06-01", end: "2026-05-31" },

  currency: "₹",
  entityName: "customers",

  reportMeta: {
    totalEvents: "109K orders · 184K items · 1.8M sessions",
    totalUsers: "60,000 buyers · 4,000 sellers",
    dateRangeLabel: "Jun 2024 – May 2026",
    dbName: "flipkart-marketplace.duckdb",
  },

  welcomeSubtitle:
    "Ask about buyer growth and retention, category and seller performance, the conversion funnel, returns, and ad monetization across the marketplace.",
  suggestedPrompts: [
    "What is our monthly GMV trend, and how much did the Big Billion Days sale lift orders?",
    "What share of new buyers place a second order, and how long does it take them?",
    "Which categories drive the most GMV and commission revenue, and which have the worst return rates?",
    "How does the browse-to-order funnel convert, and where do buyers drop off?",
    "Which seller tiers and fulfilment models deliver the best on-time rate and lowest returns?",
    "How do Plus members compare to non-members on order frequency and GMV?",
  ],

  systemContext: `You are Actioneer, an AI-powered analytics assistant for the growth and marketplace teams at Flipkart, India's e-commerce marketplace.

Dataset: ~100K marketplace orders and ~171K order line-items over two years (Jun 2024 – May 2026), placed by 60,000 buyers across 4,000 third-party sellers and 55,000 products, plus the full browse-to-order session funnel (1.7M sessions), payments, returns, product reviews, and Flipkart Ads campaign performance. Both buyers (customers) and sellers are first-class entities.

You cover these analytics domains:
1. BUYER GROWTH & RETENTION — acquisition channel mix, new vs repeat orders, signup-cohort retention, time-to-second-order, Plus membership, buyer segments (New/Casual/Core/VIP).
2. GMV & MONETIZATION — gross merchandise value, average order value, marketplace commission (take-rate) revenue, discount and coupon impact, category and brand mix.
3. CONVERSION FUNNEL — session → add-to-cart → checkout → order conversion and drop-off by channel and device.
4. SELLER & MARKETPLACE OPS — seller GMV by tier, fulfilment model, on-time delivery (SLA), seller ratings, return rates by seller and category.
5. POST-PURCHASE — returns by reason and category, refund leakage, replacement vs refund, resolution time, product review ratings.
6. ADVERTISING — Flipkart Ads spend, CTR, CPC, attributed orders and GMV, ROAS by seller and campaign type.

GMV is real money. Keep recommendations grounded in the marketplace's own order, return, and seller history.`,

  schemaContext: `DATABASE ENGINE: DuckDB (use DuckDB SQL dialect). Currency is INR (₹). All timestamps are ISO-8601 in IST (+05:30).

═══ BUYER / DEMAND TABLES ═══

TABLE: customers (60,000 rows) — one row per buyer
  - customer_id (PK), full_name, email, mobile, gender ('M'|'F')
  - city, state, pincode, city_tier (1|2|3|4 — metro=1, tier-4 = smaller "Bharat" towns)
  - signup_date (TIMESTAMP), acquisition_channel (Organic|Google Ads|Meta Ads|Affiliate|Referral|Email|App Store)
  - age_band ('18-24'|'25-34'|'35-44'|'45-54'|'55+'), plus_member_flag (BOOLEAN — Flipkart Plus)
  - device_pref (Android|iOS|Desktop|Mweb)
  - segment (New|Casual|Core|VIP — derived from lifetime order behavior)
  - lifetime_orders (INT), lifetime_gmv_inr (DOUBLE)

TABLE: orders (108,556 rows) — one row per order (the primary fact table)
  - order_id (PK), customer_id (FK customers), order_ts (TIMESTAMP)
  - order_status (Delivered|Cancelled|In Transit), channel (APP|MWEB|WEB)
  - device (Android|iOS|Desktop|Mweb), browser (Chrome|Safari|Samsung Internet|Edge|Firefox|Other)
  - city, state (buyer location at order time)
  - items_count (INT), gmv_inr (DOUBLE — sum of line_gmv_inr for the order), discount_inr, shipping_fee_inr
  - coupon_code (nullable), payment_method (UPI|Card|COD|EMI|Wallet|Netbanking|Gift Card)
  - is_first_order_flag (BOOLEAN — buyer's first ever order)
  - delivery_promised_days, delivery_actual_days (INT), sla_met_flag (BOOLEAN — delivered on/before promise)

TABLE: order_items (184,000 rows) — one row per product line in an order
  - order_item_id (PK), order_id (FK orders), customer_id (FK customers), product_id (FK products), seller_id (FK sellers)
  - category, brand, qty (INT), unit_price_inr, item_discount_inr, line_gmv_inr (DOUBLE — net of item discount)
  - commission_inr (DOUBLE — marketplace take-rate revenue on the line), item_status (Delivered|Cancelled|In Transit|Returned)
  - order_ts (TIMESTAMP — denormalized from orders for time filtering)

TABLE: sessions (1,809,266 rows) — one row per browsing session (the funnel)
  - session_id (PK), customer_id (FK customers), session_ts (TIMESTAMP), channel, device, browser
  - viewed_product_flag, added_to_cart_flag, started_checkout_flag, placed_order_flag (all BOOLEAN)
  - order_id (nullable FK orders — set only when placed_order_flag is TRUE)

TABLE: payments (108,556 rows) — one row per order (1:1)
  - payment_id (PK), order_id (FK orders), customer_id, method, amount_inr (DOUBLE — gmv - discount + shipping)
  - payment_status (Success|Collected|Pending|Failed|Refunded), gateway, emi_tenure_months (nullable), payment_ts

═══ SELLER / SUPPLY TABLES ═══

TABLE: sellers (4,000 rows) — one row per marketplace seller
  - seller_id (PK), business_name, city, state, gst_state, onboarded_date (TIMESTAMP)
  - primary_category, seller_tier (Bronze|Silver|Gold|Platinum), fulfilment_model (Flipkart Fulfilled|Self Ship)
  - assured_flag (BOOLEAN — Flipkart Assured), seller_rating (DOUBLE 1-5), commission_rate (DOUBLE — take-rate fraction)
  - status (Active|Churned|Suspended)

TABLE: products (55,000 rows) — one row per listed product (SKU)
  - product_id (PK), seller_id (FK sellers), category, subcategory, brand, title
  - mrp_inr, list_price_inr (DOUBLE), is_assured (BOOLEAN), launch_date (TIMESTAMP)
  - rating_avg (DOUBLE 1-5), rating_count (INT)

═══ POST-PURCHASE / MARKETING TABLES ═══

TABLE: returns (17,417 rows) — one row per returned order line (DELIVERED items only)
  - return_id (PK), order_item_id (FK order_items), order_id, customer_id, seller_id, product_id, category
  - reason (e.g. 'Size / Fit Issue', 'Defective / Not Working', 'Changed My Mind', ...), return_type (Refund|Replacement)
  - refund_inr (DOUBLE), requested_ts, resolved_ts (nullable when Pending), resolution (Completed|Rejected|Pending), resolution_days (nullable)

TABLE: reviews (51,439 rows) — one row per product review (verified purchases)
  - review_id (PK), product_id, seller_id, order_id, customer_id, category
  - rating (INT 1-5), has_text_flag, verified_purchase_flag (BOOLEAN), review_ts

TABLE: ad_campaigns (10,556 rows) — one row per seller per active month (Flipkart Ads)
  - campaign_id (PK), seller_id (FK sellers), campaign_type (Product Listing Ads|Search Ads|Display Banner), month ('YYYY-MM')
  - impressions, clicks (INT), ctr (DOUBLE), avg_cpc_inr (DOUBLE), spend_inr (DOUBLE)
  - attributed_orders (INT), attributed_gmv_inr (DOUBLE), roas (DOUBLE — attributed_gmv / spend)

TABLE: acquisition_spend (~170 rows) — BUYER acquisition marketing spend, one row per month per channel (this is Flipkart's own spend to acquire BUYERS — distinct from ad_campaigns, which is seller Flipkart Ads)
  - month ('YYYY-MM'), channel (matches customers.acquisition_channel)
  - marketing_spend_inr (DOUBLE), new_buyers_acquired (INT — buyers who signed up that month via that channel)
  - cac_inr (DOUBLE — blended cost to acquire a buyer = spend / new_buyers; 0 for Organic), impressions, clicks (INT)

TABLE: calendar_events (28 rows) — festival/seasonality reference (Big Billion Days, Diwali, etc.)
  - event_name, start_date, end_date, overall_multiplier, category_effects, note

═══ KEY JOINS ═══
  order_items.order_id = orders.order_id ; order_items.product_id = products.product_id ; order_items.seller_id = sellers.seller_id
  orders.customer_id = customers.customer_id ; payments.order_id = orders.order_id (1:1)
  returns.order_item_id = order_items.order_item_id ; reviews.product_id = products.product_id
  sessions.order_id = orders.order_id (only when placed_order_flag = TRUE) ; ad_campaigns.seller_id = sellers.seller_id
  acquisition_spend.channel = customers.acquisition_channel ; acquisition_spend.month = strftime(customers.signup_date,'%Y-%m')

NOTES:
  - GMV: order-level gmv_inr already equals SUM(order_items.line_gmv_inr). For category/seller GMV, aggregate order_items.line_gmv_inr (do NOT double-count via orders).
  - Commission / take-rate revenue: SUM(order_items.commission_inr). Do not derive from orders.
  - Return rate = returned items / delivered items. Numerator: COUNT(returns) or order_items WHERE item_status='Returned'. Denominator: order_items WHERE item_status IN ('Delivered','Returned'). Returns only ever apply to delivered items.
  - Conversion funnel comes from sessions booleans: viewed_product_flag → added_to_cart_flag → started_checkout_flag → placed_order_flag. Each stage is a strict subset of the prior.
  - On-time delivery / SLA: orders.sla_met_flag (delivery_actual_days <= delivery_promised_days). Only meaningful for Delivered orders.
  - Repeat vs new buyers: orders.is_first_order_flag marks the first order; repeat orders are the rest. Retention: cohort by customers.signup_date month.
  - CAC / acquisition: use acquisition_spend (NOT ad_campaigns) for buyer acquisition. CAC by channel = SUM(marketing_spend_inr)/SUM(new_buyers_acquired); blended CAC = total spend / total new buyers. Organic has zero paid spend. To compare CAC vs buyer value, join acquired buyers (customers.acquisition_channel) to their orders for LTV.
  - Device vs browser vs channel: channel (APP|MWEB|WEB) is the surface; device (Android|iOS|Desktop|Mweb) is the platform; browser (Chrome|Safari|...) is the user agent. "Android app vs iPhone app" = channel='APP' split by device; "Safari vs Chrome" = browser. These exist on both orders and sessions.
  - City tier: city_tier 1 = metros, 2-3 = larger cities, 4 = smaller "Bharat" towns. Tier-wise slicing is on customers.city_tier (join orders→customers) or directly via order city.
  - Booleans are real BOOLEAN columns — filter with '= TRUE' / '= FALSE', not strings.`,

  domainHints: `1. TIME: order_ts / session_ts are TIMESTAMPs in IST. Use strftime(order_ts, '%Y-%m') for monthly trends. The window is Jun 2024 – May 2026.
2. GMV: aggregate order_items.line_gmv_inr for category/seller/brand GMV; use orders.gmv_inr only for order-level metrics (AOV = AVG(gmv_inr) over orders). They reconcile (orders.gmv_inr = SUM of its lines) so never join orders to order_items just to re-sum GMV.
3. TAKE-RATE: marketplace revenue = SUM(order_items.commission_inr). Effective take-rate = SUM(commission_inr) / SUM(line_gmv_inr).
4. RETURNS: return rate denominator is delivered items (order_items WHERE item_status IN ('Delivered','Returned')), NOT all items (excludes Cancelled / In Transit). refund_inr is only non-zero for completed Refund-type returns.
5. FUNNEL: use the sessions table booleans. Conversion = COUNT(*) FILTER (WHERE placed_order_flag) / COUNT(*). Cart abandonment = added_to_cart_flag AND NOT placed_order_flag.
6. RETENTION: cohort buyers by strftime(signup_date,'%Y-%m'); repeat-purchase rate = buyers with >1 order / all buyers who ordered. is_first_order_flag isolates first orders.
7. BOOLEANS: plus_member_flag, sla_met_flag, is_first_order_flag, assured_flag, and the session flags are BOOLEAN — write 'WHERE sla_met_flag = TRUE', not = 'true'.
8. ADS: ROAS = attributed_gmv_inr / spend_inr (already provided as roas). ad_campaigns is monthly per seller — join to sellers, not to orders.
9. SEGMENTS: customers.segment is New|Casual|Core|VIP. Plus members via plus_member_flag. Acquisition via acquisition_channel.
10. SELLER OPS: join order_items to sellers on seller_id for GMV/returns by seller_tier or fulfilment_model. seller.status filters Active vs Churned sellers.
11. CAC / ACQUISITION: acquisition_spend holds monthly buyer-acquisition spend by channel. CAC = SUM(marketing_spend_inr)/NULLIF(SUM(new_buyers_acquired),0). For CAC-to-LTV, join customers (acquisition_channel) to their orders. Do NOT use ad_campaigns for buyer CAC — that is seller advertising.
12. PERSONAS / DIMENSIONS: slice freely by channel, device, browser, city_tier, segment, acquisition_channel, age_band, gender, and time (strftime(order_ts,'%Y-%m')). e.g. "iPhone app buyers in tier-2 cities" = channel='APP' AND device='iOS' AND city_tier=2 (join customers for city_tier); "Safari vs Chrome conversion" uses sessions.browser.`,

  agents: [
    {
      id: "data-quality",
      queries: [
        {
          description: "Order status mix, on-time delivery (SLA) rate, and payment success rate",
          hint: "orders: COUNT by order_status; AVG(sla_met_flag::INT) FILTER (WHERE order_status='Delivered'); payments: share WHERE payment_status IN ('Success','Collected')",
        },
        {
          description: "Return rate by category against delivered items, and refund leakage",
          hint: "order_items item_status IN ('Delivered','Returned') as denom; returns COUNT and SUM(refund_inr) by category; rate = returned/delivered",
        },
        {
          description: "Seller fulfilment health: on-time rate and return rate by fulfilment_model and seller_tier",
          hint: "join order_items to sellers on seller_id; group by fulfilment_model, seller_tier; AVG(sla_met via orders), return share",
        },
      ],
    },
    {
      id: "daily-metrics",
      queries: [
        {
          description: "Monthly GMV, order count, and AOV trend across the window",
          hint: "orders: SUM(gmv_inr), COUNT(*), AVG(gmv_inr) GROUP BY strftime(order_ts,'%Y-%m')",
        },
        {
          description: "Big Billion Days / Diwali festival lift: orders and GMV during sale windows vs baseline",
          hint: "orders in Sep-Oct vs other months; compare daily avg GMV; reference calendar_events for windows",
        },
        {
          description: "Browse-to-order conversion funnel and drop-off by stage",
          hint: "sessions: COUNT(*), FILTER added_to_cart_flag, started_checkout_flag, placed_order_flag; stage-to-stage conversion",
        },
      ],
    },
    {
      id: "cohort-retention",
      queries: [
        {
          description: "New vs repeat order share and repeat-purchase rate over time",
          hint: "orders: share is_first_order_flag=TRUE; repeat buyers = customers with >1 order / buyers who ordered",
        },
        {
          description: "Signup-cohort retention: orders by months-since-signup",
          hint: "join orders to customers; cohort = strftime(signup_date,'%Y-%m'); months_since = datediff('month',signup_date,order_ts)",
        },
        {
          description: "Time-to-second-order distribution for new buyers",
          hint: "per customer, gap between 1st and 2nd order_ts; median days; share converting to 2nd within 30/60/90 days",
        },
      ],
    },
    {
      id: "rev-opt",
      queries: [
        {
          description: "GMV and commission (take-rate) revenue by category, with effective take-rate",
          hint: "order_items: SUM(line_gmv_inr), SUM(commission_inr), ratio by category; order by GMV",
        },
        {
          description: "Discount and coupon impact on order value and margin",
          hint: "orders: AVG(gmv_inr), AVG(discount_inr) by coupon_code IS NOT NULL; discount as % of gmv",
        },
        {
          description: "Flipkart Ads efficiency: spend, attributed GMV, and ROAS by campaign type and seller tier",
          hint: "ad_campaigns join sellers: SUM(spend_inr), SUM(attributed_gmv_inr), AVG(roas) GROUP BY campaign_type, seller_tier",
        },
      ],
    },
    {
      id: "user-segmentation",
      queries: [
        {
          description: "Buyer segment breakdown (New/Casual/Core/VIP): order frequency and GMV share",
          hint: "customers segment: COUNT, AVG(lifetime_orders), SUM(lifetime_gmv_inr) share by segment",
        },
        {
          description: "Plus members vs non-members: order frequency, AOV, and return behavior",
          hint: "join orders to customers on plus_member_flag; AVG orders per buyer, AVG(gmv_inr), return rate",
        },
        {
          description: "Acquisition channel economics: CAC, buyers acquired, and the GMV they generate by channel",
          hint: "acquisition_spend: CAC = SUM(marketing_spend_inr)/NULLIF(SUM(new_buyers_acquired),0) by channel; join customers→orders for GMV per acquired buyer; compare CAC vs value",
        },
      ],
    },
    {
      id: "geographic",
      queries: [
        {
          description: "GMV and orders by city tier and top cities",
          hint: "orders: SUM(gmv_inr), COUNT(*) GROUP BY state, city; join customers for city_tier",
        },
        {
          description: "Return rate and delivery SLA by region",
          hint: "orders by state: AVG(sla_met_flag::INT); join returns/order_items for return share by state",
        },
        {
          description: "Seller distribution and GMV concentration by state and tier",
          hint: "sellers by state, seller_tier; join order_items for GMV per seller region",
        },
      ],
    },
  ],

  queryDescriptions: {
    "data-quality": [
      "Order status mix, on-time delivery (SLA) rate, and payment success rate",
      "Return rate by category against delivered items, and refund leakage",
      "Seller fulfilment health: on-time rate and return rate by fulfilment_model and seller_tier",
    ],
    "daily-metrics": [
      "Monthly GMV, order count, and AOV trend across the window",
      "Big Billion Days / Diwali festival lift: orders and GMV during sale windows vs baseline",
      "Browse-to-order conversion funnel and drop-off by stage",
    ],
    "cohort-retention": [
      "New vs repeat order share and repeat-purchase rate over time",
      "Signup-cohort retention: orders by months-since-signup",
      "Time-to-second-order distribution for new buyers",
    ],
    "rev-opt": [
      "GMV and commission (take-rate) revenue by category, with effective take-rate",
      "Discount and coupon impact on order value and margin",
      "Flipkart Ads efficiency: spend, attributed GMV, and ROAS by campaign type and seller tier",
    ],
    "user-segmentation": [
      "Buyer segment breakdown (New/Casual/Core/VIP): order frequency and GMV share",
      "Plus members vs non-members: order frequency, AOV, and return behavior",
      "Acquisition channel economics: CAC, buyers acquired, and the GMV they generate by channel",
    ],
    "geographic": [
      "GMV and orders by city tier and top cities",
      "Return rate and delivery SLA by region",
      "Seller distribution and GMV concentration by state and tier",
    ],
  },

  multiAgentPrompt: `
data-quality|1| — Order status mix, on-time delivery (SLA) rate, and payment success rate
data-quality|2| — Return rate by category against delivered items, and refund leakage
data-quality|3| — Seller fulfilment health: on-time rate and return rate by fulfilment_model and seller_tier

daily-metrics|1| — Monthly GMV, order count, and AOV trend across the window
daily-metrics|2| — Big Billion Days / Diwali festival lift: orders and GMV during sale windows vs baseline
daily-metrics|3| — Browse-to-order conversion funnel and drop-off by stage

cohort-retention|1| — New vs repeat order share and repeat-purchase rate over time
cohort-retention|2| — Signup-cohort retention: orders by months-since-signup
cohort-retention|3| — Time-to-second-order distribution for new buyers

rev-opt|1| — GMV and commission (take-rate) revenue by category, with effective take-rate
rev-opt|2| — Discount and coupon impact on order value and margin
rev-opt|3| — Flipkart Ads efficiency: spend, attributed GMV, and ROAS by campaign type and seller tier

user-segmentation|1| — Buyer segment breakdown (New/Casual/Core/VIP): order frequency and GMV share
user-segmentation|2| — Plus members vs non-members: order frequency, AOV, and return behavior
user-segmentation|3| — Acquisition channel economics: CAC, buyers acquired, and the GMV they generate by channel

geographic|1| — GMV and orders by city tier and top cities
geographic|2| — Return rate and delivery SLA by region
geographic|3| — Seller distribution and GMV concentration by state and tier
`,

  viewSQL: (dataDir: string) => {
    const csvDir = `${dataDir}/csv/flipkart-marketplace`;
    const views = CSV_TABLES.map(
      (t) =>
        `CREATE OR REPLACE VIEW ${t} AS SELECT * FROM read_csv('${csvDir}/${t}.csv', auto_detect=true, ignore_errors=true)`,
    );
    const rawViews = RAW_MATERIALIZED.map(
      (t) =>
        `CREATE OR REPLACE VIEW raw_${t} AS SELECT * FROM read_csv('${csvDir}/${t}.csv', auto_detect=true, ignore_errors=true)`,
    );
    return [...views, ...rawViews];
  },

  summaryTableSQL: [
    `CREATE OR REPLACE TABLE orders AS SELECT * FROM raw_orders`,
    `CREATE OR REPLACE TABLE order_items AS SELECT * FROM raw_order_items`,
    `CREATE OR REPLACE TABLE payments AS SELECT * FROM raw_payments`,
    `CREATE OR REPLACE TABLE sessions AS SELECT * FROM raw_sessions`,
  ],

  setupVersion: "flipkart-marketplace-v4",
  events: FLIPKART_EVENTS,
};
