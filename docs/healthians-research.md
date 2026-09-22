# Healthians — Dataset Research & Design Brief

> Compiled from live research session, May 2026.
> This document covers competitive context, business model, scraped catalog, schema design, event taxonomy, customer data model, and planted stories for the Healthians synthetic dataset.

---

## Table of Contents

1. [Business Overview](#1-business-overview)
2. [Competitive Landscape](#2-competitive-landscape)
3. [Business Model Deep Dive](#3-business-model-deep-dive)
4. [What Was Scraped](#4-what-was-scraped)
5. [The Four Business Layers](#5-the-four-business-layers)
6. [Full Schema Design](#6-full-schema-design)
7. [Customer Data Model](#7-customer-data-model)
8. [Events Taxonomy](#8-events-taxonomy)
9. [Funnels & Conversion Design](#9-funnels--conversion-design)
10. [City-Level Data](#10-city-level-data)
11. [Campaign Data](#11-campaign-data)
12. [Seasonal Patterns to Plant](#12-seasonal-patterns-to-plant)
13. [Planted Stories](#13-planted-stories)
14. [Realistic Number Benchmarks](#14-realistic-number-benchmarks)
15. [Dataset Scale](#15-dataset-scale)
16. [What Makes This Dataset Unique](#16-what-makes-this-dataset-unique)

---

## 1. Business Overview

**Company:** Healthians  
**Founded:** 2013, Gurugram  
**Founders:** Deepak Sahni, Anuj Mittal, Shruti Gupta  
**Stage:** Series C  
**Funding:** $80.1M (WestBridge, BEENEXT, DG Ventures, Youwecan)

**FY25 Financials (real):**
- Revenue: ₹263 Cr (up 8% YoY from ₹243 Cr in FY24)
- Loss: ₹45 Cr in FY24, narrowed 89% by FY25 (near breakeven)
- Cumulative tests: 10 crore+
- Cities: 350+
- Phlebotomists: 2,000+
- Employees: 1,730

**Positioning:** India's largest home-collection-first diagnostics platform. Fundamentally a logistics + diagnostics company — the model wraps sample collection into a tech-led product experience.

---

## 2. Competitive Landscape

| Company | Model | Revenue (approx) | Price Point | Edge |
|---|---|---|---|---|
| **Dr Lal PathLabs** | Asset-heavy: 298 labs + 6,607 PSCs | ₹2,461 Cr (FY25) | ₹800-1,000 (lipid profile) | Brand trust, doctor referrals, B2B hospital |
| **Metropolis Healthcare** | Asset-heavy, strong West + South | ~₹1,200 Cr | ₹700-900 | Premium, specialist tests |
| **Agilus (ex-SRL)** | Fortis subsidiary, 410+ labs | Private | Mid-range | Fortis hospital integration, AI pathology |
| **Thyrocare** | Ultra-asset-light, franchise + central lab | ~₹600 Cr | ₹50-500 | Lowest cost, franchise density |
| **Healthians** | Home-collection first, tech-led | ₹263 Cr | ₹99–₹2,840 | App/UX, Smart Report, deepest home collection |
| **1mg/PharmEasy** | Super-app diagnostics | Bundled | Discounted | E-pharmacy cross-sell |

**Key insight from The Ken:** Healthians went D2C and ignored doctors (who drive ~70% of Indian diagnostic demand via referrals). Dr Lal built its moat through doctor relationships + collection center density. Healthians bet on disrupting that via direct-to-consumer preventive/wellness — a smaller slice of the market.

**Industry Size:** ~$18.55B (2025), growing at 10.4% CAGR to $37.13B by 2032.

**Revenue per test trend:** Fell from ₹233 to ₹187 between FY21 and FY25 — competition driving down pricing. Volume growth (12% CAGR) offsets per-test decline.

---

## 3. Business Model Deep Dive

### Customer Flow
```
App/web booking → Slot selection (60-min window)
→ Phlebotomist dispatched (GPS-tracked)
→ Home visit 10-15 min (blood/urine collection)
→ Sample couriered to central/regional lab
→ Report in 6-24 hours (27h for complex packages)
→ Smart Report (AI-enriched, historical trends, Health Karma score)
→ Free doctor consultation bundled
```

### Revenue Streams
- D2C bookings (primary)
- Packages/profiles (full body checkups, organ-specific, age/gender-specific)
- Subscriptions (chronic disease monitoring — thyroid, diabetes, vitamins)
- Corporate wellness / B2B (excluded from this dataset)

### Pricing Model
- Near-uniform **~70% discount on MRP** across entire catalog
- MRP is the inflated rack rate (3.3× actual price)
- "UPTO 70% OFF" is always-on — permanent urgency mechanic
- Entry-level teaser: ₹99 (Make India Healthy Package — 7 tests)
- Full body checkup range: ₹549–₹2,840 (discounted)

**SITEMAP DISCOVERY (May 2026):** Sitemap accessible via Playwright/browser navigation at `healthians.com/sitemap.xml`.
Structure: one sitemap index → per-city child sitemaps with 3 types each:
- `/sitemap/{city}/health-packages-sitemap.xml` — ~332 packages per city
- `/sitemap/{city}/health-parameters-sitemap.xml` — 74 individual tests
- `/sitemap/{city}/health-profiles-sitemap.xml` — 67 panel profiles
- **Total confirmed SKUs: 473** (vs 139 we had scraped — we had only 29%)
- 158 cities have sitemaps (vs 215 in city selector — some cities don't have content yet)
- Complete slug lists saved in `docs/healthians-all-package-slugs.txt`, `healthians-all-parameter-slugs.txt`, `healthians-all-profile-slugs.txt`

**CONFIRMED (live scrape, May 2026): Pricing is nationally uniform — no city-tier differential.**
Same price in Delhi, Mumbai, Rohtak (tier2), Surat (tier2). The `tests_catalog.discounted_price_inr` applies to all 215 cities.

**City availability varies:** Some packages return "Not available in your city" on the direct booking URL even though they appear on category/habit pages. Tests are available in proportion to local lab network capability. More specialised packages (smoking screening, advanced fever) have more limited city coverage than basic tests (CBC, thyroid, glucose).

**Multi-person / family bundle pricing:**
- Book 1 test for 1 person: standard price (e.g. ₹1,025)
- Book same test for 2 people in one visit: ~50% per-person discount (₹513/person)
- "Add 1 more → Pay ₹476/person" incentive shown on booking screen
- Applies primarily to full body checkup packages, not individual tests
- ~9% of bookings are 2-person family bundles (parent+child, or couple)
- Schema implication: `bookings.persons_in_booking`, `bookings.price_per_person_inr`, `bookings.is_family_bundle`

### Hub-and-Spoke Operations
- Phlebotomists work from city hubs (zones of pincodes)
- Samples collected home → routed to collection point → central lab
- Key costs: phlebotomist ops, lab processing, logistics, report tech, CAC
- NABL + CAP certified labs

### Smart Report / AI Layer
- Health Karma Score (0-100 lifestyle score)
- Historical trend comparisons (current vs. previous results)
- Risk flags (elevated markers → metabolic syndrome risk)
- Recommendations (dietary, lifestyle, follow-up tests)
- Score improvement over time = key retention driver

---

## 4. What Was Scraped

**Method:** Live browser automation via agent-browser (Chromium) — Healthians blocks all non-browser HTTP clients with 403 (Cloudflare WAF).

**Pages scraped:**
- `/popular-package` — full body packages
- `/popular-test` — individual tests
- `/risk/{slug}/delhi` — 30+ risk category pages
- `/habit/{slug}/delhi` — 12 habit category pages
- `/profile/delhi` — individual test profiles

**Result: 136 clean SKUs across 27 categories** (saved in `docs/healthians-catalog.md`)

### Catalog Summary

| Category | SKUs | Price Range (disc) |
|---|---|---|
| Full Body Checkup Packages | 9 | ₹99 – ₹2,840 |
| Heart & Cholesterol | 9 | ₹143 – ₹2,851 |
| Diabetes & Blood Sugar | 9 | ₹94 – ₹7,060 |
| Liver | 10 | ₹130 – ₹2,423 |
| Pregnancy & Reproductive | 8 | ₹148 – ₹3,110 |
| Fever / Infection | 11 | ₹301 – ₹3,999 |
| Thyroid | 5 | ₹334 – ₹1,168 |
| Cancer Screening | 5 | ₹99 – ₹699 |
| STD / HIV | 5 | ₹379 – ₹5,564 |
| Habits (12 categories) | 22 | ₹136 – ₹2,590 |
| Other (Bone, Arthritis, Allergy, etc.) | 43 | varies |

### Package Structure
Each "package" (e.g. Smoking Effect Screening Package, 65 tests) contains multiple **organ-system panels**:
```
Smoking Effect Screening Package (65 tests total)
├── Liver Function Test     (12 tests: Albumin, Bilirubin, GGTP, ALP, etc.)
├── Complete Blood Count    (25 tests)
├── Lipid Profile           (9 tests)
├── Iron Studies            (4 tests)
└── ... more panels
```

"Tests" = individual measurements. "Parameters" = Healthians' marketing term for same concept. 136 SKUs are the featured/popular subset — actual backend catalog is 500-1,000+ individual tests.

### Metadata Available Per Test (from scraped detail pages)
- Name, category, parameter count, discounted price, MRP, discount %
- Fasting required (Yes/No, hours)
- TAT (turnaround time: 6-27 hours)
- Gender eligibility (Male/Female/Both)
- Age range (typically 5-99 yrs)
- Rating (avg 4.8/5)
- Booking volume signal ("1000+ booked so far")

---

## 5. The Four Business Layers

Healthians is analytically 4 businesses in one — the dataset needs to model all of them (excluding B2B for this build):

```
Layer 1: D2C Consumer        → app/web bookings, browse, cart, payment
Layer 2: Field Ops           → phlebotomist dispatch, arrival, sample collection
Layer 3: Lab & Clinical      → sample QC, processing, report generation, results
Layer 4: Post-Report Engage  → report view, counseling, follow-up booking, retention
```

---

## 6. Full Schema Design

### Core Reference Tables

```
tests_catalog       139 rows  — all SKUs: name, category, parameters, price (national uniform), MRP, fasting, TAT,
                              city_availability (all/metro_only/specific), min_patient_age,
                              family_bundle_eligible (bool)
test_panels         ~800 rows — which sub-tests are inside each package (composition)
phlebotomists       600 rows  — id, city, hub, experience_months, certification, avg_rating
cities              215 rows  — city, state, tier (metro/tier1/tier2), hub_count, active_phlebotomists, lab_present
labs                30 rows   — lab_id, city, type (own/partner), NABL/CAP certified, capacity
```

### Transaction Tables

```
customers           50,000 rows   — see Section 7 for full schema
bookings            300,000 rows  — 2 years, ~400/day growing to 650/day
booking_items       400,000 rows  — tests per booking (some bookings have 2-3 tests)
phlebotomist_assignments  300,000 rows  — 1:1 with bookings
sample_tracking     300,000 rows  — collection → lab → report timeline
reports             300,000 rows  — report delivery, view timestamps
report_results      ~8,000,000 rows  — per-parameter results (300K × avg 27 params)
counseling_sessions 54,000 rows   — ~18% of bookings
follow_up_recommendations  36,000 rows
subscriptions       12,000 rows
subscription_runs   45,000 rows
```

### Customer Supplementary Tables

```
customer_addresses         73,000 rows   — 1.46 addresses per customer avg
customer_family_members    31,000 rows   — 0.62 per customer
customer_prescriptions     21,000 rows   — 21% of customers have prescription history
customer_appointments      54,000 rows   — post-report doctor consultations
customer_biomarker_history 380,000 rows  — longitudinal marker tracking
customer_health_timeline   420,000 rows  — ~8.4 events per customer
```

### Events & CRM

```
user_events         2,000,000 rows  — Mixpanel-style behavioral log
comms_log           1,500,000 rows  — push/SMS/WhatsApp/email
nps_responses       90,000 rows     — ~30% of bookings
phlebotomist_ratings 180,000 rows   — ~60% of bookings
referrals           8,500 rows
```

### Marketing

```
ad_campaigns        80 rows
ad_sets             300 rows
ad_creatives        600 rows
ad_daily_metrics    ~18,000 rows   — 600 creatives × 30 active days avg
install_attribution 50,000 rows    — 1:1 with customers
```

### Pre-Materialised Summary Tables

```
daily_company_kpis       730 rows   — 2 years daily
city_monthly_kpis        5,160 rows — 215 cities × 24 months
hub_daily_kpis           ~150,000 rows — ~700 hubs × 24 months
test_popularity          ~78,000 rows — 136 tests × 215 cities × months (active city-test combinations)
funnel_conversion_daily  730 rows
retention_cohorts        576 rows   — 24 cohorts × 24 months
campaign_performance     ~3,000 rows
phlebotomist_performance ~14,000 rows — 600 × 24 months
```

**Total: ~13M rows across 35 tables.**

---

### Key Table Schemas

#### `bookings` (denormalized, one row per booking)
```
booking_id, customer_id, booking_date, booking_time
slot_date, slot_band (6-8am/8-10am/10am-12pm/12-2pm/2-4pm/4-6pm)
city, pincode, hub_id, address_type (home/office/other)
tests_count, booking_value_inr, mrp_value_inr, discount_pct
coupon_code, coupon_type (first_booking/seasonal/referral/corporate)
payment_method (upi/card/netbanking/wallet/cash)
payment_status (success/failed/refunded)
booking_source (app_android/app_ios/web/phone/whatsapp)
phlebotomist_id, assigned_at, arrived_at, on_time, delay_min
collection_duration_min, sample_rejected (bool), rejection_reason
lab_id, sample_received_at, tat_hours, report_released_at
report_viewed (bool), time_to_view_hours
counseling_taken (bool), follow_up_booked (bool)
cancellation_reason, reschedule_count
is_first_booking (bool), is_corporate (bool)
is_prescription_driven (bool), is_subscription_run (bool)
persons_in_booking (1/2/3), price_per_person_inr, is_family_bundle (bool)
patient_age, patient_gender, patient_relationship (self/child/spouse/parent/sibling)
patient_is_minor (bool — patient_age < 18)
```

#### `sample_tracking` (the operational pipeline)
```
sample_id, booking_id, customer_id
collection_timestamp, collection_hub_id
transit_mode (phlebotomist_batch/courier/cold_chain)
lab_received_timestamp, transit_hours
qc_status (accepted/rejected), rejection_reason
rejection_reason: hemolysis/insufficient_volume/wrong_tube/
                  damaged_container/labelling_error/temperature_breach
processing_started_at, processing_instrument (Roche/Siemens/Beckman/Manual)
pathologist_review_required (bool), pathologist_review_at
report_generated_at, qc_passed_at, report_released_at
tat_hours (booking → report), tat_sla_met (bool)
```

#### `report_results` (per-parameter clinical outcomes)
```
result_id, booking_id, customer_id, report_date
panel_name (Liver Function/CBC/Lipid Profile/etc.)
parameter_name (Albumin/WBC/Total Cholesterol/etc.)
value (numeric), unit (g/dL / mIU/L / mg/dL / etc.)
reference_range_low, reference_range_high
status (normal/low/high/critical)
is_critical (bool) — requires immediate callback
change_from_previous (improved/worsened/stable/first_reading)
delta_from_previous (numeric)
previous_booking_id
```

#### `customer_prescriptions`
```
prescription_id, customer_id
prescribed_date, days_since_prescription
prescribing_specialty (GP/endocrinologist/cardiologist/gynecologist/dermatologist)
prescription_source (healthians_doctor/external_uploaded/verbal_advice)
tests_prescribed[] — array of test names (raw, as written on prescription)
healthians_skus_matched[] — FK to tests_catalog (fuzzy-matched)
booking_id — NULL if not yet fulfilled
fulfillment_pct — 0/33/67/100 (% of prescribed tests booked)
unfulfilled_reason (not_booked_yet/booked_elsewhere/waiting/forgot)
urgency (routine/within_1_week/urgent/stat)
follow_through_within_30d (bool)
```

#### `customer_appointments` (post-report consultations)
```
appointment_id, customer_id, booking_id
days_after_report
doctor_specialty (GP/endocrinologist/cardiologist/gynecologist)
booking_trigger (post_report_abnormal/routine_follow_up/pre_test_consult/symptom)
outcome (prescription_given/lifestyle_advice/further_tests_recommended/
         specialist_referral/normal_dismissed)
tests_prescribed_count
session_type (teleconsultation/in_person_referral)
duration_min, satisfaction_score (1-5)
converted_to_rebooking (bool), rebooking_days_lag
```

#### `customer_health_timeline`
```
event_id, customer_id, event_date
event_type:
  booking_completed | report_abnormal_found | critical_value_alerted
  counseling_completed | prescription_received | subscription_started
  subscription_skipped | follow_up_booked | improvement_milestone
  lapse_started | reactivation | nps_submitted | referral_sent
event_value — e.g. HbA1c value, test_name, booking_id
event_context — JSON
```

---

## 7. Customer Data Model

**50,000 customers. 65+ columns. Five data layers.**

### Layer 1 — Demographics

| Field | Values | Distribution |
|---|---|---|
| `age` | 18-75 | Median 38. 35-44: 31%, 25-34: 26%, 45-54: 23%, 55-64: 10%, 18-24: 7%, 65+: 3% |
| `gender` | male/female/other | 54% male (accounts), but women drive 58% of bookings |
| `city` | 50 cities | Delhi/NCR 22%, Mumbai 14%, Bangalore 11%, Hyderabad 7%, Chennai 6% |
| `city_tier` | metro/tier1/tier2 | Metro 38%, Tier 1 29%, Tier 2 33% — 215 cities across 23 states |
| `state` | 20 states | MH, Delhi, KA, UP, TN top 5 |
| `occupation` | salaried_private/salaried_govt/self_employed/homemaker/student/retired | Salaried private 44%, self-employed 22%, homemaker 18% |
| `annual_income_bracket` | <3L/3-6L/6-12L/12-25L/25L+ | Median: 6-12L |
| `marital_status` | single/married/other | 67% married in 30+ cohort |
| `education` | graduate/postgraduate/other | 71% graduate+ |

### Layer 2 — Acquisition (Deep Attribution)

| Field | Values | Distribution |
|---|---|---|
| `acquisition_channel` | organic_search/google_ads/meta_ads/referral_friend/whatsapp_share/doctor_referral/content_blog/youtube | Organic 32%, Google 26%, Meta 18%, Referral 14%, WhatsApp 6%, Doctor 3%, Other 1% |
| `install_platform` | android/ios/web | Android 63%, iOS 22%, Web 15% |
| `device_model_tier` | budget/mid/flagship | Budget 38%, Mid 44%, Flagship 18% |
| `first_landing_test_category` | Heart/Thyroid/Full Body/Diabetes/Fever/etc. | The "door" they came through — highly predictive of LTV |
| `days_to_first_booking` | 0/1-3/4-7/8-30/30+/never | Same-day 28%, 1-3d 19%, 4-7d 14%, 8-30d 22%, 30d+ 11%, Never 6% |
| `referrer_customer_id` | customer_id or NULL | |
| `coupon_used_at_signup` | bool | 34% of new users |
| `utm_source, utm_medium, utm_campaign` | standard UTM | |

### Layer 3 — Health Profile (Self-Reported)

| Field | Values | Distribution |
|---|---|---|
| `health_goal` | preventive_wellness/chronic_monitoring/doctor_prescribed/pre_employment/fitness | Preventive 38%, Chronic 24%, Doctor prescribed 21%, Pre-employment 10%, Fitness 7% |
| `primary_health_concern` | diabetes_risk/heart_risk/thyroid/fatigue/fertility/weight/general | General 31%, Thyroid 16%, Diabetes 14%, Fatigue 12%, Heart 11%, Fertility 8%, Weight 8% |
| `chronic_condition` | none/diabetes/thyroid/hypertension/heart_disease/pcos/anemia/multiple | None 47%, Diabetes 19%, Hypertension 17%, Thyroid 13%, PCOS (female) 21%, Multiple 6% |
| `family_history` | diabetes/heart/cancer/thyroid (multi-select array) | Diabetes 44%, Heart 28%, Thyroid 18%, Cancer 12% |
| `smoking_status` | non_smoker/ex_smoker/current_smoker | Non 71%, Ex 14%, Current 15% |
| `alcohol_consumption` | none/occasional/regular | None 54%, Occasional 33%, Regular 13% |
| `exercise_frequency` | sedentary/light/moderate/active | Sedentary 31%, Light 28%, Moderate 27%, Active 14% |
| `bmi_category` | underweight/normal/overweight/obese | Normal 34%, Overweight 38%, Obese 19%, Underweight 9% |
| `on_regular_medication` | bool | 31% (thyroid/diabetes/BP medications) |
| `last_doctor_visit_timeframe` | within_3m/3-12m/1-3y/3y_plus/never | within_3m: 22%, 3-12m: 31%, 1-3y: 28%, 3y+: 14%, Never: 5% |
| `insurance_provider` | Star Health/HDFC Ergo/Bajaj Allianz/New India/None/Other | None 59%, Star 12%, HDFC 8%, rest |
| `insurance_linked_to_healthians` | bool | Only 18% of insured customers link it |
| `family_members_added` | 0-5 | 0: 48%, 1: 28%, 2: 17%, 3+: 7% |
| `books_primarily_for` | self/spouse/parent/child/mixed | Self 63%, Mixed 21%, Parent 10%, Spouse 5%, Child 1% |

### Layer 4 — Behavioral History (Precomputed)

**Booking behavior:**
| Field | Description | Realistic Range |
|---|---|---|
| `total_bookings` | Lifetime count | Median 3. Distribution: Never 6%, 1: 31%, 2-3: 27%, 4-6: 18%, 7-12: 9%, 12+: 3% (subscribers) |
| `total_spend_inr` | Lifetime GMV | ₹0–₹40,000 |
| `avg_order_value_inr` | Mean per booking | ₹400–₹2,800, blended median ₹850 |
| `aov_trend` | increasing/stable/decreasing | Increasing 22%, Stable 51%, Decreasing 27% |
| `days_since_last_booking` | Recency | <30d: 18%, 30-90d: 24%, 90-180d: 21%, 180d+: 37% |
| `booking_frequency_days` | Avg days between bookings | Median 94 (quarterly) |
| `most_booked_category` | Dominant category | Thyroid 21%, Full Body 19%, Diabetes 16% |
| `preferred_slot_band` | Time preference | 6-8am: 38%, 8-10am: 29%, 10am-12pm: 18%, afternoon: 15% |
| `preferred_payment_method` | UPI/card/etc. | UPI 61%, Card 22%, Netbanking 8%, Wallet 7%, Cash 2% |
| `cancellation_rate_pct` | % bookings cancelled | Median 4.2% |
| `reschedule_rate_pct` | % rescheduled | Median 8.7% |
| `package_preference` | individual/organ_package/full_body | Individual 31%, Package 42%, Mixed 27% |
| `coupon_usage_rate_pct` | % bookings with coupon | Median 28%; coupon-hunter >80% |

**Engagement behavior:**
| Field | Distribution |
|---|---|
| `report_view_rate_pct` | Median 74%. Highly engaged: >90%. Passive: <40% |
| `report_view_speed_hours` | Median 3.2h from notification. Power users: <30 min |
| `health_karma_engagement` | Always 34%, Sometimes 41%, Never 25% |
| `counseling_uptake_pct` | Median 14%. High-engagers: >50% |
| `follow_up_booking_rate_pct` | 31% of counseled sessions → booking |
| `subscription_active` | 11% of customers |
| `subscription_tenure_months` | Median 8.3 months |
| `app_sessions_last_30d` | Median 2.3 |
| `referrals_sent` | 0: 74%, 1: 17%, 2-3: 7%, 4+: 2% |
| `nps_score` | Median 7.8 |
| `nps_category` | Promoter 48%, Passive 34%, Detractor 18% |

**Lifecycle stage** (derived):
- `new` — 0-1 bookings, registered <30 days
- `activated` — 1+ bookings, regular app use
- `engaged` — 3+ bookings, report view rate >60%
- `loyal` — 6+ bookings or active subscription
- `at_risk` — was engaged, no booking in 60-90 days
- `churned` — no activity in 180+ days
- `reactivated` — churned → booked again

### Layer 5 — Clinical Summary (Derived from Report Results)

All grounded in published Indian epidemiology:

| Field | Distribution |
|---|---|
| `vitamin_d_status` | Deficient (<20 ng/mL): 43%, Insufficient (20-29): 30%, Sufficient: 27% of tested. 73% overall have some deficiency. |
| `vitamin_b12_status` | Deficient (<200 pg/mL): 31%, Borderline: 27%, Normal: 42% of tested |
| `thyroid_status` | Hypothyroid: 14%, Hyperthyroid: 4%, Subclinical: 9%, Normal: 73% of tested |
| `glucose_status` | Diabetic (HbA1c >6.5%): 12%, Prediabetic (5.7-6.4%): 19%, Normal: 69% of HbA1c-tested |
| `cholesterol_status` | High (>240): 18%, Borderline (200-239): 26%, Normal: 56% of tested |
| `hemoglobin_status` | Anemic: 22% overall (34% women, 12% men) |
| `lifetime_abnormal_flags_count` | 0: 22%, 1-2: 31%, 3-5: 28%, 6+: 19% |
| `ever_had_critical_value` | 3.4% of customers (HbA1c >9, TSH <0.1, Hb <7) |
| `improvement_trajectory` | improving/stable/worsening/first_test (repeat customers only) |
| `first_booking_had_abnormal` | **THE single best retention predictor** (see Section 13) |

---

## 8. Events Taxonomy

### Acquisition Events
```
app_installed          source, campaign_id, creative_id, platform
app_opened             session_id, platform, app_version
web_visit              landing_page, utm_source/medium/campaign
promo_code_entered     code, discount_amount, valid (bool)
```

### Browse & Discovery Events
```
search_performed       query, results_count, selected_result_position
category_browsed       category, source (nav/home/search/recommendation)
test_page_viewed       test_id, test_name, dwell_sec, source
package_page_viewed    package_id, source
smart_report_sample_viewed  —
symptom_checker_used   symptoms[], recommended_tests[]
compare_packages       package_ids[]
```

### Booking Funnel Events
```
test_added_to_cart     test_id, price, mrp, is_package, source
cart_viewed            cart_value, item_count
coupon_applied         code, discount_amount, valid
cart_abandoned         step (address/slot/payment), time_in_cart_min, cart_value
address_entered        city, pincode, is_new_address
slot_selected          date, time_band, city, days_ahead
slot_unavailable_shown preferred_slot, next_available_slot, abandoned (bool)
payment_initiated      amount, method
payment_failed         reason (bank_decline/timeout/insufficient_balance)
booking_confirmed      booking_id, amount, test_count
booking_cancelled      reason, hours_before_slot
booking_rescheduled    old_slot, new_slot, reason, hours_before_original
```

### Pre-Collection Events
```
phlebotomist_assigned     phlebotomist_id, eta_minutes, distance_km
phlebotomist_en_route     eta_minutes
phlebotomist_arrived      arrival_time, on_time (bool), delay_min
sample_collected          collection_duration_min, tubes_count
sample_rejected           reason, recollection_scheduled (bool)
recollection_scheduled    new_slot
```

### Lab Processing Events
```
sample_received_at_lab    lab_id, transit_hours
sample_qc_passed          —
sample_qc_failed          rejection_reason
processing_started        instrument_type
pathologist_review_started  —
report_generated          tat_hours, parameters_count, abnormal_count
report_qc_passed          —
report_released           —
```

### Report & Post-Test Events
```
report_notification_sent      channel (push/sms/whatsapp/email), delivery_status
report_viewed                 platform, time_to_view_hours, abnormal_count
health_karma_score_viewed     score, change_from_last
report_downloaded             —
report_shared                 shared_with (doctor/family), channel
abnormal_flag_clicked         parameter_name, value, reference_range, severity
critical_value_callback_made  parameter_name, value
counseling_session_started    counselor_type (ai/human)
counseling_session_completed  duration_min, satisfaction_score
follow_up_test_recommended    test_id, urgency, recommended_by
follow_up_test_booked         days_after_counseling
improvement_milestone_seen    parameter_name, previous_status, current_status
```

### Retention & CRM Events
```
reminder_sent            channel, reminder_type
                         (annual_checkup/repeat_thyroid/vitamin_retest/
                          hba1c_due/dengue_season/tax_deduction_season)
reminder_opened          —
reminder_clicked         —
subscription_viewed      test_type, frequency
subscription_activated   test_id, frequency, amount
subscription_skipped     reason
subscription_cancelled   reason, tenure_months
referral_sent            channel (whatsapp/sms/link_copy)
referral_converted       referee_booking_id
nps_survey_shown         —
nps_score_submitted      score (0-10), feedback_text
```

---

## 9. Funnels & Conversion Design

### Funnel 1: D2C Booking Funnel (most watched)

```
app_opened / web_visit          100%
→ test_page_viewed               70%   (30% bounce immediately)
→ test_added_to_cart             30%   of visitors (21% of app opens)
→ address_confirmed              60%   of carts
→ slot_selected                  55%   ← BIGGEST DROP-OFF: slot unavailability
→ payment_initiated              87%
→ booking_confirmed              92%   (payment failure is low — UPI is reliable)

Net: ~13-18% app open → confirmed booking
Cart abandonment at slot: 43% — #1 leakage point
```

### Funnel 2: New User Activation
```
app_installed           100%
→ profile_completed      78%
→ address_entered        51%
→ test_page_viewed       44%
→ first_booking          22%
→ second_booking (30d)   31% of first-bookers
→ third_booking (60d)    48% of second-bookers
```

### Funnel 3: Report-to-Consultation
```
report_released              100%
→ notification_delivered      94%   (WhatsApp highest)
→ report_viewed               75%   (within 24h)
→ health_karma_viewed         54%   of openers
→ abnormal_flag_clicked       40%   of those with ≥1 abnormal
→ counseling_started          18%   of all bookings
→ doctor_consultation_booked   6%   of all bookings
```

### Funnel 4: Chronic Repeat Funnel
```
report_viewed (abnormal result)     100%
→ follow_up_recommended             68%   (by counselor/system)
→ reminder_sent (30/60/90d)         85%   of recommended
→ reminder_opened                   22%   open rate
→ repeat_booking_confirmed           8%   of reminded = 29% of openers
```

### Funnel 5: Referral Funnel
```
booking_confirmed               100%
→ referral_share_screen_shown   100%   (shown to all)
→ referral_sent                  12%   (WhatsApp 55%, SMS 25%, link 20%)
→ referee_installed              35%   of sent
→ referee_first_booking          25%   of installed
K-factor ≈ 0.03-0.05
```

### The Stickiness Ladder (key planted insight)

```
First result all-normal           →  71% churn within 90 days
First result: 1 abnormal          →  42% churn within 90 days
First result: 2+ abnormals        →  28% churn within 90 days
Took post-report counseling       →  19% churn within 90 days
Booked follow-up within 30 days   →  11% churn within 90 days
Activated subscription            →   4% churn within 12 months
Hit improvement milestone         →   2% churn within 12 months
```

---

## 10. City-Level Data

### Complete City Coverage: 215 Cities

Source: Healthians' live city selector (scraped May 2026). Full reference: `docs/healthians-cities.csv`

**Summary:**
- **9 Metro cities** — Bengaluru, Chennai, Delhi, Gurgaon, Hyderabad, Kolkata, Mumbai, Noida, Pune
- **47 Tier 1 cities** — major commercial centres, pop 500K+
- **159 Tier 2 cities** — smaller cities, price-sensitive, individual-test dominant
- **23 states/UTs** covered

**State concentration (cities per state):**

| State | Cities | Tier |
|---|---|---|
| Uttar Pradesh | 62 | Mostly tier2 — UP belt dominates volume |
| Maharashtra | 21 | Mix of tier1 + tier2 |
| Haryana | 20 | NCR satellite cities |
| Rajasthan | 16 | Spread across the state |
| Punjab | 14 | Dense coverage |
| Madhya Pradesh | 13 | |
| Bihar | 13 | High-growth market |
| Gujarat | 9 | |
| Jharkhand | 8 | |
| Uttarakhand | 8 | |

**Metro cities (9):**
Bengaluru, Chennai, Delhi, Gurgaon, Hyderabad, Kolkata, Mumbai, Noida, Pune

**Tier 1 cities (47, sample):**
Agra, Ahmedabad, Allahabad, Amritsar, Bhopal, Bhubaneswar, Chandigarh, Dehradun Vikasnagar, Faridabad, Ghaziabad, Greater Noida, Guntur, Guwahati, Gwalior, Haridwar Rishikesh, Howrah, Indore, Jabalpur, Jaipur, Jalandhar, Jamshedpur, Jodhpur, Kakinada, Kanpur, Karimnagar, Kolhapur, Kota, Lucknow, Ludhiana, Meerut, Mohali, Mysuru, Nagpur, Nashik, Patna, Panchkula, Raipur, Rajkot, Ranchi, Surat, Udaipur, Vadodara, Varanasi, Vijayawada, Visakhapatnam, Warangal + more

**Tier 2 cities (159):** Full list in `docs/healthians-cities.csv`

### Hub Structure
Each city has 2-8 hubs (zones). Hub = cluster of pincodes served by a phlebotomist pool.

### City-Level Summary Tables

**`city_monthly_kpis`** (~5,160 rows — 215 cities × 24 months):
```
city_id, city, state, city_tier, month
total_bookings, gmv_inr, avg_order_value_inr
completed_bookings, cancellation_rate_pct
unique_customers, new_customers, repeat_customers, repeat_rate_pct
on_time_arrival_pct, avg_arrival_delay_min
sample_rejection_rate_pct, avg_tat_hours
report_view_rate_pct, counseling_uptake_pct
nps_score, avg_phlebotomist_rating
active_phlebotomists, bookings_per_phlebotomist
most_booked_test_category
```

**`hub_daily_kpis`** (~50,000 rows):
```
hub_id, city_id, date
bookings_assigned, bookings_completed, bookings_cancelled
capacity_utilization_pct, on_time_pct
avg_arrival_min, sample_rejections
phlebotomists_active
```

### City-Specific Patterns to Plant

| City / Region | Pattern |
|---|---|
| North India (Delhi/UP) | Vitamin D deficiency 82% vs 61% south — less sunlight |
| Mumbai | 2× full-body checkup rate vs Delhi — preventive culture |
| Delhi | 2× individual test rate vs Mumbai — reactive/symptom-driven |
| Bangalore | 55% of bookings corporate-linked (tech workforce) |
| Chennai | Highest TSH test rate per capita (thyroid awareness + iodine deficiency) |
| Tier 2 cities | 78% single tests vs 42% in metro; highly price-sensitive |
| Delhi NCR | Highest coupon redemption rate — most competitive market |

---

## 11. Campaign Data

### Performance Marketing

**Structure:** `ad_campaigns` → `ad_sets` → `ad_creatives` → `ad_daily_metrics`

**Platforms:** Google Search (high-intent: "blood test near me"), Meta (awareness/retargeting), YouTube

**Campaign Types:**
- Acquisition: first-booking discount, new user free consultation
- Seasonal: tax deduction (Jan-Mar), Dengue season (Jul-Sep), Diwali sugar (Nov)
- Product: new package launch, government panel tests
- Retargeting: abandoned cart, test page viewed but not booked

**`ad_campaigns`** (80 rows):
```
campaign_id, campaign_name, platform (google/meta/youtube)
campaign_type (acquisition/seasonal/retargeting/product/brand)
objective (installs/bookings/awareness)
start_date, end_date, budget_inr
target_audience (new_users/lapsed_30d/cart_abandoners/lookalike_bookers)
city_targeting (all_india/metro_only/tier1_plus/specific_cities[])
test_category_focus (Full Body/Thyroid/Diabetes/etc. or All)
```

**`ad_daily_metrics`** (~18,000 rows):
```
date, ad_creative_id, platform, campaign_id
impressions, clicks, installs, first_bookings, repeat_bookings
spend_inr, ctr_pct, cpi_inr, cpb_inr (cost per booking), roas
avg_booking_value_inr, ltv_7d, ltv_30d
```

### CRM / Lifecycle Campaigns

**`comms_log`** (1.5M rows):
```
send_id, customer_id, channel (push/sms/whatsapp/email/in_app)
campaign_id or journey_id
campaign_type: acquisition/reactivation/reminder/seasonal/
               report_followup/counseling_nudge/subscription_renewal
sent_at, delivered (bool), opened (bool), clicked (bool), converted (bool)
booking_id (if converted), send_cost_inr
user_segment_at_send (new/active/at_risk/churned)
days_since_last_booking
ab_variant (A/B/NULL)
```

**WhatsApp vs Push reality:**
- WhatsApp report delivery: 94% open rate
- Push notification: 71% open rate
- SMS: 82% delivery, 31% open (assumed read)
- Email: 24% open rate, 6% click

**Key campaign triggers:**
- Annual checkup reminder (365 days after last full-body)
- TSH retest reminder (180 days after thyroid test)
- HbA1c retest reminder (90 days for diabetics, 180 for pre-diabetics)
- Vitamin D retest (90 days after starting supplements)
- Dengue season alert (Jul 1 in Delhi/Mumbai/Bangalore)
- Tax deduction nudge (Feb 15, Mar 1, Mar 15 — 80D reminders)
- Post-Diwali sugar check (Nov 1-10)
- Reactivation (60 days of inactivity)

---

## 12. Seasonal Patterns to Plant

| Period | Event | Test Spike |
|---|---|---|
| Jan-Mar | Section 80D tax deduction awareness (preventive health is deductible) | Full body checkup +67%, peaks Feb-Mar |
| March 8 | Women's Day campaigns | Women-specific packages, PCOS, thyroid +40% |
| Apr-May | Summer — heat, hydration | Vitamin D paradox, dehydration markers, general checkup |
| Jun-Jul | Monsoon onset | Dengue, Malaria, Typhoid +120% in Jul-Aug vs Apr baseline |
| Sep-Oct | Post-monsoon | Jaundice, Hepatitis spike; Dengue second wave |
| Oct 29 | World Heart Day | Lipid profile, cardiac packages +35% |
| Nov | Diwali aftermath (typically Oct-Nov) | Blood glucose, HbA1c +30% (post-festival eating guilt) |
| Nov | Diabetes Awareness Month | HbA1c, random glucose +25% |
| Dec-Jan | Winter north India | Vitamin D deficiency spike (low sunlight) |
| Year-round | Quarterly chronic cycle | Thyroid/diabetes patients drive steady baseline |

---

## 13. Planted Stories

These are analytically interesting patterns built into the synthetic data.

### Clinical Insights
1. **Vitamin D epidemic:** 73% of tested customers have Vitamin D deficiency — most common abnormal finding. Planted: spike in Dec-Jan in north India cities, high follow-up booking rate.

2. **Thyroid is the stickiest test:** 87% annual rebooking rate for TSH patients — highest of any test category. Thyroid subscription churn: 8%/year (lowest). Planted: clear cohort retention advantage.

3. **Abnormal result retention:** Customers with ≥1 abnormal on first booking have 3.1× higher 90-day rebooking rate. All-normal first-timers churn at 71%. Planted: stark split in cohort curves.

4. **Improvement milestone loyalty:** Customers who see a marker go from abnormal to normal (e.g. Vitamin D normalized after 3 cycles) have 89% 12-month retention. Planted: high engagement cluster.

5. **HbA1c post-Diwali spike:** 34% more HbA1c tests in December — patients checking after festival eating.

6. **Pre-diabetic discovery:** 19% of customers who test HbA1c are pre-diabetic (5.7-6.4%) — they had no prior diagnosis. 68% of these rebook within 90 days.

### Operational Insights
7. **Morning slot dominance:** 6-8am slots have 3.2× higher on-time arrival rate vs. afternoon. Morning bookings have 8% lower cancellation rate.

8. **Slot unavailability abandonment:** When preferred morning slot is unavailable, 43% of customers abandon rather than take afternoon. This is the #1 conversion loss point.

9. **Monsoon rejection spike:** July 2024 — sample rejection rate spiked to 4.2% (vs. 1.8% baseline) due to heat/transit integrity issues. Planted: visible spike in `sample_tracking`.

10. **Phlebotomist rating impact:** Phlebotomists rated >4.5 stars generate 28% more repeat bookings from the same customers (customers request their preferred phlebotomist).

### Marketing Insights
11. **WhatsApp report delivery outperforms push:** 94% open rate vs. 71%. Customers who receive reports on WhatsApp rebook at 1.4× rate.

12. **Organic search LTV:** Organic search customers have 2.6× higher 12-month retention vs. Meta Ads customers. Doctor-referred customers have highest LTV but are only 3% of base.

13. **Coupon-hunter churn:** Customers who used a coupon at first booking churn at 1.4× rate vs. full-price customers.

14. **Tax season full-body surge:** Full-body checkup bookings increase 67% in February-March as customers claim Section 80D deduction. Concentrated in metro + tier 1 cities.

15. **Tier 2 individual test preference:** In Tier 2 cities, 78% of bookings are single tests vs. 42% in metros. Average order value ₹320 vs. ₹1,200 in metro.

### Product Insights
16. **Counseling uptake → re-booking:** Customers who take counseling sessions rebook within 30 days at 3.4× rate vs. non-counseled.

17. **Report view speed = intent signal:** Customers who open their report within 30 minutes of notification have 2.1× higher follow-up booking rate vs. those who open after 24 hours.

18. **Blood glucose subscription churn:** 34%/year — patients feel "cured" when HbA1c normalizes, stop testing, then deteriorate again. Planted: visible churn-reactivation cycle.

19. **Cart abandonment at slot:** 43% of carts abandoned at slot selection step — not at payment. Next-day morning slots convert at 2× rate vs. same-day afternoon.

20. **Family booking LTV multiplier:** Customers who add ≥2 family members book at 2.4× rate of solo users and have 3.1× LTV.

---

## 14. Realistic Number Benchmarks

### Business KPIs (grounded in Healthians' actual scale)

| Metric | Value |
|---|---|
| Revenue (dataset period, 2 years) | ~₹490 Cr implied (₹263 Cr FY25 × 2, with growth) |
| Bookings per day (start) | ~400/day |
| Bookings per day (end of 2 years) | ~650/day |
| Average order value (blended) | ₹850 |
| Platform take rate | ~35-40% of GMV (lab cost + phlebotomist cost = ~60%) |
| Phlebotomist utilisation | 8-10 collections/day |
| Sample rejection rate | 1.8% baseline, spikes to 4.2% in monsoon |
| Report TAT (median) | 11.2 hours (booking → report) |
| TAT SLA breach rate | 7.3% (>24h for standard tests) |
| On-time phlebotomist arrival | 84% |
| Average phlebotomist rating | 4.3/5 |
| NPS score | 34 (industry benchmark for diagnostics) |

### Customer Economics

| Segment | % of Customers | % of Revenue | LTV (2 years) |
|---|---|---|---|
| Chronic Subscriber | 11% | 38% | ₹12,000-20,000 |
| Engaged Non-Subscriber | 18% | 28% | ₹4,000-8,000 |
| Annual Checker | 28% | 18% | ₹1,500-3,000 |
| Reactive/Symptomatic | 21% | 10% | ₹900-2,500 |
| One-and-Done | 22% | 6% | ₹200-600 |

### CAC by Channel

| Channel | CAC (blended) | 12-month LTV/CAC |
|---|---|---|
| Organic Search | ₹0 (no paid) / ₹180 amortised | 8.2× |
| Referral | ₹250 (reward cost) | 6.1× |
| Google Ads | ₹380 | 3.4× |
| Meta Ads | ₹290 | 2.1× |
| Doctor Referral | ₹150 (commission) | 9.8× |

### Indian Epidemiology (for report_results realism)

| Biomarker | Abnormal Rate in Tested Population |
|---|---|
| Vitamin D deficiency | 73% |
| Vitamin B12 low | 58% |
| Hemoglobin low (anemia) | 34% women, 12% men |
| Cholesterol borderline/high | 44% |
| TSH abnormal | 28% |
| HbA1c pre-diabetic or diabetic | 31% of HbA1c-tested (high because these patients self-select) |
| Uric acid high | 22% men, 8% women |

---

## 15. Dataset Scale

**Total rows: ~13 million across 35 tables**

| Layer | Tables | Approx Rows |
|---|---|---|
| Reference/Master | 5 | ~2,000 |
| Customers & Supplements | 7 | ~625,000 |
| Transactions & Operations | 7 | ~9,400,000 |
| Events & CRM | 5 | ~3,800,000 |
| Marketing | 4 | ~70,000 |
| Summary/KPI | 8 | ~55,000 |

**Date range:** Apr 2024 – Mar 2026 (24 months, 2 Indian fiscal years)
**Currency:** INR (₹)
**Primary entity:** `customer_id`
**Primary table:** `bookings`

---

## 16. What Makes This Dataset Unique

### Comparison to Other Baby-Sentinel Datasets

| Dimension | FundsIndia | QuickHelp | Vastu HFC | Healthians |
|---|---|---|---|---|
| Primary entity | investor | customer | borrower | customer |
| Field agent | None | Home help partner | None | Phlebotomist pipeline |
| Clinical/outcome data | None | None | Loan stage/DPD | Report results, biomarker trends |
| Operational pipeline | None | Simple ops | Collections | Sample → lab → report (6-stage) |
| Post-transaction engagement | None | Survey | None | Report view, counseling, follow-up booking |
| Subscription layer | Monthly SIP | None | Monthly EMI | Chronic test subscriptions |
| Seasonal patterns | ELSS tax season | None | Indian FY | Rich Indian health calendar (8 seasonal peaks) |
| Clinical intelligence | None | None | None | Biomarker trends, improvement trajectory |
| B2C segments | Risk profile | LTV bucket | Employment type | Chronic condition + health goal |
| Data richness | High | Medium | High | Very High (65 customer columns) |

### Unique Analytics Questions Enabled

1. **"What % of our Tier 2 city customers have undiagnosed pre-diabetes?"** (cross: city_tier × glucose_status)
2. **"Do Vitamin D-deficient customers who rebook after counseling eventually normalize, and how long does it take?"** (longitudinal biomarker × counseling × improvement_milestone)
3. **"Which acquisition channel produces customers with the most chronic conditions — and what's their 24-month LTV?"** (acquisition_channel × chronic_condition × total_spend)
4. **"At what point in the report engagement funnel do we lose the highest-risk customers?"** (abnormal_flag_clicked × counseling_taken × follow_up_booked, sliced by severity)
5. **"How does phlebotomist rating affect same-customer rebooking rate?"** (phlebotomist_ratings × days_to_rebook × requested_same_phlebotomist)
6. **"What's the minimum number of abnormal results in a first booking to predict a subscription activation within 6 months?"** (lifetime_abnormal_flags × subscription_activated × days_lag)

---

## Files

| File | Location | Description |
|---|---|---|
| Test catalog | `docs/healthians-catalog.md` | 139 SKUs with prices, scraped live (incl. 3 pediatric) |
| All package slugs | `docs/healthians-all-package-slugs.txt` | 332 package slugs from sitemap |
| All parameter slugs | `docs/healthians-all-parameter-slugs.txt` | 74 individual test slugs from sitemap |
| All profile slugs | `docs/healthians-all-profile-slugs.txt` | 67 profile slugs from sitemap |
| City reference | `docs/healthians-cities.csv` | 215 cities with state + tier classification |
| City reference JSON | `docs/healthians-cities.json` | Machine-readable city data |
| SKU JSON | `/tmp/healthians_final_all.json` | Machine-readable catalog |
| SKU CSV | `/tmp/healthians_master_clean.csv` | Spreadsheet-ready catalog |
| This document | `docs/healthians-research.md` | Full research brief |

---

---

## 17. Late-Breaking Research Findings

### 17a. Pricing is Nationally Uniform (confirmed May 2026)

Live scrape across Gurgaon (metro), Rohtak (tier2), Meerut (tier2), Lucknow (tier1), Surat (tier2) confirmed:
- **No city-tier pricing differential.** Same price everywhere.
- Smoking Effect Screening Package: ₹2,334 in all cities
- Kids Special Package: ₹979 in all cities (earlier Google cache showed ₹700 — stale)
- Diabetic Checkup: ₹840 in all cities

Implication: `tests_catalog.discounted_price_inr` is a single national price. No city price table needed.

**One exception:** Pediatric Blood Culture & Sensitivity has city-variable pricing (₹749–₹2,299) — likely because it relies on specialised culture equipment not available uniformly.

### 17b. City Availability Varies

Not all packages are available in all 215 cities. The `/package/{city}/{slug}` URL returns **"Not available in your city"** for some package-city combinations. This happens for:
- Specialised packages requiring specific lab equipment (e.g. Smoking Effect in Delhi)
- Advanced packages in smaller tier2 cities
- Basic tests (CBC, thyroid, glucose) are available everywhere

Category/habit pages (`/risk/`, `/habit/`) show packages with prices regardless of city availability — they are marketing pages. The actual booking URL confirms availability.

**Schema implication:**
```
tests_catalog:
  city_availability  VARCHAR  -- 'all' / 'metro_only' / 'major_cities'
                               -- (most tests = 'all', some specialised = 'metro_only')
```

### 17c. Multi-Person Family Bundle Pricing

Healthians incentivises booking for multiple family members in a single phlebotomist visit:

```
1 person  →  standard price (e.g. ₹1,025)
2 people  →  ~50% per-person discount (₹513/person = ₹1,026 total)
             "Add 1 more → Pay ₹476/person"
```

Applies primarily to full body checkup packages. Individual tests (CBC, thyroid) don't have this structure.

**Realistic booking distribution:**
- 1-person bookings: 91%
- 2-person family bundles: 8%
- 3-person bundles: 1%

**Schema additions to `bookings`:**
```
persons_in_booking     INTEGER  -- 1/2/3
price_per_person_inr   DOUBLE   -- booking_value / persons
is_family_bundle       BOOLEAN  -- persons > 1
```

### 17d. Pediatric / Child Booking Layer

Healthians has dedicated pediatric packages and supports family member booking. **~12% of bookings have a patient who is different from the account holder** (child, elderly parent, spouse).

**Pediatric SKUs confirmed (added to catalog):**

| Package | Tests | Price | MRP | Age | Notes |
|---|---|---|---|---|---|
| Kids Special Package | 49 | ₹979 | ₹3,262 | 5-12 yr | CBC, Blood Group, Vitamin D, Calcium, Iron, Urine |
| Child Health Tracker | 49 | ₹949 | ₹3,163 | 5-15 yr | Similar scope |
| Pediatric Blood Culture & Sensitivity | 1 | ₹749 | ₹2,497 | 0-15 yr | City-variable pricing |

**Patient vs account holder split:**

| Patient relationship | % of bookings |
|---|---|
| Self | 63% |
| Child (5-17) | 12% |
| Parent (55+) | 11% |
| Spouse | 9% |
| Sibling/other | 5% |

**Why children get tested (most common reasons, grounded in Indian epidemiology):**
1. Fever workup — CBC + dengue + malaria + typhoid (Jul-Sep spike)
2. School entry health certificate — blood group, CBC
3. Nutritional assessment — Vitamin D deficiency 60-65% in school-age children, anemia 39%
4. Annual Kids Health Package (preventive)

**Clinical differences for pediatric patients:**
- Anemia flag rate: 39% (vs 22% adult overall, 34% adult women)
- Vitamin D deficiency: ~62% (similar to adults)
- Dengue highest incidence: 5-10 yr age group (50.4 per 1,000/year in Delhi)
- Fasting compliance: 61% for children vs 84% for adults
- Pediatric reference ranges differ from adult — `report_results` needs `reference_range_is_pediatric` flag

**Schema additions to `bookings`:**
```
patient_age              INTEGER  -- actual patient's age (may ≠ customer.age)
patient_gender           VARCHAR  -- actual patient's gender
patient_relationship     VARCHAR  -- self/child/spouse/parent/sibling
patient_is_minor         BOOLEAN  -- patient_age < 18
```

**Schema additions to `customers`:**
```
has_children             BOOLEAN
children_ages            INTEGER[]  -- [8, 12]
books_for_children       BOOLEAN    -- has made at least one child booking
child_booking_count      INTEGER
```

---

---

## 18. Smart Report — Complete Structure (from PDF analysis, May 2026)

Source: `healthians-sample-report-latest.pdf` — full report fetched via curl with browser headers.

### Report Structure (10 pages)

| Page | Section | What it contains |
|---|---|---|
| 1 | Cover | Booking ID, patient name, date, QR credibility code, celebrity branding (Yuvraj Singh) |
| 2 | Introduction | 5-section overview: Health Analysis, Historical Charts, Lab Test Results, Health Advisory, General Recommendations |
| 3 | Health Analysis — Vital Parameters | Health Score (0-100), 10-organ body diagram with status per organ system |
| 4 | Health Analysis — Critical Parameters | Per-abnormal-parameter cards with value, direction, normal range, health impact, improvement advice |
| 5 | Historical Charts | Time-series charts for key parameters with color-coded trend dots |
| 6 | Lab Report | Raw detailed results: Test Name, Result, Unit, Biological Reference Interval |
| 7 | Health Advisory | Lifestyle profile + personalized nutrition/lifestyle Do's & Don'ts + Suggested Future Tests with frequency |
| 8 | Suggestions for Well-being | Physical Activity, Balanced Diet, Stress Management, BMI chart |
| 9 | General Recommendation | Age-based preventive screening table (18-29 / 30-39 / 40-55 / 55+) |
| 10 | Recommendations | Package upsell, coupon offer, lab quality explanation, app download |

---

### Health Score
- **Range:** 0-100, displayed as a circular gauge with colour (sample: 83/100)
- **Label:** "Your Health Score — Calculated from test reports"
- **Shown on app** as well as report

### The 10 Vital Health Parameters (body diagram, page 3)
Fixed set of 10 organ systems mapped to the body. Status shown per system:

| System | Key parameter shown | Possible statuses |
|---|---|---|
| Thyroid Function | TSH (Ultrasensitive) | Everything looks good / Concern / Test not taken |
| Vitamin B12 | Vitamin B12 Cyanocobalamin | Everything looks good / Concern / Test not taken |
| Cholesterol Total | Cholesterol-Total | Everything looks good / Concern / Test not taken |
| Liver Function | SGPT (ALT) | Everything looks good / Concern / Test not taken |
| Kidney Function | Serum Creatinine | Everything looks good / Concern / Test not taken |
| Calcium Total | Calcium, Serum | Everything looks good / Concern / Test not taken |
| Vitamin D | Vitamin D Total-25 Hydroxy | Everything looks good / Concern / Test not taken |
| Iron Studies | Ferritin / Iron | Everything looks good / Concern / Test not taken |
| HbA1c | Glycated Hemoglobin | Everything looks good / Concern / Test not taken |
| Complete Hemogram | Haemoglobin | Everything looks good / Concern / Test not taken |

If a test was not included in the booking: "Test not taken" displayed.

### Critical Parameters (page 4)
Each out-of-range parameter gets a card with:
- Parameter name + brief explanation of what it measures
- **Your Result Value** with ↑ (high) or ↓ (low) arrow + value + unit
- **"Concern"** status badge
- **Normal Value** range (e.g. 70-100 mg/dl)
- **Impact on overall health?** — 2-3 sentences of clinical explanation
- **How to improve health conditions?** — actionable advice

Sample critical parameters from report:
- WBC-Total: 3.7 th/cumm ↓ (Normal 4-10) — Concern
- Urea, Serum: 11.5 mg/dL ↓ (Normal 12.8-42.8) — Concern
- Blood Glucose Fasting: 112 mg/dl ↑ (Normal 70-100) — Concern (pre-diabetic range)
- Potassium, Serum: 5.46 mmol/L ↑ (Normal 3.5-5.1) — Concern

### Historical Charts (page 5)
Time-series per parameter with:
- **Latest result** value + date
- Reference range bar (green zone = normal, orange = borderline, red = out of range)
- **Status badge:** "Everything looks good" / "Borderline Result" / "Concern" / **"KEEP WATCHING"**
- Line chart with colour-coded dots (green = normal, orange = borderline, red = concern)

Parameters tracked historically in sample (going back to Dec 2018):
Calcium Total, Cholesterol-Total, Creatinine, Hemoglobin Hb, TSH Ultra-sensitive, SGOT/SGPT Ratio, HbA1c, Vitamin B12 Cyanocobalamin

**KEEP WATCHING** flag appears when HbA1c = 6.4% — technically "normal" (below 6.5% diabetic threshold) but trending upward. This is the "borderline" engagement hook.

### Lab Report (page 6 — separate section labelled "Lab Report")
Raw results with:
- Test Name + Methodology (e.g. "Whole Blood EDTA, Cyanide free")
- Result value
- Unit
- Biological Reference Interval

Full CBC shown with 18 individual parameters (Hb, TLC, Polymorphs, Lymphocytes, Eosinophils, Monocytes, Basophils, Absolute counts, RBC, HCT, MCV, MCH, MCHC, Platelet Count)

### Health Advisory (page 7) — Lifestyle Questionnaire Data
This page reveals that Healthians collects a **lifestyle questionnaire** at profile setup. Data shown on this page:

| Field | Sample Value |
|---|---|
| BMI | 27.34 (calculated from height/weight) |
| Height | 5'3" |
| Weight | 70 kg |
| Physical Activity | 5 or more times a week |
| Smoke | No, I don't smoke |
| Food Preference | Non-Veg (4-6 times a week) |
| Blood Pressure | 120/80 |
| Medication | Aproxen, 2 Tablets |
| Alcohol | 1-3 drinks per week |
| Family History | Diabetes, High cholesterol, Heart diseases |
| Sugar levels | 90 \| 120 (Before Meal \| After Meal) |

This feeds into personalised "Suggested Nutrition" Do's & Don'ts and "Suggested Lifestyle" Do's & Don'ts.

**Suggested Future Tests** (test frequency recommendations, specific per patient):
- Glycated Hemoglobin (HbA1c) — Every 3 Month
- Blood Glucose Fasting — Every 1 Week
- Glucose Postprandial — Every 1 Week
- Kidney Function Test — Every 1 Month
- Vitamin D Total-25 Hydroxy — Every 2 Month
- Calcium Total, Serum — Every 2 Month
- Complete Hemogram — Every 1 Month

**This is the direct driver of re-booking and subscriptions.** The report literally tells the patient which tests to book and how often. This is the strongest retention mechanism in the product.

### General Recommendation on Preventive Screening (page 9)
Standard age-group screening table — not personalised, shown to all customers:

| Risk | Tests | 18-29 | 30-39 | 40-55 | 55+ |
|---|---|---|---|---|---|
| Diabetes | HbA1c + Fasting Glucose | Screen annually | Recommended | Strongly Recommended | Strongly Recommended |
| Thyroid | Thyroid Profile-Total | Screen annually | Recommended | Strongly Recommended | Strongly Recommended |
| Vitamin D | Vitamin D 25-Hydroxy | Recommended | Recommended | Strongly Recommended | Strongly Recommended |
| Vitamin B12 | Vitamin B12 Cyanocobalamin | Recommended | Recommended | Strongly Recommended | Strongly Recommended |
| Cholesterol | Lipid Profile | Screen annually | Recommended | Strongly Recommended | Strongly Recommended |
| Kidney | KFT + Urine RM + Urea | Screen annually | Recommended | Strongly Recommended | Strongly Recommended |
| Liver | LFT + SGOT + SGPT | Screen annually | Recommended | Strongly Recommended | Strongly Recommended |

Under treatment: repeat every 2-3 months for most conditions.

---

### Schema Additions from Smart Report Analysis

**`reports` table (additions):**
```
health_score               INTEGER     -- 0-100
health_score_category      VARCHAR     -- poor (<50) / fair (50-70) / good (70-85) / excellent (85+)
vital_organ_statuses       JSON        -- {thyroid: 'good', b12: 'not_taken', liver: 'concern', ...}
critical_params_count      INTEGER     -- count of Concern flags
borderline_params_count    INTEGER     -- count of Borderline flags
keep_watching_params       VARCHAR[]   -- parameters with KEEP WATCHING flag
```

**`customer_lifestyle_profile` (new table — from Health Karma questionnaire):**
```
customer_id
height_cm, weight_kg, bmi, bmi_category (underweight/normal/overweight/obese)
physical_activity_freq     VARCHAR  -- none/1-2x/3-4x/5+x per week
smoking_status             VARCHAR  -- never/ex_smoker/current
food_preference            VARCHAR  -- vegetarian/non_veg/vegan
blood_pressure_systolic, blood_pressure_diastolic
current_medications        VARCHAR  -- free text (e.g. "Aproxen, 2 Tablets")
alcohol_consumption        VARCHAR  -- none/occasional/1-3_per_week/daily
family_history             VARCHAR[] -- diabetes/heart/cancer/thyroid/hypertension
fasting_blood_sugar        DOUBLE   -- self-reported
postprandial_blood_sugar   DOUBLE   -- self-reported
questionnaire_date         DATE
```

**`report_future_tests` (new table — personalised retest recommendations):**
```
recommendation_id, booking_id, customer_id
test_name                  VARCHAR  -- "Glycated Hemoglobin (HbA1c)"
recommended_frequency      VARCHAR  -- "Every 3 Month" / "Every 1 Week" / "Every 2 Month"
recommended_by             VARCHAR  -- report_advisory / counselor / doctor
created_at                 TIMESTAMP
booked_within_window       BOOLEAN  -- did customer actually rebook within recommended timeframe
booking_id_followup        VARCHAR  -- FK if rebooked
```

---

### Key Insights for Dataset Design

1. **Health Score drives engagement** — customers who check their score rebook at 2.1× rate. Score is prominently shown in app (confirmed from page 10 app screenshot: 90/100 shown on home screen).

2. **"Test not taken" creates upsell opportunity** — if Thyroid, Vitamin D, or B12 shows "Test not taken", the next booking often adds that test. Plant this conversion pattern.

3. **KEEP WATCHING is the stickiest flag** — HbA1c at 6.4% (borderline pre-diabetic) with KEEP WATCHING generates the highest re-booking rate because it creates anxiety without being alarming.

4. **Suggested Future Tests = re-booking engine** — the advisory page literally outputs a schedule. A customer with 7 suggested future tests (from this sample) has a near-guaranteed re-booking. This is the direct mechanism behind the "counseled customer rebooks at 3.4×" finding.

5. **Lifestyle questionnaire is collected at signup** — height, weight, medications, family history, BP, sugar levels are all captured. These should be on the `customers` table (or a linked `customer_lifestyle_profile`).

6. **BMI 27.34** shown = overweight — this customer would be a natural target for weight management packages. The advisory section makes this explicit. This is the cross-sell mechanism.

---

---

## 19. Complete Booking Flow — Confirmed from Live Walkthrough (May 2026)

Source: Vimarsh walked through the full booking flow on healthians.com. Screenshots captured May 26, 2026.

### The Real Flow Architecture

The "Book Now" button on any package page opens a modal. From that modal there are TWO paths:

**Path A — Callback (lead capture):**
```
Modal: enter mobile + name + city → "Get a Call Back"
→ Healthians agent calls within 10 min
→ Agent completes booking over phone
```

**Path B — Self-serve digital checkout:**
```
Modal: enter mobile → OTP → redirect to healthians.com/book-now
→ 4-step self-serve checkout
→ booking_confirmed
```

Both paths exist. Path B (self-serve) is the primary digital path used by most customers. Path A exists for less tech-savvy users.

### The 4-Step Checkout (`healthians.com/book-now`)

**Step 1: Login/Register**
- Mobile number entry → OTP verification
- Right side: selected package shown with "+ ADD MORE PATHOLOGY TESTS" and "+ ADD MORE RADIOLOGY TESTS" buttons ← radiology bookable here
- Benefits shown: historic reports access, notifications control

**Step 2: Profile + Member Selection**
- First-time users: modal "Enter your Details" — Name *, Email *, Date of Birth *, Age (auto), Gender (Male/Female)
- Then: "Select Package Members" — shows saved members with checkbox
- "+Add More Member" button → same profile modal for family member (name, DOB, gender, relationship)

**Step 3: Address + Date & Time**
- "Add New Address" modal:
  - Locality * (sublocality search — granular, not just city)
  - House No. / Flat No. / Building / Landmark *
  - Pincode *
  - City, State (auto-populated from pincode)
  - Address Type: Home / Office / Other
  - "Make Default Address" checkbox
- Saved addresses shown with address type badge (HOME orange)
- "Choose Date & Time for Home Sample Collection *" — separate date picker + time picker
- "Select date & time to proceed *" — mandatory before payment

**Step 4: Payment Options — THE CRITICAL SCREEN**
```
Cart breakdown (revealed for the first time):
  Package price:                   ₹99
  Consumables & Transportation:    ₹98   ← HIDDEN FEE — only revealed here
  Report Counselling:              FREE  (₹399 crossed out)
  ─────────────────────────────────────
  Total Payable:                   ₹197
```

Add-ons (optional):
- Hard copy of report: ₹199 (checkbox)
- Expert Diet Consultation: ₹199 per member ("+Add Customer" button)

Discount mechanisms:
- Coupon code field + "Available coupon" link
- IndiGo BluChip Membership ID (earn miles on bookings)
- Gyftr E-Gift Cards
- Healthians E-Gift Cards (by ValueDesign)
- Healthians Voucher

Payment methods:
- PhonePe UPI / Credit / Debit Card → "Upto ₹300 cashback"
- UPI / Wallet / Cards / Netbanking → "₹10-₹200 cashback + Gold Coins"
- MobiKwik → "Upto ₹500 cashback on min ₹1,200"
- **Cash/Card on Sample Collection** (pay when phlebotomist arrives — zero upfront)

CTA: "Complete Order" (orange button) + T&C checkbox

### The ₹98 Consumables & Transportation Fee

**This is the #1 source of billing complaints.** Package page shows ₹99; actual bill is ₹197. The fee is only revealed at Step 4. This matches Trustpilot reviews: *"mention a discounted price to lure you, then once sample is collected the app shows full price."*

For dataset: `bookings.advertised_price_inr` ≠ `bookings.total_paid_inr` for most bookings.

### Schema Updates from Checkout Discovery

**`bookings` — additional fields:**
```
advertised_price_inr         DOUBLE   — package page price (₹99)
consumables_transport_fee_inr DOUBLE  — ₹98 for most bookings
hard_copy_fee_inr            DOUBLE   — ₹199 if ordered, else 0
diet_consultation_fee_inr    DOUBLE   — ₹199 if added, else 0
coupon_code                  VARCHAR
coupon_discount_inr          DOUBLE
cashback_earned_inr          DOUBLE
total_paid_inr               DOUBLE   — actual charge

hard_copy_ordered            BOOLEAN
diet_consultation_added      BOOLEAN
radiology_test_added         BOOLEAN  — from "+ ADD MORE RADIOLOGY TESTS"

payment_method:
  phonePe_upi / upi_wallet_netbanking / mobikwik / cash_on_collection / card

indigo_bluchip_linked        BOOLEAN
gyftr_card_used              BOOLEAN
healthians_voucher_used      BOOLEAN
healthians_egift_card_used   BOOLEAN

booking_channel:
  app_android / app_ios / web_self_serve / web_callback / phone_inbound / whatsapp
```

**`customer_addresses` — richer than before:**
```
address_id, customer_id
locality_sublocality    — "HSR Layout", "Koramangala 5th Block" (granular search)
house_flat_no
building_landmark
pincode
city, state             — auto-populated from pincode
address_type            — home / office / other
is_default              BOOLEAN
times_used              INTEGER
```

**New tables:**

`leads` (web form submissions — both booking and support):
```
lead_id, customer_id (nullable if anonymous)
lead_type           — new_booking / customer_support_query
mobile_number, email (support only), name, city
test_context        — package slug they were viewing
source_url, source_type (package_page / nav_bar / home_banner)
submitted_at, consent_given
```

`outbound_calls` (agent callback after lead):
```
call_id, lead_id, agent_id
called_at, duration_seconds
outcome: booked / not_interested / no_answer / rescheduled / wrong_number
booking_id (FK if booked)
upsell_attempted, upsell_converted
```

`diet_consultations`:
```
consultation_id, booking_id, customer_id
scheduled_at, completed_at, duration_min
feedback_score (1-5), diet_plan_sent (bool)
```

---

## 20. The 8 User Journeys — Complete Event Sequences

Each journey has a distinct event sequence, different table writes, and different conversion rates.

### J1 — Web New User → First Booking
*Source: Google/Meta. Never used Healthians before. Most complex journey.*

```
web_visit                    {utm_source, landing: '/package/delhi/thyroid-package-preventive'}
test_page_viewed             {test_id, dwell_sec, source: 'google_search'}
book_now_clicked             {from: 'package_page'}
modal_opened                 {tab: 'new_booking'}
otp_requested                {}
otp_verified                 {}
profile_modal_shown          {}              ← fires ONCE, new users only
profile_completed            {name, email, dob, gender}
step2_member_selection_shown {}
member_self_selected         {}
step3_address_shown          {}
address_modal_shown          {}
address_entered              {locality, pincode, address_type: 'home'}
slot_date_selected           {date}
slot_time_selected           {time_band: '6-8am'}
step4_payment_shown          {}
consumables_fee_revealed     {advertised: 99, fee: 98, total: 197}
payment_method_selected      {method: 'phonePe_upi'}
complete_order_clicked       {}
payment_success              {amount: 197}
booking_confirmed            {booking_id}
```

Tables written: `customers` (new), `customer_addresses`, `bookings`, `booking_items`
Avg events: 18–22 | Conversion from web_visit: ~13%

---

### J2 — App New User → First Booking
*Downloaded from Play Store. Native app, more streamlined.*

```
app_installed                {attributed_platform: 'google_ads', campaign_id}
app_opened                   {}
search_performed / category_browsed
test_page_viewed             {test_id, source: 'search'}
book_now_tapped              {}
otp_verified                 {}
profile_completed            {}
member_selected, address_entered, slot_selected
payment_screen_shown         {consumables_fee: 98}
payment_completed            {method: 'upi'}
booking_confirmed            {booking_id}
```

Tables written: same as J1, `booking_channel = 'app_android'/'app_ios'`
Avg events: 14–18 | Conversion: ~18%

---

### J3 — Web Callback Lead (Phone-Assisted)
*Less tech-savvy user. Clicks "Get a Call Back" without OTP login.*

```
web_visit                    {source: 'organic_search'}
test_page_viewed             {dwell_sec: 90}
book_now_clicked             {}
modal_opened                 {tab: 'new_booking'}
lead_form_submitted          {mobile, name, city, test_context}
  ↓ OFFLINE
outbound_call_made           {lead_id, called_at}
  ├── call_no_answer          → [sms_reminder → may rebook or churn]
  └── call_connected
        ├── booking_confirmed {booking_channel: 'web_callback'}
        └── not_interested
```

Tables written: `leads`, `outbound_calls`, optionally `bookings`
Avg events (digital): 5–6 | Conversion from lead submit: ~37%

---

### J4 — Repeat Customer (from Push Notification)
*Has saved profile, address, payment. Zero friction. Fastest journey.*

```
push_notification_received   {type: 'annual_checkup_reminder', test_id: 'thyroid'}
push_notification_opened     {delay_min: 8}
test_page_viewed             {source: 'push_notification'}
book_now_tapped              {}
otp_auto_verified            {}   ← session active / biometric
[saved member auto-populated]
[saved address auto-populated]
slot_selected                {}
payment_method_selected      {}   ← saved preferred method
booking_confirmed            {booking_id}
```

Tables read: `customers`, `customer_addresses`, `customer_family_members`
Avg events: 8–10 (vs 18–22 for new user) | Conversion from notification: ~22%

---

### J5 — Post-Report Follow-up Booking
*Abnormal result → counseling → recommended test → re-books. High LTV driver.*

```
report_notification_sent     {channel: 'whatsapp'}    ← from comms_log
report_notification_opened   {delay_hours: 2.1}
report_viewed                {abnormal_count: 2}
health_score_viewed          {score: 74, delta: -7}
abnormal_flag_clicked        {parameter: 'HbA1c', value: 6.2, status: 'borderline'}
counseling_session_started   {}
counseling_session_completed {duration_min: 18, satisfaction: 4}
follow_up_test_recommended   {test_id: 'hba1c', frequency: 'every_3_months'}
follow_up_book_cta_clicked   {}   ← CTA inside report screen
test_preloaded_in_cart       {test_id, source: 'report_recommendation'}
slot_selected                {}   ← saved address, skip address step
payment_completed            {}
booking_confirmed            {booking_id, source: 'report_followup', report_id}
```

Tables written: `counseling_sessions`, `report_future_tests`, `bookings` (new)
Avg events: 10–12 | Only triggered for customers with ≥1 abnormal result

---

### J6 — Subscription Auto-Run
*Chronic patient. Thyroid every 6 months, HbA1c every 3 months. Near-zero friction.*

```
subscription_reminder_sent   {channel: 'sms', days_before_due: 7}
subscription_reminder_opened {}
  ├── [auto-confirm if opt-in]: booking_confirmed immediately
  └── [one-click]: subscription_rebook_clicked → slot_selected → booking_confirmed

booking_confirmed            {subscription_id, run_number: 4}
```

Tables written: `subscription_runs`, `bookings`
Avg events: 3–4 | Adherence rate: 79%
18% skip → `subscription_skipped` → CRM re-engagement flow

---

### J7 — Parent Booking for Child / Elderly Parent
*Account holder ≠ patient. 12% of bookings.*

```
app_opened
test_page_viewed             {test_id: 'healthians-junior-boys-health-package-up-to-12-years'}
book_now_tapped              {}
otp_verified                 {}
step2_member_selection
add_more_member_clicked      {}
member_modal_shown           {}
member_details_entered       {name, dob, gender, relationship: 'child'}
member_saved                 {}
member_selected              {relationship: 'child', patient_age: 9}
address_selected             {}
slot_selected                {}
payment_completed            {}
booking_confirmed            {patient_relationship: 'child', patient_age: 9, patient_gender: 'male'}
```

Tables written: `customer_family_members` (new), `bookings` (with patient_* fields)
Avg events: 12–16

---

### J8 — Customer Support Query (Web Modal)
*Existing customer with issue — delayed report, billing, etc.*

```
web_visit                    {source: 'google: "healthians report not received"'}
page_viewed                  {}
book_now_clicked             {}
modal_opened                 {tab: 'customer_support_query'}
mobile_entered, email_entered, name_entered, city_selected
get_callback_submitted       {type: 'support_query'}
  ↓
support_lead_created         {}
outbound_support_call_made   {}
support_ticket_created       {
    category: 'delayed_report' / 'billing_dispute' / 'phlebotomist_no_show' /
              'wrong_result' / 'incomplete_report' / 'sample_rejected',
    linked_booking_id: (if existing customer)
}
support_ticket_resolved / escalated
```

Tables written: `leads` (support type), `outbound_calls`, `support_tickets`

---

## 21. Journey × Event × Table Correlation Matrix

Every event maps to a table write + FK chain:

| Event | Table Written | FK Chain |
|---|---|---|
| `otp_verified` (new) | `customers` | customer_id (PK) |
| `profile_completed` | `customers` (update) | customer_id |
| `member_saved` | `customer_family_members` | → customer_id |
| `address_entered` | `customer_addresses` | → customer_id |
| `booking_confirmed` | `bookings` | → customer_id, tests_catalog, customer_addresses, cities |
| `booking_item_added` | `booking_items` | → booking_id, test_id |
| `payment_completed` | `bookings` (update) | → booking_id |
| `lead_form_submitted` | `leads` | → customer_id (nullable) |
| `outbound_call_result` | `outbound_calls` | → lead_id |
| `phlebotomist_assigned` | `phlebotomist_assignments` | → booking_id, phlebotomist_id |
| `sample_collected` | `sample_tracking` | → booking_id |
| `sample_received_at_lab` | `sample_tracking` (update) | → lab_id |
| `report_released` | `reports` | → booking_id, customer_id |
| `report_results_generated` | `report_results` | → booking_id, test_id (tests_catalog) |
| `counseling_completed` | `counseling_sessions` | → booking_id, customer_id |
| `follow_up_recommended` | `report_future_tests` | → report_id, test_id |
| `follow_up_booked` | `bookings` (new) | → report_future_tests.id |
| `subscription_activated` | `subscriptions` | → customer_id, test_id |
| `subscription_run_booked` | `subscription_runs` + `bookings` | → subscription_id |
| `nps_submitted` | `nps_responses` | → booking_id, customer_id |
| `phlebotomist_rated` | `phlebotomist_ratings` | → booking_id, phlebotomist_id |
| `support_ticket_created` | `support_tickets` | → booking_id, customer_id |
| `comms_sent` | `comms_log` | → customer_id |
| `comms_opened/clicked` | `comms_log` (update) | → send_id |

### Complete FK Graph

```
customers (50K)
  ├── 1:1  customer_lifestyle_profile
  ├── 1:N  customer_addresses
  ├── 1:N  customer_family_members
  ├── 1:N  customer_prescriptions
  ├── 1:N  customer_appointments     → booking_id
  ├── 1:N  customer_biomarker_history → booking_id, test_id
  ├── 1:N  customer_health_timeline
  ├── 1:N  bookings
  │    ├── 1:N  booking_items        → test_id (tests_catalog)
  │    ├── 1:1  phlebotomist_assignments → phlebotomist_id (phlebotomists)
  │    ├── 1:1  sample_tracking      → lab_id (labs)
  │    ├── 1:1  reports
  │    │    └── 1:N report_results   → test_id (tests_catalog)
  │    ├── 0:1  counseling_sessions
  │    ├── 1:N  report_future_tests  → test_id (tests_catalog)
  │    ├── 0:1  nps_responses
  │    ├── 0:1  phlebotomist_ratings → phlebotomist_id
  │    └── 0:1  support_tickets
  ├── 1:N  subscriptions             → test_id (tests_catalog)
  │    └── 1:N subscription_runs    → booking_id (bookings)
  ├── 1:N  leads
  │    └── 1:N outbound_calls
  ├── 1:N  referrals
  ├── 1:N  user_events              (behavioral log — see below)
  └── 1:N  comms_log

tests_catalog (169 SKUs)
  ← booking_items.test_id
  ← report_results.test_id
  ← report_future_tests.test_id
  ← subscriptions.test_id

phlebotomists (600)
  ← phlebotomist_assignments.phlebotomist_id
  ← phlebotomist_ratings.phlebotomist_id

cities (215)
  ← bookings.city
  ← phlebotomists.city

labs (30)
  ← sample_tracking.lab_id

ad_campaigns → ad_sets → ad_creatives → ad_daily_metrics
install_attribution → customer_id, ad_creative_id
```

---

## 22. Dataset Generation Order

Tables must be generated in dependency order — each table reads from tables above it:

```
LAYER 0 — Reference (no dependencies)
  tests_catalog        169 rows
  cities               215 rows
  labs                 30 rows

LAYER 1 — Core entities
  customers            50K rows
    Fields driven by: demographics model, acquisition channel model,
                      chronic_condition prevalence (India epidemiology)
  phlebotomists        600 rows
    Fields: city assignment, hub assignment, experience, certification
  customer_lifestyle_profile  50K rows
    Derived from: customer.age, chronic_condition, bmi, lifestyle fields

LAYER 2 — Transactions (depend on Layer 1)
  bookings             ~30K rows
    Each booking driven by:
      customer.lifecycle_stage → booking frequency
      customer.chronic_condition → test category selection
      customer.city → city availability + lab routing
      seasonal_calendar → booking date (dengue season, tax season etc.)
      customer.acquisition_channel → booking_channel
    Pre-populate ALL outcomes at generation time:
      on_time, delay_min, sample_rejected, tat_hours,
      report_viewed, counseling_taken, follow_up_booked,
      billing_dispute, consumables_fee, hard_copy_ordered

  booking_items        ~35K rows (1.15 tests per booking avg)
    Expand each booking → test_ids from tests_catalog

LAYER 3 — Operations (depend on bookings)
  phlebotomist_assignments  ~28K rows (excludes cancelled)
    on_time driven by: city_tier + day_of_week + month (monsoon vs not)
    no_show driven by: city_tier (tier2 UP = 8%, metro = 2%)

  sample_tracking      ~28K rows
    rejection_rate: metro 1.8%, tier2 2.8%, monsoon +1.4%
    tat_hours: metro 8h, tier1 14h, tier2 24h

  customer_addresses   ~42K rows (1.4 per customer avg)
  customer_family_members  ~14K rows

LAYER 4 — Reports (depend on sample_tracking)
  reports              ~27K rows (accepted samples)
    health_score: derived from report_results
  report_results       ~730K rows (27K bookings × avg 27 parameters)
    Values drawn from Indian epidemiology distributions:
      HbA1c: normal(5.8, 0.8) — 31% prediabetic/diabetic
      TSH: lognormal(2.0, 1.2) — 28% abnormal
      Vitamin D: normal(22, 12) — 73% deficient
      Hemoglobin (women): normal(11.8, 1.8) — 34% anemic
      Cholesterol: normal(185, 35) — 44% borderline/high

LAYER 5 — Post-report (depend on reports)
  counseling_sessions  ~5K rows (18% of bookings with reports)
  report_future_tests  ~18K rows (driven by abnormal report_results)
  customer_biomarker_history  ~82K rows (repeat customers only)

LAYER 6 — CRM & Retention (depend on bookings + reports)
  comms_log            ~450K rows
    Driven by: booking dates + test_category + lifecycle_stage + season
    Channel: customer.preferred_comm_channel
  subscriptions        ~5.5K rows (11% of customers)
  subscription_runs    ~20K rows (subscriptions × months × adherence_rate)

LAYER 7 — Marketing (depend on customers)
  install_attribution  ~50K rows (1:1 with customers)
  ad_campaigns → ad_sets → ad_creatives  ~980 rows
  ad_daily_metrics     ~18K rows

LAYER 8 — Leads & Support
  leads                ~4K rows (12% of web bookings have a lead)
  outbound_calls       ~4K rows
  support_tickets      ~1.2K rows (~4% of bookings)
  nps_responses        ~8K rows (~30% of bookings)
  phlebotomist_ratings ~16K rows (~60% of bookings)

LAYER 9 — Events (FINAL — derived from all above)
  user_events          ~3.5M rows
    Pass 1: Booking-derived events (expand bookings + phlebotomist + sample + report)
    Pass 2: Pre-booking browse events (backfill 0-30 days before each booking)
    Pass 3: Non-converting browse sessions (DAU without booking)
    Pass 4: CRM engagement events (expand comms_log → open/click events)
    Pass 5: Subscription events
```

---

## 23. Session Model & Timing Rules

### Session Definition
- New session if >30 min idle
- Booking journey = 1-3 sessions (some browse multiple times before converting)
- Average sessions per customer per month: 2.3 (engaged), 0.4 (at_risk/churned)

```
session_id          UUID
customer_id         FK
session_start       TIMESTAMP
session_end         TIMESTAMP
platform            app_android / app_ios / web
source              organic / push_notification / sms_click / whatsapp_click /
                    email_click / paid_ad / direct
booking_id          FK (nullable — only if booking happened)
events_count        INTEGER
converted           BOOLEAN
```

### Timing Anchors Per Journey

All event timestamps derive from `bookings.slot_date` and `bookings.created_at`:

```
Pre-booking browse:         created_at - [0 to 30 days]  (J1/J2)
                            created_at - [0 to 4 hours]   (J4 repeat, notification)

OTP verification:           +1 to 2 min after mobile_entered
Profile completion:         +2 to 5 min after otp_verified (first time)
Slot selection:             +3 to 8 min after address_entered
Payment completion:         +2 to 4 min after method_selected

Phlebotomist assigned:      booking_confirmed + 15-45 min
Phlebotomist arrived:       slot_start + [-15 to +60 min]
  on_time = arrived within 60 min of slot_start
  delay_min: metro avg 12 min, tier2 avg 28 min, monsoon +18 min

Sample at lab:              arrived_at + 45-180 min (metro) or 2-18 hours (tier2)
Report generated:           sample_received + 4-20 hours (test type dependent)
Report released:            generated + 10-45 min (QC)
Notification sent:          released + 1-10 min
Report viewed:              notification + 12 min (J5) to 8 hours (J4)
                            26% never view (open rate 74%)

Counseling scheduled:       report_viewed + 0-24 hours (if taken)
Follow-up booking:          counseling_completed + 0-60 min (if J5 path)

Subscription reminder sent: subscription.next_due_date - 7 days
Subscription booking:       reminder + [0 to 7 days] (if adherent)
```

### Seasonal Calendar Applied to Bookings

```python
# Booking date distribution must encode:
if month in [7, 8]:  # Monsoon
    dengue_malaria_typhoid_share *= 3.0
    no_show_rate *= 2.1
    sample_rejection_rate *= 1.8
    phlebotomist_delay_minutes += 18

if month in [2, 3]:  # Tax season
    full_body_checkup_share *= 1.67
    total_bookings_multiplier *= 1.4

if month == 11:  # Post-Diwali
    glucose_hba1c_share *= 1.3

if day_of_week == 0:  # Monday
    on_time_rate *= 0.85  # capacity overflow

if city_tier == 'tier2':
    tat_hours_multiplier *= 2.5
    no_show_rate *= 3.0
    sample_rejection_rate *= 1.6
```

---

## 24. Operational Failure Modes (from Reviews — Live Trustpilot / Consumer Complaints)

Sources: Trustpilot (2.5/5, 143 reviews), ConsumerComplaints.in, Watchdoq patient stories, Google Play (65.6K reviews).

### Failure Rate Parameters (realistic, grounded in review data)

| Failure Mode | Field | Metro | Tier 1 | Tier 2 | Monsoon spike |
|---|---|---|---|---|---|
| Phlebotomist no-show | `no_show` | 2.1% | 3.8% | 7.2% | +4% |
| Late arrival (>60 min) | `on_time = false` | 16% | 22% | 35% | +18 min delay |
| Sample rejected at source | `rejection_reason` | 1.2% | 1.8% | 2.8% | — |
| Sample rejected at lab | `lab_rejection` | 0.6% | 1.1% | 2.1% | +1.4% summer |
| TAT breach | `tat_breach` | 7% | 14% | 22% | — |
| Incomplete report | `tests_missing > 0` | 2.1% | 3.4% | 4.8% | — |
| Wrong result (triggers retest) | `retest_recommended` | 0.6% | 0.9% | 1.4% | — |
| Billing dispute | `billing_dispute` | 2.2% | 2.8% | 3.1% | — |
| Location not serviceable | `cancellation_reason` | 0.8% | 1.5% | 3.8% | — |

### City-Level Supply Chain Issues

| City / Region | Primary Failure | Root Cause |
|---|---|---|
| Bengaluru outer areas (Sarjapura, Yelahanka, Whitefield) | No-show 6-8% | Distance from hubs, traffic |
| UP belt (Lucknow, Mathura, Bareilly, Agra) | Wrong results + billing | Aggregator phlebotomists, weaker QC |
| North India tier2 summer (Meerut, Rohtak, Panipat in May-Jun) | Temp-compromised samples | No-AC transit, ambient 42°C |
| Delhi/NCR Monday mornings | +35% delay rate | Post-weekend booking surge |
| Mumbai outer suburbs (Virar, Thane, Navi Mumbai) | +40% TAT vs core Mumbai | Long transit to central lab |
| All tier2 cities | TAT breach 22% vs 7% metro | Overnight routing to hub city |
| Dengue season any city (Jul-Sep) | 40% slot unavailability | 3× volume overwhelms supply |

---

*Research conducted: May 2026. Data sourced from: healthians.com (live scrape including full booking flow walkthrough), published Indian health epidemiology, Healthians FY25 financial filings, The Ken, CARE Ratings diagnostics industry report, Trustpilot reviews, ConsumerComplaints.in, Watchdoq patient stories.*
