# Synthetic Live Data — Production Deployment Runbook

**Goal:** ship synthesis code to Railway production for the quickhelp sample dataset, then bootstrap the dataset to today and start daily ticks. Zero data loss for existing users.

**Estimated total time:** ~1 hour wall-clock. Bulk is the 25-30 min bootstrap; everything else is minutes.

---

## Pre-flight checklist

Before starting, confirm:

- [ ] Synthesis code is on `main` (or whichever branch Railway deploys from)
- [ ] You have access to Railway project dashboard
- [ ] You have access to the GitHub repo (for Actions cron setup)
- [ ] Your Clerk userId is known (find at clerk.com → Users → your record → Copy ID)
- [ ] **`QUICKHELP_SCHEMA_VERSION` in `scripts/startup.sh` is unchanged** (currently `"2"`). Do NOT bump.
- [ ] Local typecheck clean: `pnpm exec tsc --noEmit`
- [ ] Local lint clean: `pnpm lint`

If any of these fail, fix before proceeding.

---

## Deployment sequence

There are three phases, each independently verifiable. **You can pause between phases** if anything looks wrong.

### Phase 1 — Deploy code in dormant mode (5 min)

The synthesis code ships disabled. App behaves identically to today.

#### 1.1 — Generate the cron secret

```bash
openssl rand -hex 32
```

Copy the output. You'll set this in two places (Railway env + GitHub secret).

#### 1.2 — Add Railway environment variables

In Railway dashboard → your service → Variables:

```
CRON_SECRET=<paste output of step 1.1>
SYNTHETIC_ADMIN_USER_IDS=<your_clerk_user_id>
SYNTHETIC_ENABLED=false
```

Do NOT set `SYNTHETIC_LEADER` (only matters when `SYNTHETIC_ENABLED=true`).

#### 1.3 — Merge + push to Railway

```bash
git checkout main
git merge feat/clerk-auth-merged    # or whichever branch holds synthesis
git push origin main
```

Railway auto-deploys. Watch deploy logs for:
- `[startup] Wrote N variables to .env.local` — confirm CRON_SECRET appears
- `[startup] QuickHelp database found on volume (schema v2) — skipping setup` (no rebuild — this is what we want)
- `Starting app...` — boot complete

#### 1.4 — Verify dormant state

```bash
# App alive
curl -s https://your-prod-host/api/health | jq

# Synthesis endpoint reachable but nothing happening
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "https://your-prod-host/api/admin/synthetic/status?datasetId=quickhelp" | jq '.clock'
```

Expected status response:
```json
{
  "currentNow": "2026-02-28T23:59:59.000Z",
  "tickCount": 0,
  "status": "ok"
}
```

**Existing users at this point:** see exactly what they saw before. No live pill (clock untouched), no behavioral change. Log into the app yourself, switch to quickhelp, confirm:
- Sample dataset still loads
- Old chat conversations preserved
- Saved segments load with their old counts
- Uploaded datasets unaffected

If anything looks wrong, **stop here.** Roll back: revert merge commit, redeploy. No bootstrap = no live data to clean up.

---

### Phase 2 — Bootstrap quickhelp to today (~30 min)

This is the long step. Idempotent and safe — can be re-run if it fails partway.

#### 2.1 — One-shot bootstrap

```bash
# Single 60-tick burst (clock: Feb 28 → Apr 29)
curl --max-time 1800 -X POST \
  -H "x-cron-secret: $CRON_SECRET" \
  "https://your-prod-host/api/admin/synthetic/tick?datasetId=quickhelp&action=burst&ticks=60" \
  -o /tmp/burst.json -w "HTTP %{http_code} time=%{time_total}s\n"
```

This blocks for ~25-30 min. Two ways to monitor in another terminal:

```bash
# Poll status every 30s
while true; do
  curl -s -H "x-cron-secret: $CRON_SECRET" \
    "https://your-prod-host/api/admin/synthetic/status?datasetId=quickhelp" \
    | jq '.clock | "tick \(.tickCount)/60  →  \(.currentNow[:10])"'
  sleep 30
done
```

Or watch Railway logs — each tick logs `[synthetic.scheduler] tick ok …`.

#### 2.2 — If the curl times out mid-burst

Possible: Railway sleeps the connection at 15-30 min. Doesn't matter — the burst keeps running on the server. Check status:

```bash
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "https://your-prod-host/api/admin/synthetic/status?datasetId=quickhelp" | jq '.clock'
```

If `tickCount < 60`, fire a new burst with the remaining count:

```bash
# E.g. if tickCount = 35, need 25 more
curl --max-time 1800 -X POST \
  -H "x-cron-secret: $CRON_SECRET" \
  "https://your-prod-host/api/admin/synthetic/tick?datasetId=quickhelp&action=burst&ticks=25"
```

Bursts use `force=true` internally so the idempotency guard doesn't block them.

#### 2.3 — Verify final state

```bash
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "https://your-prod-host/api/admin/synthetic/status?datasetId=quickhelp" | jq
```

Expected:
- `clock.currentNow`: `2026-04-29T23:59:59.000Z` (or whatever today is when you run this)
- `clock.tickCount`: 60
- `clock.status`: `"ok"`
- `bookings.live`: ~40,000–50,000
- `funnelEvents.signup_complete`: ~8,000
- `datasetNowSegmentTest.datasetToday`: today's date

#### 2.4 — Verify in the UI

Log into prod. Switch to quickhelp:
- Topbar shows `Live · just now` pill
- Visit `/segments` → cards show recent timestamps
- Ask the LLM "what is the latest date we have data for" → should answer **today's date**
- Old conversations and saved segments still present

If LLM says "Feb 28, 2026" → schema cache may be stale. Wait 30s, ask again. If still stale, hit `POST /api/admin/synthetic/status` (the act of reading triggers `setNowCache`).

---

### Phase 3 — Wire up the daily cron (10 min)

The bootstrap is a one-time catch-up. From here, daily ticks keep the dataset moving.

#### 3.1 — Add the GitHub Actions workflow

A `.github/workflows/synthetic-tick.yml` file is checked in (see deployment artifact). It runs at `30 7 * * *` UTC (= 13:00 IST) and POSTs to the tick endpoint.

#### 3.2 — Add GitHub repo secrets

In GitHub repo → Settings → Secrets and variables → Actions → New repository secret:

```
CRON_SECRET    = <same value as Railway env>
PROD_HOST      = https://your-prod-host.railway.app   (no trailing slash)
```

#### 3.3 — Trigger a manual run to verify

In GitHub → Actions tab → "Daily synthetic tick (quickhelp)" workflow → Run workflow.

Expected: workflow runs in ~5 seconds, exits 0. Body should contain `"status":"skipped"` or `"status":"ok"` (skipped if last tick was <12h ago — that's fine).

#### 3.4 — Verify next-day tick fired

24 hours after Phase 2 bootstrap, hit:

```bash
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "https://your-prod-host/api/admin/synthetic/status?datasetId=quickhelp" | jq '.clock'
```

Expected: `tickCount: 61`, `currentNow` advanced by 1 day, `lastTickSucceededAt` within last 24h.

If `tickCount` didn't move:
1. Check GitHub Actions for that day's workflow run — did it 200?
2. Check Railway logs for the tick attempt — any errors?
3. Idempotency guard? If you manually fired a tick within 12h of the cron, the cron one would skip.

---

## Rollback procedures

### If Phase 1 reveals a problem (code deploys but breaks something)

```bash
git revert HEAD
git push origin main
```

Railway redeploys. Quickhelp DB is untouched (no `__live` tables created yet because `ensureSyntheticInfrastructure` only runs on tick or status calls). Saved segments, conversations, uploaded data all unaffected. **Total data loss: zero.**

### If Phase 2 bootstrap creates wrong data

```bash
curl -X POST -H "x-cron-secret: $CRON_SECRET" \
  "https://your-prod-host/api/admin/synthetic/reset?datasetId=quickhelp"
```

This TRUNCATEs all `__live` tables, resets clock to Feb 28. Dataset returns to seed-only state. Re-burst to retry. **User data unaffected** (saved segments, chats, uploaded datasets all in different storage).

### If Phase 3 cron is too aggressive (firing mid-day) or wrong

Disable the workflow:

```bash
# In GitHub: Actions tab → workflow → "Disable workflow" toggle
```

Synthesis pauses. Existing live data stays. Re-enable when ready.

### If you need to roll the whole thing back permanently

```
1. Disable GitHub Actions workflow
2. POST /api/admin/synthetic/reset?datasetId=quickhelp  (clears live shards)
3. Set SYNTHETIC_ENABLED=false on Railway (already false, just confirm)
4. Optionally: revert merge commit
```

User data preserved at every step.

---

## Failure mode cheat sheet

| Symptom | Likely cause | Fix |
|---|---|---|
| Bootstrap times out at 15 min | Railway connection timeout | Check status, fire next burst with `ticks=N-tickCount` |
| `tickCount` not incrementing daily | GitHub Actions failed | Check Actions logs; manually retry workflow |
| Pill stuck on `Stale` | Last tick > 25h ago | Force tick: `?force=true` |
| Tick fails with `Out of Memory` | Live shard too large for 256MB DuckDB | Bump `DUCKDB_MEMORY_LIMIT` to `512MB`, redeploy |
| LLM says "Feb 2026" after bootstrap | Schema cache stale | Hit any `/api/admin/synthetic/status` to refresh |
| Live pill missing on quickhelp | Synthesis plan not registered for this dataset | Check `src/lib/synthetic/plans/index.ts` includes quickhelp |
| Cron fires twice in 12h window | Both manual + scheduled tick | Idempotency guard handles it (returns skipped) |
| Container slept past cron window | Railway Hobby idle timeout | Cron HTTP wakes container; cold-boot catch-up handles missed day |

---

## What changes for users — concrete list

### Visible changes
- Quickhelp users see new `Live · …` pill in topbar
- Saved segments display `· N min ago` next to count
- Tick toast (`+850 bookings · +4700 comms · …`) when tick lands while user has tab open
- LLM answers anchor to today's date instead of Feb 28, 2026
- Charts in quickhelp extend through today, not stop at Feb 28
- Saved-segment counts will drift over time (this is the feature)

### Invisible changes
- New tables in `quickhelp.duckdb`: `bookings__live`, `daily_sessions__live`, `funnel_events__live`, `partner_shifts__live`, `raw_*_live` for econ/comms/ads/payouts/surveys, plus `synthetic_clock`, `dataset_now`
- `bookings` and ~15 other public views rebound to UNION seed + live
- 17 summary tables rebuilt every tick
- New global caches on `globalThis` (tick history, now-cache, metric cache)
- New env vars: `CRON_SECRET`, `SYNTHETIC_ENABLED`, `SYNTHETIC_ADMIN_USER_IDS`

### Unchanged
- All other sample datasets (gameramp, vastu-hfc) — read-only, no synthesis
- All user-uploaded datasets — gated by `ownerId` check
- All saved metrics, funnels, scouts, chat conversations — different storage
- Clerk auth, onboarding, user metadata
- All existing API routes and their behavior

---

## Decision log

Documenting the calls made:

| Decision | Choice | Why |
|---|---|---|
| Cron mechanism | GitHub Actions external cron, not in-process | Container can sleep on Railway Hobby; HTTP wakes it |
| `SYNTHETIC_ENABLED` value | `false` in prod | External cron is the trigger; in-process scheduler not needed |
| Bootstrap timing | Manual curl after deploy, not in startup.sh | Healthcheck has 600s timeout; bootstrap takes 25-30 min |
| Bootstrap recovery | Restart-aware (check status, burst remaining ticks) | Single-shot bursts may exceed Railway HTTP timeout |
| Schema version | Do NOT bump | Avoid wiping the DB; live tables created idempotently at runtime |
| Live shard storage | Same `quickhelp.duckdb` file | One file simplifies ops; volume persists across deploys |
| Multi-replica | Not solved (single-replica only) | Railway Hobby is single-replica; revisit if you scale |
| Memory budget | 256MB sufficient at current scale | Heavy summaries (`weekly_company_kpis`) may OOM at year+ scale; bump to 512MB then |
| Other sample datasets | Out of scope for this rollout | Validate quickhelp in prod first; ~5 days each to add |
