---
title: "feat: Multi-step onboarding wizard"
type: feat
status: active
date: 2026-03-30
---

# Multi-Step Onboarding Wizard

## Overview

Build a 4-step full-page onboarding flow that new users see after sign-up. Adapts the production Sentinel onboarding (light theme, GameRamp branding) into baby-sentinel's dark monochrome design language. All steps are mocked — no real integrations. The goal is pixel-perfect UX that exceeds the production reference.

## Flow

```
Sign Up (Clerk) → Step 1: Account → Step 2: Integrations → Step 3: Syncing → Step 4: Complete → App
```

### Step 1 — Tell us about yourself
- Fields: Organisation name, App name, Link to app/website
- All fields optional (can skip with Continue)
- Single centered card layout

### Step 2 — Connect your database
- Tabbed grid: Warehouse | MMP | Ad Networks | Others | Search
- Each tab shows a 4-column grid of connector cards (logo + name)
- Categories: collapsible with "See more" expansion
- Each category has subtitle + connect time estimate
- Clicking a connector toggles selection (dashed border highlight)
- "Upload CSV" option at the bottom
- Continue button (enabled when ≥1 source selected OR skip)

### Step 3 — Database connected / Syncing
- Shows selected connectors with "Connected, syncing..." status + spinner
- Two CTAs: "Add more connectors" (back to step 2) | "Select sample data" (forward to step 4)
- If no real connectors selected, auto-advance to step 4

### Step 4 — Get started with sample data
- 2×2 grid of dataset cards matching baby-sentinel's actual datasets:
  - Quick Help (Demo) — Q&A platform with service bookings
  - GameRamp (Demo) — Mobile gaming user acquisition
  - Vastu HFC (Demo) — Property lending & home finance
  - eCommerce (Demo) — Online retail transaction data
- Single-select with highlight border on active card
- "Continue to Actioneer" button

### Welcome Modal (over main app)
- Centered dialog over the full app layout (sidebar visible behind)
- Icon + "Welcome to Actioneer" + "Your analytics workspace is ready to use"
- Shows selected dataset name + description
- "Start Exploring" CTA dismisses modal, marks onboarding complete

## Stepper

Horizontal progress bar at the top of every step page:
- 4 steps: Account → Integrations → Syncing → Complete
- States: completed (check icon) | active (filled number) | pending (outlined number)
- Connecting lines between steps, filled when complete
- Monochrome: foreground for completed/active, muted-foreground for pending

## Architecture

### Route Structure

```
src/app/onboarding/
├── layout.tsx          — Full-page layout (no sidebar), stepper, step transitions
├── page.tsx            — Redirect to /onboarding/account
├── account/page.tsx    — Step 1: Tell us about yourself
├── connect/page.tsx    — Step 2: Connect your database
├── syncing/page.tsx    — Step 3: Database connected
└── complete/page.tsx   — Step 4: Sample data selection
```

### State Management

**`src/lib/onboarding-store.ts`** — Extend existing store (already has localStorage + versioning):
- Add `accountInfo: { orgName, appName, appUrl }`
- Add `selectedConnectors: string[]`
- Add `selectedDataset: string`
- Add `onboardingComplete: boolean`
- Bump `STORAGE_VERSION` to force clean state

### Components

```
src/components/onboarding/
├── onboarding-stepper.tsx    — Horizontal step indicator (reuse quick-mode-progress pattern)
├── connector-grid.tsx        — Tabbed grid of connector cards
├── connector-card.tsx        — Individual connector with logo, name, selection state
├── dataset-card.tsx          — Sample dataset selection card
├── syncing-card.tsx          — Connected source with spinner
└── welcome-modal.tsx         — Final welcome dialog over main app
```

### Middleware Gate

In `src/proxy.ts` (Clerk middleware), add `/onboarding(.*)` to public routes. In `layout-shell.tsx`, bypass providers for `/onboarding` paths (same pattern as `/sign-in`).

Separately, add a check: if user is authenticated but `onboardingComplete` is false, redirect to `/onboarding`. This goes in `layout-shell.tsx` reading from `onboarding-store.ts`.

### Animations

Per codebase animation standards (`ui-engineering/animations.md`):
- **Step transitions:** 300ms ease-out fade + 12px slide (same as sign-in page)
- **Connector card selection:** 150ms ease border highlight
- **Stepper progress:** 200ms ease-in-out line fill
- **Welcome modal:** 200ms ease-out fade-in + zoom-in-95 (matches existing dialog)
- **Respect `prefers-reduced-motion`**

## Implementation Phases

### Phase 1: Foundation
- [ ] Extend `onboarding-store.ts` with new fields, bump version
- [ ] Create `src/app/onboarding/layout.tsx` — full-page dark layout with stepper
- [ ] Create `onboarding-stepper.tsx` component
- [ ] Add `/onboarding` to middleware public routes
- [ ] Add `/onboarding` bypass in `layout-shell.tsx`
- [ ] Create `src/app/onboarding/page.tsx` redirect

### Phase 2: Step Pages
- [ ] `account/page.tsx` — 3 input fields + Continue button
- [ ] `connect/page.tsx` — Tabbed connector grid with mock data
- [ ] `connector-grid.tsx` + `connector-card.tsx` components
- [ ] `syncing/page.tsx` — Selected connectors syncing state
- [ ] `syncing-card.tsx` component
- [ ] `complete/page.tsx` — Dataset selection grid
- [ ] `dataset-card.tsx` component

### Phase 3: Welcome & Gate
- [ ] `welcome-modal.tsx` — Over main app, shows selected dataset
- [ ] Wire welcome modal into main app (show on first visit after onboarding)
- [ ] Add onboarding gate: redirect unauthenticated+incomplete users to /onboarding
- [ ] Step transitions with motion animations

### Phase 4: Polish
- [ ] Keyboard navigation (Tab through fields, Enter to continue, arrow keys for cards)
- [ ] Back navigation between steps
- [ ] Skip functionality (proceed without filling optional fields)
- [ ] Loading/transition states
- [ ] Mobile responsive (stack grid to 2 columns, then 1)

## Connector Mock Data

Use existing `CONNECTOR_CATEGORIES` from `src/lib/connector-categories.ts`:
- **Warehouse** (instant): BigQuery, Snowflake, Redshift, PostgreSQL, Databricks, ClickHouse, MySQL, MongoDB, Supabase, PlanetScale, SingleStore, CockroachDB
- **MMP** (5-10 min): AppsFlyer, Adjust, Singular, Branch, Kochava, Tenjin, Airbridge, Metrica
- **Ad Networks** (5-10 min): Meta Ads, Google Ads, TikTok Ads, Unity Ads, AppLovin, ironSource, Snap Ads, X Ads, Apple Search Ads, Chartboost, Vungle, Liftoff
- **Others** (varies): Stripe, RevenueCat, Firebase, Amplitude, Mixpanel, Slack, HubSpot, Salesforce, Zendesk, Intercom, Segment, mParticle

Each card shows a placeholder square (gray) + name. Selection = dashed border highlight.

## Dataset Cards

Pull from existing datasets in `src/lib/datasets/`:
```
| ID          | Label       | Description                                          |
|-------------|-------------|------------------------------------------------------|
| quickhelp   | Quick Help  | Q&A platform with service bookings & partner data    |
| gameramp    | GameRamp    | Mobile gaming user acquisition & monetization        |
| vastu-hfc   | Vastu HFC   | Property lending & home finance company              |
| ecommerce   | eCommerce   | Online retail transaction & event data               |
```

Each card: name + "Demo" badge + one-line description. Single-select highlight.

## Design Tokens (Dark Monochrome)

```
Page background:       #111
Card background:       #161616
Card border:           #282828
Card border (hover):   #333
Card border (selected): #e8e8e8 (dashed)
Input background:      #161616
Input border:          #282828
Input text:            #e8e8e8
Placeholder:           #444
Label:                 #888
Primary button:        bg-#e8e8e8 text-#111
Muted text:            #555
Stepper completed:     #e8e8e8
Stepper pending:       #444
```

## Success Criteria

- [ ] New user after Clerk sign-up lands on onboarding (not main app)
- [ ] All 4 steps render with correct content and dark theme
- [ ] Stepper accurately reflects current progress
- [ ] Connector grid is tabbed, filterable, and selectable
- [ ] Dataset selection persists and determines active dataset in app
- [ ] Welcome modal appears once on first app visit after onboarding
- [ ] Onboarding state persists across page refreshes (localStorage)
- [ ] Back/forward browser navigation works between steps
- [ ] Keyboard accessible throughout
- [ ] Animations are smooth, 60fps, respect reduced-motion

## Sources

- Production Sentinel screenshots (5 reference images provided by user)
- Existing onboarding store: `src/lib/onboarding-store.ts`
- Connector categories: `src/lib/connector-categories.ts`
- Quick-mode progress stepper: `src/components/chat/quick-mode-progress.tsx`
- Animation standards: `ui-engineering/animations.md`
- Segment detail panel patterns: `docs/solutions/design-patterns/segment-detail-panel-ux-patterns.md`
- Sidebar state lift pattern: `docs/solutions/design-patterns/lift-sidebar-state-to-layout-context.md`
