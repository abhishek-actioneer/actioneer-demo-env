# Synthetic Live Data — Plan & Threat Model

**Status:** Draft, pre-implementation
**Date:** 2026-04-29
**Scope (v1):** **quickhelp only.** Other sample datasets (gameramp, vastu-hfc, alpha) are out of scope until quickhelp validates the architecture. Uploaded datasets are explicitly out of scope forever (warehouse-connector workstream).
**Cadence:** **Daily at 13:00 IST.** One tick per day. `syntheticHoursPerTick = 24` (one tick advances the clock by exactly one calendar day).
**Goal:** Make the quickhelp sample dataset feel alive between sessions — segments drift, funnels move, scouts fire, the "today" edge of every chart actually advances — without requiring re-upload.

---

## Why this exists

Baby Sentinel is a CSV-only product today. Sample datasets are frozen at their seed end-date (e.g. gameramp ends Feb 28, 2026). This kills the credibility of every dynamic surface: live segments, funnels, scouts, time-series with a "now" edge. Real freshness for uploaded data needs a warehouse-connector path (separate workstream). Synthetic freshness for sample datasets is what we're solving here, and it only needs to be convincing enough for sales demos and the "come back tomorrow" experience.

---

## Architectural ground truth (do not assume — these were verified against the codebase)

1. **Sample tables are views over parquet**, not real tables. Example: `CREATE VIEW installs AS SELECT * FROM read_parquet('data/parquet/gamerampv2/installs.parquet')`. We cannot `INSERT INTO installs` directly.
2. **Summary tables are derived** via `CREATE OR REPLACE TABLE ... AS SELECT ... GROUP BY`. Examples: `monthly_revenue_summary`, `ltv_by_cohort`, `arpdau_trend`. New rows in raw tables don't propagate to summaries until rebuilt.
3. **Each sample dataset has its own `.duckdb` file** (`data/gameramp.duckdb`, `data/quickhelp.duckdb`, etc.). DB lifecycle managed by `src/lib/db.ts` — `getOrCreateInstance` + per-dataset queue via `withConnection`.
4. **Per-dataset operation queue** already serializes DB ops. Tick must use `withConnection` and will inherit serialization for free.
5. **`schemaContext` hardcodes literal date ranges** (e.g. `DATE RANGE: 2025-08-01 to 2026-02-28`) inside the LLM prompt. Without rewriting these, the LLM remains anchored to the seed end-date even after we extend data forward.
6. **`/api/metrics` has a 5-min stale-while-revalidate cache** keyed by `datasetId`. Other surfaces (entity catalog, explorer, board) have similar in-memory caches.
7. **Foreign-key integrity is implicit.** Sessions reference `installs.user_id`. Ad impressions reference `sessions.session_id`. A tick must walk the dependency DAG to keep cohort logic intact.
8. **DuckDB has known WAL replay bugs** with `BindDefaultValues` — `db.ts` has retry+unlink logic. Increased write volume from ticks expands this surface area.
9. **DEFAULT_DATASET = "gameramp"**. DEFAULT_SAMPLE_DATASETS = ["gameramp", "vastu-hfc"]. Uploaded datasets carry `ownerId` (Clerk userId); samples have `ownerId === undefined`.

---

## The architecture

### Storage strategy: parallel `__live` tables, UNION ALL views

Pick this over parquet shards or table conversion:

| Option | Pro | Con | Decision |
|---|---|---|---|
| A. Parquet shards (`installs__live/<ts>.parquet`) | Authentic update feel, simple reset | Needs parquet writer; many small files slow down `read_parquet`; needs compaction | ❌ |
| **B. Parallel `__live` table + UNION ALL view** | Fast inserts; reset = `TRUNCATE`; seed parquet stays immutable; one-line view edit | One extra view per table | ✅ |
| C. Convert seed view → real table | Simplest queries | Loses parquet-as-source-of-truth; reset means re-seed | ❌ |

**Implementation:**
```sql
-- Once per raw table (in viewSQL):
CREATE TABLE IF NOT EXISTS installs__live (...same schema as installs...);
CREATE OR REPLACE VIEW installs AS
  SELECT * FROM read_parquet('data/parquet/gamerampv2/installs.parquet')
  UNION ALL
  SELECT * FROM installs__live;

-- Tick:
INSERT INTO installs__live VALUES (...);

-- Reset:
TRUNCATE installs__live;
```

Same pattern for derived summary tables (`monthly_revenue_summary__live`, etc.). Summary `__live` tables get incrementally GROUP BY'd from the corresponding raw `__live` tables on each tick. The summary view UNIONs seed-summary + live-summary.

### The `synthetic_clock` table — single source of truth for "now"

Per-dataset table, one row:
```sql
CREATE TABLE synthetic_clock (
  baseline_now TIMESTAMP,    -- frozen at first boot, equal to dataset.dateRange.end
  current_now  TIMESTAMP,    -- advances each tick
  last_tick_succeeded_at TIMESTAMP,
  last_tick_attempted_at TIMESTAMP,
  tick_count INTEGER,
  status VARCHAR  -- 'ok' | 'degraded' | 'error'
);
```

Three downstream consumers:
- **LLM prompts** — `getSystemContext()` substitutes `{{DATASET_NOW}}` in `schemaContext`. `welcomeSubtitle` and `reportMeta.dateRangeLabel` get same treatment.
- **UI freshness pill** — reads `last_tick_succeeded_at`, `current_now`.
- **Synthesis itself** — row generation stamps timestamps in `[current_now - tickWindow, current_now]`.

### Synthesis plan (declarative, hand-authored per dataset)

```ts
// src/lib/synthetic/plans/gameramp.ts
export const gamerampSynthetic: SyntheticPlan = {
  datasetId: "gameramp",
  enabled: true,
  cadence: { intervalMinutes: 60, syntheticHoursPerTick: 1 },

  tables: [
    {
      name: "installs",
      mode: "generate",
      ratePerSyntheticHour: 60,
      scriptedCurve: { weekday: "flat", hourOfDay: "playtimePeak" },
      columns: { /* per-column generators */ },
    },
    {
      name: "sessions",
      mode: "deriveFromUsers",
      source: "installs",
      sessionsPerUserPerDay: { mean: 1.4, stddev: 0.3, decayWithDaysFromInstall: 0.92 },
    },
    {
      name: "ad_impression_events",
      mode: "deriveFromSessions",
      source: "sessions",
      impressionsPerSession: { mean: 8, stddev: 3 },
    },
  ],

  postTick: {
    refreshSummaries: ["monthly_revenue_summary__live", "arpdau_trend__live", "cohort_retention_actuals__live"],
    invalidateCaches: ["metrics", "explorer", "entity-catalog"],
  },

  scriptedNarratives: [
    { name: "monday_install_spike", multiplier: 1.4, dayOfWeek: 1 },
  ],
};
```

### Cadence — three modes, one knob

- **Steady** (default): `intervalMinutes=60`, `syntheticHoursPerTick=1`. 1:1 real-to-synthetic time.
- **Demo** ("Watch live" button): tick every 30s for the next 5 min with `syntheticHoursPerTick=1`.
- **Catch-up** (cold boot after long downtime): clamp `min(realElapsed, maxDriftHours=24)`. Tick once with that hours-per-tick.

Scheduler: single `setInterval` registered at server boot in `src/lib/synthetic/scheduler.ts`, gated by `process.env.SYNTHETIC_ENABLED === "true"` and a global symbol flag for HMR safety.

### Multi-replica safety

DuckDB has no native row locks. File mutex doesn't work across Railway containers. **Decision:** designate a single leader replica via `SYNTHETIC_LEADER=true` env var. Other replicas refuse to schedule ticks. Dumb, works.

### Sample-only gating

```ts
function shouldSchedule(ds: DatasetConfig): boolean {
  if (ds.ownerId !== null && ds.ownerId !== undefined) return false; // user upload
  if (ds.isDynamic && !STATIC_DATASETS[ds.id]) return false;          // legacy orphan
  if (!getSyntheticPlan(ds.id)?.enabled) return false;                 // no plan or disabled
  return true;
}
```

---

## Pipeline (one diagram)

```
       ┌─────────────────────────────┐
       │  src/lib/synthetic/plans/   │  hand-authored, checked in
       │  gameramp.ts                │  per-dataset narrative rules
       └──────────────┬──────────────┘
                      │
                      ▼
   scheduler ──tick──►  runTick(datasetId, plan)
                      │
                      │ withConnection (existing per-dataset queue)
                      ▼
       ┌──────────────┴──────────────────────────────────────┐
       │ 1. Read synthetic_clock → currentNow                │
       │ 2. Acquire lock (UPDATE last_tick_attempted_at)     │
       │ 3. Generate rows: walk plan.tables in DAG order     │
       │ 4. INSERT INTO {table}__live                        │
       │ 5. Refresh summary __live shards (incremental)      │
       │ 6. Advance synthetic_clock.current_now              │
       │ 7. CHECKPOINT                                       │
       │ 8. Update last_tick_succeeded_at, status='ok'       │
       └──────────────┬──────────────────────────────────────┘
                      │
                      ▼
              invalidate caches
                      │
                      ▼
              UI polls /api/synthetic/clock every 30s
                  refetches stale data on tick change
```

---

## File layout

```
src/lib/synthetic/
  types.ts                  // SyntheticPlan, TickResult, ColumnGenerator
  plans/
    gameramp.ts             // hand-authored
    vastu-hfc.ts
    quickhelp.ts
    alpha.ts
    index.ts                // datasetId → plan map; null = no synthesis
  rng.ts                    // seeded mulberry32 (deterministic w/ seed)
  generators.ts             // jitter, sampleFromSeed, scriptedCurve, channelFraudRate
  tick.ts                   // runTick(datasetId)
  clock.ts                  // getDatasetNow, advanceClock, resetClock
  scheduler.ts              // boot-time setInterval registration
  invalidate.ts             // bump metrics + entity catalogs after tick
  reset.ts                  // resetSyntheticState(datasetId)
  view-rewrites.ts          // UNION ALL view definitions per table

src/app/api/admin/synthetic/
  tick/route.ts             // manual single tick
  burst/route.ts            // burst N ticks (demo speed)
  reset/route.ts            // reset to baseline
  status/route.ts           // last/next tick, drift, deltas

src/app/api/synthetic/
  clock/route.ts            // public: returns currentNow + lastTickAt for UI poll
```

---

## Phasing

**Day 1 — Foundation + one table**
- `synthetic_clock` table; `getDatasetNow()`; `{{DATASET_NOW}}` substitution in `getSystemContext()`, `welcomeSubtitle`, `reportMeta.dateRangeLabel`
- `installs__live` parallel table for gameramp; rewrite `installs` view to UNION
- Minimal `runTick(gameramp)` — appends jittered installs only
- `/api/admin/synthetic/tick` for manual trigger
- Smoke test: tick three times, verify install count moves in `/explore` and segments

**Day 2 — Cross-table consistency + summary refresh**
- Extend tick to derive sessions, ad_impressions from new installs
- `__live` versions of 4 most-queried summaries (`monthly_revenue_summary`, `arpdau_trend`, `cohort_retention_actuals`, one more)
- Rewrite their views to UNION
- Cache invalidation: bump metrics cache on tick

**Day 3 — Cadence + UX layer 1 & 4**
- `setInterval` scheduler (HMR-safe, env-gated)
- Topbar "Live" pill + popover
- Per-segment "· 2m ago" timestamps
- `SYNTHETIC_LEADER` gating for multi-replica
- Cold-boot catch-up with drift clamp

**Day 4 — UX layer 2 (tick events) + replicate to other datasets**
- Delta toast on tick (poll-based)
- Scout firing on tick crossings
- Author plans for vastu-hfc, quickhelp, alpha
- "Reset to baseline" in dataset settings

**Day 5 — Polish + admin controls**
- "Watch live" demo speed-mode
- Tick history admin panel
- Telemetry: `last_tick_at` on `/api/health`
- Reproducibility: seeded RNG
- Feature flag for graceful rollback

---

## Threat model — what could break, what we have to guard against

Sorted by likelihood × pain. Categorized so we know how to find them.

### Tier 1 — Will definitely break, must design for

| # | Failure | Mitigation |
|---|---------|------------|
| 1 | LLM mental model of "now" goes stale instantly. Hardcoded `DATE RANGE` in prompts means LLM keeps writing `WHERE month = '2026-02-01'` for "this month" after data drifts forward. | `{{DATASET_NOW}}` substitution at prompt-build is **non-negotiable** — not a nice-to-have. |
| 2 | Saved segments/metrics/funnels/scouts reference frozen absolute dates ("WHERE install_date BETWEEN '2026-01-01' AND '2026-02-28'"). After ticks, saved entities don't grow. | Store saved SQL with relative anchors (`now() - INTERVAL '30 days'`) or rewrite at query-time. Audit every entity that captures SQL on save. |
| 3 | Foreign-key drift between tables. New installs without matching D7+ sessions = flat retention curves. | Synthesis walks DAG. Sessions backfill against historical installs (seed + live). Generate D0–D30 fan-out per new install over multiple ticks. |
| 4 | Summary tables stale until rebuilt. Charts using summaries lag charts using raw tables. Two views of same data disagree. | `__live` summary shards + UNION views, rebuilt every tick. Highest-bug-density area. |
| 5 | 5-min metrics cache silently swallows freshness. User sees toast "+127 events" but metric tile doesn't move. | Explicit cache invalidation on tick: metrics, entity catalog, explorer, board, retention. **Audit every cache.** |

### Tier 2 — Will probably break under load or edge conditions

| # | Failure | Mitigation |
|---|---------|------------|
| 6 | View `UNION ALL` cost at scale. `__live` tables eventually exceed 5M rows; query plans degrade. | Compaction job. Every N ticks, append `__live` rows to a new parquet shard, add to view's `read_parquet` glob, truncate `__live`. Don't preempt — instrument and watch. |
| 7 | DuckDB WAL replay bug surface area. Railway redeploy mid-tick → potential WAL corruption. | Tick wraps in BEGIN/COMMIT, CHECKPOINT after every tick. Tick is idempotent enough that losing one is fine. |
| 8 | Multi-replica concurrent ticks → duplicate inserts. File mutex doesn't work across Railway containers. | Designated leader via `SYNTHETIC_LEADER=true` env on one replica. |
| 9 | Process restart re-runs ticks. Next.js HMR fires multiple ticks per code save. | Scheduler reads `last_tick_succeeded_at`, refuses to tick if `now - last_tick_at < intervalMinutes / 2`. Idempotent boots. |

### Tier 3 — Subtle correctness bugs that erode trust

| # | Failure | Mitigation |
|---|---------|------------|
| 10 | Distribution drift over weeks. Random jitter shifts channel mix; after 200 ticks, demo dataset doesn't match prompts. | `sampleFromSeed` with weights frozen at first boot. Periodic post-tick assertion: distribution stays within ±5% of seed. |
| 11 | `is_observed` flag becomes a lie. Synthesis generates D30 rows for cohorts only 3 days old, breaking LTV-model-accuracy story. | Per-table contract awareness in plan. Some columns are *not* synthesizable — mark them. |
| 12 | Scripted narratives go off the rails. "Fraud creeps up by 0.0005/tick" → after 1000 ticks, fraud is 67%. | Bounded curves, not unbounded deltas. Period reset of narratives. |
| 13 | User watchlist segments confused with rule-based segments. List doesn't grow but user expects it to. | Clear UI distinction — already exists in data model, ensure UI labels it. |
| 14 | Time-series cliff at seed/live boundary. Day after `dataset.dateRange.end` looks visibly different. | Smooth first few live ticks toward seed's trailing-7d average. "Feathered onset." |
| 15 | Tests reference fixtures break. Live rows leak into snapshot tests. | `SYNTHETIC_ENABLED=false` in test env. `TRUNCATE *_live` in test setup. |

### Tier 4 — UX failure modes (more dangerous than data bugs)

| # | Failure | Mitigation |
|---|---------|------------|
| 16 | "Live" pill cries wolf. Tick fails silently, pill keeps showing "updated 2m ago" because last *successful* tick was set on prior run. | Track `last_tick_attempted_at` separately from `last_tick_succeeded_at`. Pill goes amber/error if attempts > successes. Surface in admin panel. |
| 17 | Delta toasts during deep research. Tick lands at second 12 of a 30-second research run; user assumes results reflect new data (they don't). | Suppress toasts while a research stream is active for that user/dataset. |
| 18 | Sales call surprise. Demo person clicks "Watch live" on prod, cranks cadence to 30s for everyone — other concurrent demos see wobbling data. | Speed-mode is per-session, not per-dataset. Or admin-locked behind feature flag. |
| 19 | Reset destroys someone else's demo. Two sales people on same Railway instance, one resets mid-other's pitch. | Reset is admin-only with strong gating + "warn other active sessions" check. Or per-user dataset clone (complex; probably v2). |
| 20 | Onboarding first-impression mismatch. Welcome subtitle says "Aug 2025–Feb 2026" but data shows through April. | Substitute `{{DATASET_NOW}}` in `welcomeSubtitle` and `reportMeta.dateRangeLabel` too — more sites than just `schemaContext`. |

### Tier 5 — Operational / ops surface

| # | Failure | Mitigation |
|---|---------|------------|
| 21 | Disk growth. ~100M rows of synthetic data accumulating per year. DuckDB files grow; backups slow. | Compaction (Tier 2 #6 doubles as this). Hard cap: when `__live` > 1M rows per table, auto-compact. |
| 22 | Backup/restore semantics unclear. Restore last week's snapshot → `current_now` jumps backward 7 days; gap on next tick. | Post-restore hook detects clock regression, skips ahead or backfills. |
| 23 | Logs flood. ~96 routine entries/day across 4 datasets. Real errors get buried. | Log levels: INFO for per-tick result line, DEBUG for internals. |
| 24 | Monitoring blind spot. No visibility into "did ticks fire on time last week" until something looks wrong. | `/api/health` returns per-dataset `last_tick_at` and `tick_count`. External uptime check. |

---

## The four must-not-break invariants

If we cut to the bone, these are the four. Failure of any one kills the demo more thoroughly than not building this at all:

1. **`{{DATASET_NOW}}` substitution everywhere a date appears** in prompts/UI/welcome text. Without it, the whole thing is a lie.
2. **Cache invalidation on tick.** Without it, freshness doesn't propagate to UI.
3. **Saved-entity SQL uses relative dates.** Without it, segments/funnels/scouts don't actually move.
4. **Tick failure is loud, not silent.** Without it, the "Live" pill becomes a credibility bomb.

---

## The dangerous failure mode in plain English

Synthesis breaking is loud — you see it in the data immediately.

The dangerous mode is **synthesis works, but the surrounding system doesn't catch up**. Caches stay warm, prompts stay frozen, saved segments stay capped, summary tables lag raw tables. The user sees "Live · updated 2m ago" and trusts it, while half the surfaces show February data and the other half show today. That's the credibility crater.

So when we build, the unit of work is **not** "the tick handler." It's "the tick handler + every cache it has to bust + every prompt it has to re-anchor + every saved entity it has to keep correct." That's why Day 1 isn't about generating rows — it's about making sure the rest of the system *knows the clock has moved*. Rows come on Day 1 too, but the harder work is plumbing.

---

## UX surfaces (high-quality bar)

### Layer 1 — Always-on freshness affordances
1. **Topbar pill** — `● Live · updated 2m ago` (animated dot, monochrome). Click → popover with last tick, next tick, manual "Tick now" (admin-gated).
2. **Per-segment freshness** — `· 2m ago` next to count.
3. **Per-card "fresh" hairline** — top-edge gradient on trailing 24h slice indicating "this part just landed."
4. **`{{DATASET_NOW}}` everywhere a date appears** — date pickers, "showing data through ...", chart x-axis right edge.

### Layer 2 — Tick events the user notices
5. **Delta toast on tick land** — bottom-right: "Live update: +127 events, +14 installs, +2 trial-conversions." Auto-dismiss ~4s. Suppressed when page hidden (Page Visibility API). Suppressed during deep research.
6. **Scout firings** — when tick crosses a scout threshold, scout fires for real. Sidebar badge, scout detail page shows trigger event. **The demo gold.**
7. **Realtime segment movement** — segment overview "users entered in last 24h" actually moves.

### Layer 3 — Demo controls (admin-gated)
8. **"Watch live" button** in topbar pill popover — speed-mode for 5 min.
9. **Reset to baseline** in dataset settings — confirm modal → `TRUNCATE *_live` + reset clock.
10. **Tick history panel** — admin-only modal: timeline of last 50 ticks, row counts, last summary refresh, errors.

### Layer 4 — Honest defaults
11. **Sample datasets only** — `if (ds.ownerId !== null && ds.ownerId !== undefined) skip`.
12. **Disabled in dev by default** — `SYNTHETIC_ENABLED=false` unless explicitly turned on.

---

## Decisions locked for v1

| # | Decision | Choice | Reasoning |
|---|----------|--------|-----------|
| 1 | Scope | **quickhelp only** | Validate architecture on one dataset before duplicating plan-authoring effort. Quickhelp is the user's preferred demo surface and has rich support/booking/funnel/comms tables that benefit most from drift. |
| 2 | Cadence | **Daily at 13:00 IST**, `syntheticHoursPerTick=24` | One tick = one synthetic day. Predictable, easy to reason about, matches a natural "come back tomorrow" demo cycle. No sub-day granularity needed. |
| 3 | Tick window | `[currentNow, currentNow + 24h]` | Each tick stamps new rows across the next 24h of synthetic time, then advances `currentNow` by 24h. |
| 4 | Storage | Same `quickhelp.duckdb` file, `__live` companion tables | Single-file simplicity. `ATTACH` adds nothing for one dataset. |
| 5 | View pattern | `UNION ALL` of seed parquet view + `__live` table | Already designed in this plan. |
| 6 | `{{DATASET_NOW}}` rewrite | **Required in v1** | Tier-1 invariant. LLM anchored to Feb 28 ignores all live data. Non-negotiable. |
| 7 | Multi-replica safety | `SYNTHETIC_LEADER=true` env on one Railway replica | Single-leader is dumb and works. Skip leader election for now. |
| 8 | Admin gating | `SYNTHETIC_ADMIN_USER_IDS` env allowlist | Faster than Clerk role; v2 can move to Clerk. |
| 9 | Dev default | `SYNTHETIC_ENABLED=false` | Predictable dev. Opt-in only. |
| 10 | Fail mode | Loud, surfaced in pill + admin panel | Tier-1 invariant. Silent failure = credibility bomb. |

---

## What "1pm daily" actually means — implementation specifics

### The cron mechanism

There are three places we could run "13:00 daily." Pick one:

**Option A — Vercel Cron / Railway Scheduled Job (external trigger)**
- Define in `vercel.json` or Railway dashboard: `0 13 * * *` hits `POST /api/admin/synthetic/tick`.
- Pro: external scheduler is reliable, survives redeploys, no in-process state.
- Pro: trivial to confirm "did it fire?" — Railway/Vercel logs.
- Con: needs HTTP handshake; add `CRON_SECRET` header check on the route.

**Option B — In-process `setInterval` at boot**
- `src/lib/synthetic/scheduler.ts` registers an interval that checks every minute "is it 13:00 now and have we ticked today?"
- Pro: no external infra, runs anywhere.
- Con: dies if Railway sleeps (free tier) or scales replicas. Survives redeploys only via the leader-election trick.
- Con: harder to verify externally.

**Option C — Hybrid: external cron triggers internal endpoint, endpoint is also manually callable**
- `vercel.json`/Railway cron → `POST /api/admin/synthetic/tick` with `CRON_SECRET`.
- Same endpoint admin-callable for manual ticks.
- Pro: best of both — external reliability + internal manual control.
- Con: minor — needs two auth modes on the route (CRON_SECRET or admin user).

**Decision: Option C.** Most reliable, cheapest to operate.

```jsonc
// vercel.json (or Railway cron config)
{
  "crons": [
    { "path": "/api/admin/synthetic/tick?datasetId=quickhelp", "schedule": "30 7 * * *" }
  ]
}
```

Schedule is `30 7 * * *` because **Vercel/Railway crons run in UTC**, and 13:00 IST = 07:30 UTC. We must convert. (If we ever move to Railway native cron and configure timezone, this changes — document the conversion in the deploy runbook.)

### Idempotency — what if the cron fires twice?

Belt and suspenders. The route checks `synthetic_clock.last_tick_succeeded_at`:
- If `now - last_tick_succeeded_at < 12 hours` → return `{ skipped: true, reason: "already ticked today" }`.
- Else → run tick.

This handles: duplicate cron firing, manual tick spam, post-restore replay, dev/prod cron both pointing to the same DB.

### What if the cron doesn't fire (Railway sleep, deploy window, network blip)?

When the next tick *does* fire, we look at the gap: `realElapsed = now - last_tick_succeeded_at`. Two strategies:

- **A. Single tick, advance clock by 1 day** (drop the missed days). Simple. After a 3-day Railway sleep, you lose 2 days of synthetic data, but the demo is still alive.
- **B. Catch-up replay**: tick `floor(realElapsed / 24h)` times, each advancing the clock by 24h. Faithful but generates a burst of inserts.

**Decision: A by default, capped catch-up via `?catchup=true`** on the manual tick endpoint. Daily-ness is preserved; catch-up is opt-in for "I redeployed yesterday and want to backfill."

### What if real time and synthetic time disagree by a lot?

Quickhelp seed ends `2026-02-28`. Today is `2026-04-29`. On first tick, `current_now` starts at `2026-02-28` and advances by 24h. After ~60 days of ticks, synthetic time catches up to real wall-clock. Acceptable — the dataset stays "recent."

If you want to **bootstrap synthetic time to today on first run**, that's an ops decision: a one-time admin call to `/api/admin/synthetic/clock?datasetId=quickhelp&setNow=2026-04-28` (the day before today) so the very first daily tick lands rows for "yesterday." I'd recommend this — otherwise the first scout firing comes 60 days from now.

---

## Remaining questions, explained

These don't block v1 but you should have an opinion on them before we start coding.

### Q1. Bootstrap "now" — start at seed end, or jump to (today − 1 day)?

**The choice:** when we first set up `synthetic_clock` for quickhelp, what value goes in `current_now`?

- **Option a — `baseline_now = current_now = "2026-02-28"`** (seed end). First tick adds rows for March 1, second tick March 2, and so on. Synthetic time crawls forward. After ~60 daily ticks, we catch up to real time.
- **Option b — `baseline_now = "2026-02-28"`, `current_now = "2026-04-28"`** (yesterday). First tick adds rows for today. Demo is "today-fresh" immediately. The 60-day gap between seed end and `current_now` is ungenerated — *or* we backfill it in a one-time burst.
- **Option c — `baseline_now = "2026-02-28"`, then run a 60-tick burst at setup** to fill Mar 1 → Apr 28, then daily from Apr 29. Demo data is dense and continuous. Most expensive setup, best demo result.

**My recommendation: c.** Run a one-time backfill at setup — generates ~60 days of synthetic activity in one go (~2-3 minutes), then daily ticks take over. Charts have no Feb-to-today cliff.

### Q2. Saved-segment SQL — relative or absolute dates?

**The choice:** when a user creates a segment via "users who booked in the last 7 days," what SQL do we save?

- **Absolute:** `WHERE booking_date BETWEEN '2026-04-22' AND '2026-04-29'`. Stable, reproducible, but **doesn't move when data ticks** — segment count is frozen.
- **Relative:** `WHERE booking_date >= now() - INTERVAL '7 days'`. Moves with time, but `now()` is real wall-clock — out of sync with `current_now` if synthetic time hasn't caught up.
- **Synthetic-relative:** `WHERE booking_date >= (SELECT current_now FROM synthetic_clock) - INTERVAL '7 days'`. Moves with synthetic clock. Semantically correct. Slightly heavier query.

**My recommendation: synthetic-relative for any time-windowed segment.** This is one of the four Tier-1 invariants — without it, segments don't drift after ticks. Cost: one SQL pattern change in the segment generator + a function to expose `current_now` cleanly.

### Q3. Should ticks generate *only forward* time, or fill gaps?

Quickhelp has tables like `funnel_events` where a user signs up, then 14 days later does their second booking. If a user signs up on tick day N, when do we generate their `second_booking_14d` row?

- **Option a — Generate it now, dated 14 days in the future.** Breaks "synthetic time has not yet reached day N+14."
- **Option b — Carry a queue forward.** Tick day N writes user to a "pending second_booking" queue. Tick day N+14 reads the queue and emits the event.
- **Option c — Probabilistic backfill at tick time.** When generating today's funnel rows, look at which users from 14 days ago are eligible and emit events for them now.

**My recommendation: c.** Each tick first looks back at users from prior ticks (or seed) who are due for their next funnel event today, emits those, *then* generates today's new signups. This keeps cohort dynamics (D7 retention, D14 second-booking) realistic.

### Q4. Reset semantics — what exactly does "reset to baseline" do?

When a sales person clicks "Reset to baseline" before a demo:

- **Definitely:** `TRUNCATE *_live` (raw and summary). `synthetic_clock.current_now = baseline_now`. Clear caches.
- **Question:** what about user-saved segments/metrics/funnels/scouts created against the live data? They reference IDs that still exist (segments are SQL, not row snapshots), so most will work fine — but their counts will snap back. Acceptable for a demo dataset.
- **Question:** what about scout firings that happened during live time? Drop them, or preserve as historical? Drop for v1.
- **Question:** does reset run the bootstrap backfill (Q1c) automatically, or leave the dataset at seed-end? **Leave at seed-end.** Bootstrap is opt-in via a separate "Bootstrap to today" button. Two distinct admin actions.

### Q5. What does the "Live" pill show before the first tick?

If quickhelp's last tick was 25 hours ago (cron failed) or has never ticked (fresh deploy), what does the pill say?

- Never ticked → "Live · scheduled for 13:00" (informational, not error).
- Last tick > 25h ago → "Live · last update {timestamp} (stale)" in amber, with admin "Tick now" button.
- Last tick within 25h → "Live · updated {N}h ago" (normal).

The pill is honest about state. This is the Tier-4 #16 mitigation.

### Q6. How do we test this without running the cron?

Two paths:

- **Manual tick endpoint** (`POST /api/admin/synthetic/tick?datasetId=quickhelp`) is callable by admin allowlist. Call it from the browser dev console or a curl. Same code path as cron.
- **Burst endpoint** (`POST /api/admin/synthetic/burst?datasetId=quickhelp&days=7`) runs 7 ticks in sequence. Use this to fast-forward a week and check that segments/funnels/scouts behave correctly.

Both endpoints exist for manual testing; cron just hits the first one with `?source=cron`.

---

## Implementation status

**Day 1 — DONE 2026-04-29**
- ✅ `synthetic_clock` table + `getDatasetNow()` + `{{DATASET_NOW}}` substitution
- ✅ `bookings_seed` / `bookings__live` / `bookings` UNION view for quickhelp
- ✅ Manual tick endpoint with dual auth (cron secret + admin allowlist)
- ✅ Idempotency guard (12h since last success)
- ✅ Status + probe diagnostic endpoints

**Day 6 — Holistic business simulation — DONE 2026-04-29**

Volume + coverage upgrade. Bookings-only synthesis is replaced with a coordinated multi-table simulation that powers every metric in the dataset.

- ✅ `growth.ts` — `dailyVolume()` function with compound growth (+0.5%/day), weekly seasonality (weekday peak / weekend dip), Box-Muller gaussian noise (±8%), 5% spike days at 1.25×
- ✅ Plan format change: `ratePerSyntheticHour: number` → `volume: GrowthConfig` per generated table
- ✅ Bookings baseline raised from 192/day → 620/day with full growth shape; sessions follow 1:1
- ✅ New `derivations.ts` with 6 cross-table derivations:
  - `deriveBookingEconomics` — 1:1 with bookings, commission rates by tier, contribution margin formula
  - `derivePartnerShifts` — one shift row per (partner, date) with bookings completed
  - `deriveSurveys` — ~20% of completed bookings, NPS/CSAT/post_booking, biased by partner_rating
  - `deriveCommsSends` — onboarding journey + always-on engagement (~1500 customers/day) + active campaign sends, ~4700/day matches 10× bookings
  - `deriveAdMetrics` — per-creative daily metrics, growth-shaped spend
  - `derivePartnerPayouts` — Wednesday weekly aggregation of prior week's shifts
- ✅ Infrastructure rebinds 6 raw_* views (booking_unit_economics, partner_shifts, survey_responses, comms_sends, ad_daily_metrics, partner_payouts) to `seed UNION ALL __live` so summary tables that read raw_* names automatically include live data
- ✅ Summary refresh redesigned: pulls SQL straight from `dataset.summaryTableSQL` and re-runs all 17 summaries every tick. No SQL duplication in synthesis layer.
- ✅ Reset endpoint discovers `__live` tables via `information_schema` so all 9 derived tables get truncated (not just plan.tables)
- ✅ Comms customer sampling switched from `USING SAMPLE 8%` (DuckDB Bernoulli, inconsistent) to deterministic `ORDER BY hash(customer_id * seed) LIMIT 1500`

**Verified 7-day burst (clean reset → ticks 1–7):**

| Day | Bookings | Comms | Surveys | Payouts | Tick ms |
|-----|----------|-------|---------|---------|---------|
| 03-01 | 571 | 4,712 | 112 | 0 | 28,136 |
| 03-02 (Mon) | 760 | 4,802 | 155 | 0 | 26,047 |
| 03-03 | 626 | 4,734 | 99 | 0 | 25,494 |
| 03-04 (Wed) | 679 | 4,722 | 123 | **500** | 26,405 |
| 03-05 | 731 | 4,734 | 132 | 0 | 28,616 |
| 03-06 | 667 | 4,738 | 124 | 0 | 28,807 |
| 03-07 (Sat) | **559** | 4,682 | 93 | 0 | 30,346 |

Weekend dip visible on day 7 (Sat). Wednesday partner payouts roll up correctly. Every tick refreshes all 17 summary tables successfully. Total tick time ~26–30s (well within daily-cron budget).

**Metric coverage**: all 40 metrics now route through tickable tables (bookings, daily_sessions, comms_full, bookings_economics, ad_full, partner_shifts, partner_payouts, survey_full, weekly_company_kpis, monthly_company_kpis, activation_metrics, funnel_conversion_metrics, monthly_partner_economics, ad_platform_metrics, hub_metrics).

**Day 5 — DONE 2026-04-29**
- ✅ Saved-segment count refresh on tick: `refreshAllSegmentCounts(datasetId)` runs each segment's SQL wrapped in `SELECT COUNT(*) FROM (…)`, updates `segments.user_count` in SQLite. Runs in `.then()` chain after `withConnection` releases — avoids re-entrant DuckDB queue deadlock.
- ✅ Burst endpoint: `POST /api/admin/synthetic/tick?action=burst&ticks=N` runs up to 30 ticks back-to-back with `force=true`. Powers "Watch live" demo speed-mode.
- ✅ Tick history: in-memory ring buffer (last 30 ticks per dataset, on globalThis) populated from `runTick` end-of-pipeline. Read via `?action=history`.
- ✅ SQL migration script `scripts/migrate-segment-sql-to-dataset-now.ts`: regex-rewrites `CURRENT_DATE` / `now()` / `CURRENT_TIMESTAMP` in saved segment SQL to use `dataset_now`. `SYNTHETIC_DRY_RUN=1` for preview. Hardcoded date literals are left alone (user intent).
- ✅ Bug caught + fixed: tick re-entered `withConnection` for segment refresh from inside the same callback → deadlock. Fixed by `.then()` chain after the connection releases. Required dev server restart to clear the wedged queue.
- ⏭️ Deferred: comms_full__live generation (still low ROI), scout fire-on-tick (real scout system is mock-only), tick history admin UI panel (endpoint exists; client component can be added later).

**Day 4 — DONE 2026-04-29**
- ✅ `dataset_now` view exposes synthetic clock to SQL: `(SELECT today FROM dataset_now)`, `(SELECT now FROM dataset_now)`
- ✅ `buildSegmentSqlPrompt` instructs LLM to use `dataset_now` anchor for relative dates on sample datasets — fixes Tier-1 invariant #2 for new segments. Includes worked examples for "today", "yesterday", "last 7 days", "this month".
- ✅ Funnel D14 forward-carry: probabilistic 42% retention, emits `second_booking_14d` for cohorts whose first_booking landed exactly 14 days before currentNow. Verified at tick 16 (28 of ~67 cohort customers retained ≈ expected rate)
- ✅ `synthetic_clock.last_deltas` column stores last tick's row counts as JSON; exposed via public clock endpoint
- ✅ `LiveTickToast` component: detects tickCount increase via clock polling, fires bottom-right toast with deltas, dismisses after 4.5s, suppressed when tab hidden, sessionStorage tracking prevents re-fires across route changes
- ✅ Status endpoint extended with `funnelEvents` breakdown + `datasetNowSegmentTest` to verify the LLM's pattern returns sensible counts

**Day 3 — DONE 2026-04-29**
- ✅ Public clock endpoint `GET /api/synthetic/clock?datasetId=` — returns `currentNow`, `lastTickSucceededAt`, `nextEstimateAt`, `isStale`, `neverTicked`
- ✅ `LiveDataPill` topbar component — three states (scheduled / live / stale), monochrome, polls every 30s, auto-rerenders for relative time
- ✅ Mounted in header strip of `layout-shell.tsx`
- ✅ `useLiveFreshness` hook with module-level cache so multiple consumers share one HTTP poll
- ✅ Per-segment card freshness display: "· N min ago" appended to count/created-at line (only when synthesis enabled + last tick exists)
- ✅ In-process scheduler `src/lib/synthetic/scheduler.ts` — wakes every 15min, fires within 07:30–08:00 UTC window (= 13:00 IST), env-gated by `SYNTHETIC_ENABLED` + `SYNTHETIC_LEADER`, HMR-safe via global symbol
- ✅ Cold-boot catch-up: fires one tick on boot if last success > intervalHours ago (clamped to one tick — no replay storm)
- ✅ Multi-replica safety via `SYNTHETIC_LEADER=true` env on a single replica
- ✅ `src/instrumentation.ts` — Next.js boot hook that registers the scheduler
- ✅ `docs/synthetic-data-ops.md` runbook — env vars, two scheduling paths (in-process vs external cron), endpoints, smoke checks, recovery procedures
- ✅ Funnel event emission: `signup_complete` + `first_booking` paired for every `is_first_booking=true` booking (~18% of new bookings → ~70 funnel events/day)

**Day 2 — DONE 2026-04-29**
- ✅ `daily_sessions__live` (1:1 derivation from new bookings, watermark-isolated)
- ✅ `funnel_events__live` infrastructure (DDL only — generation deferred to Day 3)
- ✅ Summary refresh: `daily_metrics`, `service_metrics`, `hub_metrics`, `monthly_metrics` rebuilt every tick (~400ms each, picks up live via UNION view)
- ✅ Cache invalidation: `metrics`, `explorer`, `entity-catalog` cleared post-tick
- ✅ Transaction wrapping: BEGIN/COMMIT around row mutations + summary refresh; ROLLBACK on failure prevents row leaks
- ✅ Reset-to-baseline endpoint: `TRUNCATE *_live` + clock reset + summary rebuild + cache invalidation
- ✅ `proxy.ts` exempts `/api/admin/synthetic/*` from Clerk so cron auth path works

**Verified at end of Day 2** (after reset + 3 fresh ticks):
- Public `bookings` view returns 192/day live (Mar 1–3) alongside seed (~620/day, Feb 24–28)
- `daily_metrics` summary agrees with bookings view counts row-for-row
- `daily_sessions` shows 192 live entries per new day + ~1900 seed entries per Feb day
- Clock advances 24h per tick; tick_count increments correctly
- Schema/system context show "Feb 2025 – Mar 2026" and "CURRENT DATE: 2026-03-03"

## Remaining phasing

**Day 1 — Foundation**
- `synthetic_clock` table for quickhelp; `getDatasetNow(datasetId)` helper
- `{{DATASET_NOW}}` substitution in `getSystemContext()`, `welcomeSubtitle`, `reportMeta.dateRangeLabel` for quickhelp
- One raw `__live` table for quickhelp's primary table (`bookings__live`); rewrite `bookings` view to UNION
- Minimal `runTick("quickhelp")` — appends jittered bookings only (no derived tables yet)
- `/api/admin/synthetic/tick` endpoint (manual, admin-gated)
- Smoke test: tick once, verify booking count moves in `/explore` and segments

**Day 2 — Cross-table consistency**
- Extend tick to derive: `funnel_events__live`, `comms_full__live`, `daily_sessions__live`
- Forward-carry queue for cohort events (signup today → second_booking_14d in 14 days)
- `__live` versions of the 3-4 most-queried summaries; rewrite views to UNION
- Cache invalidation on tick (metrics cache, entity catalog, explorer)

**Day 3 — Cron + UX layer 1 & 4**
- Vercel/Railway cron entry: `30 7 * * *` UTC = 13:00 IST → `/api/admin/synthetic/tick?datasetId=quickhelp&source=cron`
- `CRON_SECRET` auth on the route alongside admin user check
- Idempotency check (skip if last tick < 12h ago)
- Topbar "Live" pill with all three states (scheduled, fresh, stale)
- Per-segment "· {timestamp}" freshness display

**Day 4 — UX layer 2 (tick events) + bootstrap**
- Bootstrap-to-today admin endpoint (Q1c) — runs ~60-tick burst to fill seed-end → today
- Reset-to-baseline endpoint (Q4)
- Delta toast on tick (poll-based)
- Scout firing wired to tick events

**Day 5 — Polish + hardening**
- "Tick history" admin panel — last 30 ticks, row counts per table, errors
- `/api/health` includes `quickhelp.last_tick_at` and `tick_count`
- Catch-up logic with `?catchup=true` opt-in
- `SYNTHETIC_LEADER` env gate for multi-replica safety
- Acceptance checklist run-through (every Tier-1 invariant verified)

---

## Acceptance checklist (per Tier-1 invariant)

Before shipping v1, all of these must pass:

- [ ] LLM prompt includes current `DATASET_NOW` value, not seed end-date.
- [ ] User asks "show me last week" → SQL `WHERE date >= now() - INTERVAL '7 days'`, returns post-tick rows.
- [ ] Saved segment created on Day 0 has count > Day 0 count after 24h of ticks.
- [ ] Saved funnel/retention shows new conversions after ticks.
- [ ] Metric tile updates within 1 minute of tick (not 5).
- [ ] `last_tick_attempted_at - last_tick_succeeded_at > 2 * intervalMinutes` → pill shows error state.
- [ ] Cohort retention curves include D7/D14/D30 buckets for live cohorts after 30 days of ticks.
- [ ] Summary table queries return same answer as raw-table queries (within rounding).
- [ ] Reset returns dataset to seed state (verify row counts match seed exactly).
- [ ] Synthesis disabled (`SYNTHETIC_ENABLED=false`) → app behavior identical to current main.

---

## What this plan deliberately does NOT cover

- Real freshness for uploaded datasets (warehouse-connector workstream — separate)
- LLM-generated synthetic content at tick time (deterministic only, batch-pre-generated text pools if needed)
- Per-user synthetic streams (every viewer of a sample sees the same tick history)
- Real-time WebSocket push (poll the clock every 30s — simpler, sufficient)
- Multi-tenant isolation of synthetic data (samples are shared)
