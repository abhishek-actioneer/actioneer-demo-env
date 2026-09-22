---
title: "feat: Sidebar UX Redesign — Phosphor Icons, Popups, Onboarding"
type: feat
date: 2026-02-24
brainstorm: docs/brainstorms/2026-02-24-sidebar-ux-redesign-brainstorm.md
branch: feat/sidebar-ux-redesign
---

# feat: Sidebar UX Redesign — Phosphor Icons, Popups, Onboarding

## Overview

A visual and interaction refresh of the sidebar that restructures the navigation into two labelled sections (Analytics, Actions), swaps icons to Phosphor duotone, widens the detail panel to 256px, replaces the Settings panel and UserPanel with lightweight click-triggered popup cards, and redesigns the onboarding widget to show a full-width pill + 7 Sentinel-adapted steps.

No backend changes. Routes that already exist are reused; no new routes required.

---

## Problem Statement

- Lucide line icons in the sidebar rail are visually thin with no depth hierarchy
- Settings and Account behave like nav destinations instead of utility actions
- The UserPanel is cramped with too many concerns (workspace, model, theme, logout)
- The onboarding widget shows generic steps in a small sidebar-rail button
- Several pages are unreachable from the sidebar: `/forecasting`, `/store` (hidden), `/data-catalog` (no entry point from rail)
- Knowledge, Connectors, and Data Catalog are three separate rail items when they belong together as one "Data" section

---

## Branch Setup

```bash
git checkout -b feat/sidebar-ux-redesign
pnpm add @phosphor-icons/react
```

---

## Technical Context

### Key files

| File | Role | What changes |
|------|------|--------------|
| `src/components/sidebar.tsx` | Main sidebar shell | Icon imports, RailIcon prop type, detail panel width, footer Popover wrappers |
| `src/components/sidebar/panels.tsx` | UserPanel (logout, model, theme), StorePanel | Remove UserPanel; model/theme/logout move to popups |
| `src/components/settings/settings-panel.tsx` | Existing settings panel | Removed; replaced by SettingsPopup trigger |
| `src/components/onboarding/onboarding-widget.tsx` | Onboarding progress widget | Trigger restyled to pill, 7 new Sentinel steps, popup direction top |
| `src/lib/onboarding-store.ts` | localStorage state for onboarding | Add 6 new step IDs; expand STEP_IDS |
| `src/components/ui/popover.tsx` | Radix Popover (already exists) | No changes needed |

### New files to create

| File | Purpose |
|------|---------|
| `src/components/sidebar/settings-popup.tsx` | Settings popup card (Billing, Usage, Model, Appearance) |
| `src/components/sidebar/account-popup.tsx` | Account popup card (email, Language, About, Get help, Logout) |

### Existing patterns to follow

**Popover pattern** (from `onboarding-widget.tsx`):
```tsx
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";

<Popover open={open} onOpenChange={setOpen}>
  <PopoverTrigger asChild>
    <button ...>trigger</button>
  </PopoverTrigger>
  <PopoverContent side="top" align="start" sideOffset={8} className="w-[280px] p-0">
    {/* content */}
  </PopoverContent>
</Popover>
```
`PopoverContent` portals to `document.body`, auto z-50, dismisses on outside click.

**CSS constants**: Import from `@/lib/sidebar-config` for consistent panel item styles.

**Hooks available**:
- `useTheme()` from `"next-themes"` → `{ theme, setTheme }`; values: `"light" | "dark" | "system"`
- `useModel()` from `"@/lib/model-context"` → `{ modelId, model, switchModel }`
- `useDataset()` from `"@/lib/dataset-context"` → workspace info

**Logout pattern** (keep exactly):
```tsx
<ConfirmDialog open={showLogout} onOpenChange={setShowLogout}
  title="Log out" description="Are you sure you want to log out?"
  confirmLabel="Log out" onConfirm={() => { window.location.href = "/"; }} />
```

**localStorage hydration rule** (from docs/solutions): Never read `localStorage` in `useState()` initializer. Always restore inside `useEffect()` after mount.

**No Tailwind arbitrary CSS variables**: Use `style={{ color: "var(--muted-foreground)" }}` not `text-[var(--muted-foreground)]`.

---

## Implementation Phases

### Phase 0 — Nav Restructuring

**Goal:** Align the sidebar's navigation items and type system with the Figma design before any visual changes. All routing and panel wiring is resolved here so Phase 1 only deals with icons/width.

#### 0a. New sidebar structure

The sidebar gains two labelled sections with section header text above each group:

```
+ New chat
○ All chats
──────────────
Analytics
  Canvas
  Metrics
  Playbooks
  Scouts
  Data
──────────────
Actions
  Monetisation
  Forecasting
  User segments
  Credit  (stub — disabled)
──────────────
[onboarding pill]
[Settings]  [Account]
```

**Removed from rail:**
- `Knowledge` — absorbed as a tab inside the Data page (`/data-catalog`)
- `Connectors` — absorbed as a tab inside the Data page (`/data-catalog`)
- `Metric Tree` — not present in Figma; remove rail item and hover panel (page at `/metric-tree` stays, just loses sidebar entry point for now)

**Added/changed:**
- `Data` → navigates to `/data-catalog` (already has Catalog / Connectors / Knowledge tabs)
- `Monetisation` → re-enables the hidden Store rail icon, routes to `/store`
- `Forecasting` → new rail item, routes to `/forecasting`
- `User segments` → rename of the existing `Segments` item (same route `/segments`)
- `Credit` → stub item, **disabled**, no route; shows "Coming soon" on click or is non-interactive

#### 0b. Update `HoverPanel` type union in `sidebar.tsx`

```ts
// BEFORE
type HoverPanel = "history" | "knowledge" | "metrics" | "metric-tree" | "segments"
  | "playbooks" | "scouts" | "canvas" | "connectors" | "settings" | "store" | "user" | null;

// AFTER
type HoverPanel = "history" | "metrics" | "segments" | "playbooks" | "scouts"
  | "canvas" | "data" | "monetisation" | "forecasting" | "settings" | "user" | null;
```

Removed: `"knowledge"`, `"connectors"`, `"metric-tree"`, `"store"`
Added: `"data"`, `"monetisation"`, `"forecasting"`
Note: `"credit"` intentionally omitted — stub item has no hover panel.

#### 0c. Update `getActivePage()` in `sidebar.tsx`

```ts
function getActivePage(pathname: string): string {
  if (pathname.startsWith("/metrics"))      return "metrics";
  if (pathname.startsWith("/metric-tree"))  return "metrics";   // re-parent to metrics active state
  if (pathname.startsWith("/segments"))     return "segments";
  if (pathname.startsWith("/playbooks"))    return "playbooks";
  if (pathname.startsWith("/scouts"))       return "scouts";
  if (pathname.startsWith("/canvas"))       return "canvas";
  if (pathname.startsWith("/data-catalog")) return "data";      // was "connectors"
  if (pathname.startsWith("/connectors"))   return "data";      // was "connectors"
  if (pathname.startsWith("/knowledge"))    return "data";      // was "knowledge"
  if (pathname.startsWith("/store"))        return "monetisation"; // was "store"
  if (pathname.startsWith("/forecasting"))  return "forecasting";  // new
  if (pathname.startsWith("/billing"))      return "settings";
  return "chat";
}
```

#### 0d. Update `pageToPanel()` in `sidebar.tsx`

```ts
const pageToPanel = (page?: string): HoverPanel => {
  switch (page) {
    case "chat":         return "history";
    case "metrics":      return "metrics";
    case "segments":     return "segments";
    case "playbooks":    return "playbooks";
    case "scouts":       return "scouts";
    case "canvas":       return "canvas";
    case "data":         return "data";
    case "monetisation": return "monetisation";
    case "forecasting":  return "forecasting";
    case "settings":     return "settings";
    default:             return "history";
  }
};
```

#### 0e. Panel components for new items

| Item | Panel needed | Approach |
|------|-------------|---------|
| `Data` | `DataPanel` (new) | Rename/repurpose `ConnectorsPanel`. Show 3 rows: Catalog (`/data-catalog`), Connectors (`/connectors`), Knowledge (`/knowledge`) + recent entries |
| `Monetisation` | Re-enable `StorePanel` | Already exists in `panels.tsx`. Unhide by adding the rail item. Optionally rename "Store" labels to "Monetisation" inside the panel. |
| `Forecasting` | None (simple navigate) | Click routes to `/forecasting` directly. No hover panel needed unless content warrants one. |
| `Credit` | None | Stub — no panel, non-interactive or "coming soon" tooltip |

**`DataPanel` spec:**
```
┌─────────────────────────────────────┐
│  Data                               │
├─────────────────────────────────────┤
│  🗄 Catalog        [12 tables]  →   │
│  ⚡ Connectors     [4 active]   →   │
│  💡 Knowledge      [13 entries] →   │
└─────────────────────────────────────┘
```
Each row is a button that navigates to the respective tab in `/data-catalog` (using a `?tab=catalog|connectors|knowledge` query param, or just navigating to `/data-catalog`, `/connectors`, `/knowledge` directly if tab routing is not yet implemented).

#### 0f. Section headers in rail

Add non-interactive section header labels between item groups:

```tsx
<p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/50 px-2 mt-2 mb-0.5">
  Analytics
</p>
```

These render inside the 75px rail column. At 75px wide they are very short — the label will likely be truncated or abbreviated. Consider:
- Using only the first few characters ("ANA", "ACT") as abbreviations at rail width
- OR rendering the section headers only in the detail panel header area
- OR accepting the truncation as a visual divider cue

This is a **layout decision to make during implementation** based on how it looks at 75px.

#### 0g. Credit stub item

Render as a disabled `RailIcon` with muted opacity:
```tsx
<RailIcon
  icon={Coin}
  label="Credit"
  disabled
  onClick={() => { /* no-op or show tooltip */ }}
  className="opacity-40 cursor-not-allowed"
/>
```

Update `RailIcon` to accept an optional `disabled` prop.

---

### Phase 1 — Icon Swap + Width Change

**Goal:** Replace all lucide icons in `sidebar.tsx` with Phosphor duotone equivalents and widen the detail panel.

#### 1a. Install Phosphor

```bash
pnpm add @phosphor-icons/react
```

#### 1b. Update `RailIcon` component in `sidebar.tsx`

Current prop type (line ~335):
```tsx
icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
```

New prop type (Phosphor icons use `weight` at import time, not as a prop):
```tsx
icon: React.ComponentType<{ className?: string; size?: number }>
```

Remove `strokeWidth={1.5}` from the JSX inside `RailIcon` (~line 343).

Phosphor duotone icons are imported with weight suffix in the import name OR via `weight="duotone"` prop. Use the `weight="duotone"` prop approach for clarity:
```tsx
// In each RailIcon instance:
<SomePhosphorIcon weight="duotone" className="..." size={20} />
```

Actually, Phosphor's approach: import the base icon, pass `weight="duotone"`:
```tsx
import { PlusCircle } from "@phosphor-icons/react";
<PlusCircle weight="duotone" size={20} />
```

#### 1c. Icon mapping

Replace lucide imports (lines 7–22 in sidebar.tsx) with the full new set:

| Section | Nav item | Lucide (remove) | Phosphor (add) | Route |
|---------|----------|----------------|----------------|-------|
| Top | New chat | `Plus` | `PlusCircle` | — |
| Top | All chats | `Clock` | `ChatCircle` | `/` |
| Analytics | Canvas | `LayoutDashboard` | `SquaresFour` | `/canvas` |
| Analytics | Metrics | `BarChart3` | `ChartBar` | `/metrics` |
| Analytics | Playbooks | `NotebookPen` | `BookOpenText` | `/playbooks` |
| Analytics | Scouts | `Radar` | `MagnifyingGlass` | `/scouts` |
| Analytics | Data | `Database` | `Database` | `/data-catalog` |
| Actions | Monetisation | *(was hidden)* | `CurrencyDollar` | `/store` |
| Actions | Forecasting | *(was missing)* | `TrendUp` | `/forecasting` |
| Actions | User segments | `UsersRound` | `UsersThree` | `/segments` |
| Actions | Credit | *(was missing)* | `Coin` | stub (disabled) |
| Footer | Settings | `Settings` | `GearSix` | popup |
| Footer | Account | *(avatar "A")* | `UserCircle` | popup |
| Rail util | Pin/Unpin | `Pin`, `PinOff` | `PushPin` (weight="fill"/"regular") | — |

**Removed from rail entirely:** `BookOpen` (Knowledge), `GitFork` (Metric Tree), `Database` as Connectors standalone — these routes still exist but are no longer top-level nav items.

> **Note:** Validate all icon names against `@phosphor-icons/react` exports during implementation — some names may differ. Let TypeScript errors guide corrections.

Also update `panels.tsx` lucide imports (lines 8–10) for icons that appear inside panel headers or list items.

#### 1d. Widen detail panel in `sidebar.tsx`

Two locations, both lines ~237–241:
```tsx
// Outer: w-[220px] → w-[256px]
// Inner: w-[220px] → w-[256px]
```

No changes to `flex-1` main content area; it reflows automatically.

---

### Phase 2 — Settings Popup

**Goal:** Replace the Settings navigation (currently opens SettingsPanel slide-in) with a click-triggered popup card.

#### 2a. Create `src/components/sidebar/settings-popup.tsx`

```
src/components/sidebar/settings-popup.tsx
```

**Component API:**
```tsx
export function SettingsPopup() { ... }
```

**Structure:**
```
┌──────────────────────────────────────┐
│ Settings                    [header] │
├──────────────────────────────────────┤
│ 🧾 Billing                           │
│ ⏱  Usage                  (disabled) │
│ 🤖 Model             [Flash 2.0 ▾]   │
├──────────────────────────────────────┤
│ Appearance                           │
│  [☀ Light]  [🌙 Dark]  [💻 System]   │
└──────────────────────────────────────┘
```

**Popup positioning:** `side="top"`, `align="start"`, `sideOffset={8}`, width ~300px.

**Billing row:** `onClick` navigates to `/billing` using `useRouter()` from `next/navigation`, then closes popup.

**Usage row:** Disabled. Show `"Coming soon"` badge or muted label, non-interactive.

**Model row:** Inline dropdown using `useModel()`. Reuse the existing hand-rolled dropdown pattern from `UserPanel` in `panels.tsx` (`bg-popover shadow-md rounded-md border border-border z-50`). Model list from `MODELS` in `@/lib/model-registry`.

**Appearance section (3-pill segmented control):**
- Three pills in a row: Sun icon (Light), Moon icon (Dark), Monitor icon (System)
- Icons only, no text labels
- Active pill: `bg-background shadow-sm rounded-md` on a `bg-muted rounded-lg` container
- Use `useTheme()` to read/set current theme
- Phosphor icons: `Sun weight="duotone"`, `Moon weight="duotone"`, `Desktop weight="duotone"`

```tsx
const themes = [
  { value: "light", Icon: Sun },
  { value: "dark", Icon: Moon },
  { value: "system", Icon: Desktop },
] as const;

<div className="flex rounded-lg bg-muted p-0.5">
  {themes.map(({ value, Icon }) => (
    <button
      key={value}
      onClick={() => setTheme(value)}
      className={`flex-1 flex items-center justify-center py-1.5 rounded-md transition-colors
        ${theme === value ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
    >
      <Icon size={14} weight={theme === value ? "fill" : "regular"} />
    </button>
  ))}
</div>
```

#### 2b. Wire `SettingsPopup` into `sidebar.tsx`

In the footer section where the Settings `RailIcon` currently is:
- Wrap in `<SettingsPopup>` or make `SettingsPopup` self-contained (Popover trigger + content)
- Remove the `onMouseEnter={() => setHoveredItem("settings")}` handler from this button
- Keep it as `onClick` only

Remove `SettingsPanel` import and usage from `sidebar.tsx`.

---

### Phase 3 — Account Popup

**Goal:** Replace the UserPanel slide-in with a click-triggered popup for account utilities.

#### 3a. Create `src/components/sidebar/account-popup.tsx`

```
src/components/sidebar/account-popup.tsx
```

**Structure:**
```
┌─────────────────────────────────────┐
│ user@example.com         [email row] │
├─────────────────────────────────────┤
│ 文A Language                       › │
│  ⓘ  About                           │
│  ?  Get help                         │
├─────────────────────────────────────┤
│ → Log out                            │
└─────────────────────────────────────┘
```

**Popup positioning:** `side="top"`, `align="start"`, `sideOffset={8}`, width ~280px.

**Email display:** The app has no client-side auth context exposing the user's email. For this implementation, use a placeholder or expose email via a small API call:
- **Simplest approach (recommended for demo):** Add a `/api/auth/me` route that reads the `session_token` cookie and returns `{ email }`. Call it on mount with `useEffect`. Show a loading skeleton while fetching.
- **Fallback:** Hardcode `"Admin User"` or a config variable until the API route is in place.

**Language / About / Get help:** Placeholder rows — render as styled `<button>` items, `onClick` is a no-op (or shows a toast "Coming soon").

**Log out row:** Use the existing `ConfirmDialog` pattern from `UserPanel`:
```tsx
const [showLogout, setShowLogout] = useState(false);

<button onClick={() => setShowLogout(true)}>Log out</button>
<ConfirmDialog
  open={showLogout}
  onOpenChange={setShowLogout}
  title="Log out"
  description="Are you sure you want to log out?"
  confirmLabel="Log out"
  onConfirm={() => { window.location.href = "/"; }}
/>
```

**UserPanel removal:** After `AccountPopup` is wired in, the `UserPanel` component in `panels.tsx` becomes unused. Remove its usage from `sidebar.tsx` and mark as dead code. Do NOT remove the file until confirmed unused — it contains workspace/dataset switching that may be needed later.

#### 3b. Wire `AccountPopup` into `sidebar.tsx`

Replace the current user avatar `<button>` at the footer (lines ~224–231) with `<AccountPopup />` (self-contained). Remove `onMouseEnter={() => setHoveredItem("user")}`.

Remove `UserPanel` from the `HoverPanel` type union and `pageToPanel()` mapping in `sidebar.tsx` if "user" is no longer a hover panel target.

---

### Phase 4 — Onboarding Widget Redesign

**Goal:** Redesign the existing onboarding widget from a progress-ring button to a full-width pill trigger, with 7 Sentinel-adapted steps.

#### 4a. Update `src/lib/onboarding-store.ts`

Current STEP_IDS (3 steps):
```ts
export const STEP_IDS = ["send-query", "view-report", "explore-data"] as const;
```

New STEP_IDS (7 steps):
```ts
export const STEP_IDS = [
  "signed-up",
  "connect-data-source",
  "run-first-analysis",
  "create-metric",
  "setup-playbook",
  "explore-canvas",
  "invite-team-member",
] as const;
```

The `signed-up` step should be auto-completed on first load (inside `getOnboardingState()` or in the widget's `useEffect`).

#### 4b. Update `src/components/onboarding/onboarding-widget.tsx`

**New STEPS array** (7 items):
```ts
const STEPS = [
  { id: "signed-up",           title: "Signed up",              icon: Heart },
  { id: "connect-data-source", title: "Connect a data source",  icon: Database },
  { id: "run-first-analysis",  title: "Run your first analysis", icon: ChartBar },
  { id: "create-metric",       title: "Create a metric",         icon: ChartPie },
  { id: "setup-playbook",      title: "Set up a playbook",       icon: BookOpenText },
  { id: "explore-canvas",      title: "Explore Canvas",          icon: SquaresFour },
  { id: "invite-team-member",  title: "Invite a team member",    icon: UsersThree },
];
```

Use Phosphor icons (duotone weight) for step icons, matching the sidebar icon set.

**Trigger pill redesign** (replaces progress-ring button):

Current trigger: circular 40×40px button with `<ProgressRing>` SVG.

New trigger:
```tsx
<button className="mx-2 mb-1 flex items-center gap-2 px-3 py-1.5 rounded-full
  bg-muted/60 hover:bg-muted text-sm text-foreground transition-colors">
  <span className="font-medium">Getting started</span>
  <span className="text-muted-foreground text-xs">{percent}%</span>
  <ChevronUp size={12} className={`ml-auto transition-transform ${open ? "rotate-180" : ""}`} />
</button>
```

**Popup direction change:** `side="top"` (currently `"right"`), `align="start"`, width 300px.

**Popup card redesign:**
```
┌──────────────────────────────────────────┐
│ Getting started          [···]  [↙ shrink]│
│ 14% completed · Nice start!              │
│ ════░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │  ← thin progress bar
│                                          │
│ ❤  Signed up                       ✓   │
│ 🗄  Connect a data source               │
│ 📊  Run your first analysis             │
│ 📈  Create a metric                     │
│ 📖  Set up a playbook                   │
│ ⬛  Explore Canvas                      │
│ 👥  Invite a team member    (stretch)   │
└──────────────────────────────────────────┘
```

Key details:
- Thin linear progress bar (not ring): `h-1 bg-muted rounded-full` + `bg-primary rounded-full` fill
- Motivational subtitle: vary by `percent` ("Nice start!", "Getting there!", "Almost done!")
- Completed steps: line-through title, checkmark icon in `text-emerald-500`
- `signed-up` is always complete on first render

**Placement:** The widget renders in the sidebar footer area. Currently it's mounted directly in `sidebar.tsx`. Keep that mount point. In the new 256px sidebar, the pill will span the content panel width naturally.

---

## Acceptance Criteria

### Phase 0 (Nav Restructuring)
- [ ] Sidebar shows two section headers: "Analytics" and "Actions"
- [ ] Analytics section: Canvas, Metrics, Playbooks, Scouts, Data
- [ ] Actions section: Monetisation, Forecasting, User segments, Credit (disabled)
- [ ] Knowledge, Connectors, Metric Tree no longer appear as rail items
- [ ] `HoverPanel` type union updated — no TypeScript errors
- [ ] `getActivePage()` correctly maps `/data-catalog`, `/connectors`, `/knowledge` → `"data"`
- [ ] `getActivePage()` correctly maps `/store` → `"monetisation"`, `/forecasting` → `"forecasting"`
- [ ] Navigating to `/data-catalog` highlights the Data rail item
- [ ] Navigating to `/store` highlights the Monetisation rail item
- [ ] Navigating to `/forecasting` highlights the Forecasting rail item
- [ ] Credit item is visually disabled and non-interactive
- [ ] `DataPanel` hover panel shows Catalog, Connectors, Knowledge rows with nav to respective pages
- [ ] `StorePanel` hover panel opens on Monetisation hover (re-enabled from hidden)

### Phase 1 (Icons + Width)
- [ ] `@phosphor-icons/react` installed in `package.json`
- [ ] All rail items use Phosphor duotone icons (verified visually)
- [ ] `RailIcon` component no longer passes `strokeWidth` prop
- [ ] Detail panel width is 256px (visually verified; no layout breakage in main content area)
- [ ] TypeScript compiles with no new errors

### Phase 2 (Settings Popup)
- [ ] Clicking the Settings rail icon opens a popup card; hover no longer triggers panel slide
- [ ] Popup contains: Billing row (navigates to `/billing`), Usage row (disabled), Model dropdown, Appearance 3-pill toggle
- [ ] Clicking outside the popup dismisses it
- [ ] Theme toggle correctly switches the app between light/dark/system
- [ ] Model dropdown shows available models; selection persists via `useModel()`
- [ ] Popup renders correctly in both dark and light mode
- [ ] No z-index bleed into main content area

### Phase 3 (Account Popup)
- [ ] Clicking the Account rail icon opens the account popup; hover no longer triggers panel slide
- [ ] Popup shows email (or placeholder), Language/About/Get help items, and Log out
- [ ] Log out shows confirmation dialog; confirmed logout navigates to `/`
- [ ] Popup renders correctly in both dark and light mode
- [ ] UserPanel is no longer used as a hover panel in the sidebar

### Phase 4 (Onboarding Widget)
- [ ] Widget trigger is a full-width pill showing "Getting started X%"
- [ ] Clicking pill opens upward popup with 7 Sentinel steps
- [ ] `signed-up` step is auto-completed on first load
- [ ] Progress percentage reflects completed steps
- [ ] Dismissing popup (click outside) closes it; pill stays visible
- [ ] State persists across page refreshes via localStorage
- [ ] When all steps complete: animation sequence plays, widget fades out

---

## Open Questions for Implementation

1. **Email in Account popup:** No client-side auth context currently exposes the user's email. Options: (a) Add `GET /api/auth/me` returning `{ email }`, (b) expose via env config `APP_EMAIL`, (c) keep as placeholder "Admin". Recommend option (a) for completeness.

2. **Phosphor icon final names:** Some icons in the mapping table may have slightly different export names in `@phosphor-icons/react`. Validate with TypeScript during implementation. Reference: https://phosphoricons.com (filter by "duotone").

3. **Popup z-index in dark mode:** Verify `PopoverContent` renders above all sidebar content including any active hover panels. The Radix portal approach should handle this automatically.

4. **`UserPanel` cleanup:** After Account popup is live, `UserPanel` in `panels.tsx` is dead code. Decide whether to delete it or keep as reference. The dataset/workspace switcher inside it may be needed in a future iteration.

---

## File Checklist

```
Modified:
  src/components/sidebar.tsx                   # HoverPanel type, getActivePage, pageToPanel,
                                               # rail items (sections, new items, removed items),
                                               # icons, width, popup wires, section headers
  src/components/sidebar/panels.tsx            # add DataPanel, re-enable StorePanel,
                                               # remove UserPanel usage, update lucide→Phosphor icons
  src/components/onboarding/onboarding-widget.tsx  # pill trigger, 7 steps, popup direction top
  src/lib/onboarding-store.ts                  # 7 new step IDs + STORAGE_VERSION bump

Created:
  src/components/sidebar/settings-popup.tsx    # Settings popup card
  src/components/sidebar/account-popup.tsx     # Account popup card

Optional:
  src/app/api/auth/me/route.ts                 # expose email to client for Account popup
```

---

## Dependencies & Risks

| Risk | Mitigation |
|------|-----------|
| Phosphor icon names differ from mapping table | Let TypeScript errors guide corrections during implementation |
| Popup z-index bleeds over main content | Radix portal auto-handles; test in both themes before finalizing |
| `UserPanel` removal breaks hover-panel routing | Check `pageToPanel()` and `HoverPanel` type union for "user" references |
| Onboarding step IDs change → existing localStorage state invalid | Add a `STORAGE_VERSION` check in `onboarding-store.ts` to clear stale state |
| `ConfirmDialog` import path change | Verify import from `@/components/ui/confirm-dialog` |
