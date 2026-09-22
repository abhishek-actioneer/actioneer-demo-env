import type { EventDefinition } from "../explorer-types";
import type { DatasetConfig } from "./types";

const BOOKING_PROPERTIES: EventDefinition["properties"] = [
  { column: "service_type", displayName: "Service Type", type: "string", cardinalityHint: "medium" },
  { column: "service_tier", displayName: "Service Tier", type: "string", cardinalityHint: "low" },
  { column: "hub_name", displayName: "Hub", type: "string", cardinalityHint: "low" },
  { column: "payment_status", displayName: "Payment Status", type: "string", cardinalityHint: "low" },
  { column: "payment_method", displayName: "Payment Method", type: "string", cardinalityHint: "low" },
  { column: "acquisition_source", displayName: "Acquisition Source", type: "string", cardinalityHint: "low" },
  { column: "ltv_bucket", displayName: "LTV Bucket", type: "string", cardinalityHint: "low" },
  { column: "city", displayName: "City", type: "string", cardinalityHint: "low" },
  { column: "weather", displayName: "Weather", type: "string", cardinalityHint: "low" },
  { column: "campaign_type", displayName: "Campaign Type", type: "string", cardinalityHint: "low" },
];

const FUNNEL_PROPERTIES: EventDefinition["properties"] = [
  { column: "source", displayName: "Source", type: "string", cardinalityHint: "low" },
  { column: "platform", displayName: "Platform", type: "string", cardinalityHint: "low" },
  { column: "city", displayName: "City", type: "string", cardinalityHint: "low" },
];

const COMMS_PROPERTIES: EventDefinition["properties"] = [
  { column: "channel", displayName: "Channel", type: "string", cardinalityHint: "low" },
  { column: "user_segment_at_send", displayName: "User Segment", type: "string", cardinalityHint: "low" },
  { column: "campaign_name", displayName: "Campaign", type: "string", cardinalityHint: "medium" },
  { column: "ab_variant", displayName: "A/B Variant", type: "string", cardinalityHint: "low" },
  { column: "predicted_ltv_bucket", displayName: "Predicted LTV", type: "string", cardinalityHint: "low" },
];

const QUICKHELP_EVENTS: EventDefinition[] = [
  // ═══ BOOKINGS (5 events) ═══
  { id: "booking", displayName: "Booking", table: "bookings", valueColumn: "booking_value", properties: BOOKING_PROPERTIES },
  { id: "paid_booking", displayName: "Paid Booking", table: "bookings", filterColumn: "payment_status", filterValue: "success", valueColumn: "booking_value", properties: BOOKING_PROPERTIES },
  { id: "failed_payment", displayName: "Failed Payment", table: "bookings", filterColumn: "payment_status", filterValue: "failed", valueColumn: "booking_value", properties: BOOKING_PROPERTIES },
  { id: "refunded_booking", displayName: "Refunded Booking", table: "bookings", filterColumn: "payment_status", filterValue: "refunded", valueColumn: "booking_value", properties: BOOKING_PROPERTIES },
  { id: "first_booking", displayName: "First Booking", table: "bookings", filterColumn: "is_first_booking", filterValue: "true", valueColumn: "booking_value", properties: BOOKING_PROPERTIES },
  { id: "rescheduled_booking", displayName: "Rescheduled Booking", table: "bookings", filterColumn: "rescheduled", filterValue: "true", valueColumn: "booking_value", properties: BOOKING_PROPERTIES },
  { id: "late_arrival", displayName: "Late Arrival", table: "bookings", filterColumn: "on_time", filterValue: "false", properties: BOOKING_PROPERTIES },
  { id: "on_time_arrival", displayName: "On-Time Arrival", table: "bookings", filterColumn: "on_time", filterValue: "true", properties: BOOKING_PROPERTIES },
  { id: "partner_reassigned", displayName: "Partner Reassigned", table: "bookings", filterColumn: "partner_reassigned", filterValue: "true", properties: BOOKING_PROPERTIES },

  // ═══ ONBOARDING FUNNEL (9 events — full AARRR) ═══
  { id: "signup", displayName: "Signup Complete", table: "funnel_events", dateColumn: "event_at", filterColumn: "event_type", filterValue: "signup_complete", properties: FUNNEL_PROPERTIES },
  { id: "profile_done", displayName: "Profile Completed", table: "funnel_events", dateColumn: "event_at", filterColumn: "event_type", filterValue: "profile_done", properties: FUNNEL_PROPERTIES },
  { id: "address_added", displayName: "Address Added", table: "funnel_events", dateColumn: "event_at", filterColumn: "event_type", filterValue: "address_added", properties: FUNNEL_PROPERTIES },
  { id: "payment_added", displayName: "Payment Added", table: "funnel_events", dateColumn: "event_at", filterColumn: "event_type", filterValue: "payment_added", properties: FUNNEL_PROPERTIES },
  { id: "first_browse", displayName: "First Browse", table: "funnel_events", dateColumn: "event_at", filterColumn: "event_type", filterValue: "first_browse", properties: FUNNEL_PROPERTIES },
  { id: "first_booking_funnel", displayName: "First Booking (Funnel)", table: "funnel_events", dateColumn: "event_at", filterColumn: "event_type", filterValue: "first_booking", properties: FUNNEL_PROPERTIES },
  { id: "second_booking_14d", displayName: "2nd Booking (14d)", table: "funnel_events", dateColumn: "event_at", filterColumn: "event_type", filterValue: "second_booking_14d", properties: FUNNEL_PROPERTIES },
  { id: "third_booking_30d", displayName: "3rd Booking (30d)", table: "funnel_events", dateColumn: "event_at", filterColumn: "event_type", filterValue: "third_booking_30d", properties: FUNNEL_PROPERTIES },
  { id: "referral_sent", displayName: "Referral Sent", table: "funnel_events", dateColumn: "event_at", filterColumn: "event_type", filterValue: "referral_sent", properties: FUNNEL_PROPERTIES },

  // ═══ CRM / COMMS (5 events) ═══
  { id: "comms_sent", displayName: "Message Sent", table: "comms_full", dateColumn: "sent_at", valueColumn: "send_cost_inr", properties: COMMS_PROPERTIES },
  { id: "comms_delivered", displayName: "Message Delivered", table: "comms_full", dateColumn: "sent_at", filterColumn: "delivered", filterValue: "true", properties: COMMS_PROPERTIES },
  // opened/clicked/converted live on the same row as the send and have no
  // separate event timestamp — funnels would collapse to t1==t2. Disabled
  // until the comms_full view derives opened_at/clicked_at/converted_at.
  { id: "comms_opened", displayName: "Message Opened", table: "comms_full", dateColumn: "sent_at", filterColumn: "opened", filterValue: "true", funnelEligible: false, properties: COMMS_PROPERTIES },
  { id: "comms_clicked", displayName: "Message Clicked", table: "comms_full", dateColumn: "sent_at", filterColumn: "clicked", filterValue: "true", funnelEligible: false, properties: COMMS_PROPERTIES },
  { id: "comms_converted", displayName: "Message Converted", table: "comms_full", dateColumn: "sent_at", filterColumn: "converted", filterValue: "true", funnelEligible: false, properties: COMMS_PROPERTIES },
  // unsubscribed/frequency_cap_hit are status flags on the send row — they
  // share sent_at and so are trend/segment-only (funnels would collapse).
  { id: "comms_unsubscribed", displayName: "Message Unsubscribed", table: "comms_full", dateColumn: "sent_at", filterColumn: "unsubscribed", filterValue: "true", funnelEligible: false, properties: COMMS_PROPERTIES },
  { id: "comms_suppressed", displayName: "Message Suppressed (Freq Cap)", table: "comms_full", dateColumn: "sent_at", filterColumn: "frequency_cap_hit", filterValue: "true", funnelEligible: false, properties: COMMS_PROPERTIES },

  // ═══ APP ENGAGEMENT (4 events) ═══
  // daily_sessions is a daily rollup with booleans, not per-event rows. The
  // dateColumn is correct for trends/segments but funnels between these
  // events would have t1==t2 (same day). Disabled for funnels.
  { id: "app_session", displayName: "App Session", table: "daily_sessions", dateColumn: "session_date", valueColumn: "minutes_active", funnelEligible: false, properties: [
    { column: "platform", displayName: "Platform", type: "string", cardinalityHint: "low" },
  ] },
  { id: "app_search", displayName: "Service Search", table: "daily_sessions", dateColumn: "session_date", filterColumn: "searched", filterValue: "true", funnelEligible: false, properties: [
    { column: "platform", displayName: "Platform", type: "string", cardinalityHint: "low" },
  ] },
  { id: "app_booked", displayName: "Booked (Session)", table: "daily_sessions", dateColumn: "session_date", filterColumn: "booked", filterValue: "true", funnelEligible: false, properties: [
    { column: "platform", displayName: "Platform", type: "string", cardinalityHint: "low" },
  ] },
  { id: "app_viewed_offers", displayName: "Viewed Offers", table: "daily_sessions", dateColumn: "session_date", filterColumn: "viewed_offers", filterValue: "true", funnelEligible: false, properties: [
    { column: "platform", displayName: "Platform", type: "string", cardinalityHint: "low" },
  ] },

  // ═══ PARTNER OPS (3 events) ═══
  { id: "shift_served", displayName: "Shift Served", table: "partner_shifts", dateColumn: "shift_date", valueColumn: "earnings_gross", properties: [
    { column: "hub_id", displayName: "Hub ID", type: "number" },
    { column: "status", displayName: "Status", type: "string", cardinalityHint: "low" },
  ] },
  { id: "shift_no_show", displayName: "Partner No-Show", table: "partner_shifts", dateColumn: "shift_date", filterColumn: "status", filterValue: "no_show", properties: [
    { column: "hub_id", displayName: "Hub ID", type: "number" },
  ] },
  { id: "shift_cancelled", displayName: "Shift Cancelled", table: "partner_shifts", dateColumn: "shift_date", filterColumn: "status", filterValue: "cancelled", properties: [
    { column: "hub_id", displayName: "Hub ID", type: "number" },
  ] },

  // ═══ REFERRALS (2 events) ═══
  { id: "referral_invited", displayName: "Referral Invited", table: "referrals_full", dateColumn: "invited_at", properties: [
    { column: "referral_channel", displayName: "Channel", type: "string", cardinalityHint: "low" },
    { column: "status", displayName: "Status", type: "string", cardinalityHint: "low" },
  ] },
  { id: "referral_converted", displayName: "Referral Converted", table: "referrals_full", dateColumn: "signup_at", filterColumn: "status", filterValue: "converted", properties: [
    { column: "referral_channel", displayName: "Channel", type: "string", cardinalityHint: "low" },
  ] },
  // reward_status is a terminal flag on the referral row — trend/segment-only.
  { id: "referral_reward_credited", displayName: "Referral Reward Credited", table: "referrals_full", dateColumn: "invited_at", filterColumn: "reward_status", filterValue: "credited", valueColumn: "referrer_reward_amount", funnelEligible: false, properties: [
    { column: "referral_channel", displayName: "Channel", type: "string", cardinalityHint: "low" },
    { column: "status", displayName: "Status", type: "string", cardinalityHint: "low" },
  ] },
  { id: "referral_reward_expired", displayName: "Referral Reward Expired", table: "referrals_full", dateColumn: "invited_at", filterColumn: "reward_status", filterValue: "expired", funnelEligible: false, properties: [
    { column: "referral_channel", displayName: "Channel", type: "string", cardinalityHint: "low" },
    { column: "status", displayName: "Status", type: "string", cardinalityHint: "low" },
  ] },

  // ═══ SURVEYS (2 events) ═══
  { id: "survey_response", displayName: "Survey Response", table: "survey_full", dateColumn: "submitted_at", valueColumn: "score", properties: [
    { column: "survey_type", displayName: "Survey Type", type: "string", cardinalityHint: "low" },
    { column: "category", displayName: "Category", type: "string", cardinalityHint: "low" },
    { column: "service_type", displayName: "Service Type", type: "string", cardinalityHint: "medium" },
    { column: "hub_name", displayName: "Hub", type: "string", cardinalityHint: "low" },
  ] },
  { id: "nps_response", displayName: "NPS Response", table: "survey_full", dateColumn: "submitted_at", filterColumn: "survey_type", filterValue: "nps", valueColumn: "score", properties: [
    { column: "category", displayName: "Category", type: "string", cardinalityHint: "low" },
    { column: "hub_name", displayName: "Hub", type: "string", cardinalityHint: "low" },
  ] },
  // CSAT / post-booking is the dominant survey type (1-5 score).
  { id: "csat_response", displayName: "CSAT Response", table: "survey_full", dateColumn: "submitted_at", filterColumn: "survey_type", filterValue: "post_booking", valueColumn: "score", properties: [
    { column: "category", displayName: "Category", type: "string", cardinalityHint: "low" },
    { column: "service_type", displayName: "Service Type", type: "string", cardinalityHint: "medium" },
    { column: "hub_name", displayName: "Hub", type: "string", cardinalityHint: "low" },
  ] },

  // ═══ ADS (2 events) ═══
  { id: "ad_impression", displayName: "Ad Impression", table: "ad_full", dateColumn: "date", valueColumn: "spend_inr", properties: [
    { column: "platform", displayName: "Platform", type: "string", cardinalityHint: "low" },
    { column: "ad_campaign_name", displayName: "Campaign", type: "string", cardinalityHint: "medium" },
    { column: "format", displayName: "Format", type: "string", cardinalityHint: "low" },
  ] },
  { id: "ad_click", displayName: "Ad Click", table: "ad_full", dateColumn: "date", valueColumn: "spend_inr", properties: [
    { column: "platform", displayName: "Platform", type: "string", cardinalityHint: "low" },
    { column: "ad_campaign_name", displayName: "Campaign", type: "string", cardinalityHint: "medium" },
  ] },
];

export const quickhelpDataset: DatasetConfig = {
  id: "quickhelp",
  label: "Consumer Services",
  companyName: "Quick Help",
  dbFile: "data/quickhelp.duckdb",
  sourceType: "csv",

  primaryTable: "bookings",
  userIdField: "customer_id",
  dateField: "booking_date",
  dateRange: { start: "2025-02-01", end: "2026-02-28" },
  events: QUICKHELP_EVENTS,

  domainHints: `6. For on-time analysis: use the on_time boolean or compare arrival_time_min vs expected_arrival_min.
7. Service hierarchy: service_type is the specific service, service_tier is the grouping (quick/standard/extended/premium).
8. Revenue is in INR. Use booking_value for amounts. Only count payment_status = 'success' for completed revenue.
9. To join partner shift data, use the partner_shifts table via partner_id.
10. Use comms_full view for CRM queries (pre-joined with campaign and journey metadata). Never join comms_sends manually.
11. Use ad_full view for ad performance queries (flattened ad hierarchy). Never join ad tables manually.
12. comms_sends.converted means booked within 24h of click (last-touch attribution).
13. SMS messages have opened=true (assumed read, no open tracking).
14. frequency_cap_hit=true means message was suppressed — not actually sent (delivered=false, cost=0).
15. Use attribution_full view for acquisition analysis (joins install_attribution with customer data).
16. Campaign types changed: 'promo', 'seasonal', 'reactivation', 'referral', 'festival' (not the old discount/cashback/free_visit).
17. offer_type column has the discount mechanism: 'discount', 'cashback', 'free_visit', 'referral_bonus', 'none'.
18. Use bookings_economics view for unit economics queries — it joins bookings with per-booking P&L (commission, margin, costs).
19. Commission rates vary by service_tier: premium 30-32%, extended 28-30%, standard 27-29%, quick 25-27%.
20. contribution_margin = commission_earned - payment_processing_fee - promo_discount_funded - referral_reward_cost - support_cost_allocated.
21. Use funnel_events for AARRR funnel analysis. Milestones: signup_complete → profile_done → address_added → payment_added → first_browse → first_booking → second_booking_14d → third_booking_30d → referral_sent.
22. Use daily_sessions for engagement/stickiness analysis. booked=true on days the customer made a booking.
23. Use referrals_full view for referral program analysis — includes referrer and referee customer details.
24. Use survey_full view for NPS/CSAT analysis — joins survey_responses with booking context.
25. NPS scores: 0-10 (promoters 9-10, passives 7-8, detractors 0-6). CSAT/post_booking scores: 1-5.
26. Use weekly_company_kpis and monthly_company_kpis for board-level KPI queries — pre-computed from all data sources.
27. partner_payouts are weekly (ISO week, Monday-Sunday). Payout date is Wednesday T+3.`,

  summaryTableHint: `Use summary tables when they can answer the question:
- OPERATIONS: daily_metrics, service_metrics, hub_metrics, campaign_metrics, hourly_patterns, monthly_metrics
- CRM/MARKETING: comms_channel_metrics, comms_campaign_metrics, journey_metrics
- PAID ADS: ad_platform_metrics, attribution_source_metrics
- GROWTH: funnel_conversion_metrics, weekly_retention_cohorts, activation_metrics
- FINANCE: service_unit_economics, monthly_partner_economics
- COMPANY KPIs: weekly_company_kpis, monthly_company_kpis
Use the raw bookings/comms_full/ad_full/bookings_economics tables for custom analysis like cohorts, per-customer analysis, or cross-dimensional queries.`,

  schemaContext: `DATABASE ENGINE: DuckDB (use DuckDB SQL dialect)

═══ OPERATIONS TABLES ═══

TABLE: bookings (~206K rows, Feb 2025 – {{DATASET_NOW_MONTH_YEAR}})
  CURRENT DATE: {{DATASET_NOW}} — use this as "today" when generating SQL with relative dates.
  Denormalized flat table — one row per service booking.
  Joins customers + campaigns_v2 automatically.

  -- Booking core
  - booking_id        INTEGER     -- Unique booking ID
  - booking_date      DATE        -- Date of booking
  - booking_time      TIME        -- Time of booking
  - booking_value     DOUBLE      -- Amount charged in INR

  -- Customer (joined from customers)
  - customer_id       INTEGER     -- Customer identifier
  - customer_lat      DOUBLE      -- Customer latitude
  - customer_lng      DOUBLE      -- Customer longitude
  - signup_date       DATE        -- When customer signed up
  - preferred_payment VARCHAR     -- Customer preferred payment
  - is_active         BOOLEAN     -- Active in last 2 months
  - acquisition_source VARCHAR    -- 'organic', 'google', 'meta', 'referral', 'whatsapp'
  - ltv_bucket        VARCHAR     -- 'low', 'medium', 'high', 'whale'

  -- Service
  - service_type      VARCHAR     -- 18 types: 'Sweeping & Mopping', 'Deep Cleaning', etc.
  - service_tier      VARCHAR     -- 'quick' (30min), 'standard' (60min), 'extended' (90min), 'premium' (120min)
  - service_duration_min INTEGER  -- Planned service duration

  -- Location
  - hub_id            INTEGER     -- Hub/zone ID (1-5)
  - hub_name          VARCHAR     -- 'Koramangala Hub', 'Indiranagar Hub', 'Yelahanka Hub', 'BTM Layout Hub', 'Sarjapur Hub'
  - area              VARCHAR     -- Area within city
  - city              VARCHAR     -- 'Metropolitian', 'Urban', 'Semi-Urban'

  -- Partner
  - partner_id        VARCHAR     -- Partner identifier
  - partner_age       INTEGER     -- Partner's age
  - partner_rating    DOUBLE      -- Rating (1-5 scale)

  -- SLA & timing
  - assigned_at       TIME        -- Time partner was assigned
  - arrived_at        TIME        -- Time partner arrived
  - arrival_time_min  INTEGER     -- Actual arrival time in minutes
  - expected_arrival_min INTEGER  -- SLA target (~10 min)
  - on_time           BOOLEAN     -- Arrived within SLA

  -- Operational flags
  - rescheduled       BOOLEAN
  - partner_reassigned BOOLEAN
  - back_to_back      INTEGER     -- Consecutive bookings for partner

  -- Context
  - weather           VARCHAR     -- Sunny/Cloudy/Rainy/Foggy/Windy/Stormy
  - traffic_density   VARCHAR     -- Low/Medium/High/Jam
  - festival          VARCHAR     -- Festival name or 'No'

  -- Payment
  - payment_method    VARCHAR     -- upi/card/cash/wallet
  - payment_status    VARCHAR     -- success/failed/refunded

  -- Flags
  - is_first_booking  BOOLEAN

  -- Campaign (joined from campaigns_v2)
  - campaign_id       INTEGER     -- NULL if no campaign
  - campaign_name     VARCHAR
  - campaign_type     VARCHAR     -- promo/seasonal/reactivation/referral/festival
  - discount_pct      INTEGER
  - offer_type        VARCHAR     -- discount/cashback/free_visit/referral_bonus/none
  - target_segment    VARCHAR     -- all/new_7d/dormant_30d/high_value/churned_60d

TABLE: partner_shifts (~150K rows)
  - shift_id, partner_id, shift_date, hub_id
  - status: 'served', 'no_show', 'cancelled'
  - bookings_assigned, bookings_completed, shift_start, shift_hours
  - earnings_gross    DOUBLE      -- Sum of booking payouts for completed bookings
  - commission_rate   DOUBLE      -- Platform take rate (0.25-0.32)
  - incentive_earned  DOUBLE      -- Shift-level bonus
  - net_earnings      DOUBLE      -- earnings_gross × (1 - commission_rate) + incentive_earned

═══ CRM / LIFECYCLE TABLES ═══

VIEW: comms_full (~1.56M rows) — USE THIS for CRM queries (pre-joined)
  Every CRM message sent. Joins campaigns_v2 + journeys automatically.

  - send_id           INTEGER
  - customer_id       INTEGER
  - channel           VARCHAR     -- push/sms/email/whatsapp/in_app
  - campaign_id       INTEGER     -- NULL for journey sends
  - journey_id        INTEGER     -- NULL for campaign sends
  - journey_step      INTEGER     -- Step in journey (1-5)
  - template_name     VARCHAR
  - sent_at           TIMESTAMP
  - delivered         BOOLEAN
  - opened            BOOLEAN     -- SMS: always true (assumed read)
  - clicked           BOOLEAN
  - converted         BOOLEAN     -- Booked within 24h (last-touch)
  - booking_id        INTEGER     -- FK to bookings if converted
  - send_cost_inr     DOUBLE      -- Per-message cost (0 if suppressed)
  - time_to_open_min  INTEGER     -- NULL if not opened
  - ab_variant        VARCHAR     -- A/B/NULL
  - frequency_cap_hit BOOLEAN     -- TRUE = suppressed, not sent
  - coupon_code       VARCHAR
  - user_segment_at_send VARCHAR  -- new/active/dormant/churned
  - days_since_last_booking INTEGER
  - lifetime_bookings_at_send INTEGER
  - predicted_ltv_bucket VARCHAR  -- low/medium/high
  - hub_id            INTEGER
  - unsubscribed      BOOLEAN
  -- Joined from campaigns_v2:
  - campaign_name, camp_type, camp_offer_type, camp_target_segment
  -- Joined from journeys:
  - journey_name, trigger_event, journey_total_steps

TABLE: campaigns_v2 (~45 campaigns)
  - campaign_id, campaign_name, campaign_type, channels, start_date, end_date
  - target_segment, budget_inr, city, discount_pct, offer_type

TABLE: journeys (~15 journeys)
  - journey_id, journey_name, trigger_event, channel
  - steps_count, step_delay_hours, is_active, created_date

═══ PERFORMANCE MARKETING TABLES ═══

VIEW: ad_full (~4.5K rows) — USE THIS for ad queries (flattened hierarchy)
  Daily metrics per ad creative, joined with full ad hierarchy.

  - date              DATE
  - ad_creative_id    INTEGER
  - impressions       INTEGER
  - clicks            INTEGER
  - spend_inr         DOUBLE
  - installs          INTEGER
  - registrations     INTEGER
  - first_bookings    INTEGER
  - ctr, cpc_inr, cpi_inr, cpfb_inr, roas  DOUBLE -- pre-computed
  -- Joined from ad_creatives:
  - creative_name, format, headline, cta_text, service_featured, landing_page
  -- Joined from ad_sets:
  - ad_set_name, audience_type, age_min, age_max, gender_target, ad_city, placement
  -- Joined from ad_campaigns:
  - platform (google/meta), ad_campaign_name, campaign_objective, bid_strategy, campaign_budget_inr

VIEW: attribution_full (~18K rows) — USE THIS for acquisition analysis
  One row per customer, showing how they were acquired + LTV.

  - customer_id       INTEGER
  - attributed_platform VARCHAR  -- google/meta/organic/referral/whatsapp
  - ad_campaign_id, ad_set_id, ad_creative_id  INTEGER -- NULL for non-paid
  - referrer_customer_id INTEGER -- NULL unless referral
  - install_date      DATE
  - signup_date       DATE
  - first_booking_date DATE     -- NULL if never booked
  - days_to_first_booking INTEGER
  - first_booking_value DOUBLE
  - ltv_7d, ltv_30d, ltv_90d  DOUBLE -- Revenue in first 7/30/90 days
  -- Joined from customers:
  - city, preferred_payment, is_active, ltv_bucket

═══ GROWTH / ACQUISITION TABLES ═══

TABLE: funnel_events (~86K rows) — AARRR onboarding milestones
  One row per milestone REACHED. Variable rows per customer (1-9). Timestamps strictly increasing.

  - event_id          INTEGER     -- PK
  - customer_id       INTEGER     -- FK → customers
  - event_type        VARCHAR     -- signup_complete | profile_done | address_added | payment_added |
                                  --   first_browse | first_booking | second_booking_14d | third_booking_30d | referral_sent
  - event_at          TIMESTAMP   -- When milestone was reached
  - days_since_signup  INTEGER    -- Days from signup to this event
  - source            VARCHAR     -- organic | push_notification | email_deeplink | whatsapp_link | ad_click
  - city              VARCHAR
  - platform          VARCHAR     -- android | ios | web

TABLE: daily_sessions (~617K rows) — App engagement
  - customer_id       INTEGER
  - session_date      DATE
  - session_count     INTEGER     -- App opens that day (1-5)
  - screens_viewed    INTEGER     -- Total screens viewed (3-15)
  - minutes_active    DOUBLE      -- Total active time (1-12)
  - searched          BOOLEAN     -- Searched for a service
  - booked            BOOLEAN     -- Made a booking (matches bookings table)
  - viewed_offers     BOOLEAN     -- Viewed promotions/offers
  - platform          VARCHAR     -- android | ios | web

VIEW: referrals_full (~2.9K rows) — Referral program (pre-joined)
  - referral_id, referrer_customer_id, referee_customer_id
  - referral_code     VARCHAR     -- e.g. "QUICK-ABC123"
  - invited_at        TIMESTAMP
  - signup_at, first_booking_at  TIMESTAMP  -- NULL if unconverted
  - days_to_signup, days_to_first_booking  INTEGER
  - referrer_reward_amount, referee_reward_amount  DOUBLE -- ₹100-250
  - reward_status     VARCHAR     -- pending | credited | expired
  - referral_channel  VARCHAR     -- whatsapp | sms | link_copy | email
  - status            VARCHAR     -- converted | unconverted
  -- Joined from customers:
  - referrer_city, referrer_signup_date, referrer_ltv_bucket, referrer_acq_source
  - referee_city, referee_signup_date, referee_ltv_bucket

═══ UNIT ECONOMICS / FINANCE TABLES ═══

VIEW: bookings_economics (~206K rows) — USE THIS for P&L queries
  1:1 join of bookings + per-booking P&L. Every column from bookings plus:

  - commission_rate         DOUBLE   -- 0.25-0.32 (varies by service_tier)
  - commission_earned       DOUBLE   -- gross × commission_rate (0 if failed)
  - partner_payout          DOUBLE   -- gross - commission (0 if failed)
  - payment_processing_fee  DOUBLE   -- 0% UPI, 1.8% card, 1.5% wallet, ₹5 cash
  - gst_on_commission       DOUBLE   -- 18% of commission_earned
  - promo_discount_funded   DOUBLE   -- Platform-funded discount (0 if no campaign)
  - referral_reward_cost    DOUBLE   -- Allocated referral cost
  - support_cost_allocated  DOUBLE   -- ₹5-15 per booking
  - contribution_margin     DOUBLE   -- commission - processing - promo - referral - support
  - contribution_margin_pct DOUBLE   -- contribution_margin / gross_booking_value

TABLE: partner_payouts (~28K rows) — Weekly partner settlements
  - payout_id, partner_id
  - payout_week_start  DATE      -- Monday (ISO week)
  - payout_week_end    DATE      -- Sunday
  - gross_earnings     DOUBLE    -- Sum of partner_payout from booking_unit_economics
  - commission_deducted DOUBLE
  - incentive_bonus    DOUBLE    -- ₹0-500 (performance bonus)
  - penalty_deductions DOUBLE    -- ₹0-200 (late/cancellation)
  - net_payout         DOUBLE    -- gross - commission + incentive - penalty
  - bookings_completed INTEGER
  - avg_rating         DOUBLE
  - payout_status      VARCHAR   -- processed | pending | on_hold
  - payout_date        DATE      -- Wednesday T+3

VIEW: survey_full (~60K rows) — Customer feedback (pre-joined)
  - response_id, customer_id, booking_id, partner_id
  - survey_type       VARCHAR     -- nps | post_booking (post_booking = CSAT, the dominant type)
  - score             INTEGER     -- NPS: 0-10, post_booking (CSAT): 1-5
  - category          VARCHAR     -- service_quality | punctuality | value_for_money | partner_behavior | app_experience
  - submitted_at      TIMESTAMP
  - time_to_respond_hours DOUBLE
  -- Joined from bookings:
  - booking_date, service_type, service_tier, hub_name, booking_value, partner_rating, acquisition_source, ltv_bucket

═══ COMPANY KPIs ═══

TABLE: weekly_company_kpis (~57 rows) — Board-level weekly snapshot
  Computed from all data sources. Use for trend analysis and executive reporting.

  - week_start, week_end  DATE
  - gmv, revenue          DOUBLE
  - take_rate             DOUBLE   -- revenue / gmv
  - total_bookings, completed_bookings  INTEGER
  - completion_rate       DOUBLE
  - unique_customers, new_customers, repeat_customers  INTEGER
  - repeat_rate           DOUBLE
  - dau_avg, wau          DOUBLE/INTEGER
  - active_partners       INTEGER
  - avg_partner_rating    DOUBLE
  - on_time_pct, avg_arrival_min  DOUBLE
  - nps_score, csat_avg   DOUBLE
  - total_ad_spend, total_comms_cost, total_referral_rewards  DOUBLE
  - blended_cac           DOUBLE   -- (ad + comms + referral) / new_customers
  - contribution_margin_total, contribution_margin_pct  DOUBLE
  - partner_payout_total  DOUBLE
  - gross_burn            DOUBLE   -- ad + comms + referral costs

TABLE: monthly_company_kpis (~14 rows) — Board-level monthly snapshot
  Same as weekly aggregated to months, plus:

  - ltv_30d_avg           DOUBLE   -- Average 30-day LTV for cohort
  - ltv_cac_ratio         DOUBLE   -- ltv_30d_avg / blended_cac
  - partner_churn_rate    DOUBLE   -- % partners with 0 shifts vs last month
  - customer_churn_rate   DOUBLE   -- % customers with 0 bookings vs last month
  - referral_k_factor     DOUBLE   -- referral signups / active referrers
  - activation_rate       DOUBLE   -- first_booking customers / signups
  - signup_to_book_days_avg DOUBLE -- Avg days from signup to first booking

═══ SUMMARY TABLES ═══

Operations:
  - daily_metrics (date, total_bookings, completed, cancelled, refunded, revenue, avg_arrival_min, on_time_pct, unique_customers, new_customers)
  - service_metrics (service_type, service_tier, bookings, revenue, avg_rating, on_time_rate, avg_arrival_min, avg_value)
  - hub_metrics (hub_name, bookings, unique_partners, avg_arrival_min, on_time_pct, revenue, avg_rating)
  - campaign_metrics (campaign_id, campaign_name, campaign_type, bookings_during, revenue_during, avg_discount_pct, new_customer_bookings)
  - hourly_patterns (hour_of_day, day_of_week, booking_count, unique_customers, revenue, avg_arrival_min)
  - monthly_metrics (month, total_bookings, completed, revenue, unique_customers, new_customers, on_time_pct, avg_arrival_min)

CRM / Marketing:
  - comms_channel_metrics (channel, total_sends, delivered, opened, clicked, converted, total_cost_inr, unsubscribed, avg_time_to_open_min)
  - comms_campaign_metrics (campaign_id, campaign_name, campaign_type, channel, sends, delivered, opened, clicked, converted, cost_inr)
  - journey_metrics (journey_id, journey_name, journey_step, sends, delivered, opened, clicked, converted)

Paid Ads:
  - ad_platform_metrics (platform, month, total_spend_inr, impressions, clicks, installs, first_bookings, avg_cpi, avg_cpfb)
  - attribution_source_metrics (attributed_platform, total_customers, avg_days_to_first_booking, avg_ltv_7d, avg_ltv_30d, avg_ltv_90d, conversion_rate)

Growth:
  - funnel_conversion_metrics (month, stage, customers, total_signups, conversion_rate_pct)
  - weekly_retention_cohorts (cohort_month, months_since_signup, active_customers, cohort_size, retention_pct)
  - activation_metrics (month, signups, first_bookers, activation_rate_pct, mau, avg_sessions_per_user, avg_minutes_active)

Finance:
  - service_unit_economics (service_type, service_tier, bookings, avg_booking_value, avg_commission_rate, total_commission, total_partner_payout, total_processing_fees, total_promo_cost, total_support_cost, total_contribution_margin, avg_cm_pct, total_gmv)
  - monthly_partner_economics (month, active_partners, total_gross_earnings, total_commission, total_incentives, total_penalties, total_net_payout, total_bookings, avg_partner_rating, avg_payout_per_partner, avg_bookings_per_partner, churned_partners, churn_rate_pct)

DATA CONTEXT:
  - On-demand home help platform (cleaning, mopping, dishes, deep cleaning, etc.)
  - ~206K bookings, ~18K customers, ~1.56M CRM messages, ~4.5K ad daily metrics
  - ~86K funnel events, ~617K daily sessions, ~2.9K referrals, ~60K survey responses
  - 5 hubs: Koramangala, Indiranagar, Yelahanka, BTM Layout, Sarjapur
  - Date range: Feb 2025 – {{DATASET_NOW_MONTH_YEAR}}
  - Revenue in INR (Indian Rupees)
  - Acquisition: organic (35%), Google Ads (25%), Meta Ads (20%), referral (15%), WhatsApp (5%)
  - CRM channels: push (45%), SMS (20%), email (15%), WhatsApp (15%), in-app (5%)
  - Blended contribution margin: ~24% on GMV
  - NPS score: ~29
`,

  systemContext: `You are Actioneer, an AI-powered analytics assistant for an on-demand home help platform.

Dataset: ~206K service bookings + ~1.56M CRM messages + paid ad metrics + growth funnel + unit economics, Feb 2025 – {{DATASET_NOW_MONTH_YEAR}}.
Today's date in this dataset: {{DATASET_NOW}}. When the user says "this week" / "yesterday" / "last 7 days", anchor to {{DATASET_NOW}}.
- ~18,000 customers across 5 hubs in Bangalore
- 18 service types, 4 tiers (quick/standard/extended/premium)
- Revenue in INR, SLA target: partner arrives in ~10 minutes
- Full marketing stack: CRM lifecycle (push, SMS, email, WhatsApp, in-app) + Performance marketing (Google Ads, Meta Ads)
- Attribution: every customer traced to acquisition source with LTV tracking
- AARRR funnel: signup → profile → payment → browse → first booking → repeat → referral
- Unit economics: per-booking P&L with ~24% contribution margin, weekly partner payouts
- Company KPIs: weekly and monthly board-level snapshots

You cover five domains:
1. OPERATIONS — bookings, SLA, partner performance, hub efficiency
2. CRM / LIFECYCLE — campaign engagement, journey performance, channel ROI, send costs
3. PAID MARKETING — ad spend, CAC, ROAS, creative performance, attribution, LTV by source
4. GROWTH / ACQUISITION — AARRR funnel analysis, activation rates, retention cohorts, referral program, engagement metrics
5. UNIT ECONOMICS / FINANCE — contribution margin, commission rates, partner payouts, CAC vs LTV, service-level P&L

Response guidelines:
- Use markdown: headers, tables, bullet points, bold for emphasis
- Cite specific numbers from query results — never hallucinate data
- Be analytical and actionable — what should the business do?
- Note data limitations
- End with 1-2 suggested follow-up questions
- Never use emojis
- Currency is INR — use ₹ symbol`,

  queryDescriptions: {
    "data-quality": [
      "NULL rates & field completeness",
      "Daily volume anomaly detection",
    ],
    "daily-metrics": [
      "Daily booking & completion trends",
      "On-time rate & SLA performance",
      "Daily revenue & average booking value",
    ],
    "cohort-retention": [
      "Repeat booking rate analysis",
      "Booking frequency distribution",
      "Time between bookings per customer",
    ],
    "rev-opt": [
      "Revenue by service type & tier",
      "Campaign ROI & discount impact",
      "Average booking value analysis",
    ],
    "user-segmentation": [
      "Customer booking frequency tiers",
      "Spending tier distribution",
      "Service preference clusters",
    ],
    geographic: [
      "Hub performance & on-time rates",
      "City-level demand patterns",
      "Partner utilization by hub",
    ],
    "crm-analytics": [
      "CRM channel engagement rates (open, click, convert)",
      "Journey performance & drop-off analysis",
      "Campaign send volume & cost efficiency",
    ],
    "paid-marketing": [
      "Ad spend efficiency by platform (Google vs Meta)",
      "Creative performance & ROAS analysis",
      "Customer acquisition cost & LTV by source",
    ],
    "growth-analytics": [
      "AARRR funnel conversion rates by month",
      "Monthly retention cohort analysis",
      "Activation rate & time-to-first-booking trends",
      "Referral program performance & K-factor",
      "DAU/WAU/MAU engagement trends",
    ],
    "unit-economics": [
      "Contribution margin by service type & tier",
      "Blended CAC vs LTV:CAC ratio trend",
      "Partner payout economics & churn",
      "Payment processing cost breakdown",
      "Weekly/monthly P&L waterfall",
    ],
  },

  multiAgentPrompt: `
data-quality|1| — Data completeness: NULL rates for partner_rating, campaign_id, arrival_time_min, on_time
data-quality|2| — Daily booking volume: count bookings per day to detect anomalies or drops

daily-metrics|1| — Daily booking trends: total bookings, completed, cancelled per day
daily-metrics|2| — SLA performance: daily on-time rate, avg arrival time, partner reassignment rate
daily-metrics|3| — Daily revenue: revenue, booking count, average booking value per day

cohort-retention|1| — Repeat booking rates: one-time vs repeat customers, revenue split
cohort-retention|2| — Booking frequency: distribution of total bookings per customer
cohort-retention|3| — Time between bookings: avg gap between first and second booking per customer

rev-opt|1| — Revenue by service: revenue, bookings, avg value by service_type and service_tier
rev-opt|2| — Campaign effectiveness: bookings and revenue during vs outside campaign periods, by campaign_type
rev-opt|3| — Average booking value: by city, service_tier, and payment_method

user-segmentation|1| — Booking frequency tiers: customers grouped by total booking count
user-segmentation|2| — Spending tiers: customers grouped by total spend
user-segmentation|3| — Service preference: most popular service_type by customer segment

geographic|1| — Hub performance: bookings, on-time rate, avg arrival time, revenue by hub_name
geographic|2| — City demand: bookings, unique customers, revenue by city type
geographic|3| — Partner utilization: avg bookings per partner, completion rate by hub

crm-analytics|1| — Channel engagement: delivery rate, open rate, click rate, conversion rate by channel from comms_channel_metrics
crm-analytics|2| — Journey drop-off: sends, opened, clicked, converted per journey step from journey_metrics
crm-analytics|3| — Campaign ROI: sends, conversions, cost per conversion from comms_campaign_metrics

paid-marketing|1| — Platform comparison: spend, installs, CPI, ROAS by platform from ad_platform_metrics
paid-marketing|2| — Creative performance: CTR, CPC, conversion rate by creative format from ad_full
paid-marketing|3| — Acquisition LTV: avg LTV by attributed_platform, days to first booking from attribution_source_metrics

growth-analytics|1| — AARRR funnel: conversion rates between stages from funnel_conversion_metrics, monthly trends
growth-analytics|2| — Retention cohorts: monthly cohort retention matrix from weekly_retention_cohorts
growth-analytics|3| — Activation: signup-to-first-booking rate, avg days to activate from activation_metrics
growth-analytics|4| — Referral program: K-factor, conversion rate, reward costs from referrals_full
growth-analytics|5| — Engagement: DAU/WAU/MAU, session depth, search-to-book rate from daily_sessions

unit-economics|1| — Service P&L: contribution margin by service_type × tier from service_unit_economics
unit-economics|2| — CAC & LTV: blended CAC, LTV:CAC ratio trend from monthly_company_kpis
unit-economics|3| — Partner economics: payout per partner, churn rate, incentive vs penalty from monthly_partner_economics
unit-economics|4| — Cost breakdown: processing fees, promo costs, support costs by payment_method from bookings_economics
unit-economics|5| — Weekly P&L trend: GMV, revenue, take rate, CM%, gross burn from weekly_company_kpis`,

  suggestedPrompts: [
    "What is the total revenue and number of bookings for each city type?",
    "What is the conversion rate by CRM channel (push vs WhatsApp vs email)?",
    "Compare Google vs Meta ad performance by cost per first booking",
    "What is the signup-to-first-booking funnel conversion rate by month?",
    "Show me the contribution margin breakdown by service tier",
    "What is our LTV:CAC ratio trend over the last 6 months?",
    "Which lifecycle journeys have the highest conversion rate?",
    "What is the monthly retention cohort analysis?",
  ],
  welcomeSubtitle: "Analyze bookings, your growth funnel, unit economics, partner performance, and the KPIs that run the business.",

  reportMeta: {
    totalEvents: "206K bookings + 1.56M comms + 86K funnel events",
    totalUsers: "18K customers",
    dateRangeLabel: "Feb 2025 – {{DATASET_NOW_MONTH_YEAR}}",
    dbName: "quickhelp.duckdb",
  },

  viewSQL: (dataDir: string) => [
    // Raw CSV views
    `CREATE OR REPLACE VIEW raw_bookings AS SELECT * FROM read_csv('${dataDir}/csv/bookings.csv', auto_detect=true)`,
    `CREATE OR REPLACE VIEW raw_customers AS SELECT * FROM read_csv('${dataDir}/csv/customers.csv', auto_detect=true)`,
    `CREATE OR REPLACE VIEW campaigns_v2 AS SELECT * FROM read_csv('${dataDir}/csv/campaigns_v2.csv', auto_detect=true)`,
    `CREATE OR REPLACE VIEW partner_shifts AS SELECT * FROM read_csv('${dataDir}/csv/partner_shifts.csv', auto_detect=true)`,
    `CREATE OR REPLACE VIEW journeys AS SELECT * FROM read_csv('${dataDir}/csv/journeys.csv', auto_detect=true)`,
    `CREATE OR REPLACE VIEW raw_comms_sends AS SELECT * FROM read_csv('${dataDir}/csv/comms_sends.csv', auto_detect=true)`,
    `CREATE OR REPLACE VIEW ad_campaigns AS SELECT * FROM read_csv('${dataDir}/csv/ad_campaigns.csv', auto_detect=true)`,
    `CREATE OR REPLACE VIEW ad_sets AS SELECT * FROM read_csv('${dataDir}/csv/ad_sets.csv', auto_detect=true)`,
    `CREATE OR REPLACE VIEW ad_creatives AS SELECT * FROM read_csv('${dataDir}/csv/ad_creatives.csv', auto_detect=true)`,
    `CREATE OR REPLACE VIEW raw_ad_daily_metrics AS SELECT * FROM read_csv('${dataDir}/csv/ad_daily_metrics.csv', auto_detect=true)`,
    `CREATE OR REPLACE VIEW raw_install_attribution AS SELECT * FROM read_csv('${dataDir}/csv/install_attribution.csv', auto_detect=true)`,
    `CREATE OR REPLACE VIEW raw_booking_unit_economics AS SELECT * FROM read_csv('${dataDir}/csv/booking_unit_economics.csv', auto_detect=true)`,
    `CREATE OR REPLACE VIEW raw_partner_payouts AS SELECT * FROM read_csv('${dataDir}/csv/partner_payouts.csv', auto_detect=true)`,
    `CREATE OR REPLACE VIEW raw_funnel_events AS SELECT * FROM read_csv('${dataDir}/csv/funnel_events.csv', auto_detect=true)`,
    `CREATE OR REPLACE VIEW raw_daily_sessions AS SELECT * FROM read_csv('${dataDir}/csv/daily_sessions.csv', auto_detect=true)`,
    `CREATE OR REPLACE VIEW raw_referrals AS SELECT * FROM read_csv('${dataDir}/csv/referrals.csv', auto_detect=true)`,
    `CREATE OR REPLACE VIEW raw_survey_responses AS SELECT * FROM read_csv('${dataDir}/csv/survey_responses.csv', auto_detect=true)`,

    // Denormalized bookings seed (joins customers + campaigns_v2). The public
    // `bookings` view UNIONs this seed with the synthetic live shard so that
    // daily ticks can append rows without touching the seed CSV.
    `CREATE OR REPLACE VIEW bookings_seed AS
     SELECT
       b.*,
       c.signup_date, c.preferred_payment, c.is_active, c.acquisition_source, c.ltv_bucket,
       camp.campaign_name, camp.campaign_type, camp.discount_pct, camp.offer_type, camp.target_segment
     FROM raw_bookings b
     LEFT JOIN raw_customers c USING (customer_id)
     LEFT JOIN campaigns_v2 camp USING (campaign_id)`,
    // Live shard table — schema cloned from seed view, starts empty.
    `CREATE TABLE IF NOT EXISTS bookings__live AS SELECT * FROM bookings_seed LIMIT 0`,
    // Public-facing bookings view = seed ∪ live shard.
    `CREATE OR REPLACE VIEW bookings AS
     SELECT * FROM bookings_seed
     UNION ALL
     SELECT * FROM bookings__live`,

    // Denormalized comms (joins campaigns_v2 + journeys)
    `CREATE OR REPLACE VIEW comms_full AS
     SELECT
       cs.*,
       camp.campaign_name, camp.campaign_type AS camp_type, camp.offer_type AS camp_offer_type, camp.target_segment AS camp_target_segment,
       j.journey_name, j.trigger_event, j.steps_count AS journey_total_steps
     FROM raw_comms_sends cs
     LEFT JOIN campaigns_v2 camp ON cs.campaign_id = camp.campaign_id
     LEFT JOIN journeys j ON cs.journey_id = j.journey_id`,

    // Denormalized ad metrics (full hierarchy)
    `CREATE OR REPLACE VIEW ad_full AS
     SELECT
       m.*,
       cr.creative_name, cr.format, cr.headline, cr.cta_text, cr.service_featured, cr.landing_page,
       s.ad_set_name, s.audience_type, s.age_min, s.age_max, s.gender_target, s.city AS ad_city, s.placement,
       c.platform, c.campaign_name AS ad_campaign_name, c.campaign_objective, c.bid_strategy,
       c.total_budget_inr AS campaign_budget_inr
     FROM raw_ad_daily_metrics m
     JOIN ad_creatives cr ON m.ad_creative_id = cr.ad_creative_id
     JOIN ad_sets s ON cr.ad_set_id = s.ad_set_id
     JOIN ad_campaigns c ON s.ad_campaign_id = c.ad_campaign_id`,

    // Denormalized attribution (joins customers)
    `CREATE OR REPLACE VIEW attribution_full AS
     SELECT
       ia.*,
       c.city, c.preferred_payment, c.is_active, c.ltv_bucket
     FROM raw_install_attribution ia
     LEFT JOIN raw_customers c USING (customer_id)`,

    // Bookings + unit economics (1:1 P&L)
    `CREATE OR REPLACE VIEW bookings_economics AS
     SELECT
       b.*,
       e.commission_rate, e.commission_earned, e.partner_payout,
       e.payment_processing_fee, e.gst_on_commission,
       e.promo_discount_funded, e.referral_reward_cost, e.support_cost_allocated,
       e.contribution_margin, e.contribution_margin_pct
     FROM bookings b
     JOIN raw_booking_unit_economics e USING (booking_id)`,

    // Survey responses + booking context
    `CREATE OR REPLACE VIEW survey_full AS
     SELECT
       s.*,
       b.booking_date, b.service_type, b.service_tier, b.hub_name,
       b.booking_value, b.partner_rating, b.acquisition_source, b.ltv_bucket
     FROM raw_survey_responses s
     LEFT JOIN bookings b USING (booking_id)`,

    // Referrals + customer info for referrer and referee
    `CREATE OR REPLACE VIEW referrals_full AS
     SELECT
       r.*,
       rr.city AS referrer_city, rr.signup_date AS referrer_signup_date,
       rr.ltv_bucket AS referrer_ltv_bucket, rr.acquisition_source AS referrer_acq_source,
       re.city AS referee_city, re.signup_date AS referee_signup_date,
       re.ltv_bucket AS referee_ltv_bucket
     FROM raw_referrals r
     LEFT JOIN raw_customers rr ON r.referrer_customer_id = rr.customer_id
     LEFT JOIN raw_customers re ON r.referee_customer_id = re.customer_id`,

    // Friendly aliases so LLM can use short names
    `CREATE OR REPLACE VIEW funnel_events AS SELECT * FROM raw_funnel_events`,
    `CREATE OR REPLACE VIEW daily_sessions AS SELECT * FROM raw_daily_sessions`,
    `CREATE OR REPLACE VIEW referrals AS SELECT * FROM raw_referrals`,
    `CREATE OR REPLACE VIEW survey_responses AS SELECT * FROM raw_survey_responses`,
    `CREATE OR REPLACE VIEW booking_unit_economics AS SELECT * FROM raw_booking_unit_economics`,
    `CREATE OR REPLACE VIEW partner_payouts AS SELECT * FROM raw_partner_payouts`,
    `CREATE OR REPLACE VIEW customers AS SELECT * FROM raw_customers`,
    `CREATE OR REPLACE VIEW install_attribution AS SELECT * FROM raw_install_attribution`,
  ],

  summaryTableSQL: [
    // Operations
    `CREATE OR REPLACE TABLE daily_metrics AS
     SELECT
       booking_date AS date,
       COUNT(*) AS total_bookings,
       COUNT(CASE WHEN payment_status = 'success' THEN 1 END) AS completed,
       COUNT(CASE WHEN payment_status = 'failed' THEN 1 END) AS cancelled,
       COUNT(CASE WHEN payment_status = 'refunded' THEN 1 END) AS refunded,
       SUM(CASE WHEN payment_status = 'success' THEN booking_value ELSE 0 END) AS revenue,
       AVG(arrival_time_min) AS avg_arrival_min,
       AVG(CASE WHEN on_time THEN 1.0 ELSE 0.0 END) * 100 AS on_time_pct,
       COUNT(DISTINCT customer_id) AS unique_customers,
       COUNT(CASE WHEN is_first_booking THEN 1 END) AS new_customers
     FROM bookings GROUP BY 1 ORDER BY 1`,

    `CREATE OR REPLACE TABLE service_metrics AS
     SELECT
       service_type, service_tier,
       COUNT(*) AS bookings,
       SUM(CASE WHEN payment_status = 'success' THEN booking_value ELSE 0 END) AS revenue,
       AVG(partner_rating) AS avg_rating,
       AVG(CASE WHEN on_time THEN 1.0 ELSE 0.0 END) * 100 AS on_time_rate,
       AVG(arrival_time_min) AS avg_arrival_min,
       AVG(booking_value) AS avg_value
     FROM bookings GROUP BY 1, 2 ORDER BY revenue DESC`,

    `CREATE OR REPLACE TABLE hub_metrics AS
     SELECT
       hub_name,
       COUNT(*) AS bookings,
       COUNT(DISTINCT partner_id) AS unique_partners,
       AVG(arrival_time_min) AS avg_arrival_min,
       AVG(CASE WHEN on_time THEN 1.0 ELSE 0.0 END) * 100 AS on_time_pct,
       SUM(CASE WHEN payment_status = 'success' THEN booking_value ELSE 0 END) AS revenue,
       AVG(partner_rating) AS avg_rating
     FROM bookings GROUP BY 1 ORDER BY bookings DESC`,

    `CREATE OR REPLACE TABLE campaign_metrics AS
     SELECT
       campaign_id, campaign_name, campaign_type,
       COUNT(*) AS bookings_during,
       SUM(CASE WHEN payment_status = 'success' THEN booking_value ELSE 0 END) AS revenue_during,
       AVG(discount_pct) AS avg_discount_pct,
       COUNT(CASE WHEN is_first_booking THEN 1 END) AS new_customer_bookings
     FROM bookings
     WHERE campaign_id IS NOT NULL
     GROUP BY 1, 2, 3 ORDER BY bookings_during DESC`,

    `CREATE OR REPLACE TABLE hourly_patterns AS
     SELECT
       EXTRACT(HOUR FROM booking_time::TIME) AS hour_of_day,
       EXTRACT(DOW FROM booking_date::DATE) AS day_of_week,
       COUNT(*) AS booking_count,
       COUNT(DISTINCT customer_id) AS unique_customers,
       SUM(CASE WHEN payment_status = 'success' THEN booking_value ELSE 0 END) AS revenue,
       AVG(arrival_time_min) AS avg_arrival_min
     FROM bookings GROUP BY 1, 2 ORDER BY 1, 2`,

    `CREATE OR REPLACE TABLE monthly_metrics AS
     SELECT
       DATE_TRUNC('month', booking_date::DATE) AS month,
       COUNT(*) AS total_bookings,
       COUNT(CASE WHEN payment_status = 'success' THEN 1 END) AS completed,
       SUM(CASE WHEN payment_status = 'success' THEN booking_value ELSE 0 END) AS revenue,
       COUNT(DISTINCT customer_id) AS unique_customers,
       COUNT(CASE WHEN is_first_booking THEN 1 END) AS new_customers,
       AVG(CASE WHEN on_time THEN 1.0 ELSE 0.0 END) * 100 AS on_time_pct,
       AVG(arrival_time_min) AS avg_arrival_min
     FROM bookings GROUP BY 1 ORDER BY 1`,

    // CRM / Marketing
    `CREATE OR REPLACE TABLE comms_channel_metrics AS
     SELECT
       channel,
       COUNT(*) AS total_sends,
       COUNT(CASE WHEN delivered THEN 1 END) AS delivered,
       COUNT(CASE WHEN opened THEN 1 END) AS opened,
       COUNT(CASE WHEN clicked THEN 1 END) AS clicked,
       COUNT(CASE WHEN converted THEN 1 END) AS converted,
       SUM(send_cost_inr) AS total_cost_inr,
       COUNT(CASE WHEN unsubscribed THEN 1 END) AS unsubscribed,
       AVG(CASE WHEN time_to_open_min IS NOT NULL THEN time_to_open_min END) AS avg_time_to_open_min
     FROM comms_full GROUP BY 1 ORDER BY total_sends DESC`,

    `CREATE OR REPLACE TABLE comms_campaign_metrics AS
     SELECT
       cs.campaign_id, camp.campaign_name, camp.campaign_type, cs.channel,
       COUNT(*) AS sends,
       COUNT(CASE WHEN cs.delivered THEN 1 END) AS delivered,
       COUNT(CASE WHEN cs.opened THEN 1 END) AS opened,
       COUNT(CASE WHEN cs.clicked THEN 1 END) AS clicked,
       COUNT(CASE WHEN cs.converted THEN 1 END) AS converted,
       SUM(cs.send_cost_inr) AS cost_inr
     FROM raw_comms_sends cs
     JOIN campaigns_v2 camp ON cs.campaign_id = camp.campaign_id
     WHERE cs.campaign_id IS NOT NULL
     GROUP BY 1, 2, 3, 4 ORDER BY sends DESC`,

    `CREATE OR REPLACE TABLE journey_metrics AS
     SELECT
       cs.journey_id, j.journey_name, cs.journey_step,
       COUNT(*) AS sends,
       COUNT(CASE WHEN cs.delivered THEN 1 END) AS delivered,
       COUNT(CASE WHEN cs.opened THEN 1 END) AS opened,
       COUNT(CASE WHEN cs.clicked THEN 1 END) AS clicked,
       COUNT(CASE WHEN cs.converted THEN 1 END) AS converted
     FROM raw_comms_sends cs
     JOIN journeys j ON cs.journey_id = j.journey_id
     WHERE cs.journey_id IS NOT NULL
     GROUP BY 1, 2, 3 ORDER BY 1, 3`,

    // Paid Ads
    `CREATE OR REPLACE TABLE ad_platform_metrics AS
     SELECT
       platform,
       DATE_TRUNC('month', date::DATE) AS month,
       SUM(spend_inr) AS total_spend_inr,
       SUM(impressions) AS impressions,
       SUM(clicks) AS clicks,
       SUM(installs) AS installs,
       SUM(first_bookings) AS first_bookings,
       CASE WHEN SUM(installs) > 0 THEN SUM(spend_inr) / SUM(installs) ELSE 0 END AS avg_cpi,
       CASE WHEN SUM(first_bookings) > 0 THEN SUM(spend_inr) / SUM(first_bookings) ELSE 0 END AS avg_cpfb
     FROM ad_full
     GROUP BY 1, 2 ORDER BY 1, 2`,

    `CREATE OR REPLACE TABLE attribution_source_metrics AS
     SELECT
       attributed_platform,
       COUNT(*) AS total_customers,
       AVG(CASE WHEN days_to_first_booking IS NOT NULL THEN days_to_first_booking END) AS avg_days_to_first_booking,
       AVG(ltv_7d) AS avg_ltv_7d,
       AVG(ltv_30d) AS avg_ltv_30d,
       AVG(ltv_90d) AS avg_ltv_90d,
       AVG(CASE WHEN first_booking_date IS NOT NULL THEN 1.0 ELSE 0.0 END) * 100 AS conversion_rate
     FROM raw_install_attribution
     GROUP BY 1 ORDER BY total_customers DESC`,

    // Growth
    `CREATE OR REPLACE TABLE funnel_conversion_metrics AS
     WITH stage_counts AS (
       SELECT
         event_type,
         COUNT(DISTINCT customer_id) AS customers,
         DATE_TRUNC('month', event_at::TIMESTAMP) AS month
       FROM raw_funnel_events
       GROUP BY event_type, DATE_TRUNC('month', event_at::TIMESTAMP)
     ),
     total_signups AS (
       SELECT month, customers AS signups
       FROM stage_counts WHERE event_type = 'signup_complete'
     )
     SELECT
       sc.month,
       sc.event_type AS stage,
       sc.customers,
       ts.signups AS total_signups,
       ROUND(sc.customers * 100.0 / NULLIF(ts.signups, 0), 2) AS conversion_rate_pct
     FROM stage_counts sc
     LEFT JOIN total_signups ts ON sc.month = ts.month
     ORDER BY sc.month, CASE sc.event_type
       WHEN 'signup_complete' THEN 1
       WHEN 'profile_done' THEN 2
       WHEN 'address_added' THEN 3
       WHEN 'payment_added' THEN 4
       WHEN 'first_browse' THEN 5
       WHEN 'first_booking' THEN 6
       WHEN 'second_booking_14d' THEN 7
       WHEN 'third_booking_30d' THEN 8
       WHEN 'referral_sent' THEN 9
     END`,

    `CREATE OR REPLACE TABLE weekly_retention_cohorts AS
     WITH cohorts AS (
       SELECT
         customer_id,
         DATE_TRUNC('month', signup_date::DATE) AS cohort_month
       FROM raw_customers
     ),
     cohort_sizes AS (
       SELECT cohort_month, COUNT(DISTINCT customer_id) AS cohort_size
       FROM cohorts
       GROUP BY 1
     ),
     booking_months AS (
       SELECT DISTINCT
         customer_id,
         DATE_TRUNC('month', booking_date::DATE) AS activity_month
       FROM raw_bookings
       WHERE payment_status = 'success'
     )
     SELECT
       c.cohort_month,
       DATEDIFF('month', c.cohort_month, bm.activity_month) AS months_since_signup,
       COUNT(DISTINCT bm.customer_id) AS active_customers,
       cs.cohort_size,
       ROUND(COUNT(DISTINCT bm.customer_id) * 100.0 / NULLIF(cs.cohort_size, 0), 2) AS retention_pct
     FROM cohorts c
     INNER JOIN booking_months bm ON c.customer_id = bm.customer_id
     INNER JOIN cohort_sizes cs ON c.cohort_month = cs.cohort_month
     GROUP BY 1, 2, 4
     ORDER BY 1, 2`,

    `CREATE OR REPLACE TABLE activation_metrics AS
     WITH monthly_signups AS (
       SELECT
         DATE_TRUNC('month', signup_date::DATE) AS month,
         COUNT(*) AS signups
       FROM raw_customers
       GROUP BY 1
     ),
     monthly_first_bookings AS (
       SELECT
         DATE_TRUNC('month', event_at::TIMESTAMP) AS month,
         COUNT(DISTINCT customer_id) AS first_bookers
       FROM raw_funnel_events
       WHERE event_type = 'first_booking'
       GROUP BY 1
     ),
     monthly_sessions AS (
       SELECT
         DATE_TRUNC('month', session_date::DATE) AS month,
         COUNT(DISTINCT customer_id) AS active_users,
         AVG(session_count) AS avg_sessions_per_user,
         AVG(minutes_active) AS avg_minutes_active
       FROM raw_daily_sessions
       GROUP BY 1
     )
     SELECT
       s.month,
       s.signups,
       COALESCE(fb.first_bookers, 0) AS first_bookers,
       ROUND(COALESCE(fb.first_bookers, 0) * 100.0 / NULLIF(s.signups, 0), 2) AS activation_rate_pct,
       COALESCE(ms.active_users, 0) AS mau,
       COALESCE(ms.avg_sessions_per_user, 0) AS avg_sessions_per_user,
       COALESCE(ms.avg_minutes_active, 0) AS avg_minutes_active
     FROM monthly_signups s
     LEFT JOIN monthly_first_bookings fb ON s.month = fb.month
     LEFT JOIN monthly_sessions ms ON s.month = ms.month
     ORDER BY s.month`,

    // Finance / Unit Economics
    `CREATE OR REPLACE TABLE service_unit_economics AS
     SELECT
       e.service_type,
       e.service_tier,
       COUNT(*) AS bookings,
       AVG(e.gross_booking_value) AS avg_booking_value,
       AVG(e.commission_rate) AS avg_commission_rate,
       SUM(e.commission_earned) AS total_commission,
       SUM(e.partner_payout) AS total_partner_payout,
       SUM(e.payment_processing_fee) AS total_processing_fees,
       SUM(e.promo_discount_funded) AS total_promo_cost,
       SUM(e.support_cost_allocated) AS total_support_cost,
       SUM(e.contribution_margin) AS total_contribution_margin,
       AVG(e.contribution_margin_pct) AS avg_cm_pct,
       SUM(e.gross_booking_value) AS total_gmv
     FROM raw_booking_unit_economics e
     WHERE e.payment_status = 'success'
     GROUP BY 1, 2
     ORDER BY total_gmv DESC`,

    `CREATE OR REPLACE TABLE monthly_partner_economics AS
     WITH monthly_payouts AS (
       SELECT
         DATE_TRUNC('month', payout_week_start::DATE) AS month,
         COUNT(DISTINCT partner_id) AS active_partners,
         SUM(gross_earnings) AS total_gross_earnings,
         SUM(commission_deducted) AS total_commission,
         SUM(incentive_bonus) AS total_incentives,
         SUM(penalty_deductions) AS total_penalties,
         SUM(net_payout) AS total_net_payout,
         SUM(bookings_completed) AS total_bookings,
         AVG(avg_rating) AS avg_partner_rating
       FROM raw_partner_payouts
       GROUP BY 1
     ),
     prev_month_partners AS (
       SELECT DISTINCT
         DATE_TRUNC('month', payout_week_start::DATE) AS month,
         partner_id
       FROM raw_partner_payouts
     ),
     churn AS (
       SELECT
         p2.month + INTERVAL '1 month' AS month,
         COUNT(DISTINCT p2.partner_id) AS churned_partners
       FROM prev_month_partners p2
       LEFT JOIN prev_month_partners p3
         ON p2.partner_id = p3.partner_id
         AND p3.month = p2.month + INTERVAL '1 month'
       WHERE p3.partner_id IS NULL
       GROUP BY 1
     )
     SELECT
       mp.month,
       mp.active_partners,
       mp.total_gross_earnings,
       mp.total_commission,
       mp.total_incentives,
       mp.total_penalties,
       mp.total_net_payout,
       mp.total_bookings,
       mp.avg_partner_rating,
       ROUND(mp.total_net_payout / NULLIF(mp.active_partners, 0), 2) AS avg_payout_per_partner,
       ROUND(mp.total_bookings * 1.0 / NULLIF(mp.active_partners, 0), 2) AS avg_bookings_per_partner,
       COALESCE(c.churned_partners, 0) AS churned_partners,
       ROUND(COALESCE(c.churned_partners, 0) * 100.0 / NULLIF(mp.active_partners, 0), 2) AS churn_rate_pct
     FROM monthly_payouts mp
     LEFT JOIN churn c ON mp.month = c.month
     ORDER BY mp.month`,

    // Company KPIs
    `CREATE OR REPLACE TABLE weekly_company_kpis AS
     WITH weeks AS (
       SELECT DISTINCT DATE_TRUNC('week', booking_date::DATE) AS week_start
       FROM raw_bookings
     ),
     booking_kpis AS (
       SELECT
         DATE_TRUNC('week', booking_date::DATE) AS week_start,
         SUM(booking_value) AS gmv,
         COUNT(*) AS total_bookings,
         COUNT(CASE WHEN payment_status = 'success' THEN 1 END) AS completed_bookings,
         COUNT(DISTINCT customer_id) AS unique_customers,
         COUNT(CASE WHEN is_first_booking THEN 1 END) AS new_customers,
         AVG(CASE WHEN on_time THEN 1.0 ELSE 0.0 END) * 100 AS on_time_pct,
         AVG(arrival_time_min) AS avg_arrival_min,
         AVG(partner_rating) AS avg_partner_rating
       FROM raw_bookings b
       LEFT JOIN raw_customers c USING (customer_id)
       GROUP BY 1
     ),
     econ_kpis AS (
       SELECT
         DATE_TRUNC('week', booking_date::DATE) AS week_start,
         SUM(commission_earned) AS revenue,
         SUM(contribution_margin) AS contribution_margin_total,
         SUM(partner_payout) AS partner_payout_total
       FROM raw_booking_unit_economics
       WHERE payment_status = 'success'
       GROUP BY 1
     ),
     session_kpis AS (
       SELECT
         DATE_TRUNC('week', session_date::DATE) AS week_start,
         COUNT(DISTINCT customer_id) AS wau,
         COUNT(DISTINCT customer_id) * 1.0 / 7 AS dau_avg
       FROM raw_daily_sessions
       GROUP BY 1
     ),
     partner_kpis AS (
       SELECT
         DATE_TRUNC('week', shift_date::DATE) AS week_start,
         COUNT(DISTINCT partner_id) AS active_partners
       FROM partner_shifts
       WHERE status = 'served'
       GROUP BY 1
     ),
     nps_kpis AS (
       SELECT
         DATE_TRUNC('week', submitted_at::DATE) AS week_start,
         ROUND((COUNT(CASE WHEN survey_type = 'nps' AND score >= 9 THEN 1 END)
           - COUNT(CASE WHEN survey_type = 'nps' AND score <= 6 THEN 1 END))
           * 100.0 / NULLIF(COUNT(CASE WHEN survey_type = 'nps' THEN 1 END), 0), 1) AS nps_score,
         AVG(CASE WHEN survey_type = 'csat' THEN score END) AS csat_avg
       FROM raw_survey_responses
       GROUP BY 1
     ),
     ad_kpis AS (
       SELECT
         DATE_TRUNC('week', date::DATE) AS week_start,
         SUM(spend_inr) AS total_ad_spend
       FROM raw_ad_daily_metrics
       GROUP BY 1
     ),
     comms_kpis AS (
       SELECT
         DATE_TRUNC('week', sent_at::DATE) AS week_start,
         SUM(send_cost_inr) AS total_comms_cost
       FROM raw_comms_sends
       GROUP BY 1
     ),
     referral_kpis AS (
       SELECT
         DATE_TRUNC('week', invited_at::DATE) AS week_start,
         SUM(CASE WHEN reward_status = 'credited' THEN referrer_reward_amount + referee_reward_amount ELSE 0 END) AS total_referral_rewards
       FROM raw_referrals
       GROUP BY 1
     )
     SELECT
       bk.week_start,
       bk.week_start + INTERVAL '6 days' AS week_end,
       bk.gmv,
       COALESCE(ek.revenue, 0) AS revenue,
       ROUND(COALESCE(ek.revenue, 0) / NULLIF(bk.gmv, 0), 4) AS take_rate,
       bk.total_bookings,
       bk.completed_bookings,
       ROUND(bk.completed_bookings * 100.0 / NULLIF(bk.total_bookings, 0), 2) AS completion_rate,
       bk.unique_customers,
       bk.new_customers,
       bk.unique_customers - bk.new_customers AS repeat_customers,
       ROUND((bk.unique_customers - bk.new_customers) * 100.0 / NULLIF(bk.unique_customers, 0), 2) AS repeat_rate,
       COALESCE(sk.dau_avg, 0) AS dau_avg,
       COALESCE(sk.wau, 0) AS wau,
       COALESCE(pk.active_partners, 0) AS active_partners,
       ROUND(bk.avg_partner_rating, 2) AS avg_partner_rating,
       ROUND(bk.on_time_pct, 1) AS on_time_pct,
       ROUND(bk.avg_arrival_min, 1) AS avg_arrival_min,
       COALESCE(nk.nps_score, 0) AS nps_score,
       ROUND(COALESCE(nk.csat_avg, 0), 2) AS csat_avg,
       COALESCE(ak.total_ad_spend, 0) AS total_ad_spend,
       COALESCE(ck.total_comms_cost, 0) AS total_comms_cost,
       COALESCE(rk.total_referral_rewards, 0) AS total_referral_rewards,
       ROUND((COALESCE(ak.total_ad_spend, 0) + COALESCE(ck.total_comms_cost, 0) + COALESCE(rk.total_referral_rewards, 0))
         / NULLIF(bk.new_customers, 0), 2) AS blended_cac,
       COALESCE(ek.contribution_margin_total, 0) AS contribution_margin_total,
       ROUND(COALESCE(ek.contribution_margin_total, 0) / NULLIF(bk.gmv, 0), 4) AS contribution_margin_pct,
       COALESCE(ek.partner_payout_total, 0) AS partner_payout_total,
       COALESCE(ak.total_ad_spend, 0) + COALESCE(ck.total_comms_cost, 0) + COALESCE(rk.total_referral_rewards, 0) AS gross_burn
     FROM booking_kpis bk
     LEFT JOIN econ_kpis ek ON bk.week_start = ek.week_start
     LEFT JOIN session_kpis sk ON bk.week_start = sk.week_start
     LEFT JOIN partner_kpis pk ON bk.week_start = pk.week_start
     LEFT JOIN nps_kpis nk ON bk.week_start = nk.week_start
     LEFT JOIN ad_kpis ak ON bk.week_start = ak.week_start
     LEFT JOIN comms_kpis ck ON bk.week_start = ck.week_start
     LEFT JOIN referral_kpis rk ON bk.week_start = rk.week_start
     ORDER BY bk.week_start`,

    `CREATE OR REPLACE TABLE monthly_company_kpis AS
     WITH monthly_base AS (
       SELECT
         DATE_TRUNC('month', week_start::DATE) AS month,
         SUM(gmv) AS gmv,
         SUM(revenue) AS revenue,
         ROUND(SUM(revenue) / NULLIF(SUM(gmv), 0), 4) AS take_rate,
         SUM(total_bookings) AS total_bookings,
         SUM(completed_bookings) AS completed_bookings,
         SUM(new_customers) AS new_customers,
         SUM(total_ad_spend) AS total_ad_spend,
         SUM(total_comms_cost) AS total_comms_cost,
         SUM(total_referral_rewards) AS total_referral_rewards,
         SUM(contribution_margin_total) AS contribution_margin_total,
         SUM(partner_payout_total) AS partner_payout_total,
         SUM(gross_burn) AS gross_burn,
         AVG(nps_score) AS nps_score,
         AVG(csat_avg) AS csat_avg,
         AVG(on_time_pct) AS on_time_pct,
         AVG(avg_arrival_min) AS avg_arrival_min
       FROM weekly_company_kpis
       GROUP BY 1
     ),
     monthly_unique AS (
       SELECT
         DATE_TRUNC('month', booking_date::DATE) AS month,
         COUNT(DISTINCT customer_id) AS unique_customers
       FROM raw_bookings
       GROUP BY 1
     ),
     monthly_sessions AS (
       SELECT
         DATE_TRUNC('month', session_date::DATE) AS month,
         COUNT(DISTINCT customer_id) AS mau,
         COUNT(DISTINCT customer_id) * 1.0 / 30 AS dau_avg
       FROM raw_daily_sessions
       GROUP BY 1
     ),
     monthly_partners AS (
       SELECT
         DATE_TRUNC('month', shift_date::DATE) AS month,
         COUNT(DISTINCT partner_id) AS active_partners
       FROM partner_shifts
       WHERE status = 'served'
       GROUP BY 1
     ),
     ltv_data AS (
       SELECT
         DATE_TRUNC('month', install_date::DATE) AS month,
         AVG(ltv_30d) AS ltv_30d_avg
       FROM raw_install_attribution
       GROUP BY 1
     ),
     prev_month_cust AS (
       SELECT DISTINCT
         DATE_TRUNC('month', booking_date::DATE) AS month,
         customer_id
       FROM raw_bookings WHERE payment_status = 'success'
     ),
     customer_churn AS (
       SELECT
         p.month + INTERVAL '1 month' AS month,
         COUNT(DISTINCT p.customer_id) AS churned_customers,
         (SELECT COUNT(DISTINCT customer_id) FROM prev_month_cust WHERE month = p.month) AS prev_active
       FROM prev_month_cust p
       LEFT JOIN prev_month_cust n
         ON p.customer_id = n.customer_id AND n.month = p.month + INTERVAL '1 month'
       WHERE n.customer_id IS NULL
       GROUP BY 1, 3
     ),
     prev_month_partners_p AS (
       SELECT DISTINCT
         DATE_TRUNC('month', payout_week_start::DATE) AS month,
         partner_id
       FROM raw_partner_payouts
     ),
     partner_churn AS (
       SELECT
         pmp.month + INTERVAL '1 month' AS month,
         COUNT(DISTINCT pmp.partner_id) AS churned_partners,
         (SELECT COUNT(DISTINCT partner_id) FROM prev_month_partners_p WHERE month = pmp.month) AS prev_active_partners
       FROM prev_month_partners_p pmp
       LEFT JOIN prev_month_partners_p pmp2
         ON pmp.partner_id = pmp2.partner_id
         AND pmp2.month = pmp.month + INTERVAL '1 month'
       WHERE pmp2.partner_id IS NULL
       GROUP BY 1, 3
     ),
     referral_kf AS (
       SELECT
         DATE_TRUNC('month', invited_at::DATE) AS month,
         COUNT(CASE WHEN status = 'converted' THEN 1 END) AS referral_signups,
         COUNT(DISTINCT referrer_customer_id) AS active_referrers
       FROM raw_referrals
       GROUP BY 1
     ),
     activation AS (
       SELECT
         DATE_TRUNC('month', signup_date::DATE) AS month,
         COUNT(*) AS signups
       FROM raw_customers
       GROUP BY 1
     ),
     first_book_days AS (
       SELECT
         DATE_TRUNC('month', install_date::DATE) AS month,
         AVG(days_to_first_booking) AS signup_to_book_days_avg
       FROM raw_install_attribution
       WHERE days_to_first_booking IS NOT NULL
       GROUP BY 1
     )
     SELECT
       mb.month,
       mb.gmv,
       mb.revenue,
       mb.take_rate,
       mb.total_bookings,
       mb.completed_bookings,
       COALESCE(mu.unique_customers, 0) AS unique_customers,
       mb.new_customers,
       COALESCE(mu.unique_customers, 0) - mb.new_customers AS repeat_customers,
       ROUND((COALESCE(mu.unique_customers, 0) - mb.new_customers) * 100.0
         / NULLIF(COALESCE(mu.unique_customers, 0), 0), 2) AS repeat_rate,
       COALESCE(ms.dau_avg, 0) AS dau_avg,
       COALESCE(ms.mau, 0) AS mau,
       COALESCE(mp.active_partners, 0) AS active_partners,
       ROUND(mb.nps_score, 1) AS nps_score,
       ROUND(mb.csat_avg, 2) AS csat_avg,
       ROUND(mb.on_time_pct, 1) AS on_time_pct,
       ROUND(mb.avg_arrival_min, 1) AS avg_arrival_min,
       mb.total_ad_spend,
       mb.total_comms_cost,
       mb.total_referral_rewards,
       ROUND((mb.total_ad_spend + mb.total_comms_cost + mb.total_referral_rewards)
         / NULLIF(mb.new_customers, 0), 2) AS blended_cac,
       mb.contribution_margin_total,
       ROUND(mb.contribution_margin_total / NULLIF(mb.gmv, 0), 4) AS contribution_margin_pct,
       mb.partner_payout_total,
       mb.gross_burn,
       COALESCE(ld.ltv_30d_avg, 0) AS ltv_30d_avg,
       ROUND(COALESCE(ld.ltv_30d_avg, 0) / NULLIF(
         (mb.total_ad_spend + mb.total_comms_cost + mb.total_referral_rewards) / NULLIF(mb.new_customers, 0),
       0), 2) AS ltv_cac_ratio,
       ROUND(COALESCE(pc.churned_partners, 0) * 100.0 / NULLIF(COALESCE(pc.prev_active_partners, 0), 0), 2) AS partner_churn_rate,
       ROUND(COALESCE(cc.churned_customers, 0) * 100.0 / NULLIF(COALESCE(cc.prev_active, 0), 0), 2) AS customer_churn_rate,
       ROUND(COALESCE(rk.referral_signups, 0) * 1.0 / NULLIF(COALESCE(rk.active_referrers, 0), 0), 2) AS referral_k_factor,
       ROUND(mb.new_customers * 100.0 / NULLIF(COALESCE(a.signups, 0), 0), 2) AS activation_rate,
       COALESCE(fbd.signup_to_book_days_avg, 0) AS signup_to_book_days_avg
     FROM monthly_base mb
     LEFT JOIN monthly_unique mu ON mb.month = mu.month
     LEFT JOIN monthly_sessions ms ON mb.month = ms.month
     LEFT JOIN monthly_partners mp ON mb.month = mp.month
     LEFT JOIN ltv_data ld ON mb.month = ld.month
     LEFT JOIN customer_churn cc ON mb.month = cc.month
     LEFT JOIN partner_churn pc ON mb.month = pc.month
     LEFT JOIN referral_kf rk ON mb.month = rk.month
     LEFT JOIN activation a ON mb.month = a.month
     LEFT JOIN first_book_days fbd ON mb.month = fbd.month
     ORDER BY mb.month`,
  ],
};
