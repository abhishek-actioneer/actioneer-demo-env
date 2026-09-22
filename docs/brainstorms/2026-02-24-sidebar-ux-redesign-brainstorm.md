# Sidebar UX Redesign — Brainstorm

**Date:** 2026-02-24
**Status:** Ready for planning
**Branch target:** `feat/sidebar-ux-redesign` (new fork from main)

---

## What We're Building

A visual and interaction refresh of the sidebar that softens the UI, adds richer utility popups for Settings and Account, and introduces an onboarding progress widget — all without changing the sidebar's core navigation structure.

**Scope summary:**
1. Swap lucide-react icons → Phosphor Icons (duotone weight) across all nav items
2. Widen sidebar from ~210px to 256px to breathe around the larger icons
3. Replace Settings panel/navigation → click-triggered popup card (Billing, Usage, Theme)
4. Replace Account/UserPanel → click-triggered popup card (email, Language, About, Get help, Logout)
5. New "Getting started" onboarding widget (pill + expandable card, localStorage state)

---

## Why This Approach

The current sidebar uses small, thin lucide line icons that are visually light — they don't give the sidebar visual hierarchy. Phosphor's **duotone** weight adds two-tone depth (opaque icon body + semi-transparent accent layer) which softens the UI without adding color noise. It's a well-established icon style in modern SaaS (Linear, Notion, Craft).

The Settings and Account items currently feel like nav destinations rather than utility actions. Replacing them with popups (similar to how Figma/Linear handle these) makes them feel contextual and lightweight — no full panel slide needed.

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Icon library | Phosphor Icons (`@phosphor-icons/react`) duotone weight | Native duotone variant, matches Figma exactly, good tree-shaking |
| Sidebar width | 256px | Confirmed from Figma spec (256W × 1030H) |
| Settings/Account trigger | Click (not hover) | More intentional — popups shouldn't flash on accidental hover |
| Popup positioning | Anchored to bottom-left, floating above the trigger item | Matches Figma card style |
| Onboarding default state | Collapsed pill | Unobtrusive; users who've onboarded aren't bothered |
| Onboarding persistence | localStorage | Simple, no backend needed for demo |
| Icon size in nav | ~20px duotone, inside 28px container | Matches Figma close-up proportions |
| Model selector location | Settings popup (new row) | Consolidates all config in one place |
| Theme toggle style | Inline 3-pill segmented control with icons (☀ Light / 🌙 Dark / 💻 System) | No sub-navigation needed; cleaner than a `>` flyout |
| Workspace switcher | Sidebar header (Spektra + chevron) | Already in Figma — no change needed |

---

## Detailed Change Inventory

### 1. Phosphor Duotone Icons

**Install:** `pnpm add @phosphor-icons/react`

**Icon mapping** (current lucide → Phosphor duotone):

| Nav Item | Current (lucide) | New (Phosphor duotone) |
|----------|-----------------|------------------------|
| New chat | `Plus` | `PlusCircle` |
| All chats | `Clock` | `ChatCircle` |
| Canvas | `LayoutDashboard` | `PresentationChart` |
| Metrics | `BarChart3` | `ChartBar` |
| Playbooks | `NotebookPen` | `BookOpenText` |
| Scouts | `Radar` | `MagnifyingGlass` |
| Data | `Database` | `Database` (Phosphor) |
| Monetisation | `UsersRound` | `CurrencyDollar` |
| Forecasting | `BarChart3` | `TrendUp` |
| User segments | `UsersRound` | `UsersThree` |
| Credit | `CreditCard` | `Coin` |
| Settings | `Settings` | `GearSix` |
| Account | `User` | `UserCircle` |

*Final icon choices to be validated against Phosphor's library during implementation.*

### 2. Sidebar Width: 210px → 256px

- Update the sidebar container width in `sidebar.tsx`
- No layout changes to the main content area expected (it uses `flex-1`)
- Adjust any hardcoded width references in context or CSS

### 3. Settings Popup Card

**Trigger:** Click on "Settings" item at sidebar footer
**Dismiss:** Click outside (use `useOutsideClick` or Radix Popover)
**Anchor:** Bottom-left, positioned above the Settings item

**Contents:**
```
┌──────────────────────────────────────┐
│ Settings                             │
├──────────────────────────────────────┤
│ 📋 Billing                           │
│ ⏱  Usage                            │
│ 🤖 Model          [Flash ▾]          │
├──────────────────────────────────────┤
│ Appearance                           │
│  [ ☀ Light ]  [ 🌙 Dark ]  [ 💻 System ] │
└──────────────────────────────────────┘
```

- Billing → navigates to `/billing` (existing route)
- Usage → placeholder (disabled, "Coming soon")
- Model → inline dropdown to switch Gemini model (moved from UserPanel)
- Appearance → 3-pill segmented control with icons, no text labels on pills; active pill is white card on dark bg (matches reference screenshot)

**Component:** New `SettingsPopup` component, replaces existing SettingsPanel trigger.

### 4. Account Popup Card

**Trigger:** Click on "Account" item at sidebar footer
**Dismiss:** Click outside
**Anchor:** Bottom-left, positioned above the Account item

**Contents:**
```
┌─────────────────────────────────────┐
│ analysis+nukebox@gameramp.com       │
├─────────────────────────────────────┤
│ 文A Language                       › │
│  ⓘ  About                          │
│  ?  Get help                        │
├─────────────────────────────────────┤
│ [→ Logout                          │
└─────────────────────────────────────┘
```

- Email: pulled from session/auth context (currently hardcoded as "Admin User")
- Language / About / Get help: placeholder actions (no routes yet)
- Logout: existing confirm dialog logic from current UserPanel

**Component:** New `AccountPopup` component. The existing `UserPanel` (workspace switcher, model switcher, theme toggle) is **removed** from this redesign — those utilities will live elsewhere or be added back later.

> **Open question:** Where do workspace switching and model selection go if UserPanel is removed? See Open Questions.

### 5. Onboarding "Getting started" Widget

**Location:** Between the last nav section and the Settings footer row, above the separator.

**Collapsed state (default):**
```
[ Getting started  14% ]  ▲
```
- Pill shape, left-aligned
- `▲` chevron on right indicates expandable
- Percentage derived from `completedSteps / totalSteps`

**Expanded state:**
```
┌──────────────────────────────────────────┐
│ Getting started          ···  ↙           │
│ 14% completed | Nice start!              │
│ ══════░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│                                          │
│ ❤  ~~Signed up~~                    ✓   │
│ ✉  Sync email account                   │
│ ↑  Connect a data source                │
│ ▦  Run your first analysis              │
│ 📊 Create a metric                      │
│ 📖 Set up a playbook                    │
│ 🗺  Explore Canvas                      │
└──────────────────────────────────────────┘
```

**Adapted onboarding steps for Sentinel:**
1. Signed up *(auto-completed on first load)*
2. Connect a data source
3. Run your first analysis
4. Create a metric
5. Set up a playbook
6. Explore Canvas
7. Invite a team member *(stretch)*

**Persistence:** `localStorage` key `sentinel:onboarding` — stores `{ completedSteps: string[], dismissed: boolean }`

**Component:** New `OnboardingWidget` component in `src/components/sidebar/`.

---

## What's NOT Changing

- Sidebar navigation structure (same sections, same items, same routes)
- The hover panel / detail panel system for analytics items (Canvas, Metrics, Playbooks etc.)
- Topbar / page content area
- Chat functionality

---

## Open Questions

- **Phosphor icon final picks** — Exact icon choices need visual review once `@phosphor-icons/react` is installed. Some duotone icons may look different than expected at small sizes.
- **Popup z-index and dark mode** — Popups render above sidebar content; need to ensure they don't bleed into the page content area and render correctly in both dark and light themes.

---

## Implementation Notes

- New branch: `feat/sidebar-ux-redesign` off `main`
- Main files touched: `src/components/sidebar.tsx`, `src/components/sidebar/panels.tsx`
- New files: `src/components/sidebar/settings-popup.tsx`, `src/components/sidebar/account-popup.tsx`, `src/components/sidebar/onboarding-widget.tsx`
- No API changes required
- No new routes required (Billing already exists at `/billing`)
