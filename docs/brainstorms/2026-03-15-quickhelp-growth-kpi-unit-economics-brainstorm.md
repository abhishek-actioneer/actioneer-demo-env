# Quick Help Dataset Extension: Growth, Unit Economics & Company KPIs

**Date:** 2026-03-15
**Status:** Brainstorm complete

## What We're Building

Extending the Quick Help dataset from ops + marketing comms to a **fully holistic company dataset** covering the remaining three domains:

1. **Growth / Acquisition** — Full AARRR funnel: signup milestones, daily sessions, activation tracking, retention cohorts, referral loop
2. **Unit Economics / Finance** — Per-booking P&L waterfall, partner payouts with weekly settlement, commission structures
3. **Company KPIs** — Board-level weekly/monthly snapshots grounded in real underlying data

This is the second extension (after marketing comms). After this, Quick Help will cover all five planned domains: Operations, Marketing Comms, Growth, Finance, and Company KPIs.

### Scope of This Extension

1. **Add growth/funnel tables**: `funnel_events`, `daily_sessions`, `referrals`
2. **Add finance tables**: `booking_unit_economics`, `partner_payouts`
3. **Add KPI/survey tables**: `survey_responses`, `weekly_company_kpis`, `monthly_company_kpis`
4. **Enrich existing `partner_shifts`** with per-shift earnings columns
5. **All KPI snapshots computed from real data** — not fabricated independently

### Generation Approach

Same as marketing extension: seeded PRNG (seed=42) for reproducibility, LLM-assisted distribution design, cross-table FK consistency validated at generation time.

---

## Why This Approach

- **AARRR coverage** — Industry-standard growth framework. Every hyperlocal/on-demand startup (Urban Company, Swiggy, Dunzo) tracks these stages. Milestone events + daily sessions gives both funnel analysis and engagement depth.
- **Per-booking P&L** — Enables real contribution margin analysis at booking level, not just monthly summaries. Urban Company reports ~28% take rate with 16-20% contribution margin — we can model this granularity.
- **Grounded KPIs** — The weekly/monthly KPI snapshot tables are materialized views over real data, not independently generated numbers. This means `weekly_company_kpis.total_gmv` will exactly equal `SUM(bookings.booking_value)` for that week.
- **Partner economics** — Both per-shift earnings (granular) and weekly payouts (what hits their bank). Industry standard is weekly settlement for gig platforms.
- **Survey data** — NPS/CSAT is a core company KPI for home services. 30% response rate is realistic for post-booking surveys.

---

## Key Decisions

1. **Event depth:** Milestones + daily sessions (not raw event stream). Clean and queryable without 5M+ row overhead.
2. **P&L granularity:** Full per-booking waterfall in separate `booking_unit_economics` table (not columns on bookings). Keeps bookings table clean.
3. **KPI grounding:** Snapshot tables computed via SQL from underlying data, ensuring cross-table consistency.
4. **Referral model:** Dedicated `referrals` table with full funnel (invite → signup → first booking → reward). Industry standard for two-sided referral programs.
5. **Partner payouts:** Both per-shift earnings (on partner_shifts) + weekly settlement table. Mirrors real gig platform payment cycles.
6. **Survey responses:** Separate table with NPS/CSAT/post-booking types. ~60K rows at 30% response rate.

---

## Complete Table Schemas

### NEW: GROWTH / ACQUISITION TABLES

#### `funnel_events.csv` (~100K rows)

One row per customer per milestone reached. Tracks the onboarding/activation funnel.

| Column | Type | Description |
|--------|------|-------------|
| event_id | INT | PK |
| customer_id | INT | FK → customers |
| event_type | VARCHAR | signup_complete / profile_done / address_added / payment_added / first_browse / first_booking / second_booking_14d / third_booking_30d / referral_sent |
| event_at | TIMESTAMP | When the milestone was reached |
| days_since_signup | INT | Days from signup to this event |
| session_id | VARCHAR | nullable, session during which event occurred |
| source | VARCHAR | organic / push_notification / email_deeplink / whatsapp_link / ad_click |
| city | VARCHAR | Customer's city at time of event |
| platform | VARCHAR | android / ios / web |

**Distribution Parameters:**
- 100% customers hit `signup_complete`
- 85% hit `profile_done` (within 1-3 days)
- 70% hit `address_added` (within 1-5 days)
- 60% hit `payment_added` (within 2-7 days)
- 50% hit `first_browse` (within 1-10 days)
- ~83% of customers have bookings → `first_booking` milestone
- 55% of first-bookers hit `second_booking_14d`
- 35% of first-bookers hit `third_booking_30d`
- 15% of customers hit `referral_sent`
- Platform split: 65% Android, 30% iOS, 5% web

#### `daily_sessions.csv` (~500K rows)

Daily app engagement per customer. Enables retention cohort analysis, DAU/WAU/MAU, stickiness.

| Column | Type | Description |
|--------|------|-------------|
| customer_id | INT | FK → customers |
| session_date | DATE | |
| session_count | INT | Number of app opens that day |
| screens_viewed | INT | Total screens viewed |
| minutes_active | DOUBLE | Total active time in minutes |
| searched | BOOLEAN | Whether user searched for a service |
| booked | BOOLEAN | Whether user made a booking |
| viewed_offers | BOOLEAN | Whether user viewed promotions/offers |
| platform | VARCHAR | android / ios / web |

**Distribution Parameters:**
- Active customers: 2-4 sessions/month on average
- Booking days: higher screens_viewed (8-15) and minutes_active (5-12)
- Browse-only days: lower engagement (3-6 screens, 2-4 min)
- Seasonal: higher frequency during festival periods, lower during monsoon
- Day-of-week pattern: weekends 1.5x weekday sessions
- Dormant customers: sessions trail off before churn

#### `referrals.csv` (~3K rows)

Full referral loop tracking. One row per referral invite that was accepted (signup).

| Column | Type | Description |
|--------|------|-------------|
| referral_id | INT | PK |
| referrer_customer_id | INT | FK → customers (who sent the invite) |
| referee_customer_id | INT | FK → customers (who signed up) |
| referral_code | VARCHAR | e.g., "QUICK-ABC123" |
| invited_at | TIMESTAMP | When invite was sent |
| signup_at | TIMESTAMP | When referee signed up |
| first_booking_at | TIMESTAMP | nullable, when referee made first booking |
| days_to_signup | INT | Days from invite to signup |
| days_to_first_booking | INT | nullable, days from signup to first booking |
| referrer_reward_amount | DOUBLE | INR reward to referrer (₹100-200) |
| referee_reward_amount | DOUBLE | INR reward/discount to referee (₹150-250) |
| reward_status | VARCHAR | pending / credited / expired |
| referral_channel | VARCHAR | whatsapp / sms / link_copy / email |

**Distribution Parameters:**
- ~15% of 18K customers came via referral (from install_attribution)
- Referral invite → signup conversion: ~40%
- Referee → first booking conversion: ~65% (higher than organic, matches research)
- WhatsApp dominant channel (~60%), followed by link_copy (~25%)
- Two-sided rewards: referrer gets ₹100-200, referee gets ₹150-250 discount
- K-factor: ~0.3 (each customer generates 0.3 new customers via referral on average)
- Reward credited only after referee's first booking

---

### NEW: UNIT ECONOMICS / FINANCE TABLES

#### `booking_unit_economics.csv` (~206K rows, one per booking)

Per-booking P&L waterfall. Joined to bookings by `booking_id`.

| Column | Type | Description |
|--------|------|-------------|
| booking_id | INT | FK → bookings (1:1) |
| gross_booking_value | DOUBLE | Same as booking_value in bookings |
| commission_rate | DOUBLE | Platform take rate (0.25-0.32) |
| commission_earned | DOUBLE | gross_booking_value × commission_rate |
| partner_payout | DOUBLE | gross_booking_value - commission_earned |
| payment_processing_fee | DOUBLE | 1.5-2.5% of gross, varies by payment method |
| gst_collected | DOUBLE | 18% GST on commission (not on full booking) |
| promo_discount_funded | DOUBLE | Platform-funded discount amount (0 if no promo) |
| referral_reward_cost | DOUBLE | Referral reward cost allocated to this booking (0 if not referral) |
| support_cost_allocated | DOUBLE | Estimated support cost per booking (~₹5-15) |
| contribution_margin | DOUBLE | commission_earned - payment_processing_fee - promo_discount_funded - referral_reward_cost - support_cost_allocated |
| contribution_margin_pct | DOUBLE | contribution_margin / gross_booking_value |

**Distribution Parameters:**
- Base commission rate: 28% (Urban Company benchmark)
  - Premium tier: 30-32% (higher margin services)
  - Quick tier: 25-27% (lower margin, volume play)
  - Standard tier: 27-29%
- Payment processing fees:
  - UPI: 0% (zero MDR in India)
  - Card: 1.8-2.0%
  - Wallet: 1.5%
  - Cash: 0% processing but ₹5 handling cost
- Promo discount: only on campaign-linked bookings (~30% of bookings), avg ₹50-150
- Support cost: ₹5-15/booking, higher for rescheduled/reassigned bookings
- Target blended contribution margin: 15-20% (Urban Company FY24: 19.5% of NTV)

#### `partner_payouts.csv` (~26K rows)

Weekly partner settlement. 500 partners × 52 weeks ≈ 26K rows.

| Column | Type | Description |
|--------|------|-------------|
| payout_id | INT | PK |
| partner_id | INT | FK → partner_shifts (via partner_id) |
| payout_week_start | DATE | Monday of the payout week |
| payout_week_end | DATE | Sunday of the payout week |
| gross_earnings | DOUBLE | Sum of all booking payouts for the week |
| commission_deducted | DOUBLE | Platform commission deducted |
| incentive_bonus | DOUBLE | Performance bonus (high ratings, punctuality) |
| penalty_deductions | DOUBLE | Late arrivals, cancellations, quality issues |
| net_payout | DOUBLE | gross_earnings - commission_deducted + incentive_bonus - penalty_deductions |
| bookings_completed | INT | Number of completed bookings in the week |
| avg_rating | DOUBLE | Average customer rating for the week |
| payout_status | VARCHAR | processed / pending / on_hold |
| payout_date | DATE | When money was transferred (usually Wednesday after week end) |

**Distribution Parameters:**
- Weekly earnings: ₹3K-15K depending on bookings completed (3-25/week)
- Incentive bonus: ₹0-500/week, triggered by >4.5 avg rating or >95% on-time
- Penalty deductions: ₹0-200/week, rare (~10% of payouts have any penalty)
- Payout processed within 3 business days of week end
- ~2% of payouts on_hold (ID verification, complaint under review)

---

### NEW: COMPANY KPI / SURVEY TABLES

#### `survey_responses.csv` (~60K rows)

Post-booking NPS and CSAT surveys. ~30% response rate.

| Column | Type | Description |
|--------|------|-------------|
| response_id | INT | PK |
| customer_id | INT | FK → customers |
| booking_id | INT | FK → bookings |
| survey_type | VARCHAR | nps / csat / post_booking |
| score | INT | NPS: 0-10, CSAT: 1-5, post_booking: 1-5 |
| category | VARCHAR | nullable — service_quality / punctuality / value_for_money / partner_behavior / app_experience |
| verbatim_text | VARCHAR | nullable, free-text feedback |
| submitted_at | TIMESTAMP | When survey was submitted |
| time_to_respond_hours | DOUBLE | Hours between booking completion and survey submission |

**Distribution Parameters:**
- Response rate: 30% of successful bookings (~62K × 0.3 per survey type, but not all get all types)
- Survey distribution: 60% post_booking (CSAT), 25% NPS (sent monthly to active users), 15% targeted (after issues)
- NPS score distribution: Promoters (9-10): 45%, Passives (7-8): 30%, Detractors (0-6): 25%. Blended NPS: ~20
- CSAT distribution: mean 4.1/5, correlated with partner_rating on same booking
- Verbatim text: 40% of respondents leave text. Negative scores more likely to have text.
- Time to respond: median 4 hours, 80% within 24 hours
- Category breakdown: service_quality 35%, punctuality 25%, value_for_money 20%, partner_behavior 15%, app_experience 5%

#### `weekly_company_kpis` (materialized view, ~56 rows)

**This is NOT a generated CSV — it's a SQL materialized view computed from real data.** One row per week.

| Column | Type | Source |
|--------|------|--------|
| week_start | DATE | Generated series |
| gmv | DOUBLE | SUM(bookings.booking_value) |
| revenue | DOUBLE | SUM(booking_unit_economics.commission_earned) |
| take_rate | DOUBLE | revenue / gmv |
| total_bookings | INT | COUNT(bookings) |
| completed_bookings | INT | COUNT(bookings WHERE payment_status='success') |
| completion_rate | DOUBLE | completed / total |
| unique_customers | INT | COUNT(DISTINCT bookings.customer_id) |
| new_customers | INT | COUNT(bookings WHERE is_first_booking) |
| repeat_customers | INT | unique_customers - new_customers |
| repeat_rate | DOUBLE | repeat_customers / unique_customers |
| dau_avg | DOUBLE | AVG daily unique users from daily_sessions |
| wau | INT | COUNT(DISTINCT daily_sessions.customer_id) for the week |
| active_partners | INT | COUNT(DISTINCT partner_shifts.partner_id WHERE status='completed') |
| avg_partner_rating | DOUBLE | AVG(bookings.partner_rating) |
| on_time_pct | DOUBLE | AVG(bookings.on_time) × 100 |
| avg_arrival_min | DOUBLE | AVG(bookings.arrival_time_min) |
| nps_score | DOUBLE | Computed from survey_responses WHERE survey_type='nps' |
| csat_avg | DOUBLE | AVG(survey_responses.score WHERE survey_type='csat') |
| total_ad_spend | DOUBLE | SUM(ad_full.spend_inr) |
| total_comms_cost | DOUBLE | SUM(comms_full.send_cost_inr) |
| blended_cac | DOUBLE | (ad_spend + comms_cost + referral_rewards) / new_customers |
| contribution_margin_total | DOUBLE | SUM(booking_unit_economics.contribution_margin) |
| contribution_margin_pct | DOUBLE | contribution_margin_total / gmv |
| gross_burn | DOUBLE | ad_spend + comms_cost + referral_rewards + partner_incentives + support_costs |
| partner_payout_total | DOUBLE | SUM(partner_payouts.net_payout) |

#### `monthly_company_kpis` (materialized view, ~13 rows)

Same structure as weekly but at monthly granularity, plus:

| Column | Type | Source |
|--------|------|--------|
| month | DATE | DATE_TRUNC('month') |
| ltv_30d_avg | DOUBLE | AVG(install_attribution.ltv_30d) for cohort |
| ltv_cac_ratio | DOUBLE | ltv_30d_avg / blended_cac |
| partner_churn_rate | DOUBLE | Partners with 0 shifts this month / active last month |
| customer_churn_rate | DOUBLE | Customers with 0 bookings this month / active last month |
| referral_k_factor | DOUBLE | New referral signups / active referrers |
| activation_rate | DOUBLE | first_booking customers / signups this month |
| signup_to_book_days_avg | DOUBLE | AVG days from signup to first booking |

---

### ENRICHMENTS TO EXISTING TABLES

#### `partner_shifts.csv` — add earnings columns

| New Column | Type | Description |
|------------|------|-------------|
| earnings_gross | DOUBLE | Total earnings from bookings completed in this shift |
| commission_rate | DOUBLE | Commission rate applied (0.25-0.32) |
| incentive_earned | DOUBLE | Bonus earned this shift (punctuality, rating) |
| net_earnings | DOUBLE | earnings_gross × (1 - commission_rate) + incentive_earned |

---

## Cross-Table Relationships

```
EXISTING (ops + marketing):
bookings ← customers, campaigns_v2, partner_shifts
comms_sends → customers, campaigns_v2, journeys, bookings
ad_daily_metrics → ad_creatives → ad_sets → ad_campaigns
install_attribution → customers, ad_campaigns

NEW (growth + finance + KPIs):
funnel_events → customers (event_type milestones align with install_attribution dates)
daily_sessions → customers (booked=true days match bookings.booking_date)
referrals → customers (referrer + referee), install_attribution (attributed_platform='referral')
booking_unit_economics → bookings (1:1, gross_booking_value = booking_value)
partner_payouts → partner_shifts (aggregated by partner_id + week)
survey_responses → bookings, customers

COMPUTED (grounded KPIs):
weekly_company_kpis = f(bookings, booking_unit_economics, daily_sessions, ad_full, comms_full, survey_responses, partner_payouts)
monthly_company_kpis = f(weekly_company_kpis, install_attribution, funnel_events, referrals)
```

---

## Distribution Parameters

### Growth Funnel Benchmarks

| Stage | Conversion from Signup | Days (median) |
|-------|----------------------|---------------|
| Signup complete | 100% | 0 |
| Profile done | 85% | 1 |
| Address added | 70% | 2 |
| Payment added | 60% | 3 |
| First browse | 50% | 2 |
| First booking | 83% | 7 |
| 2nd booking (14d) | 46% of first-bookers | 10 |
| 3rd booking (30d) | 29% of first-bookers | 22 |
| Referral sent | 15% | 30+ |

### Session Engagement

- **DAU:** ~2,500-4,000 (14-22% of MAU)
- **WAU:** ~6,000-9,000
- **MAU:** ~12,000-16,000
- **Stickiness (DAU/MAU):** 18-25%
- **Sessions per active day:** 1.5-2.5
- **Screens per session:** 4-8
- **Minutes per session:** 3-8

### Unit Economics Benchmarks (Urban Company-inspired)

| Metric | Value |
|--------|-------|
| Blended take rate | ~28% |
| Payment processing (blended) | ~0.8% (UPI dominant = 0%) |
| Promo funding (% of GMV) | ~3-5% |
| Support cost/booking | ₹8 avg |
| Contribution margin (% of GMV) | 15-20% |
| Partner weekly earnings (median) | ₹7,500 |
| Incentive bonus (% of payout weeks) | 30% |

### Survey & NPS

- **NPS:** ~20 (promoters 45%, passives 30%, detractors 25%)
- **CSAT:** 4.1/5 avg
- **Response rate:** 30%
- **Verbatim rate:** 40% of respondents

### Company-Level KPIs (expected ranges)

| Metric | Monthly Range |
|--------|--------------|
| GMV | ₹60-80L/month |
| Revenue (commission) | ₹17-22L/month |
| New customers/month | 800-1,500 |
| Blended CAC | ₹250-500 |
| LTV:CAC ratio | 2.5-4.0x |
| Customer churn (monthly) | 8-12% |
| Partner churn (monthly) | 3-5% |
| Gross burn | ₹12-18L/month |

---

## Data Sanity Rules

### New Rules (extending existing 18)

19. Every `funnel_events.customer_id` exists in customers.csv
20. `funnel_events` milestone timestamps are monotonically increasing per customer (signup < profile < address < payment < first_browse < first_booking)
21. `funnel_events.first_booking` event_at matches `install_attribution.first_booking_date` for the same customer
22. `daily_sessions.booked=true` days match dates where the customer has a booking in bookings.csv
23. `daily_sessions` only exist for dates >= customer's signup_date
24. `referrals.referee_customer_id` matches customers where `install_attribution.attributed_platform = 'referral'`
25. `referrals.referrer_customer_id` matches customers who have `referral_sent` in funnel_events
26. `booking_unit_economics.gross_booking_value` = `bookings.booking_value` for same booking_id
27. `booking_unit_economics.contribution_margin` = commission_earned - payment_processing_fee - promo_discount_funded - referral_reward_cost - support_cost_allocated (arithmetic check)
28. `partner_payouts.gross_earnings` = SUM of booking payouts for that partner in that week (from booking_unit_economics)
29. `partner_payouts.bookings_completed` matches COUNT of completed bookings for that partner in that week
30. `survey_responses.booking_id` exists in bookings with payment_status='success'
31. `survey_responses.submitted_at` > booking completion time
32. NPS scores 0-10, CSAT scores 1-5 (range validation)
33. `weekly_company_kpis.gmv` = SUM(bookings.booking_value) for that week (grounding check)
34. `weekly_company_kpis.revenue` = SUM(booking_unit_economics.commission_earned) for that week

---

## Open Questions

None — all resolved during brainstorm.

---

## Future Extensions (Not in Scope)

These domains will be added in subsequent brainstorms:
- **Customer Support** — tickets, resolution time, CSAT, issue categories, escalation paths
- **Product Analytics** — feature flags, A/B test results, funnel experiments (beyond basic sessions)
