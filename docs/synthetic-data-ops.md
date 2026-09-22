# Synthetic Live Data — Ops Runbook

## What this is
Daily synthetic-data tick keeps the **quickhelp sample dataset** feeling alive. One tick per real day, advances synthetic time by 24h, generates ~192 bookings + 192 daily_sessions, refreshes summary tables, busts caches.

Sample datasets only. Uploaded datasets are untouched.

## Required env vars

| Var | Purpose | Example |
|-----|---------|---------|
| `SYNTHETIC_ENABLED` | Master switch. `true` enables in-process scheduler. | `true` (prod), unset (dev default) |
| `SYNTHETIC_LEADER` | Multi-replica gate. Only set on **one** Railway replica. | `true` on leader |
| `CRON_SECRET` | Secret for external cron auth on tick endpoint. | random 32+ char string |
| `SYNTHETIC_ADMIN_USER_IDS` | Comma-separated Clerk userIds allowed to manually tick/reset. | `user_xxx,user_yyy` |

## Schedule
- **Target:** 13:00 IST daily (= 07:30 UTC)
- **In-process scheduler** wakes every 15min and fires within the 07:30–08:00 UTC window if last tick > 12h ago.
- **Idempotency** is enforced inside `runTick` — if last successful tick was < 12h ago, the tick is skipped. Safe to fire from multiple paths simultaneously.

## Two scheduling paths (use exactly one in prod)

### Path A: In-process scheduler (default, simplest)
- Set `SYNTHETIC_ENABLED=true` and `SYNTHETIC_LEADER=true` on one replica.
- Scheduler registered via `src/instrumentation.ts` at server boot.
- No external infra needed.
- Downside: ticks pause if the leader replica restarts during the 30-min window. Cold-boot catch-up handles missed days.

### Path B: External cron → HTTP
- Configure your cron host (Railway scheduled job, GitHub Actions, EasyCron, etc.) to:
  ```
  POST https://<your-host>/api/admin/synthetic/tick?datasetId=quickhelp
  Header: x-cron-secret: <CRON_SECRET>
  Schedule: 30 7 * * *  (UTC)
  ```
- Set `SYNTHETIC_ENABLED=false` (or omit) on app replicas — only the cron path fires ticks.

## Manual control endpoints (admin-only)

All require either `x-cron-secret: <CRON_SECRET>` header OR Clerk userId in `SYNTHETIC_ADMIN_USER_IDS`.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/admin/synthetic/tick?datasetId=quickhelp` | Run one tick (respects 12h idempotency). Add `&force=true` to override. |
| GET | `/api/admin/synthetic/status?datasetId=quickhelp` | Clock state + row counts + prompt preview. |
| GET | `/api/admin/synthetic/probe?datasetId=quickhelp` | Last-7d query against bookings + summary + sessions verification. |
| POST | `/api/admin/synthetic/reset?datasetId=quickhelp` | TRUNCATE all `*__live` tables + reset clock. |

## Public clock endpoint (any signed-in user)

`GET /api/synthetic/clock?datasetId=quickhelp` — used by the topbar "Live" pill (polls every 30s).

## Quick smoke check

```bash
# Status
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "https://<host>/api/admin/synthetic/status?datasetId=quickhelp" | jq

# Force a tick
curl -sX POST -H "x-cron-secret: $CRON_SECRET" \
  "https://<host>/api/admin/synthetic/tick?datasetId=quickhelp&force=true" | jq

# Reset to baseline
curl -sX POST -H "x-cron-secret: $CRON_SECRET" \
  "https://<host>/api/admin/synthetic/reset?datasetId=quickhelp" | jq
```

## What gets generated per tick (Day 3 state)

| Table | Mode | Rows/day |
|-------|------|----------|
| `bookings__live` | generate (jittered, weighted by seed distribution) | ~192 |
| `daily_sessions__live` | one-to-one with new bookings | ~192 |
| `funnel_events__live` | DDL only — generation deferred to Day 4 | 0 |

Summary tables rebuilt every tick: `daily_metrics`, `service_metrics`, `hub_metrics`, `monthly_metrics` (~400ms each).

Caches invalidated post-tick: `metrics`, `explorer`, `entity-catalog` (in-memory globals).

## Recovering from a stuck state

1. Stuck clock (status=error or last_tick_attempted_at >> last_tick_succeeded_at):
   - Check logs for the tick error.
   - Force a tick with `force=true`. If it succeeds, status flips back to ok.
2. Leaked rows from a pre-transaction failure:
   - Run `POST /api/admin/synthetic/reset` to start clean.
   - Pre-transaction leaks should not happen post-Day-2 (BEGIN/COMMIT around mutations).
3. Disagreement between bookings view and daily_metrics:
   - Force a tick — summaries refresh on every tick.
   - Or call `/api/admin/synthetic/reset` to fully rebuild.
