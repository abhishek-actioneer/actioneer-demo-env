# Stable Money — Research Insights (2026-04-23)

Synthesis of four Actioneer research reports run against `stable_money_analytics.mixpanel_events` on Athena (Connection 468):

1. **KYC Path Comparison** — Digilocker vs VKYC, 90-day window (Jan 23 – Apr 23, 2026).
2. **FD Repeat Booking Analysis** — Q1 2025 first-ever-FD cohort, 180-day observation through Sep 30, 2025.
3. **Behavioral Archetype Segmentation** — k=6 clustering on top 50K active users, 176-day window (Oct 25, 2025 – Apr 18, 2026).
4. **Intent Decay & Intervention Playbook** — 117,536 high-intent users across FD/Bond/MF, 90-day window (Jan 23 – Apr 23, 2026).

This document preserves the findings the team should act on, with exact numbers, methodology caveats, and the strategic implications that the report executive summaries under-emphasized.

---

## Section 1 — KYC Path Analysis: Two Journeys, Not One Comparison

### 1.1 Structural finding that reframes the whole question

The originally specified three KYC paths (`digio_kyc_sdk_events`, `digilocker_initiated`, `vkyc_journeys`) actually reduce to **two distinct flows**:

| Path | Event architecture | Nature |
|---|---|---|
| Digilocker eKYC | `digilocker_initiated` → `SM_DIGILOCKER_SUCCESS` / `digilocker_failure` | Standalone pre-qualification, completed before any FD is selected |
| Video KYC (VKYC) | `SM_VKYC_INITIATED` → `SM_VKYC_SUCCESS` / `SM_VKYC_FAILURE` / `SM_VKYC_EXPIRED` / `SM_VKYC_RETRY_REQUIRED` | Embedded **inside** the FD booking flow, triggered when the user has already picked a product |

`digio_kyc_sdk_events` does not exist as an event. Digio is the **backend provider** powering the Digilocker path — confirmed by the fact that `kyc_initiate_response` events with `provider='digio'` produce exactly 19,790 unique users, identical to `digilocker_initiated`.

VKYC has two sub-paths:
- **Instant Connect** (`vkyc_connect_instantly`): 14,321 users, 77.4% of VKYC sub-path traffic.
- **Slot-Based** (`vkyc_slot_selected`): 4,187 users, 22.6%.

**Why this matters**: every subsequent comparison between the paths is apples-to-oranges by construction — Digilocker users have not yet chosen a product; VKYC users are already committed to a specific FD. Every completion-rate, time-to-complete, and 48h-FD-booking metric between the two paths is confounded by this difference.

### 1.2 Headline funnel metrics (90 days)

**Digilocker eKYC:**

| Stage | Users | Rate |
|---|---|---|
| Initiated | 19,790 | 100% |
| Success (`SM_DIGILOCKER_SUCCESS`) | 4,747 | **24.0%** |
| Failure (`digilocker_failure`) | 4,236 | 21.4% |
| **Silent drop-off (no outcome event)** | **10,807** | **54.6%** |

**VKYC:**

| Stage | Users | Rate |
|---|---|---|
| Initiated | 41,645 | 100% |
| Success (`SM_VKYC_SUCCESS`) | 38,261 | **91.9%** |
| Failure + Expired | 1,632 | 3.9% |
| Drop-off | 1,752 | 4.2% |

### 1.3 The silent drop-off is the largest hidden loss in the platform

**10,807 Digilocker-initiating users (54.6%) fire neither a success nor a failure event.** This represents more leakage than the explicit failure bucket (21.4%) and is the single largest actionable funnel loss surfaced in the report.

- All three diagnostic fields — `failure_reason`, `error`, `status_code` — are **NULL across all 6,076 explicit failure events**, so even the "failure" population is un-diagnosable today.
- Likely root causes (unverified): abandonment during the DigiLocker portal redirect, Aadhaar authentication issues outside the app, deterrence by multi-step document flow.
- Rough financial scale: at the Digilocker completer FD-booking rate of ~73% and average ₹90K ticket, the silent drop-off represents **roughly ₹70 Cr of at-risk 90-day FD volume per quarter** — an order of magnitude larger than any routing tweak.

### 1.4 VKYC dominates throughput but has a hidden friction signal

- Final success of 91.9% masks **26.4% of VKYC users (10,978 people) hitting `SM_VKYC_RETRY_REQUIRED`** — a significant agent-initiated retry event. The retry mechanism is effective (final success still high) but adds time, user frustration, and likely agent cost.
- Within VKYC, **Instant Connect outperforms Slot-Based by 12.5 percentage points** in success rate:
  - Instant Only: 11,180 users, **87.8%** success.
  - Both (tried both): 3,141 users, 83.3%.
  - Slot Only: 1,046 users, 75.3%.
- This sub-path finding is one of the report's cleanest wins — Instant Connect should be the default, with Slot-Based only as an off-hours fallback.

### 1.5 Operational signal: the Digilocker outage of March 9

Week-by-week Digilocker volumes (typically 1,500–2,400 users/week) **collapsed to 227 in the week of March 9** while VKYC remained stable at 3,896. The two paths have fully independent infrastructure. This detection was a side-effect of the analysis; the team should set up standing alerts on weekly initiation volume per path.

### 1.6 Digilocker completers are higher-value customers — with caveats

Once both paths complete KYC, downstream behavior differs sharply:

| Metric | Digilocker | VKYC |
|---|---|---|
| KYC-completed users | 4,747 | 38,261 |
| Users who booked ≥1 FD (90-day) | 3,466 (73.0%) | 38,166 (99.8%) |
| Avg total FD per user | **₹2,33,971** | ₹1,09,456 |
| Median total FD per user | **₹1,00,162** | ₹24,556 |
| Avg FD count per user | 3.02 | 1.92 |
| Total FD volume | ₹81.1 Cr | **₹417.8 Cr** |

Digilocker completers are **2.14× higher on avg LTV, 4.08× higher on median LTV, and book 57% more FDs**. But three caveats the executive summary understated:

- **"LTV" here is a 90-day FD-volume proxy, not a lifetime metric.** The report's own methodology footnote admits this. Do not use this number for long-horizon routing or CAC-payback decisions without a true cohort with 12+ months of tenure.
- **Selection bias is likely the dominant driver.** Users who proactively complete eKYC before selecting a product are self-selected for higher intent and financial capacity. The 76% who fail Digilocker and later complete via VKYC are not controlled for.
- **The 3.02 vs 1.92 FDs/user gap is likely a tenure artefact** — Digilocker has existed longer; those users have had more time to repeat-book. Treat it as an observation, not evidence of a causal path quality effect.

### 1.7 The 48-hour nudge window is the cleanest actionable signal

For Digilocker completers (who complete KYC *before* entering the booking flow):

| Time window after KYC | % of 30-day FD bookings captured |
|---|---|
| ≤ 1 hour | 44.7% |
| ≤ 6 hours | 52.2% |
| ≤ 24 hours | 69.4% |
| **≤ 48 hours** | **79.3%** |
| ≤ 7 days | 91.3% |

**48 hours captures 79.3% of all FD bookings that will happen within 30 days.** This is the optimal nudge window — sharper than 24h (too early, captures 10pp fewer) or 7d (too late, and users have cooled).

Digilocker 48h FD booking rate = 55.0% with **₹89,139 avg ticket, ₹50,000 median ticket, ₹33.8 Cr total volume** in the 90-day window. The VKYC equivalent 98.3% rate is a tautology (VKYC happens during booking) — the Digilocker 55% is the real conversion-intent signal.

### 1.8 The instrumentation gap catalog (the most under-emphasized win)

Both `SM_DIGILOCKER_SUCCESS` and `SM_VKYC_SUCCESS` **fire server-side with NULL values for `os`, `city`, and `app_version`**. Consequence:

- Per-OS success rates cannot be computed.
- Per-city success rates cannot be computed.
- Per-app-version failure detection cannot be computed.
- Per-city-tier routing cannot be validated (and no city-tier lookup table exists — 6,533 distinct cities).
- All failure events have NULL `failure_reason`, `error`, `status_code`.

**None of these are analytical questions. They are one-sprint engineering tickets.** Until they're fixed, any routing recommendation based on city-tier, device, or failure-class is a guess with a confidence interval no one can measure.

Partial dimensional data we do have:
- Digilocker initiation by OS: Android 16,642 (83.9%), iOS 2,854 (14.4%), Web/Windows 277 (1.4%). iOS shows marginally higher failure rate (25.0% vs 20.8% Android) — indicative but unverifiable.
- Top 10 cities by Digilocker initiation (total 10,534 of init users): Bengaluru 1,880, Hyderabad ~1,200, Kolkata ~1,150, Mumbai ~1,100, Delhi ~1,000, Pune ~950, New Delhi ~900, Patna 615, Jaipur ~550, Ahmedabad ~550. Tier-2/3 meaningful volume: Patna 615, Guwahati 387, Bhubaneswar 395.

### 1.9 What the routing recommendations actually do and do not support

The report's P0/P1 recommendations, re-graded:

| Rec | Validity given selection bias | Correct action |
|---|---|---|
| Default NTB to VKYC Instant Connect | **Partially** — VKYC's 91.9% completion is confounded by the fact that VKYC users are post-product-selection. Cannot cleanly say VKYC is "better"; can say Instant Connect beats Slot-Based within VKYC. | Pilot this via a randomized cohort A/B before platform-wide default. The volume impact of being wrong is large. |
| Implement 48h post-KYC nudge for Digilocker completers | **Yes** — 79.3% capture + ₹33.8 Cr volume is a clean signal, not confounded. | Ship. Build WhatsApp + push cadence at 2h, 24h, 47h. |
| Retain Digilocker as pre-qualification option | **Yes** — even on a 90-day proxy, removing the path forfeits ₹81.1 Cr of completed-user volume. | Do not deprecate. |
| Prefer Instant Connect over Slot within VKYC | **Yes** — 87.8% vs 75.3% is a valid within-path comparison. 12.5pp × 4,187 slot users × ~₹60K avg ticket ≈ ₹3 Cr/quarter upside. | Ship. Slot only as off-hours fallback. |

### 1.10 Five actionable items from this report

1. **Instrument the Digilocker redirect funnel.** Intermediate events at Aadhaar OTP, document consent, portal return. This alone likely recovers 5–15% of the 10,807 silent drop-offs.
2. **Propagate client metadata to server-side success events.** `os`, `city`, `app_version`, `device_model` must be present on `SM_DIGILOCKER_SUCCESS` and `SM_VKYC_SUCCESS` from session context.
3. **Populate `failure_reason` and `error` on `digilocker_failure`.** Currently 100% NULL on 4,236 failure events.
4. **Build the 48-hour Digilocker post-KYC nudge cadence.** The 79.3% capture rate is the report's cleanest revenue-side finding.
5. **Stand up weekly path-volume alerts.** The March 9 Digilocker outage was detected by accident; it should not have been.

---

## Section 2 — FD Repeat Booking: The Retention Engine and the Notification Paradox

### 2.1 Cohort design and the headline curve

The Q1 2025 first-ever-FD cohort comprises **29,296 unique users** (first `SM_TD_BOOKED` event between 2025-01-01 and 2025-03-31, verified via `HAVING MIN(event_date_ist) >= '2025-01-01'`). Observation window extends to 2025-09-30 — a full 180 days even for the latest March cohort members.

Repeat booking curve:

| Window | Repeat users | Repeat rate |
|---|---|---|
| 30 days | 9,825 | **33.5%** |
| 60 days | 11,870 | 40.5% |
| 90 days | 12,923 | 44.1% |
| **180 days** | **14,513** | **49.5%** |
| Ever (by Sep 2025) | 15,051 | 51.4% |

**Half the cohort becomes a repeat investor within six months.** The curve is steepest in the first 30 days (more than half of eventual repeat activity happens there), with diminishing increments after day 90. This is the retention backbone for the ₹4,000 Cr → ₹12,000 Cr AUM ambition — any growth model should be built off this curve.

### 2.2 First-FD amount — the inverted-U sweet spot

Repeat rates by NTILE(10) first-FD amount decile:

| Decile | Amount range | Cohort | 30d % | 90d % | 180d % |
|---|---|---|---|---|---|
| D1 | ≤ ₹1,000 | 2,930 | 32.3 | 41.0 | 45.1 |
| D2 | ₹1,000–2,500 | 2,929 | 30.1 | 39.3 | 42.7 |
| D3 | ₹2,500–5,000 | 2,929 | 29.4 | 39.6 | 44.2 |
| D4 | ₹5,000–10,000 | 2,929 | 30.0 | 39.6 | 44.6 |
| D5 | ₹10,000–27,000 | 2,929 | 31.2 | 45.3 | 51.1 |
| D6 | ₹27,000–50,000 | 2,929 | 34.9 | 46.9 | 54.2 |
| D7 | ₹50,000–95,000 | 2,929 | 38.1 | 49.5 | 56.2 |
| **D8** | **₹95,000–1,00,000** | **2,929** | **42.4** | **53.1** | **58.8** |
| D9 | ₹1,00,000–2,00,000 | 2,929 | 35.7 | 46.9 | 53.4 |
| D10 | > ₹2,00,000 | 2,929 | 31.3 | 40.0 | 45.1 |

**Clear inverted-U with a peak at Decile 8 (₹95K–1L).** The gap between D8 (42.4%) and D2 (30.1%) is **12.3 percentage points, statistically significant at p < 0.001 (z = 9.87; 95% CIs: D8 [40.6%, 44.2%], D2 [28.4%, 31.8%])**.

Interpretation:
- **Sub-₹10K first-FD users are platform-testers**, not committed customers — they repeat less because the first deposit is exploratory.
- **Above ₹2L users are lump-sum deployers** who book infrequently regardless of satisfaction.
- **₹50K–1L is the psychologically-comfortable "round number" investment** where mass-affluent users are happy to repeat quickly.

Strategic implication: acquisition funnels and cross-sell prompts should be tuned to anchor users into the D6–D8 range. Onboarding nudges suggesting a ₹50K–1L FD are likely to create the highest-compounding users.

### 2.3 Partner bank — the SFB-vs-private divide

| Partner bank | Type | Cohort | 30d % | 90d % | 180d % |
|---|---|---|---|---|---|
| North East SFB | SFB | 11,218 | **37.8** | 48.4 | **54.0** |
| Unity SF Bank | SFB | 4,130 | **37.6** | 48.4 | 54.0 |
| Bajaj Finance | NBFC | 67 | 32.8 | 41.8 | 46.3 |
| Shriram Finance | NBFC | 94 | 30.9 | 42.6 | 44.7 |
| Shivalik SF Bank | SFB | 5,009 | 30.8 | 42.5 | 48.5 |
| Ujjivan SF Bank | SFB | 297 | 29.3 | 40.7 | 43.1 |
| Suryoday SF Bank | SFB | 5,673 | 27.9 | 37.6 | 42.7 |
| Utkarsh SF Bank | SFB | 2,240 | 27.7 | 37.7 | 42.7 |
| **IndusInd Bank** | **Private** | **561** | **25.3** | **33.9** | **38.0** |

- **SFB weighted avg 30-day repeat = 35.1% vs IndusInd 25.3% = 9.8pp gap, p < 0.001, z = 5.27 (95% CIs: SFBs [34.5%, 35.7%], IndusInd [21.7%, 28.9%]).**
- Within SFBs, North East and Unity are top-tier (~37.8%); Suryoday and Utkarsh underperform the SFB average by 5–6 pp — investigate rate attractiveness, maturity UX, or onboarding friction at these banks.
- The most important strategic read: **IndusInd's 25.3% tells you the current user base is rate-shopping.** These users came to Stable Money for SFB rates; when they bank with IndusInd (lower rate), they don't come back for a second FD. The product's PMF is narrower than the partner list suggests — expanding to more private-sector banks will not produce the same repeat behavior without a different acquisition wedge.

Confound to flag: product characteristics (rate attractiveness) and user-base effects (rate-sensitive first-FD cohort) are tangled. A follow-up analysis cross-tabulating rate × bank × repeat would help isolate the driver.

### 2.4 Acquisition channel — bimodal quality

| Channel | Cohort | 30d % | 90d % | 180d % |
|---|---|---|---|---|
| **Organic** | 4,759 | **36.5** | 49.2 | **55.8** |
| avow_int | 386 | 38.6 | 48.4 | 53.9 |
| None (direct) | 1,128 | 37.6 | 48.5 | 53.9 |
| Google Ads | 5,828 | 35.7 | 46.7 | 52.2 |
| Unknown | 12,854 | 33.4 | 43.2 | 48.4 |
| YouTube | 647 | 32.6 | 43.6 | 48.7 |
| — (~3,300 users across 340+ smaller channels) | | | | |
| **gromo_int** | 175 | **5.1** | 7.4 | 8.0 |
| **promotionbazaar_int** | 138 | **3.6** | 6.5 | 8.0 |
| **digitalads_int** | 76 | **2.6** | 2.6 | 3.9 |

- **Organic vs Google Ads:** 30-day gap (36.5% vs 35.7%) is **not significant (p = 0.39)**; 180-day gap widens to 3.6pp (55.8% vs 52.2%, p < 0.001, z = 3.70) — organic users have more long-term staying power.
- **Red-flag affiliate channels:** gromo_int, promotionbazaar_int, digitalads_int (~500 users combined) have near-zero repeat rates. These should be flagged in UA quality reviews and likely cut from CPI spend.
- Unknown (12,854 users) is the largest bucket and underperforms organic by 3.1pp at 30d — worth improving install attribution to understand what's in there.

### 2.5 The notification paradox — possibly the most dollar-impact finding in any of the three reports

Event penetration among repeaters (booked 2nd FD within 180 days) vs non-repeaters, **over the full 180-day window between 1st and 2nd FD**:

| Event | Repeaters % | Non-repeaters % | Ratio |
|---|---|---|---|
| `SM_PLAN_DETAILS_CHANGED` | 88.6% | 28.6% | **3.10×** |
| `next_best_fd_scroll` | 65.4% | 58.2% | 1.12× |
| `home_one_click_fd_viewed` | 28.2% | 22.6% | 1.25× |
| `home_next_best_fd_viewed` | 87.9% | 90.9% | 0.97× |
| **Notif Clicked (Android)** | **31.8%** | **44.4%** | **0.72× (inverse)** |
| **WhatsApp Clicked** | **17.1%** | **28.7%** | **0.60× (inverse)** |

**Push notifications and WhatsApp are negatively correlated with repeat behavior.** Non-repeaters click notifications at 44.4% vs 31.8% for repeaters. WhatsApp 28.7% vs 17.1%.

The naïve interpretation ("notifications are reactive, not catalytic") understates the implication: **the MoEngage and WhatsApp campaign engine may be flowing disproportionately to users who were not going to repeat anyway, inflating engagement metrics without contributing to AUM.** If true, this represents multi-crore per year in operational + campaign spend that is either neutral or value-destroying.

**Hypothesis H6 ("push/WhatsApp drives repeat bookings") was formally rejected by the report.**

Important caveat on `SM_PLAN_DETAILS_CHANGED` at 88.6%: this event fires when a user changes FD plan parameters (tenure, bank, amount, payout type). The 88.6% penetration among repeaters is consistent with two different causal readings: (a) users who experiment with FD configurations have higher intent, or (b) configuring the 2nd FD itself triggers the event (i.e., it's downstream of repeat, not leading). Without timestamp restriction relative to the 2nd FD, this signal is ambiguous. The report's §7 lift analysis addresses this by constraining exposure to the 30-day post-first-FD window.

### 2.6 Matched-cohort 30-day lift analysis (exposure within 30 days of first FD)

| Catalyst event | Exposed users | Exposed repeat % | Unexposed repeat % | Lift |
|---|---|---|---|---|
| `home_next_best_fd_viewed` † | 25,337 | 36.86% | 12.25% | +200.9% |
| `next_best_fd_scroll` | 16,864 | 45.83% | 16.86% | **+171.8%** |
| `first_fd_reward_enabled` | 80 | 53.75% | 33.48% | +60.5% |
| `home_one_click_fd_viewed` | 7,454 | 45.55% | 29.44% | **+54.7%** |
| `fd_reinvestment_fd_list_loaded` | 0 | N/A | 33.54% | N/A |

† Near-universal exposure (86.5% of cohort). Lift reflects selection bias (unexposed = disengaged users) more than treatment effect. Discount this signal.

Ranked by actionability (lift × reach):

1. **`next_best_fd_scroll`** — best actionable signal. +171.8% lift, 16,864 users (57.5% of cohort). Scrolling the next-best-FD carousel is a strong intent signal and the widget has room for UX optimization (variety, personalization, scroll cues). Stat-sig: exposed 45.8% [45.1%, 46.6%] vs unexposed 16.9% [16.2%, 17.5%], z = 56.8, p < 0.001.
2. **`home_one_click_fd_viewed`** — +54.7% lift, but only 25.4% of cohort exposed. Expanding one-click FD eligibility/prominence could unlock this lift for more users. Stat-sig: exposed 45.6% [44.4%, 46.7%] vs unexposed 29.4% [28.8%, 30.0%], z = 24.6, p < 0.001.
3. `home_next_best_fd_viewed` — drop from ranking. 86.5% already exposed; lift reflects engagement, not catalyst effect.
4. `first_fd_reward_enabled` — 53.75% exposed repeat rate, but only n=80 exposed. Directional only; re-run once the reward program reaches ≥1,000 exposed users.
5. `fd_reinvestment_fd_list_loaded` — post-maturity event that only fires months after the first FD. Zero users exposed within 30 days. **Not a short-term repeat catalyst at all. H5 formally rejected.**

**Causal caveat**: every lift above is observational. Self-selection is present — users who scroll FD options are also users with higher repeat intent. Lifts are **upper bounds** on the true causal effect. Establishing causation requires randomized A/B tests.

### 2.7 Hypothesis scorecard

| # | Hypothesis | Status | Evidence |
|---|---|---|---|
| H1 | Short FD tenors repeat faster | **Untestable** | `tenor_months` not captured. `maturity_instruction` (62% CLOSE_ACCOUNT, 35% AUTO_RENEWAL) could proxy but does not encode actual duration. |
| H2 | Mid-ticket (₹50K–1L) users repeat most | **Validated** | Deciles 7–8 peak at 42.4% (30d), 29–32% for bottom deciles. Inverted-U robust across time windows. |
| H3 | SFBs outperform private banks on repeat | **Validated** | SFB weighted avg 35.1% vs IndusInd 25.3%. Likely rate-differential driven. |
| H4 | Organic > paid on repeat | **Validated** | Organic 55.8% (180d) vs Google Ads 52.2%. Red-flag affiliates (gromo, promotionbazaar) near-zero. |
| H5 | `fd_reinvestment_fd_list_loaded` is the primary repeat catalyst | **Rejected** | Post-maturity event. Zero users exposed within 30-day post-first-FD window. |
| H6 | Push/WhatsApp notifications drive repeat bookings | **Rejected** | Inverse correlation. Non-repeaters click notifications at higher rates. Notifications appear reactive, not catalytic. |
| H7 | Home-screen FD engagement predicts repeat | **Validated** | `next_best_fd_scroll` +171.8% lift; `home_one_click_fd_viewed` +54.7% lift. Both have large exposed populations. |

### 2.8 Critical data gap

**Tenor is not captured anywhere in the event stream.** The report tests `tenor`, `tenure`, `duration`, `maturity_period`, `fd_tenor`, `maturity_date` in `extra_properties` — all NULL. This blocks:

- Testing whether short-tenor FDs produce faster repeat cycles.
- Second-FD amount behavior relative to first-FD duration.
- Maturity-driven reinvestment economics.
- Any retention modeling that differentiates "rate chasers" from "term depositors."

Recommended fix: add `tenor_months` to `SM_TD_BOOKED` or expose the backend FD booking table to the analytics warehouse via `fd_identifier` as the join key.

Additional gaps noted: `order_id` is NULL on all `SM_TD_BOOKED` events (`fd_identifier` in `extra_properties` is the correct join key); MoEngage campaign attribution is diffuse (no single campaign reached ≥10 unique repeaters in the inter-booking window).

### 2.9 Five actionable items from this report

1. **Run the notification withholding A/B.** Hold back all MoEngage push + WhatsApp from a randomized 10% cohort for 60 days post-first-FD. Measure 30/60/90-day repeat + total AUM per user. Likely finding: material reduction in notification volume with no AUM impact = multi-crore/year savings.
2. **A/B the `next_best_fd_scroll` and `home_one_click_fd_viewed` surfaces.** Randomized prominence / personalization / one-click eligibility expansion. Lifts observed are upper bounds; real causal effect needs isolation.
3. **Kill the red-flag affiliate channels.** gromo_int, promotionbazaar_int, digitalads_int. ~500 users at <10% 180-day repeat and near-zero downstream AUM. Clean CFO-facing UA cut.
4. **Add `tenor_months` to `SM_TD_BOOKED`.** Unblocks the next quarter of retention analysis. One-sprint engineering ticket.
5. **Anchor onboarding into the ₹50K–1L decile.** This is the highest-repeat sweet spot. First-FD nudges, default-amount pickers, and cross-sell prompts should bias toward this range.

---

## Section 3 — Behavioral Archetype Segmentation: Six Distinct User Types

### 3.1 Methodology and scope

- **Source**: `stable_money_analytics.mixpanel_events` (Athena Connection 468).
- **Period**: Oct 25, 2025 – Apr 18, 2026 (176 days).
- **Universe**: 5,911,304 distinct users, 546,032,617 events total.
- **Analysis sample**: top 50,000 most-active users (minimum 10 events) — **0.85% of the total universe**.
- **Features**: 17-dimensional user vector — activity volume (4), engagement depth (4), navigation breadth (3), product-area allocation (5), investment behavior (1). Log-transformed count features, StandardScaler normalization.
- **Algorithm**: MiniBatch K-Means. k=6 selected by silhouette score comparison: k=6 (0.2102), k=7 (0.1935), k=8 (0.1541).
- **AUM coverage**: only 10,332 of 50,000 users (20.7%) have AUM from `extra_properties`; remaining 79.3% use `total_payment_amount` as a proxy, which underestimates total portfolio value (excludes growth, coupons, dividends).

### 3.2 The six archetypes — size, AUM, churn, and distinguishing behavior

| # | Archetype | Persona | Size | % of sample | Median AUM | 90d churn | Active days | Dominant product |
|---|---|---|---|---|---|---|---|---|
| 1 | Bond Power User | "Yield Hunter" | 15,855 | **31.7%** | ₹1,66,872 | 0.5% | 59.8 | Bonds (78.4%) |
| 2 | FD Specialist | "Rate Comparator" | 4,578 | 9.2% | ₹1,35,145 | 1.3% | 81.0 | FDs (58.4%) |
| 3 | Power Investor | "Portfolio Optimizer" | 7,961 | 15.9% | **₹2,35,256** | **0.04%** | **116.7** | Multi (Bonds 57.8%, MF 26.9%, FD 7.8%) |
| 4 | CC-Focused Browser | "Credit Card Curious" | 8,335 | 16.7% | ₹20,000 | 0.6% | 62.7 | Credit Cards (80.3%) |
| 5 | MF Enthusiast | "SIP Disciplined" | 9,368 | 18.7% | ₹27,000 | 0.7% | 85.9 | Mutual Funds (80.9%) |
| 6 | At-Risk Non-Investor | "Window Shopper" | 3,903 | 7.8% | **₹0** | **9.8%** | 65.6 | Bonds 54.6%, MF 15%, FD 12.3% |

### 3.3 Archetype 1 — Bond Power User ("Yield Hunter")

Largest segment, 31.7% of sample. Sessions are bond-page → returns-calculator → collection-browse loops. 107 avg passbook views over 180 days (roughly every other day), 100% investment rate, 0.5% churn.

**Behavioral DNA**: Bond-native. Navigation bypasses the home feed (moderate 0.23 scroll rate) — they go directly to bonds. High content-tap rate (95 avg) suggests engagement with bond promotional content.

**Strategic role**: The platform's core franchise. Bonds are the primary product affinity and these are the volume backbone.

**Intervention (report recommendation)**: Cross-sell MF SIPs as a liquidity complement. At bond maturity, nudge: "Your ₹50K bond matures in 7 days → park it in a liquid fund earning X% while you pick your next bond." Captures the reinvestment moment.

### 3.4 Archetype 2 — FD Specialist ("Rate Comparator")

Smallest engagement-positive segment (9.2%) but second-highest active days (81). Sessions revolve around FD search filters, rate comparisons, and the "Find My Right FD" quiz. Low passbook-check frequency (25 views) — they're rate-hunting, not portfolio-monitoring.

**Behavioral DNA**: 58.4% FD events, but 20.3% bond event share hints at latent cross-product curiosity. High scroll rate (0.29) suggests deep engagement with the home feed, possibly for rate announcements.

**Intervention (report recommendation)**: When FD Specialist filters for "3-year, highest rate," show a side-by-side comparison card: "Looking for 8.5% FD? Consider this AAA bond at 9.2% for similar tenure." Leverages existing comparison behavior without disrupting the FD flow.

### 3.5 Archetype 3 — Power Investor ("Portfolio Optimizer")

**The dream user.** 15.9% of sample. By every measure the most engaged: 3× more events than other clusters (7,246 avg), active on 117 of 180 days (65% of days), 371 passbook views (more than 2 per active day), 28 payment transactions, 898 nav clicks. **Effectively zero churn (0.04% = ~3 users in 90 days).** Multi-product (Bonds 57.8%, MF 26.9%, some FD 7.8%).

**Strategic role**: AUM spine. ~8,000 users at ₹2.35L median = ~₹180 Cr in this cohort alone (proxy-based, likely understated). Protect ruthlessly.

**Intervention caveat**: The report recommends a referral program with AUM-linked rewards. Reframe this — at 0.04% churn and daily engagement, these users are **not** a growth channel, they are a moat. The better intervention is:
- A named "Power Investor" tier — first-access to new products, rate-lock on rollovers, expedited support.
- A relationship-manager pilot (the cohort is small enough at 8K to justify high-touch).
- Then layer referral incentives on top as a lesser move.

The report's own referral framing treats the most loyal users as acquisition labor; the higher-leverage move is depth, not width.

### 3.6 Archetype 4 — CC-Focused Browser ("Credit Card Curious")

16.7% of sample. **80.3% of events are credit-card events** — the sharpest single-product signature in the entire segmentation. Median AUM ₹20K (second-lowest). Surprisingly low churn (0.6%) — the CC product keeps them coming back even without incremental investment engagement.

**Important caveat the report understates**: the 97.7% "has invested" rate is instrumentation-flawed. The Suryoday CC product requires an FD collateral to issue the card, so any CC user mechanically has a payment event from that collateral FD. The "has invested" flag inflates because of the mandatory collateral, not organic investment behavior. The real question — what % of CC users have any *incremental* investment beyond their collateral FD — is not answered here.

**Intervention (report recommendation)**: Position an FD as a mechanism to increase credit limit — "Book a ₹25K FD → Get ₹20K additional credit limit instantly." Converts CC engagement into an investment entry point using the product they already care about.

### 3.7 Archetype 5 — MF Enthusiast ("The SIP Disciplined")

Second-largest engaged segment (18.7%). Near-perfect investment rate (99.5%). 80.9% MF events, 26.7 payment events average, 160 passbook views (nearly daily). Low AUM (₹27K median) despite high engagement — consistent with small recurring SIP amounts, not lump-sum investments.

**Behavioral DNA**: Low scroll rate (0.10) suggests direct navigation to MF sections rather than home-feed browsing. Moderate navigation breadth (415 nav clicks) puts them between casual browsers and power users.

**Strategic open question the report doesn't resolve**: Why does this segment have high engagement and low AUM? Two competing hypotheses:
- They're early in their SIP journey and AUM will compound passively.
- They're using Stable Money as a secondary MF app while their primary SIPs live on Groww / Zerodha Coin / Kuvera.

These have opposite product implications. The first says "wait, the flywheel works." The second says "we're the side wallet in the MF market — SIP Step-Up nudges are pointless because the user's real SIPs are elsewhere." Before shipping an MF intervention, determine which is true.

**Intervention (report recommendation)**: SIP Step-Up prompt at the passbook. When an MF Enthusiast opens the passbook, show: "Your SIP portfolio grew 12% this year. Stepping up by ₹500/month could add ₹X by [date]." Leverages existing passbook-checking habit.

### 3.8 Archetype 6 — At-Risk Non-Investor ("The Window Shopper")

**The single most actionable segment.** 3,903 users in sample (7.8%). Zero investment rate, ₹0 AUM, 9.8% churn (highest), 27.3 avg days since active (vs 8–13 for other segments). But — importantly — 65.6 active days avg and 2,263 avg events: they were engaged browsers.

Product browsing skews toward bonds (54.6%), with some MF (15%) and FD (12.3%). High content tap rate (103) and screen navigation (267) suggest **genuine interest** — the barrier is likely KYC friction, trust, or decision paralysis, not lack of intent.

**Intervention (report recommendation)**: Trigger a zero-KYC micro-investment entry point. "Try investing ₹100 in a liquid fund — no paperwork needed" after the 3rd bond-page visit in a session.

**Important regulatory caveat**: SEBI requires basic KYC (Aadhaar + PAN) for any MF investment. A strictly "zero-KYC" experience is not available in the current regulatory regime. The intervention needs product + compliance co-design — likely a frictionless one-tap KYC flow rather than zero-KYC. Ship the intervention with that correction.

**Sizing**: 3,903 in sample × ~150 (if the full-user-base multiplier approximates the inverse of sample share) = possibly **400K–2M Window Shoppers in the full 5.9M universe**. Even a 2% conversion unlocks 8K–40K net-new investors. This is the single highest-leverage funnel in the data.

### 3.9 The crucial sample-bias caveat the report understates

**This segmentation describes the top 0.85% of the user base, not the platform.**

50,000 users analyzed out of 5.9M total. The report's limitations section acknowledges this ("less-active users may cluster differently — particularly, the At-Risk Non-Investor segment is likely much larger in the full population") but does not quantify or lean on the implication.

What's almost certainly true: the vast majority of the 5.86M excluded users are:
- Installers who never converted and went dormant (the true Window Shopper population).
- One-FD-and-never-returned users.
- Low-frequency engaged users who fail the ≥10-event threshold.

If At-Risk Non-Investors are 7.8% of the top 50K (3,903 users), they could easily be **40–60% of the full 5.9M base (2.3–3.5M users)**. That reframes the whole segmentation: the "Power Investor" is not 15.9% of the platform — it's closer to **0.13%** (7,961 of 5.9M). The entire archetype distribution is a distribution of an elite subset, not the platform.

**Practical consequence**: any decision that uses "X% of our users are archetype Y" must be recomputed against the full universe, or explicitly caveated as "% of active power users." Interventions targeted at At-Risk Non-Investors should be sized against the full-universe estimate, not the 3,903 in-sample count.

### 3.10 Methodological honesty — what this report calls "session DNA" is really event-volume clustering

The report's "session-DNA" framing promises more than the data supports:
- `session_id` is inconsistently populated (most clusters show ~1 session per user, while CC users show proper session data). True session-length percentiles could not be computed.
- `screen_time_spent` has no reliable top-level column; `video_time_spent_seconds` covers only 57K of 546M events (too sparse).
- 3-event screen sequence n-grams would require windowed ordered queries over 546M events with proper session boundaries — deferred to follow-up.
- Scroll depth is proxied via `home_scrolls / home_visits` ratio.

What the report actually did: event-count-volume clustering, with product-affinity shares as the dominant discriminating signal. The clustering worked because product affinity is strong enough to carry the segmentation, but the "session DNA" label over-promises.

**Fix**: either rename the method to what it is, or commit to fixing `session_id` instrumentation before re-running.

### 3.11 The missing analysis that matters most — transition modeling

The report's "Suggested Further Analysis" section mentions transition analysis as a future item. It should be the highest-priority follow-up.

The static archetype description ("7.8% of users are Window Shoppers") is far less valuable than a transition model answering: **which Window Shoppers historically became Bond Power Users, and what event sequence preceded the shift?**

If even 10% of Window Shoppers have transitioned into investors over past periods, the event sequences that accompanied those transitions are the richest product-experiment generator available in the data — a map of what actually converts the most addressable cohort.

### 3.12 Intervention playbook summary

| Archetype | Size (sample) | Median AUM | Churn | Priority intervention | Expected leverage |
|---|---|---|---|---|---|
| Bond Power User | 15,855 (31.7%) | ₹1.67L | 0.5% | Cross-sell MF SIPs as liquidity complement at bond maturity | Increase cross-product attach, moderate LTV lift |
| FD Specialist | 4,578 (9.2%) | ₹1.35L | 1.3% | Surface bond yields alongside FD rate search results | Channel 20% of FD-only users into bonds |
| Power Investor | 7,961 (15.9%) | ₹2.35L | 0.04% | **Power-tier program + relationship management (not referral)** | Protect the AUM moat; lift ARPU |
| CC-Focused Browser | 8,335 (16.7%) | ₹20K | 0.6% | FD-backed credit limit increase offer | Convert CC engagement to incremental investment |
| MF Enthusiast | 9,368 (18.7%) | ₹27K | 0.7% | SIP Step-Up prompt at passbook (after resolving primary-vs-secondary-app question) | Raise SIP ticket size |
| At-Risk Non-Investor | 3,903 (7.8%) + likely 2M+ in full base | ₹0 | 9.8% | Frictionless micro-investment entry (compliance-validated) | **Highest revenue-unlock lever in the data** |

### 3.13 Five actionable items from this report

1. **Ship the Window Shopper micro-investment intervention** — compliance-validated frictionless-KYC, not zero-KYC. Size the addressable cohort against the full 5.9M universe, not the 3,903 in sample.
2. **Stand up a Power Investor tier.** 8K users at 0.04% churn deserves named treatment, not a referral program. First-access, rate-lock, relationship-manager pilot.
3. **Disambiguate the MF Enthusiast hypothesis.** Survey + behavioral signal analysis — are SIPs genuinely building here, or is Stable Money the secondary MF app? Ship the SIP Step-Up nudge only after this is known.
4. **Build the transition model.** Which archetype a user started in vs where they are today. The answer is a product roadmap. This is the single highest-priority follow-up analysis.
5. **Re-run clustering on a stratified sample.** Include low-activity users explicitly. The current segmentation describes elite 0.85%; platform decisions need an inclusive picture.

---

## Section 4 — Intent Decay & Intervention Playbook: Product-Aware Cadence Design

### 4.1 Why this report matters differently than the others

The first three reports describe **who** the users are (archetypes), **whether** they convert (KYC), and **whether** they repeat (retention). This report adds the missing temporal dimension: **when** intent burns out per product, and **which** intervention at **which** time window works.

Scope: 117,536 high-intent users over 90 days (Jan 23 – Apr 23, 2026). Intent events were substituted where the originally requested events did not exist in the warehouse: `fd_booking_cta_clicked` → `fd_booking_page_viewed`; `bond_checkout_page_viewed` → `bond_buy_now_clicked`; `credit_score_check_status` → not available (Credit Card intent is untracked, a major instrumentation gap).

### 4.2 The conversion funnel is radically different per product

| Product | Intent event | Conversion event | Intent users | Converted | CVR |
|---|---|---|---|---|---|
| **FD** | `fd_booking_page_viewed` | `fd_booking_payment_gateway_success_callback` | 49,304 | 2,804 | **5.69%** |
| Bond | `bond_buy_now_clicked` | `bonds_payment_success` | 43,619 | 32,716 | **75.00%** |
| MF | `mf_buy_checkout_page_loaded` | `MF_ORDER_PAYMENT_SUCCESS` | 24,613 | 15,213 | **61.81%** |

**The three products are in different worlds.** Bonds and MFs convert 60–75% of intenders; FD converts 5.7%. 46,500 FD intent users did not complete a booking in 90 days — this is the largest absolute recovery pool on the platform.

**Important caveat on MF CVR**: `MF_ORDER_PAYMENT_SUCCESS` includes SIP auto-debit events. An existing SIP user whose auto-debit fires shortly after they view `mf_buy_checkout_page_loaded` appears as a rapid converter but is not a new intent-to-conversion flow. The true first-time MF conversion rate is lower than 61.81% — likely materially lower — and the "~82.5% convert within 5 min" stat is inflated accordingly. Every MF-related decision in this report should be re-run on a denominator restricted to users without an active SIP.

### 4.3 Intent half-life per product — the single most actionable framework in the report

The **half-life** is the time by which 50% of eventual converters have completed their purchase.

| Product | Half-life | p75 | p90 |
|---|---|---|---|
| **FD** | **~29 minutes** | ~49 hours (~2 days) | ~309 hours (~13 days) |
| Bond | ~2 minutes | ~29 minutes | ~81 hours (~3.4 days) |
| MF | ~2 minutes | ~2.4 minutes | ~3.8 hours |

**Interpretation**:
- **Bonds and MFs are session-convert products** — the vast majority who will ever convert do so before leaving the app.
- **FD is a deliberation product** with a thick long tail. 1 in 3 FD converters take more than a day.
- Treating FD, Bond, and MF with one CRM cadence is the biggest operational mistake a growth team can make.

**Executive summary inaccuracy to note**: Page 1 claims Bond/MF intervention windows are "measured in seconds, not minutes." This is wrong. The actual p75s are **Bond 29 minutes, MF 2.4 minutes** — windows in minutes, not seconds. The p50 for MF is 2 minutes. Downstream operational playbooks should not be calibrated to the "seconds" framing.

**MF 4-hour hard cutoff (underweighted in the report)**: MF p90 = 3.8 hours. **90% of all eventual MF converters are done within 3.8 hours.** Any MF CRM fired more than ~4 hours after intent is targeting a <10% recovery pool. This is a harder operational stop signal than the generic ">6 hours negative lift" and should be used as the MF-specific cutoff.

**Bond 3.4-day tail (understated)**: Bond p90 = 81 hours (~3.4 days). Of 32,716 Bond converters, approximately 3,270 take more than 3 days to convert. The report's ops playbook recommends ">1 hour: Low priority" for Bond — this is overly aggressive and forfeits a multi-thousand-user multi-day tail. The correct Bond cutoff is 24–48 hours, not 1 hour. Bond is a session-convert product for the median user and a multi-day-deliberation product for a meaningful minority.

### 4.4a FD converter distribution is effectively tri-modal — three personas, not one

The 29-minute half-life masks a distribution with three distinct populations:

| FD converter persona | Time from intent | Share of converters |
|---|---|---|
| In-session deciders | 0 – 1 hour | ~53% |
| Intra-day deliberators | 1 – 24 hours | ~14% |
| Multi-day / week returners | 1 – 30+ days | ~27% |
| Right-censored tail | > 30 days | ~6% (uncaptured) |

Each population needs a different intervention strategy, and the single "FD ops playbook" cannot serve all three. Specifically:

- **In-session deciders (53%)** need frictionless checkout, not nudges — any nudge that interrupts their flow is value-destroying.
- **Intra-day deliberators (14%)** are the sweet spot for the 30-min/24h MoEngage and WhatsApp interventions.
- **Multi-day / week returners (27%)** are the cohort the "Saved FD" / shortlist feature would disproportionately serve. They're currently forced to re-search every time they return — that friction is a meaningful product gap for roughly a quarter of FD converters.

### 4.4 Cumulative conversion by time since intent

| Time threshold | FD | Bond | MF |
|---|---|---|---|
| Within 5 min | 10.6% | **65.0%** | **82.5%** |
| Within 15 min | 37.8% | 72.1% | 86.7% |
| Within 1 h | 53.2% | 76.3% | 88.6% |
| Within 6 h | 59.9% | 79.5% | 90.5% |
| Within 24 h | 67.6% | 82.6% | 91.9% |
| Within 72 h | 76.5% | 88.8% | 95.0% |
| Within 7 d | 83.4% | 92.3% | 96.8% |
| Within 30 d | 94.7% | 97.5% | 99.3% |

**Takeaway for FD**: only 10.6% of eventual FD converters convert within 5 minutes; 46.8% still haven't converted after 1 hour; 16.6% convert only after 7+ days. The FD nurture window is not hours — it is days and weeks.

### 4.5 MoEngage 30-minute intervention lift (observational, not causal)

| Product | CVR with 30-min intervention | CVR without | Lift | Users reached | Reach as % of intent pool |
|---|---|---|---|---|---|
| **FD** | **15.56%** | 5.36% | **+10.2pp** | 1,562 | **3.2%** |
| Bond | 79.40% | 74.72% | +4.7pp | 2,636 | 6.0% |
| MF | 71.75% | 61.55% | +10.2pp | 623 | 2.5% |

Lift decays as the intervention window widens. **By 6+ hours, Bond and MF interventions show negative lift** — a selection effect where users still not converted after 6 hours are inherently lower-intent, and reaching them does not overcome this. This is the cleanest "stop wasting spend" signal in the entire report series: late-window Bond and MF campaigns should be killed immediately.

**Reach-ceiling warning (missed in the report)**: the 30-min MoEngage analysis covers only **3.2% of FD intenders, 6.0% of Bond, 2.5% of MF**. Scaling this to the remaining 94–97% of the funnel assumes the targeting logic scales linearly — it almost certainly does not. MoEngage targeted the users easiest to reach (opt-in consent, recent installs, prior engagement); the unreached 95%+ are structurally harder to reach and lower intent. The "+10.2pp lift" therefore has a reach-quality ceiling. Expanding MoEngage 30× cannot capture 30× the lift — diminishing returns will bite hard before that.

**Causal warning**: the MoEngage targeting layer itself selects for higher-intent users (complete KYC, on booking page, prior history). The "without intervention" group is the dregs of the intent pool. The +10.2pp lift is an upper bound and probably 2–3× inflated. Proper measurement requires randomized hold-out at the targeting layer — 10% of eligible users receive no campaign despite qualifying — before these numbers drive budget decisions.

### 4.6 Channel effectiveness — first post-intent touch within 24 hours

| Channel | FD CVR | Bond CVR | MF CVR |
|---|---|---|---|
| **WhatsApp** | **17.36%** | 65.41% | 63.07% |
| Push | 8.01% | 73.94% | 62.77% |
| Email | 3.73% | 75.84% | 48.93% |

**For FD**: WhatsApp outperforms Push by 2.2× and Email by 4.6×. Aligns with the hypothesis that FD is high-consideration and responds to conversational/personalized channels over passive notification.

**For Bond**: Email shows the highest CVR (75.84%) — **the highest single channel CVR for any product in the report**. The report dismisses this in one sentence as "Bond email recipients are already higher-intent investors in the pipeline." That dismissal is plausible but unverified and closes a question it shouldn't.

Two competing interpretations with opposite strategic implications:

- **(a) Selection-only**: email list is a curated high-intent segment and the 75.84% CVR is tautological — these users were converting anyway.
- **(b) Channel-native**: Bonds carry multi-lakh ticket sizes and require reading content (tenor, rating, coupon structure). Email is a read-first medium; Push/WhatsApp are glance-first. High-consideration purchases may genuinely respond to email more than quick-touch channels.

If (a), email is a vanity metric. If (b), email deserves materially more Bond budget. **The follow-up is a simple segmentation**: split Bond email recipients by prior-intent tenure (new-intent vs repeat-intent). If the 75.84% holds for new-intent users, (b) is supported and email should scale for Bonds.

**For MF**: WhatsApp and Push are essentially tied (~63%); Email underperforms (48.93%). MF is a quick-decision product where the channel matters less than reaching the user in-session. The Email underperformance is consistent with MF's 2-minute half-life — by the time an email is opened, intent has decayed.

### 4.7 In-app nudges — the highest-claimed-lift intervention (with the biggest selection-bias problem)

Nudges delivered within 24 hours of intent:

| Product | With nudge CVR | Without nudge CVR | Lift |
|---|---|---|---|
| **FD** | **30.13%** | 3.51% | **+26.6pp (8.6×)** |
| Bond | 85.76% | 72.44% | +13.3pp (1.2×) |
| MF | 83.77% | 58.60% | +25.2pp (1.4×) |

**Coverage gap**: only 4,033 of 49,304 FD intent users (**8.2%**) saw a nudge. For MF, only 3,143 of 24,613 (**12.8%**). If the lift is real, scaling nudge coverage to the remaining 91.8% of FD intenders is the single highest-leverage ops action available.

**Severe selection-bias caveat**: in-app nudges fire when the user is (a) still in-session, (b) on a specific page, (c) engaged enough for the nudge to render. The "without nudge" group includes dormant users who bounced or never re-entered the relevant page. Comparing "users deep in an active session" to "all intent users including those who left 10 seconds later" is not an apples-to-apples test. The true causal lift is almost certainly 2–4× lower than the reported magnitudes. A proper test requires randomized hold-out on users who *would have* qualified for a nudge (same page, same session depth, same time-of-day) — receiving no nudge despite qualifying.

**Additional methodological flaw — impression/engagement conflation**: the report's in-app nudge definition (Appendix) aggregates five events: `dynamic_nudge_viewed` (impression), `dynamic_nudge_action`, `nudge_card_clicked`, `banner_clicked`, `home_page_single_flat_banner_clicked` (all engagement). **Four of the five are click/engagement-level events; only one is a passive impression.** The "with nudge" group therefore pools "user saw a nudge" with "user clicked a nudge" into a single category.

This means the 30% FD CVR for the "with nudge" cohort is heavily weighted toward users who actively clicked a nudge — which is a tautological signal (users who click things convert more). The actual causal lift of *showing* a nudge (rendered but not clicked) is not isolated in this analysis. If the analysis were re-run splitting impression-only from engagement, the impression-only lift would be materially lower — possibly in the +5–10pp range rather than +26.6pp. The reported "8.6× lift" may be 5–10× inflated for the pure "show a nudge" intervention, not just 2–4× as the prior selection-bias critique suggested.

**Decision rule**: do not scale nudge coverage platform-wide until (1) a randomized hold-out confirms incremental lift after selection bias is removed, and (2) the analysis is re-run splitting impression from engagement. The upside remains probably material (true FD impression-only nudge lift in the 5–15pp range is plausible and worth scaling), but the reported "+26.6pp / 8.6×" should not be the basis for a rollout.

### 4.8 Product-specific ops playbook (as recommended, with caveats)

**FD** (Half-life 29 min, CVR 5.7%):

| Timing | Action | Claimed impact | Status |
|---|---|---|---|
| 0–5 min | In-app nudge if user navigates away from booking page | 30% CVR for nudged users | Needs hold-out test |
| 5–30 min | WhatsApp with FD rate summary + booking link | 17.4% CVR for WhatsApp-touched | Directional — run hold-out |
| 30 min – 24 h | Push notification with urgency ("rates may change") | 8% CVR | Defensible |
| 1–7 days | WhatsApp drip with comparison content | Long-tail capture (17% of converters arrive after 24h) | Directional |
| 7–30 days | Email with rate alert or new FD offer | Low CVR (3.7%) but zero marginal cost | Ship |

**Bond** (Half-life 2 min, CVR 75%, p90 3.4 days):

| Timing | Action | Claimed impact | Status |
|---|---|---|---|
| 0–2 min | In-app nudge if user hesitates on checkout | 86% CVR for nudged users | Needs hold-out test |
| 2–30 min | Push notification (lightweight, session-return) | 74% CVR | Directional |
| 1–24 hours | **Light WhatsApp or Push for deliberation tail** | Captures the ~10% who convert after 3+ days (~3,270 users) | Correction to report — the report says ">1 hour: Low priority", but the Bond p90 of 3.4 days means a meaningful multi-day tail is worth a lightweight CRM touch |
| >48 hours | Kill | Negative lift | Stop |

**MF** (Half-life 2 min, CVR 62%, p90 3.8 hours):

| Timing | Action | Claimed impact | Status |
|---|---|---|---|
| 0–2 min | In-app nudge (83% of converters are in this window) | 84% CVR for nudged users | Needs hold-out test + SIP-exclusion re-run |
| 2–30 min | WhatsApp or Push (similar effectiveness at ~63%) | +10pp lift | Directional |
| 30 min – 4 hours | Light Push only, cap spend | Captures the remaining 8% of converters before p90 cutoff | Defensible |
| **>4 hours** | **Kill — p90 cutoff reached, <10% recovery pool** | Negative lift territory | **Harder stop than the report's ">6 hours" recommendation** |

### 4.9 The contradiction between this report and the repeat-booking report on notifications

This is the single most important analytical tension across the four reports, and neither report addresses it.

- **Report 2 (repeat booking)** rejected H6: push/WhatsApp notifications do **not** drive repeat bookings; they are inversely correlated with repeat (non-repeaters click at 44.4% vs 31.8%; WhatsApp 28.7% vs 17.1%).
- **Report 4 (intent decay)** shows push/WhatsApp within 30 minutes of intent lift first-FD CVR materially (WhatsApp 17.4% vs 5.4% baseline; in-app nudge 30% vs 3.5%).

Both findings can be simultaneously true **if the intent state at the time of the notification matters more than the notification itself**:

- A notification fired *inside* an active intent window (user just viewed `fd_booking_page_viewed`) moves the user toward conversion.
- A notification fired *outside* any active intent window (general engagement ping, re-engagement campaign at day 14) adds noise, generates opt-outs, and does not deepen engagement.

**Operational implication**: every MoEngage campaign should be tagged with whether it fires inside or outside an active intent window. Pruning out-of-window campaigns likely cuts 60–80% of notification volume with zero AUM impact — and possibly an AUM *improvement* from reduced opt-out and fatigue effects. This reframes the "notifications are value-destroying" finding from Report 2: it's *out-of-window* notifications that are the problem, not notifications as a category.

### 4.10 The Credit Card instrumentation gap — a product-line-wide blind spot

`credit_score_check_status` and related CC intent events **do not exist in Mixpanel**. This is not a minor gap. Combined with the archetype report, the scale becomes clear:

- Report 3 found CC-Focused Browsers are 16.7% of the top 50K active sample — **8,335 users just in the active elite**.
- Scaled naïvely to the full 5.9M user universe, that's potentially **~1 million users with CC affinity**, all currently operating in an unmeasured intent funnel.
- The CC product is the most active cross-sell wedge on the platform — Suryoday cards require an FD collateral, so every CC issuance is also an FD booking. The product-line is therefore the single highest-leverage bridge between card-curious users and investment AUM.

Report 3 also confirmed that CC-Focused users have artificially inflated "has invested" rates because CC issuance requires mandatory FD collateral — making *incremental* investment by this cohort structurally invisible. Without CC intent instrumentation, Stable Money cannot measure:

- CC-to-FD conversion beyond mandatory collateral (the real cross-sell question).
- CC-to-investment cross-sell effectiveness for bonds, MFs, gold.
- CC intent decay curves (no basis for a CC-specific CRM cadence).
- Which CC-Curious archetype users flip to Bond Power Users or FD Specialists over time.
- Whether CC users who default on or close their card also churn from the investment side.

Instrumenting `credit_score_check_*`, `cc_dashboard_viewed`, `cc_apply_clicked`, and `suryoday_cc_issued`-upstream intent events should be part of the same instrumentation sprint that adds `tenor_months`, fixes NULL failure_reason, and propagates device metadata. Of all the instrumentation gaps surfaced across the four reports, this is the one with the largest addressable-user scale.

### 4.11 Right-censoring caveat — understated by the report

The report says *"slightly underestimates"*. It's more than slight. FD's p90 is 13 days, so:

- Intent fired April 10 → 13 days observable before cutoff → no meaningful censoring.
- Intent fired April 15 → 8 days observable → the p90 tail is truncated.
- Intent fired April 20 → 3 days observable → severe truncation of deliberation-tail cohort.

**Approximately 20% of the intent population fired intent in the last 2–3 weeks of the window** and is right-censored to varying degrees for the FD long tail. The 94.7% "within 30d" FD CVR is probably closer to 96–97% with fully uncensored observation. The 4-week-tail behavior of multi-day FD deliberators is under-observed, which matters because that cohort is exactly the one the deliberation-nurture track needs to be designed around.

The effect is small for Bond/MF (almost all converters are in-session, 30-day censoring irrelevant) but material for FD's deliberation-tail analysis.

### 4.12 The re-ranking the report itself should have done

The report's ranked recommendations lead with "scaling nudge coverage." Given the selection-bias problem, the right ranking is:

| Priority | Action | Why |
|---|---|---|
| P0 | Kill late-window (>6h) Bond and MF campaigns | Negative lift finding; saves spend immediately |
| P0 | Build intent-state-aware MoEngage routing | Resolves the notification contradiction between Reports 2 and 4; 60–80% volume cut likely |
| P0 | Run a proper in-app nudge hold-out for FD | Budget-critical; answer determines whether nudge scaling is ROI-positive |
| P1 | Ship the FD deliberation-friendly nurture track | Captures the 63% of FD converters who take >1 day; currently underserved |
| P1 | Instrument CC intent events | Unlocks the 4th product line for all subsequent analysis |
| P1 | Re-run MF analysis excluding users with active SIPs | Current MF cadence is calibrated to inflated denominator |
| P2 | Expand WhatsApp campaigns for in-window FD intent | Modest lift, defensible, near-term AUM positive |
| P2 | Scale in-app nudge coverage — only after P0 hold-out confirms lift | Upside remains; gate on evidence |

### 4.13 Missing follow-up analyses — three cross-report bridges the report should have proposed

The §8 "Suggested Further Analyses" list covers holdout design, amount-weighted analysis, repeat-intent counting, day-of-week, and credit score tracking. It is missing three of the most valuable cross-report analyses, and it frames the two it does mention (amount-weighted, repeat intent) too shallowly:

**(a) Cross-product intent transitions.** A user fires FD intent but doesn't convert — do they fire Bond or MF intent within 30 days? At what rate? This answers whether the 46,500 non-converting FD intenders are platform-leavers or cross-product wanderers. Combined with the archetype report's finding that 54.6% of Window Shoppers browse bonds heavily, this transition data would isolate cross-sell opportunity from actual churn and let the team design a product-switching funnel rather than a product-specific retention funnel.

**(b) Amount-weighted CVR — bridges Reports 2 and 4.** The report vaguely suggests this but doesn't frame the existing Report 2 connection. Report 2 found repeat rates follow an inverted-U across first-FD amount deciles (peak at D8 ₹95K–1L, trough at D1/D2 and D10). If *intent-to-conversion* CVR follows a similar or inverted curve, the 5.7% average FD CVR hides large variance:

- Sub-₹10K intenders may convert at 8%+ (small, impulsive, low deliberation).
- Deciles 7–8 (₹50K–1L) may convert at 3–4% (real buyers, longer deliberation, higher drop-off risk).
- >₹2L intenders may convert at 2% (lump-sum deployers who need heavy comparison).

If the amount-by-CVR curve inverts the amount-by-repeat curve, the CRM strategy should target **different intervention windows per amount range**, not just per product. A 0–5 min urgency nudge that works for sub-₹10K FDs is counterproductive for ₹1L+ FDs (those users need time to compare, not urgency). The right playbook is a 3D grid: product × amount band × time window.

**(c) Intent-touch count threshold — bridges Reports 2 and 4.** Report 2 found `SM_PLAN_DETAILS_CHANGED` at 88.6% penetration in repeaters vs 28.6% in non-repeaters (3.1× ratio) — users who change FD parameters are in an active decision state. Report 4 does not count how many times a user fires `fd_booking_page_viewed` before converting. If converted users average 5 intent touches and non-converted users average 2, then intent-touch count is a threshold signal: trigger CRM at the 3rd intent fire, not the 1st. This is the most operationally concrete cross-report analysis available and neither report runs it.

### 4.14 Sequencing correction — the ops playbook should lead with "stop," not "scale"

The report's recommendations are ordered incorrectly. The scaling-positive recommendations ("scale nudge coverage is the highest-leverage ops action") lead; the stop-spending recommendations are buried in the playbook tables as last rows; the hold-out experiments are pushed into "further deep-dives."

The correct sequence, ranked by certainty of signal and ease of implementation:

1. **Stop** — kill late-window Bond (>48h) and MF (>4h) CRM. Negative-lift signals are unambiguous, removing spend is zero engineering effort, and the savings are immediate.
2. **Measure** — run randomized holdouts for (a) in-app FD nudge, (b) 30-min MoEngage, (c) intent-state-aware WhatsApp routing. 10% control on each. This converts every "+10pp / +26pp / 8.6× lift" number in the report from observational to causal.
3. **Split** — re-run the in-app nudge analysis with impression vs engagement separated. The true "show a nudge" causal lift is probably materially lower than the pooled number.
4. **Scale** — only after measure + split confirms incremental lift survives selection-bias correction. Scale nudge coverage for products and time windows where lift is validated.

This sequencing is ROI-positive within a quarter. The report's sequencing (scale first, measure later) risks over-investing in channels whose true causal contribution is a fraction of the reported lift.

### 4.15 Report-generation quality note

Pages 2 and 4 of the PDF include "Failed to load chart / Failed to fetch chart data / Retry" blocks — two charts did not render at export time. This is an Actioneer report-generator bug, not a data-quality issue, but it does reduce the visual interpretability of the funnel overview and half-life sections. Worth fixing in the export pipeline.

### 4.16 Five actionable items from this report

1. **Kill late-window Bond (>48h) and MF (>4h) CRM spend immediately.** Negative lift past the p90 cutoffs is a clean stop signal — the MF cutoff should be 4 hours, not 6, and Bond should be 48 hours with a lightweight touch until then, not 1 hour of hard stop.
2. **Build an intent-state-aware MoEngage targeting rule.** Every campaign tagged as in-window or out-of-window; out-of-window campaigns capped or cut. Reconciles the Report 2 / Report 4 notification contradiction.
3. **Run a randomized in-app nudge hold-out for FD, split by impression vs engagement.** Answers whether the 8.6× lift is real or 5–10× selection-biased. Budget-critical.
4. **Ship the FD multi-week nurture track plus the "Saved FD" / shortlist feature.** The 27% multi-day deliberator cohort is currently forced to re-search every time — shortlist feature alone could materially improve tail conversion.
5. **Instrument Credit Card intent events + re-run MF cadence on a SIP-excluded denominator.** Two instrumentation tickets that unlock the next round of analysis.

---

## Cross-Report Strategic Integration

Reading the four reports together, the strategic picture is more coherent than any single report suggests.

### The four distinct problems

1. **Acquisition-to-activation leakage** (from Report 1). 10,807 Digilocker silent drop-offs + NULL failure reasons + missing device/city metadata = a fixable instrumentation-and-intervention bundle. Scope: engineering + ops. Estimated recoverable: ~₹70 Cr/quarter of at-risk volume.

2. **First-FD to repeat-FD engine** (from Report 2). 49.5% 180-day repeat is category-leading. Home-screen surfaces correlate strongly with repeat; notifications inversely correlate **outside active intent windows**. Scope: experimentation-heavy. Estimated unlock: 3–8pp repeat-rate improvement + multi-crore/year notification-budget reallocation.

3. **Cross-product expansion** (from Report 3). Six archetypes with minimal overlap — cross-sell is harder than it looks. Each intervention is a specific bet that needs A/B validation. Scope: product + growth, multi-quarter. Estimated unlock: 1M+ Window Shoppers addressable.

4. **Intent-to-conversion cadence** (from Report 4). Three different products with three different half-lives (FD ~29 min / 13-day p90; Bond ~2 min / 3.4-day p90; MF ~2 min / 3.8-hour p90). One CRM cadence cannot serve all three. Scope: CRM + product. Estimated unlock: FD CVR lift from 5.7% toward 10%+ with product-aware cadence + intent-state targeting.

### The two integrative findings

**Finding A — Stable Money's real growth engine is rate-shopping users booking FDs at Small Finance Banks.**

- The KYC paths serve them (VKYC-at-booking is dominant volume).
- The Q1 2025 cohort confirms they repeat (SFBs beat IndusInd by 9.8pp, p < 0.001).
- The archetype work confirms FD Specialists and Bond Power Users are the AUM spine; IndusInd users don't repeat because they came to Stable Money for SFB rates.
- The intent-decay work confirms FD is a deliberation product with a 13-day p90 tail — consistent with rate-shoppers comparing across banks and returning.

The strategic question is therefore not "how do we become a multi-product wealth platform" but **"are we the best-possible SFB fixed-income marketplace in India, and what does winning that category completely look like?"** Every subsequent product decision — expanding banks, adding products, changing acquisition mix — should be evaluated against that reframed question.

**Finding B — Notifications are not categorically good or bad; intent state at the moment of notification determines value.**

The apparent contradiction between Report 2 (notifications inversely correlated with repeat) and Report 4 (notifications lift first-intent conversion) resolves if intent state matters more than the notification itself:

- In-window notifications (fired within the user's active intent decision window, per product half-life) move users toward conversion.
- Out-of-window notifications (fired as general engagement or re-activation pings outside any intent window) add noise, drive opt-outs, and do not deepen engagement.

This single reframing unlocks the largest single budget reallocation opportunity in the data: an intent-state-aware MoEngage routing layer would likely cut notification volume 60–80% with zero AUM impact, while simultaneously improving the signal-to-noise ratio for notifications that do fire.

### The six moves that span all four reports

Ranked by a rough ROI × effort ratio:

1. **Instrument the data gaps — one coordinated sprint.** `tenor_months` on `SM_TD_BOOKED` (Report 2). `os`/`city`/`app_version` on server-side KYC success events (Report 1). `failure_reason`/`error` on `digilocker_failure` (Report 1). `session_id` consistency (Report 3). City-tier lookup table (Report 1). Credit card intent events — `credit_score_check_*`, `cc_dashboard_viewed`, `cc_apply_clicked` (Report 4). Unlocks every subsequent analysis across all four reports.

2. **Build intent-state-aware MoEngage routing + run the notification withholding A/B.** Combines the Report 2 finding and the Report 4 finding. Every campaign tagged in-window or out-of-window; 10% hold-out to measure true incremental lift. Likely saves multi-crore/year with no AUM impact — potentially AUM-positive from reduced fatigue.

3. **Kill late-window (>6h) Bond and MF CRM spend immediately.** Report 4 found negative lift past 6 hours — an unambiguous stop signal that does not need further validation.

4. **Ship the Window Shopper frictionless micro-investment entry.** 3,903 in sample, likely 1M+ in full universe. Compliance-validated (true zero-KYC is regulatorily impossible; frictionless-KYC is the right scope). Highest revenue-unlock lever in the data.

5. **Build the 48-hour Digilocker post-KYC nudge + FD multi-week nurture track in parallel.** The 48h Digilocker window captures 79.3% of 30-day FD bookings (Report 1). The FD 13-day p90 tail (Report 4) demands a separate deliberation-friendly nurture track (rate alerts, 1/3/7-day drips, "Saved FD" feature). Together these cover both the pre-qualification funnel and the in-flow funnel.

6. **Kill the red-flag affiliate channels.** gromo_int, promotionbazaar_int, digitalads_int. ~500 users at <10% repeat. Evidence-backed CFO-facing UA cut.

### What the data does not yet let us answer

- **Tenor effects on retention.** Blocked by missing `tenor_months`.
- **True LTV.** All current "LTV" numbers are 90–180 day FD-volume proxies. Need a cohort with 12+ months of tenure and a clear definition of reinvestment-vs-net-new-capital.
- **Same-bank vs cross-bank repeat behavior.** Do users stay with their first partner bank or diversify? Implications for partner bank strategy.
- **Causal effect of home-screen FD surfaces, in-app nudges, and MoEngage campaigns.** Every lift observed across all four reports is observational. Real causal effects are upper bounds on reported lifts — selection bias is especially severe for in-app nudges (Report 4) where the "+26.6pp / 8.6×" FD nudge lift is likely 2–4× inflated.
- **Full-universe archetype distribution.** Current segmentation is on top 0.85% of users.
- **Archetype transition dynamics.** Which archetype a user came from, and what triggered movement.
- **Cross-product intent transitions.** Do non-converting FD intenders fire Bond or MF intent later? Bridges Reports 3 and 4 and isolates cross-product wanderers from true churn.
- **True first-time MF conversion behavior.** Current MF metrics are inflated by SIP auto-debits. Needs re-run on a denominator excluding users with active SIPs.
- **Credit Card intent funnel.** Completely untracked (no `credit_score_check_status` event).
- **Multi-touch ad attribution across Google Ads, Facebook Ads, and Mixpanel.** The reports don't integrate the three ad platforms.

---

## Data Methodology References

| Report | Source | Period | Key dimensions |
|---|---|---|---|
| KYC Path Comparison | `stable_money_analytics.mixpanel_events` (Athena 468) | Jan 23 – Apr 23, 2026 (90 days) | `digilocker_initiated`, `SM_DIGILOCKER_SUCCESS`, `SM_VKYC_*`, `SM_TD_BOOKED` |
| FD Repeat Booking | `stable_money_analytics.mixpanel_events` + `moengage_campaign_events` (Athena 468) | Jan 1 – Sep 30, 2025 (Q1 cohort, 180-day observation) | `SM_TD_BOOKED`, `install`, `media_source`, `fd_identifier` |
| Behavioral Archetypes | `mixpanel_events` (Athena 468) | Oct 25, 2025 – Apr 18, 2026 (176 days) | All product-area events, `session_id` (inconsistent), `extra_properties` AUM |
| Intent Decay & Intervention | `mixpanel_events` + `moengage_campaign_events` (Athena 468) | Jan 23 – Apr 23, 2026 (90 days) | `fd_booking_page_viewed`, `bond_buy_now_clicked`, `mf_buy_checkout_page_loaded`, payment-success events, MoEngage campaign touches, `dynamic_nudge_*` / `nudge_card_clicked` / `banner_clicked` |

Event substitutions applied in Report 4: `fd_booking_cta_clicked` → `fd_booking_page_viewed`; `bond_checkout_page_viewed` → `bond_buy_now_clicked`; `credit_score_check_status` → not available.

All monetary values in ₹. 1 Cr = ₹1,00,00,000 ≈ USD 120K. Lakh (L) = ₹1,00,000.
