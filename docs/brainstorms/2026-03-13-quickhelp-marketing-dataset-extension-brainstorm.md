# Quick Help Dataset Extension: Marketing & Comms

**Date:** 2026-03-13
**Status:** Brainstorm complete

## What We're Building

Extending the Quick Help dataset from ops-only to a **full-company dataset** covering marketing comms (CRM lifecycle + performance marketing). This is the first domain extension — future expansions will add product analytics, growth/acquisition funnels, customer support, and finance/unit economics.

### Scope of This Extension

1. **Regenerate all existing tables** for new date range: **Feb 2025 – Feb 2026** (13 months)
2. **Add CRM/lifecycle tables**: campaigns_v2, journeys, comms_sends
3. **Add performance marketing tables**: ad_campaigns, ad_sets, ad_creatives, ad_daily_metrics, install_attribution
4. **Enrich existing customers.csv** with `acquisition_source` and `ltv_bucket`

### Generation Approach

LLM-assisted: Use Gemini/Claude to design realistic distribution parameters and business rules, then a script materializes the actual CSV rows with seeded RNG for reproducibility.

---

## Why This Approach

- **Clean slate regeneration** — Avoids date-shifting artifacts and guarantees cross-table FK consistency
- **LLM-assisted generation** — Gets realistic Indian hyperlocal service patterns (festival spikes, WhatsApp dominance, INR pricing) without hand-tuning every distribution
- **Campaign + Journey dual model** — Matches real CRM platforms (batch campaigns for promos, always-on journeys for lifecycle triggers)
- **Full ad hierarchy** — Campaign → Ad Set → Creative → Daily Metrics mirrors actual Google/Meta ad account structure
- **Per-user attribution** — Links every customer to their acquisition source, enabling LTV-by-channel analysis

---

## Key Decisions

1. **Date range:** Feb 2025 – Feb 2026 (13 months). All tables regenerated fresh.
2. **CRM channels:** Push, SMS, Email, WhatsApp, In-app
3. **Paid channels:** Google Ads + Meta Ads with full campaign → ad set → creative hierarchy
4. **CRM model:** Both batch campaigns (campaigns_v2) AND automated journeys — reflects real lifecycle marketing
5. **Attribution:** Per-user install_attribution table linking customer_id to acquisition source + ad IDs
6. **Column depth:** Cost tracking, engagement depth (time_to_open, A/B variant, frequency cap), and audience context (segment_at_send, days_since_last_booking, lifetime_bookings) on comms_sends

---

## Complete Table Schemas

### EXISTING TABLES (Regenerated)

#### `bookings.csv` (~300K rows, 13 months)
Same schema as current. One row per service booking.
- booking_id, booking_date, booking_time, customer_id, customer_lat, customer_lng
- service_type (18 types), service_tier (quick/standard/extended/premium), service_duration_min, booking_value
- hub_id, hub_name, area, city
- partner_id, partner_age, partner_rating
- assigned_at, arrived_at, arrival_time_min, expected_arrival_min, on_time
- weather, traffic_density, back_to_back, festival
- payment_method, payment_status, is_first_booking, rescheduled, partner_reassigned
- campaign_id

#### `customers.csv` (~18K customers)
Extended with two new columns:
- customer_id, signup_date, city, preferred_payment, is_active
- **NEW: acquisition_source** (organic/google/meta/referral/whatsapp)
- **NEW: ltv_bucket** (low/medium/high/whale)

#### `partner_shifts.csv` (~250K rows)
Same schema as current.
- shift_id, partner_id, shift_date, hub_id, status, bookings_assigned, bookings_completed, shift_start, shift_hours

---

### NEW: CRM / LIFECYCLE TABLES

#### `campaigns_v2.csv` (~50 campaigns)
Replaces current campaigns.csv with richer metadata.

| Column | Type | Description |
|--------|------|-------------|
| campaign_id | INT | PK |
| campaign_name | VARCHAR | e.g., "Diwali Deep Clean 40% Off" |
| campaign_type | VARCHAR | promo / seasonal / reactivation / referral / festival |
| channels | VARCHAR | push / sms / email / whatsapp / in_app / multi |
| start_date | DATE | |
| end_date | DATE | |
| target_segment | VARCHAR | all / new_7d / dormant_30d / high_value / churned_60d |
| budget_inr | INT | |
| city | VARCHAR | Metropolitan / Urban / Semi-Urban / All |
| discount_pct | INT | nullable |
| offer_type | VARCHAR | discount / cashback / free_visit / referral_bonus / none |

#### `journeys.csv` (~15 journeys)
Automated lifecycle triggers — always-on messaging flows.

| Column | Type | Description |
|--------|------|-------------|
| journey_id | INT | PK |
| journey_name | VARCHAR | "Welcome Series", "Win-back 30d", "Post-booking NPS" |
| trigger_event | VARCHAR | signup / first_booking / dormant_14d / dormant_30d / booking_complete / low_rating / cart_abandon |
| channel | VARCHAR | push / sms / email / whatsapp |
| steps_count | INT | messages in the journey (1-5) |
| step_delay_hours | INT | delay between steps |
| is_active | BOOLEAN | |
| created_date | DATE | |

#### `comms_sends.csv` (~800K rows)
Every CRM message sent. The core lifecycle analytics table.

| Column | Type | Description |
|--------|------|-------------|
| send_id | INT | PK |
| customer_id | INT | FK → customers |
| channel | VARCHAR | push / sms / email / whatsapp / in_app |
| campaign_id | INT | nullable FK → campaigns_v2 |
| journey_id | INT | nullable FK → journeys |
| journey_step | INT | nullable (1-5) |
| template_name | VARCHAR | e.g., "diwali_push_v2" |
| sent_at | TIMESTAMP | |
| delivered | BOOLEAN | |
| opened | BOOLEAN | |
| clicked | BOOLEAN | |
| converted | BOOLEAN | booked within 24h attribution window |
| booking_id | INT | nullable FK → bookings (if converted) |
| send_cost_inr | DOUBLE | per-message cost |
| time_to_open_min | INT | nullable |
| ab_variant | VARCHAR | nullable (A / B / control) |
| frequency_cap_hit | BOOLEAN | |
| coupon_code | VARCHAR | nullable |
| user_segment_at_send | VARCHAR | new / active / dormant / churned |
| days_since_last_booking | INT | at time of send |
| lifetime_bookings_at_send | INT | at time of send |
| predicted_ltv_bucket | VARCHAR | low / medium / high |
| hub_id | INT | FK, for geo-targeting analysis |
| unsubscribed | BOOLEAN | |

---

### NEW: PERFORMANCE MARKETING TABLES

#### `ad_campaigns.csv` (~30 campaigns)

| Column | Type | Description |
|--------|------|-------------|
| ad_campaign_id | INT | PK |
| platform | VARCHAR | google / meta |
| campaign_name | VARCHAR | "Google_Install_Bangalore_Feb25" |
| campaign_objective | VARCHAR | installs / retargeting / brand_awareness |
| city | VARCHAR | |
| start_date | DATE | |
| end_date | DATE | |
| total_budget_inr | INT | |
| daily_budget_inr | INT | |
| bid_strategy | VARCHAR | target_cpa / maximize_conversions / lowest_cost |

#### `ad_sets.csv` (~100 ad sets)

| Column | Type | Description |
|--------|------|-------------|
| ad_set_id | INT | PK |
| ad_campaign_id | INT | FK → ad_campaigns |
| ad_set_name | VARCHAR | "Lookalike_25-35_F_Bangalore" |
| audience_type | VARCHAR | lookalike / interest / retargeting / broad / custom |
| age_min | INT | |
| age_max | INT | |
| gender_target | VARCHAR | all / male / female |
| city | VARCHAR | |
| placement | VARCHAR | feed / stories / reels / search / display |

#### `ad_creatives.csv` (~200 creatives)

| Column | Type | Description |
|--------|------|-------------|
| ad_creative_id | INT | PK |
| ad_set_id | INT | FK → ad_sets |
| creative_name | VARCHAR | "Video_DeepClean_30s_v2" |
| format | VARCHAR | image / video / carousel / story |
| headline | VARCHAR | "Spotless home in 30 min" |
| cta_text | VARCHAR | Book Now / Try Free / Get 50% Off |
| service_featured | VARCHAR | nullable, matches service_type in bookings |
| landing_page | VARCHAR | app_store / deep_link_home / deep_link_service |

#### `ad_daily_metrics.csv` (~15K rows)

| Column | Type | Description |
|--------|------|-------------|
| date | DATE | |
| ad_creative_id | INT | FK → ad_creatives |
| impressions | INT | |
| clicks | INT | |
| spend_inr | DOUBLE | |
| installs | INT | |
| registrations | INT | completed signup |
| first_bookings | INT | attributed first bookings |
| ctr | DOUBLE | |
| cpc_inr | DOUBLE | |
| cpi_inr | DOUBLE | |
| cpfb_inr | DOUBLE | cost per first booking |
| roas | DOUBLE | revenue / spend |

#### `install_attribution.csv` (~18K rows, one per customer)

| Column | Type | Description |
|--------|------|-------------|
| customer_id | INT | FK → customers |
| attributed_platform | VARCHAR | google / meta / organic / referral / whatsapp |
| ad_campaign_id | INT | nullable FK |
| ad_set_id | INT | nullable FK |
| ad_creative_id | INT | nullable FK |
| referrer_customer_id | INT | nullable (if referral) |
| install_date | DATE | |
| signup_date | DATE | |
| first_booking_date | DATE | nullable |
| days_to_first_booking | INT | nullable |
| first_booking_value | DOUBLE | nullable |
| ltv_7d | DOUBLE | |
| ltv_30d | DOUBLE | |
| ltv_90d | DOUBLE | |

---

## Cross-Table Relationships

```
ad_campaigns → ad_sets → ad_creatives → ad_daily_metrics
                                      ↓
                              install_attribution → customer_id → bookings
                                                                    ↑
campaigns_v2 → comms_sends → customer_id ──────────────────────────┘
journeys ────↗              → booking_id (if converted)
                            → hub_id → partner_shifts
```

---

## Distribution Parameters

### CRM Channel Mix

| Channel | % of sends | Delivery | Open | Click | Convert |
|---------|-----------|----------|------|-------|---------|
| Push | 45% | 85% | 12-18% | 3-5% | 1.5-2.5% |
| SMS | 20% | 95% | N/A (assume read) | 2-4% | 1-2% |
| Email | 15% | 92% | 15-22% | 2-4% | 0.8-1.5% |
| WhatsApp | 15% | 97% | 75-85% | 8-12% | 3-5% |
| In-app | 5% | 100% | 60-70% | 10-15% | 5-8% |

### Acquisition Channel Mix

| Source | % of customers | Avg CPI (INR) | Day-7 retention | LTV 30d (INR) |
|--------|---------------|---------------|-----------------|---------------|
| Organic | 35% | 0 | 40% | 800 |
| Google | 25% | 80-120 | 30% | 600 |
| Meta | 20% | 60-100 | 25% | 550 |
| Referral | 15% | 40 (reward) | 50% | 1000 |
| WhatsApp viral | 5% | 10-20 | 45% | 900 |

### Ad Performance

- **Google:** CPC 8-15 INR, CTR 3-5%, higher intent
- **Meta:** CPC 3-8 INR, CTR 0.8-1.5%, volume play, video > image
- **Retargeting:** 2-3x conversion vs prospecting, ~40% of spend
- **Monthly spend:** 15-25 lakh INR/month (~2-3 Cr annual, Series A/B stage)

### Seasonal Patterns

- **Festival spikes (Diwali Oct-Nov, Holi Mar, Navratri):** 2-3x comms volume, higher conversion
- **Summer peak (Apr-Jun):** Deep cleaning demand up, aggressive push
- **Monsoon dip (Jul-Aug):** Bookings -15-20%, reactivation campaigns increase
- **Year-end (Dec-Jan):** Moderate, gift card campaigns

### CRM Campaign Patterns

- **Batch campaigns:** 2-3/week, 50K-200K sends each
- **Journey automations:** 5K-15K sends/day total
- **Welcome series:** 3 steps (Day 0, 2, 7) — highest engagement
- **Win-back:** 2 steps (Day 30, 45) — low open, high value/conversion
- **Post-booking:** 1 step (Day 1) — NPS/rating nudge, 35% response
- **Unsubscribe rate:** ~0.3% per batch, ~0.1% per journey

### Booking Attribution

- **Attribution window:** 24 hours (click → booking)
- **8-10%** of bookings attributable to CRM comm
- **15-20%** of first bookings attributable to paid ads
- **60-70%** of bookings organic (user opens app)

---

## Data Sanity Rules

1. Every `customer_id` in comms_sends exists in customers.csv
2. Every `booking_id` in comms_sends (converted=true) exists in bookings.csv with matching customer_id
3. `install_attribution.customer_id` covers 100% of customers.csv
4. Organic customers have null ad FKs; paid have valid ad FKs
5. `days_since_last_booking` in comms_sends matches actual booking history at `sent_at` time
6. `lifetime_bookings_at_send` is accurate count at that timestamp
7. Ad spend in ad_daily_metrics sums to ~total_budget_inr per campaign
8. `first_bookings` in ad_daily_metrics matches install_attribution records with matching first_booking_date
9. Funnel: delivered <= sent, opened <= delivered, clicked <= opened, converted <= clicked
10. Channel costs realistic: SMS ~0.10-0.20 INR, WhatsApp ~0.40-0.70, push ~0, email ~0.01-0.02

---

## Open Questions

None — all resolved during brainstorm.

---

## Future Extensions (Not in Scope)

These domains will be added in subsequent brainstorms:
- **Product analytics** — sessions, screen views, feature usage, funnels
- **Growth** — signup funnel, onboarding completion, activation metrics
- **Customer support** — tickets, resolution time, CSAT, issue categories
- **Finance / Unit economics** — partner payouts, commissions, per-booking P&L
- **Company KPIs** — blended CAC, gross margin, contribution margin, burn rate
