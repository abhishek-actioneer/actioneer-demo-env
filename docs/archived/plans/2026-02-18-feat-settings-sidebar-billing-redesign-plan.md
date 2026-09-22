---
title: "feat: Replace Billing rail icon with Settings, redesign billing page"
type: feat
date: 2026-02-18
brainstorm: docs/brainstorms/2026-02-18-settings-sidebar-billing-redesign-brainstorm.md
---

# feat: Replace Billing Rail Icon with Settings + Billing Page Redesign

## Overview

Replace the dedicated "Billing" rail icon with a "Settings" gear icon. The Settings panel is a simple link list (Billing + 2 grayed placeholders). The `/billing` page is redesigned to show cost breakdowns by **team** and by **analysis mode** instead of per-query transaction history.

## Acceptance Criteria

- [x] Settings gear icon replaces Wallet/Billing icon at same rail position
- [x] Settings panel shows link list: Billing (clickable, shows credit balance preview), Notifications (grayed), API Keys (grayed)
- [x] Clicking Billing link in Settings panel navigates to `/billing`
- [x] Billing page shows balance overview + credit packs (unchanged)
- [x] Billing page shows **Cost by Team** horizontal bars (Analytics, Growth, Product, Revenue)
- [x] Billing page shows **Cost by Mode** horizontal bars (Deep Research, Quick Answer only)
- [x] Per-query transaction history table is removed from billing page
- [x] `creditVersion` reactivity works for Settings panel balance preview
- [x] Grayed placeholder items show `cursor-not-allowed`, no click action

## Implementation Steps

### Step 1: Update credit data model

**`src/lib/credit-types.ts`**
- Add `teamId?: string` to `CreditTransaction` interface (deductions only)

**`src/lib/credit-store.ts`**
- Bump `STORAGE_VERSION` from 1 → 2 (forces localStorage reset)
- Update seed data: add `teamId` to all deduction transactions, distributed across 4 teams
- Add helper: `getUsageByTeam(orgId?)` → `{ team: string; credits: number }[]`
- Add helper: `getUsageByMode(orgId?)` → `{ mode: string; credits: number }[]` (filter: deep + quick only, exclude direct)

### Step 2: Create SettingsPanel component

**`src/components/settings/settings-panel.tsx`** (new file)
- Read `creditVersion` from `useSidebarContext()` for balance reactivity
- Read balance from `getBalance()`
- Render link list:
  - Billing row: icon + "Billing" label + "552 credits" secondary text → `router.push("/billing")` on click
  - Notifications row: grayed, `pointer-events: none`, `cursor-not-allowed`, "Coming soon" sublabel
  - API Keys row: same disabled treatment
- Follow existing panel styling (ITEM/SECTION CSS constants from sidebar.tsx)

### Step 3: Update sidebar.tsx

**`src/components/sidebar.tsx`**
- `HoverPanel` type union (line 49): replace `"billing"` with `"settings"`
- `getActivePage` (line ~56): change `"/billing"` mapping to return `"settings"` (or keep returning `"billing"` and map in `pageToPanel`)
- `pageToPanel` (line ~95): map `"billing"` page → `"settings"` panel
- RailIcon block (line ~213): replace `Wallet` icon with `Settings` icon, label "Settings", hover/click targets `"settings"`
- Panel header (line ~252): add `{activePanel === "settings" && "Settings"}`
- Panel content (line ~282): replace `<BillingPanel />` with `<SettingsPanel />`
- Update import: swap `BillingPanel` for `SettingsPanel`

### Step 4: Redesign billing page

**`src/app/billing/page.tsx`**
- Keep: balance overview card, 7-day usage chart, credit packs section
- Remove: transaction history table + filter controls entirely
- Add: **Cost by Team** section — horizontal bar chart using `getUsageByTeam()` data
  - 4 rows: team name left, bar proportional to spend, credit amount right
  - Same blue (#3E63DD) bars, sorted descending by amount
  - All 4 teams always visible (even at 0)
- Add: **Cost by Mode** section — horizontal bar chart using `getUsageByMode()` data
  - 2 rows: Deep Research, Quick Answer
  - Same bar styling as team chart
- Use inline `style={{}}` for dynamic widths (no Tailwind arbitrary values)

### Step 5: Cleanup

- Remove or repurpose `src/components/billing/billing-panel.tsx` (no longer imported by sidebar)
- Remove unused imports from sidebar.tsx (Wallet icon if no longer used)

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Panel type | Link list (not data display) | 220px too tight for charts; keeps panel fast |
| Team data source | Hardcoded demo teams | Prototype — no real team management needed |
| Team assignment for new txns | Random from 4 teams | Demo believability without team selection UI |
| Direct Chat in mode chart | Excluded | User specified Deep Research + Quick Answer only |
| Chart style | Simple div-based horizontal bars | Matches existing 7-day usage chart pattern (no charting library) |
| Disabled items behavior | `pointer-events: none` + `cursor-not-allowed` | Minimal — no tooltip needed for prototype |

## Key Files

| File | Action |
|------|--------|
| `src/lib/credit-types.ts` | Add `teamId` field |
| `src/lib/credit-store.ts` | Bump version, update seeds, add aggregation helpers |
| `src/components/settings/settings-panel.tsx` | New — link list panel |
| `src/components/sidebar.tsx` | Replace billing → settings panel integration |
| `src/app/billing/page.tsx` | Redesign — team/mode charts, remove txn table |
| `src/components/billing/billing-panel.tsx` | Remove or archive |

## References

- Brainstorm: `docs/brainstorms/2026-02-18-settings-sidebar-billing-redesign-brainstorm.md`
- Sidebar 3-tier pattern: `docs/solutions/design-patterns/split-panel-to-sidebar-three-tier-consolidation.md`
- Sidebar state pattern: `docs/solutions/design-patterns/lift-sidebar-state-to-layout-context.md`
- Hydration gotcha: `docs/solutions/ui-bugs/hydration-mismatch-localstorage-usestate-Sidebar-20260218.md`
