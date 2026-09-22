# Funnel Analysis Research

> Research compiled 2026-04-06. Covers computation models, industry benchmarks (Amplitude/Mixpanel), gap analysis against Baby Sentinel's current implementation, and prioritized scope for building standalone funnel feature.

---

## What Funnel Analysis Is

A funnel models **intent decay** through sequential user behavior. A user who fires Step 1 has expressed intent. Each subsequent step measures how much of that intent the product successfully converts into action. The funnel measures a product's ability to carry intent through to completion.

The chart isn't the product — the decisions it enables are:

1. **"Where are we losing people?"** → Identify the worst drop-off step
2. **"Who converts better?"** → Break down by property, compare segments
3. **"Is it getting better or worse?"** → Conversion rate over time
4. **"Who dropped off and how do I get them back?"** → User list → segment → action

---

## Core Computation Model (Industry Standard)

### Conversion Window

- Starts on the **first instance of Step 1** and **never resets**
- Subsequent Step 1 events do NOT restart the timer
- Users must complete ALL remaining steps within the window from their first Step 1
- Non-resetting window is the honest measurement — prevents inflation from repeated attempts
- Mixpanel default: 7 days, max 366 days. Amplitude default: 1 day, max 366 days.

**Example edge case:** User fires A(1:00pm) → A(1:30pm) → B(1:45pm) → C(2:15pm) with 1-hour window on A→B→C. User converts through B but times out before C since C occurs >1 hour after the first A at 1:00pm.

### Ordering Modes

| Mode | Computation | Question It Answers |
|------|------------|---------------------|
| **This Order** (sequential, flexible) | Steps must occur in sequence, but other events can happen between them | "Does our happy path work?" |
| **Any Order** | All steps completed within window, any sequence | "Are users doing everything they need to?" |
| **Exact Order** | Steps must occur consecutively with NO intervening events | "Are users on rails, or wandering?" |

**Key rule:** In ordered funnels, events are unique per conversion path. A user triggering Step 1 four times before Step 2 counts as ONE conversion, not four.

### Counting Methods

| Method | Unit | Re-entry Behavior | Best For |
|--------|------|-------------------|----------|
| **Uniques** | Users | One entry per user, ever | "What % of our users convert?" (PM question) |
| **Totals** | Attempts | Re-enter after conversion, timeout, or exclusion | "How many transactions complete?" (Growth question) |
| **Sessions** | Sessions | One entry per session | "What % of sessions convert?" (UX question) |

### Re-entry Mechanics

**Default mode:** Only the first funnel attempt is evaluated. Subsequent entries within an active conversion window are ignored.

**Optimized Re-entry (Mixpanel):** Evaluates all funnel entry attempts, even if a previous attempt is still in progress. For the first step, if there are multiple entries prior to step 2, considers the most recent entry. For subsequent steps, picks the first instance. Conversions attributed to whichever attempt actually converts.

### Hold Property Constant

Changes the unit of analysis from "user" to "user × property value."

- User must retain identical property value across ALL funnel steps to count as converted
- Example: Hold `product_id` constant → user who views Product A, adds Product A, buys Product A = one conversion. Viewing Product A but buying Product B ≠ conversion for Product A's funnel.
- If one user converts with 10 different product IDs, that's 10 conversions
- Mixpanel: up to 3 simultaneous properties
- **Killer use case: session-level funnels** — hold `session_id` constant to measure per-session conversion

### Exclusion Events

- Placed BETWEEN two steps (never first or last)
- If user fires the exclusion event between Step N and Step N+1, they drop off that attempt
- Can re-enter the funnel on next Step 1 (in Totals/Sessions mode)
- Scope: apply between all steps or specific step pairs
- Mixpanel has a two-second grace period for near-simultaneous events

**Example:** Funnel A→B with exclusion of A between steps:
- User fires A(1) → A(2) → A(3) → B
- Entry 1: A(1) → exclusion hit at A(2) → dropped
- Entry 2 (re-entry): A(3) → B → converted
- Result in Totals mode: 2 entries, 1 conversion

### Attribution Models (Mixpanel)

When breaking down funnels by a property, determines which step's value represents the funnel:

| Model | Rule | Use Case |
|-------|------|----------|
| **First Step Defined** | Forward-fill from earliest non-null value | "What brought them in?" (acquisition) |
| **Last Step Defined** | Back-fill from latest non-null value | "What closed the deal?" (conversion driver) |
| **Per-Step** | Value from a specific step number | "What was true at this exact moment?" |

### Inline vs Global Filters

**Inline filters** (per-step): Remove events that don't match. "Step 2 where amount > 50" means only events with amount > 50 qualify as Step 2. Other Step 2 events are invisible to the computation.

**Global filters** (post-computation): Remove entire funnel entries that don't match. "Only include funnel entries where the user's plan = premium" excludes users, not events.

Confusing them leads to wrong numbers. Both are needed for precision.

### Statistical Significance (Mixpanel)

- P-value computed for each breakdown segment comparing segment conversion to overall rate
- Confidence level = 1 − p-value
- \>0.95 confidence = statistically significant (likely non-random)
- <0.95 confidence = not significant (likely random variation)
- <30 samples = insufficient data; p-value suppressed

---

## Five Analytical Lenses Professionals Use

### 1. Snapshot — "What does conversion look like right now?"
Standard funnel bars. The baseline. Dashboards and status checks.

### 2. Trend — "Is it getting better or worse?"
Conversion rate over time, bucketed by **entry date** (not completion date). User enters Jan 1, converts Jan 5 → counted in Jan 1 bucket. Prevents completion-date clustering from masking problems.

### 3. Breakdown — "Who converts better?"
Split by property (device, country, plan, source). Where "aha" moments live. Needs statistical significance to be trustworthy.

### 4. Time — "How long does it take?"
Median/average/distribution of time between steps. 30% conversion in 2 minutes ≠ 30% in 2 weeks. Former = UX friction. Latter = trust/consideration issue. Average hides bimodal distributions — full histogram needed.

### 5. Frequency — "What happens between steps?"
How many times users repeat events between steps. 15 product views before add-to-cart = comparison shopping. 1 view = decisive. Same conversion, different behavior.

---

## What Baby Sentinel Currently Has

### Implemented (in explorer funnel tab)

- **SQL compiler** (`src/lib/funnel-sql.ts`) — robust, ~400 lines
  - Three ordering modes (this_order, any_order, exact_order)
  - Conversion window (1h, 1d, 7d, 30d, 90d)
  - Per-step property filters (9 operators: eq, neq, gt, lt, gte, lte, contains, in, not_in)
  - Breakdown by one property
  - Segment comparison (multiple segments, separate funnel per segment)
  - Step-by-step conversion rates, drop-off rates
  - Average time between steps
  - String escaping and identifier quoting
  - Date range resolution with preset support

- **API route** (`/api/explorer/funnel`) — auth + dataset validation, segment comparison support
- **Hook** (`useFunnel`) — debounced 300ms API calls, step CRUD, config management
- **Config panel** (`funnel-config-panel.tsx`) — step builder with inline filters, ordering mode buttons, conversion window buttons, breakdown picker, segment builder
- **Chart** (`funnel-chart.tsx`) — horizontal bars, conversion table, segment comparison, SQL preview, save-to-board
- **Types** (`funnel-types.ts`) — FunnelConfig, FunnelStep, FunnelResult, FunnelSegmentResult

### Not Implemented

| Capability | Impact | Notes |
|---|---|---|
| **Persistence (save/list/manage)** | Critical | Lost on refresh. No SQLite table, no repo, no API CRUD |
| **Conversion over time trend** | Critical | Can't monitor funnels day-to-day |
| **User drill-down per step** | Critical | Can't see who dropped off — blocks the action loop |
| **Create segment from step** | Critical | The Actioneer value prop — insight → action |
| **Totals counting (re-entry)** | High | Growth teams need transaction-level analysis |
| **Hold property constant** | High | Unlocks session-level and item-level funnels |
| **Time to convert distribution** | Medium | We show avg only; need histogram |
| **Exclusion events** | Medium | "Did A but NOT B" is common analytical pattern |
| **Attribution models** | Medium | Matters for marketing attribution breakdowns |
| **Statistical significance** | Medium | Analysts can't trust breakdowns without it |
| **Frequency between steps** | Medium | Behavioral profiling |
| **Inline vs Global filters** | Medium | We have inline only |
| **Revenue/Property Sum** | Medium | Revenue through funnel |
| **Optional steps (Amplitude)** | Low | Nice to have |
| **Comparison events at one step** | Low | Mixpanel-specific |

---

## Gap Analysis by Persona

### Product Manager

PMs check funnels weekly to monitor feature health and measure release impact.

| Need | Have It? | Gap |
|---|---|---|
| Save and revisit funnels | No | Can't build a habit if the funnel disappears |
| Conversion over time trend | No | "Did last week's release help?" — unanswerable |
| Time to convert | Partial (avg only) | Need median + distribution |
| Breakdown with confidence | No significance | Can't tell if iOS vs Android difference is real |
| One-click segment from drop-off | No | "Retarget cart abandoners" is the PM's action |

**PM verdict:** Can show a funnel shape, but can't monitor it, trust breakdowns, or act on findings.

### Growth Team

Growth lives in funnels — experiments, optimization, re-engagement.

| Need | Have It? | Gap |
|---|---|---|
| Totals counting | No | "How many checkouts today?" not "how many users" |
| Hold property constant (sessions) | No | "What % of sessions convert?" — core growth metric |
| Attribution (which campaign?) | No | "Google vs Facebook conversion?" |
| Exclusion events | No | "Added to cart but did NOT use coupon" |
| Conversion over time | No | "Is this A/B test moving the needle?" |
| User list → segment → push | No | The re-engagement loop |
| Revenue through funnel | No | "How much revenue dropped at checkout?" |

**Growth verdict:** Missing most of what they need. Would bounce after 10 minutes.

### Data Analyst

Analysts need precision, flexibility, rigor.

| Need | Have It? | Gap |
|---|---|---|
| Hold property constant | No | Primary tool for controlling variables |
| Statistical significance | No | Without this, breakdowns are anecdotes |
| Inline vs Global filters | No | Wrong filter type = wrong numbers |
| Frequency between steps | No | Behavioral profiling |
| Time to convert distribution | No (avg only) | Average hides bimodal distributions |
| Attribution models | No | Same funnel, different attribution = different story |
| Re-entry modes | No | Need first-attempt AND all-attempt analysis |

**Analyst verdict:** Has ordering modes and basic filters, but lacks precision tools. Would call it "a prototype."

---

## Overall Coverage Score

| Area | Coverage | Notes |
|---|---|---|
| Core computation | ~60% | Ordering modes and basic windows solid. Missing re-entry, counting methods. |
| Analytical depth | ~25% | One breakdown, no hold-constant, no significance, no attribution, no exclusions. |
| Visualization | ~40% | Snapshot bars work. Missing trend, distribution, frequency. |
| Actionability | ~0% | No user drill-down, no segment creation from steps, no push. |
| Persistence | ~0% | Nothing saves. |

**Overall: ~25% of Mixpanel/Amplitude.**

---

## Prioritized Build Scope

### Tier 0 — Table Stakes (without these it's not a feature)
- Save/list/manage funnels (SQLite persistence, CRUD API, list + detail pages)
- Sidebar nav group (top 5 + "See all...")
- Conversion over time trend (line chart by entry date)
- User drill-down per step → Create Segment action

### Tier 1 — Credible for PMs and Growth
- Totals counting alongside Uniques
- Hold property constant (enable session-level analysis)
- Time to convert distribution (histogram, not just average)
- Drop-off indicators between steps (count + %)
- Feature flag integration

### Tier 2 — Credible for Analysts
- Exclusion events
- Statistical significance on breakdowns
- Attribution models for breakdowns (First Step, Last Step, Per-Step)
- Frequency analysis between steps
- Inline vs Global filter distinction

### Tier 3 — Differentiation (things Amplitude/Mixpanel DON'T have)
- Auto-generated starter funnels from dataset schema (LLM-powered)
- Chat-native funnel creation ("show me the signup funnel")
- Direct push-to-engagement from funnel drop-off (insight → action in one click)
- Funnel confirm card in chat (like segment-confirm-card)

### Recommended Demo Scope: Tier 0 + Tier 3
Gets basics working AND shows capabilities competitors lack. Tier 1 and 2 are what make it real for actual users post-sale.

---

## Existing Files Reference

| File | What It Does |
|---|---|
| `src/lib/funnel-sql.ts` | SQL compiler — ordering, windows, filters, breakdowns |
| `src/lib/funnel-types.ts` | FunnelConfig, FunnelStep, FunnelResult types |
| `src/hooks/use-funnel.ts` | React hook — debounced API, step CRUD |
| `src/app/api/explorer/funnel/route.ts` | API — execute funnel, segment comparison |
| `src/components/explorer/funnel-config-panel.tsx` | Step builder UI |
| `src/components/explorer/funnel-chart.tsx` | Funnel bars + table visualization |

### Files That Need to Be Created (Tier 0)

| File | Purpose |
|---|---|
| `src/lib/meta-db.ts` (extend) | Add `funnels` SQLite table |
| `src/lib/server/funnel-repo.ts` | CRUD repository |
| `src/app/api/funnels/route.ts` | GET/POST list |
| `src/app/api/funnels/[id]/route.ts` | GET/PATCH/DELETE single |
| `src/app/funnels/page.tsx` | List page |
| `src/app/funnels/[id]/page.tsx` | Detail workspace |
| `src/components/funnels/funnel-workspace.tsx` | Multi-tab detail view |
| `src/components/funnels/create-funnel-modal.tsx` | Creation flow |
| `src/components/sidebar.tsx` (extend) | Sidebar nav group |

---

## Sources

- [Amplitude: How Amplitude Computes Funnels](https://amplitude.com/docs/analytics/charts/funnel-analysis/funnel-analysis-how-amplitude-computes)
- [Amplitude: Build a Funnel](https://amplitude.com/docs/analytics/charts/funnel-analysis/funnel-analysis-build)
- [Amplitude: Interpret Funnels](https://amplitude.com/docs/analytics/charts/funnel-analysis/funnel-analysis-interpret)
- [Amplitude: Hold Properties Constant](https://amplitude.com/docs/analytics/charts/funnel-analysis/funnel-analysis-hold-properties-constant)
- [Amplitude: Get the Most from Funnels](https://amplitude.com/docs/analytics/charts/funnel-analysis/funnel-analysis-get-the-most)
- [Mixpanel: Funnels Advanced](https://docs.mixpanel.com/docs/reports/funnels/funnels-advanced)
- [Mixpanel: Funnels Overview](https://docs.mixpanel.com/docs/reports/funnels)
