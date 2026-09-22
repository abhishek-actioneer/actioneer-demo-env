---
title: Billing Page Redesign
type: feat
status: active
date: 2026-04-09
---

# Billing Page Redesign

## Overview

Simplify `/billing` from 6 sections (balance card, 7-day chart, cost-by-team bars, cost-by-mode bars, credit packs grid, transaction ledger) into a clean Cursor/Claude-style single page with 4 sections. Eliminate redundant visualizations — each section answers one distinct question.

## Problem

Current page shows the same usage data in 3 different chart forms (daily bars, team horizontal bars, mode horizontal bars). Credit packs are buried below analytics. No distinction between chat queries and background agent consumption (schema mapper, playbooks, scouts).

## Design

### Layout (top to bottom)

```
┌─────────────────────────────────────────────────┐
│ STICKY BANNER                                   │
│ ┌──────────────────────┐  ┌───────────────────┐ │
│ │ 453 credits remaining│  │ [Top Up Credits ▾] │ │
│ │ Acme Corp            │  │   (dropdown packs) │ │
│ └──────────────────────┘  └───────────────────┘ │
├─────────────────────────────────────────────────┤
│                                                 │
│ USAGE THIS PERIOD                               │
│ ┌─────────────────────────────────────────────┐ │
│ │ ████████████████░░░░░░░░░  47 / 500 used    │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ DAILY USAGE (last 30 days)                      │
│ ┌─────────────────────────────────────────────┐ │
│ │  ▐ stacked bar chart                        │ │
│ │  ▐ ■ Chat  ■ Background Agents              │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ ACTIVITY                                        │
│ ┌──────┬───────────────────┬────────┬─────────┐ │
│ │ Date │ Description       │ Source │ Credits │ │
│ ├──────┼───────────────────┼────────┼─────────┤ │
│ │ Apr 8│ Revenue breakdown │ Chat   │ -12     │ │
│ │ Apr 8│ Schema re-index   │ Mapper │ -3      │ │
│ │ Apr 7│ Growth pack       │ Top-up │ +500    │ │
│ └──────┴───────────────────┴────────┴─────────┘ │
└─────────────────────────────────────────────────┘
```

### Section Details

**1. Sticky Banner** (`sticky top-0 z-10 bg-background border-b`)
- Left: credit balance (large tabular-nums) + org name
- Right: "Top Up Credits" button that opens a dropdown with 3 packs (Starter/Growth/Pro) — not 3 separate cards
- Stays visible on scroll so user always sees balance

**2. Usage This Period**
- Single horizontal progress bar: credits used vs. starting balance this period
- Label: "47 of 500 credits used" — simple, scannable
- Muted bar background, foreground fill

**3. Daily Usage Chart**
- Stacked bar chart, last 30 days (configurable)
- Two series: **Chat** (foreground) and **Background Agents** (muted-foreground)
- Built with divs (existing pattern), no chart library needed
- Hover tooltip showing date + chat credits + agent credits
- Background Agents = sum of playbook + scout + schema mapper deductions

**4. Activity Table**
- Columns: Date, Description, Source, Credits, Balance
- Source column: tag/badge — `Chat` | `Playbook` | `Scout` | `Schema Mapper` | `Top-up`
- Description: question preview for chat, agent/playbook name for background, pack name for top-ups
- Credits: green `+N` for top-ups, muted `-N` for deductions
- Show last 20 transactions, "Show more" link at bottom

## Implementation

### Phase 1: Data Layer Changes

**`src/lib/credit-types.ts`**
- Add `source` field to `CreditTransaction`: `"chat" | "playbook" | "scout" | "schema-mapper" | "topup"`
- Remove `teamId` from transaction type (replaced by `source`)

**`src/lib/credit-store.ts`**
- Update seed data to include `source` field on mock transactions
- Add a few mock background agent transactions (playbook run, scout check, schema map)
- Remove `getUsageByTeam()` and `getUsageByMode()` (no longer needed)
- Add `getDailyUsageBySource(days)` — returns `{ date, chat, agent }[]` for chart
- Update `getDailyUsage()` to support 30 days
- Update `deductCredits()` to accept `source` in meta

### Phase 2: Page Rewrite

**`src/app/billing/page.tsx`** — full rewrite, same file
- Sticky banner section with balance + dropdown top-up
- Usage progress bar
- Daily stacked bar chart (div-based, no library)
- Activity table with source tags
- Remove all old chart sections (team bars, mode bars)
- Keep `FeatureGate` wrapper, `useSidebarContext` subscription

### Phase 3: Wire Background Agent Credits

**`src/hooks/use-analytics.ts`**
- Update `deductCredits()` calls to pass `source: "chat"`

**Future (not this PR):**
- Playbook executor → deduct with `source: "playbook"`
- Scout runner → deduct with `source: "scout"`
- Schema enricher → deduct with `source: "schema-mapper"`

(These don't run real credits yet — just ensuring the type is ready)

## Acceptance Criteria

- [ ] Sticky banner shows balance + top-up dropdown, stays fixed on scroll
- [ ] Usage progress bar shows credits consumed this period
- [ ] Stacked bar chart renders 30 days of daily usage (chat vs. agents)
- [ ] Activity table shows all transactions with correct source tags
- [ ] Top-up flow works: dropdown → pick pack → toast → balance updates → banner reflects change
- [ ] No colorful accents — monochrome only (muted, foreground, border tokens)
- [ ] Responsive: single column on mobile, same structure
- [ ] Old charts (team bars, mode bars, separate credit pack cards) are removed

## Files Changed

| File | Change |
|------|--------|
| `src/lib/credit-types.ts` | Add `source` field to `CreditTransaction` |
| `src/lib/credit-store.ts` | Update seed data, add `getDailyUsageBySource()`, remove team/mode aggregations |
| `src/app/billing/page.tsx` | Full rewrite — sticky banner, usage bar, chart, table |
| `src/hooks/use-analytics.ts` | Pass `source: "chat"` to `deductCredits()` calls |
