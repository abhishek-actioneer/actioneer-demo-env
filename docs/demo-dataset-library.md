# Demo Dataset Library — strategy & build backlog

_Last updated: 2026-06-17_

This is the reminder doc for the per-industry demo dataset library. Read this
before adding or renaming demo datasets so we stay aligned with the website's
go-to-market categories.

## Strategy (decided)

- Demo data is **per-industry**, not per-client. A library of deep, hardened
  datasets, each mapped to a category on the Actioneer website.
- **No per-client bespoke data** for now. If we ever want the "this is literally
  *us*" pop, add a *light skin* later (company name + currency + scale on top of
  an industry dataset) — without building a heavy research/slot engine.
- **Reliability is a feature.** Before a dataset is demo-ready it must pass a QA
  loop: run a battery of real queries + playbooks, fix whatever breaks in the
  events. A demo that errors live disqualifies us with high-stakes clients.
- **The platform does not generate data.** Generation stays a Claude-Code craft
  (business inputs + website crawl + event instrumentation + seasonality). The
  platform only labels, validates, provisions, and delivers.

## The 4 website categories → datasets

| Category | Sub-vertical datasets | Status |
| --- | --- | --- |
| **Banking & Lending** (NBFCs, Banks, Fintech Lenders) | Lending (anchor) · Retail Banking | Lending ✅ (`vastu-hfc`) · Retail Banking ❌ TODO |
| **Wealth & AMC** (Wealth Platforms, Asset Managers) | Wealth (anchor) · Asset Manager / AMC | Wealth ✅ (`fundsindia`) · AMC ❌ TODO |
| **Insurance** (Life, General & Health Insurers) | Life · Health · General | ❌ **whole category TODO** |
| **Consumer Apps & Gaming** (Apps, Games, Subscriptions) | Gaming (anchor) · Subscription App | Gaming ✅ (`gameramp`) · Subscription App ❌ TODO |

## Current state (what shipped 2026-06-17)

Renamed the 3 existing datasets' **display labels** to their category names and
set the onboarding picker to exactly these 3:

| Dataset id | Old label | New label (category) |
| --- | --- | --- |
| `vastu-hfc` | Housing Finance | **Banking & Lending** |
| `fundsindia` | Mutual Fund Platform | **Wealth & AMC** |
| `gameramp` | Presto | **Consumer Apps & Gaming** |

Onboarding (`DEFAULT_SAMPLE_DATASETS` + the cards in
`src/app/onboarding/complete/page.tsx`) now shows only these 3, in website order.

## Build backlog (don't lose these)

Priority order by coverage gap:

1. **Insurance** — the only category with ZERO coverage. Highest marginal value;
   a prospect in Insurance currently has nothing to demo. Build Life + Health
   first, General later.
2. **Retail Banking** — sibling to Lending; deepens Banking & Lending.
3. **Asset Manager (AMC)** — sibling to Wealth; deepens Wealth & AMC.
4. **Subscription App** — sibling to Gaming; deepens Consumer Apps & Gaming.

Each new dataset = a real build-and-harden effort (generator + QA loop). Build in
order of live pipeline, not all at once.

## Open follow-ups (not done yet, decide later)

- **`companyName` still specific.** Each config keeps its fictional company
  persona (`gameramp` → "Presto", `vastu-hfc` → "Vastu Housing Finance"). Only
  the picker/switcher `label` was genericized to the category. Decide later
  whether to genericize the in-data persona too (affects how the AI narrates).
- **`healthians` + `quickhelp` parked.** Off-strategy (diagnostics, home
  services). Removed from the onboarding picker but kept in the static registry —
  still reachable via the app switcher. Drop entirely or keep as bonus later.
- **Light per-client skin** — deferred. Foundation supports adding it later.
- **Internal-ID rename — DEFERRED (2026-06-18).** Renaming the code IDs
  (`vastu-hfc`→`banking-lending`, `gameramp`→`consumer-apps-gaming`,
  `fundsindia`→`wealth-amc`) was considered and deferred. It spans ~50 files: the
  IDs are string-keyed across the synthetic-data engine (`PLANS` record),
  hardcoded `datasetId === "..."` checks (synthetic tick, voice, lifecycle),
  sample-workspace setup, and import paths/filenames. tsc cannot verify the
  runtime keys, so a miss breaks a feature silently. Zero user-facing benefit
  (labels are already industry-named). If ever done, do it as a dedicated, tested
  refactor — not mid-feature-work.

## Dataset audit (2026-06-17)

Read-only static audit of the 3 active datasets (config vs. what the generators
actually produce). Verdicts:

- **fundsindia (Wealth & AMC)** — demo-ready. No broken references.
- **vastu-hfc (Banking & Lending)** — demo-ready. No broken references.
- **gameramp (Consumer Apps & Gaming)** — had 2 real issues:
  1. ✅ FIXED: event property referenced `ad_network`, but the generator writes
     `ad_platform`. Corrected in `gameramp.ts`.
  2. ⚠️ TODO (tied to rebuilding gameramp data): `roas_by_cohort` join in
     `scripts/setup-gameramp.ts:267` is missing `AND c.os = l.platform`, which the
     config's own `summaryTableSQL` (`gameramp.ts:442`) includes. The setup-script
     copy fans iOS/Android spend across both platforms and distorts CPI/ROAS — the
     numbers behind the flagship "double UA spend?" story. The config version is
     correct; de-dupe so they can't diverge. Confirm which builder the deploy runs.
  3. Note: `month` columns are DATE in some summary tables and VARCHAR `'YYYY-MM'`
     in others — a `WHERE month = '2026-01'` can silently return zero rows.

### Missing events worth adding (story enhancers, not breakages)

- **gameramp**: `tutorial_complete`/`first_session` (D1 funnel), `level_complete`
  as a discrete event, `in_app_purchase` (no IAP revenue event today).
- **vastu-hfc**: NACH-return as a first-class event, loan
  restructuring/moratorium/EMI-holiday events.
- **fundsindia**: `sip_payment_failed`/`sip_bounce`, `sip_paused`/`sip_resumed`,
  `goal_status_changed`, STP/SWP creation events.

## Event-catalog enrichment (2026-06-18)

Made all 3 active datasets' `events` catalogs exhaustive over the data their
generators **actually produce** (validated column-by-column against the
generator + setup scripts — nothing added that the data doesn't back). Each
dataset got a dedicated Vitest (`tests/unit/events-<ds>.test.ts`) asserting every
event's table / dateColumn / valueColumn / property column / filter value exists
in the real produced schema. Full unit suite: 960 tests green; tsc clean.

| Dataset | Events before → after | Notable additions |
| --- | --- | --- |
| **gameramp** (Consumer Apps & Gaming) | 3 → 8 | Surfaced the 2 previously-unexposed backed tables (`revenue`→`cohort_revenue`, `campaign`→`campaign_spend`, both `funnelEligible:false` daily rollups), plus `high_engagement_install`, `settled_ad_revenue`; enriched all 3 originals with real dimensions. |
| **vastu-hfc** (Banking & Lending) | 23 → 39 | Origination/product events (micro-housing, vehicle, MSME, co-lending, NTC), repayment modes (NACH/UPI, partial), asset-quality (SMA-0, stage-2), and the 2 **missing** collection actions `sms_reminder` + `demand_notice`. |
| **fundsindia** (Wealth & AMC) | 210 → 211 | Added `sip_completed` (the third terminal SIP status, previously uncovered). Catalog was already deep (many events are `.map()`-generated). |

### Bugs fixed during enrichment (schema/config drift, not data regen)
- **vastu-hfc** `schemaContext`: `collections_actions_full` documented the wrong
  `action_type` (4 of 6) and a `result` value-set the generator never writes.
  Corrected to the real 6 action types + 6 result values. Was silently
  misleading SQL generation.
- **fundsindia**: `POSITION_PROPERTIES`/`PORTFOLIO_PROPERTIES` exposed investor
  columns (`occupation`, `kyc_status`, `bank_name`, …) that the
  `investor_fund_positions` / `investor_portfolio_summary` views do **not**
  produce — an Explorer breakdown on any of them would have thrown a live
  "column not found" across ~26 events. Split out a `POSITION_INVESTOR_PROPERTIES`
  set matching exactly what the views carry.

### Still needs data-gen (deferred — requires editing generators + DuckDB rebuild)
These were NOT added because the data doesn't back them; they need generator
changes + a data regeneration pass (which means stopping the dev server):
- **gameramp**: payer / first-purchase / IAP conversion (no payer/IAP column —
  monetization is ad-revenue only); per-user D1/D7/D30 retention boolean flags
  (retention exists only as pre-aggregated rates).
- **vastu-hfc**: true NPA/SMA **transition timestamps** (delinquency stage is a
  status column on the parent loan, no transition date → those events are
  `funnelEligible:false` today); NACH presentation/return as discrete rows
  (modeled as a `bounce` boolean); foreclosure-vs-prepayment split.
- **fundsindia**: `sip_resumed` (paused→active transition not emitted); explicit
  seasonal column (`tax_season`/`fy_quarter`) — seasonality is implicit in dates.

### "No events detected" note
All 3 active datasets have funnel-eligible events, so the Funnels/Retentions
"No events detected for this dataset" guard should not fire for them. If it
appeared, the active dataset was a dynamic/uploaded one with an empty `events`
array (or a transient from the since-fixed `subagent.queries` crash). Confirm the
exact dataset in the morning before deciding on a guard.

## Roster expanded to 5 (2026-06-18 AM)

Decision: keep all five deep datasets (no removals). Promoted `quickhelp` and
`healthians` from parked into the selectable registry.

| Dataset id | Label (industry) | Events | Data |
| --- | --- | --- | --- |
| `vastu-hfc` | Banking & Lending | 39 | built |
| `fundsindia` | Wealth & AMC | 211 | built |
| `gameramp` | Consumer Apps & Gaming (persona: Presto) | 8 | **built this AM** |
| `quickhelp` | Consumer Services | ~76 | built |
| `healthians` | Healthcare | ~88 | built |

Wiring changed: `STATIC_DATASETS` (index.ts), `DEFAULT_SAMPLE_DATASETS`
(constants.ts), and the onboarding picker cards (onboarding/complete/page.tsx)
now include all 5. Labels for quickhelp ("Consumer Services") and healthians
("Healthcare") aligned to the industry-category convention.

**gameramp data was missing** — its config pointed at `data/gameramp.duckdb` but
the file never existed (and `data/parquet/` was empty), which is why it was thin.
Rebuilt via `python3 scripts/generate-gameramp.py` → `npx tsx
scripts/setup-gameramp.ts`. Seasonality (Q4 spend peak, retention decay, geo LTV
divergence) is encoded by the generator and validated in the setup scenarios.

**Presto vs gameramp:** kept the internal id `gameramp` (renaming spans ~50
string-keyed files for zero user-facing gain — still deferred). User-facing label
is "Consumer Apps & Gaming"; in-data company persona is "Presto".

### Still to do — deep regen for story-enhancers (needs generator edits + rebuilds)
Adding the deferred story-enhancer events (gameramp IAP/retention-flags, vastu
NPA-transition timestamps, fundsindia sip_resumed, etc.) requires editing each
generator and rebuilding that dataset's `.duckdb` — which means briefly stopping
the dev server for the four already-built datasets. Coordinate timing before
running.
