---
title: Sidebar Icon Rail vs Flat Sidebar Mismatch
date: 2026-02-24
problem_type: ui_bug
component: Sidebar Navigation
symptom: |
  Initial implementation used a 75px icon rail + expanding detail panel architecture
  (following the written plan), but the Figma design reference showed a flat ~220px
  sidebar with horizontal icon+text items. The sidebar looked completely wrong —
  icons stacked vertically over clipped labels — instead of the clean flat nav in Figma.
tags:
  - sidebar
  - figma
  - design-reference
  - navigation
  - phosphor-icons
  - layout
  - plan-vs-figma-mismatch
related_files:
  - src/components/sidebar.tsx
  - src/components/sidebar/settings-popup.tsx
  - src/components/sidebar/account-popup.tsx
  - src/components/sidebar/panels.tsx
  - src/components/onboarding/onboarding-widget.tsx
  - src/lib/onboarding-store.ts
pr_url: https://github.com/Glitchcraft-Inc/baby-sentinel/pull/16
status: resolved
---

# Sidebar Icon Rail vs Flat Sidebar Mismatch

## Problem

While implementing `feat/sidebar-ux-redesign`, the written plan specified keeping the existing **75px icon rail + expanding detail panel** architecture. The plan was followed faithfully — Phosphor icons were installed, the type union was updated, new nav items were wired — but the result looked nothing like the Figma design reference.

**What we built (following the plan):**
- 75px rail with icons stacked vertically above clipped text labels
- Hover-triggered detail panel (220px → 256px) sliding in from the right
- Section headers truncated to ~8px in the 75px column

**What the Figma showed:**
- Single flat ~220px sidebar with no rail/panel split
- Each nav item: 15px icon on the LEFT + text label on the RIGHT (horizontal)
- Workspace header (logo + dataset name + caret) at top
- Full-width `bg-muted` rounded rectangle for the active item
- Settings and Account as plain footer items (not rail icon buttons)

The discrepancy was caught only after taking a screenshot with `agent-browser` and doing a direct side-by-side comparison with the Figma reference.

## Root Cause

**The plan text was ambiguous and architecturally inconsistent with the Figma.** The plan said "widen the detail panel to 256px" which implied keeping the rail, but the Figma illustration showed no rail at all — it showed the *panel content* as the full sidebar. The plan was written to describe incremental changes to an existing architecture, but the Figma represented a completely different layout paradigm.

**Rule derived:** When a plan and a Figma reference show different architectures, **Figma wins**. The plan describes intent; the Figma describes the experience.

## Solution

Complete rewrite of `sidebar.tsx` from the rail+panel architecture to a single flat sidebar:

### 1. Sidebar container — 220px fixed, flex-col

```tsx
<aside className="w-[220px] shrink-0 flex flex-col border-r border-border bg-background h-full">
```

No more `w-[75px]` rail + `w-[256px]` panel. One column, always visible.

### 2. Workspace header (logo + name + caret)

```tsx
const { dataset } = useDataset();

<div className="flex items-center gap-2 px-4 pt-4 pb-3">
  <img src="/grlogo.svg" alt="Sentinel" width={22} height={22} className="shrink-0" />
  <span className="text-[13px] font-medium text-foreground truncate flex-1">{dataset.label}</span>
  <CaretDown size={11} weight="bold" className="text-muted-foreground shrink-0" />
</div>
```

### 3. SidebarItem component — the core building block

```tsx
function SidebarItem({
  icon: Icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: React.ComponentType<{ size?: number; weight?: IconWeight; className?: string }>;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-2.5 px-2.5 py-[6px] rounded-lg text-left transition-colors ${
        disabled
          ? "opacity-40 cursor-not-allowed text-muted-foreground"
          : active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
      }`}
    >
      <Icon size={15} weight={active ? "fill" : "duotone"} className="shrink-0" />
      <span className="text-[13px] leading-none truncate">{label}</span>
    </button>
  );
}
```

Key details:
- Icon `weight="fill"` when active, `"duotone"` otherwise — gives visual emphasis without color
- `py-[6px]` not `py-1.5` — Tailwind v4 requires arbitrary values for exact pixel parity with Figma
- Active = `bg-muted` full-width pill, not just a color change

### 4. Section labels (gray uppercase)

```tsx
function SectionLabel({ label }: { label: string }) {
  return (
    <p
      className="text-[10px] font-semibold uppercase tracking-widest px-2.5 pt-1 pb-0.5"
      style={{ color: "var(--muted-foreground)", opacity: 0.5 }}
    >
      {label}
    </p>
  );
}
```

Note: `style={{ color: "var(--muted-foreground)", opacity: 0.5 }}` instead of `text-[var(--muted-foreground)]/50` — Tailwind v4 JIT can't evaluate CSS variables in arbitrary values at build time.

### 5. Popup triggers match SidebarItem styling

Settings and Account popups reuse the same button style as `SidebarItem` so they blend into the footer seamlessly:

```tsx
<PopoverTrigger asChild>
  <button className={`w-full flex items-center gap-2.5 px-2.5 py-[6px] rounded-lg text-left transition-colors ${
    open ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
  }`}>
    <GearSix size={15} weight="duotone" className="shrink-0" />
    <span className="text-[13px] leading-none">Settings</span>
  </button>
</PopoverTrigger>
```

### 6. Phosphor icon TypeScript fix — import `IconWeight`

```tsx
// ❌ Wrong — 'string' is not assignable to 'IconWeight'
icon: React.ComponentType<{ size?: number; weight?: string }>

// ✅ Correct — import the type
import { type IconWeight } from "@phosphor-icons/react";
icon: React.ComponentType<{ size?: number; weight?: IconWeight; className?: string }>
```

This affects both `sidebar.tsx` and `onboarding-widget.tsx` wherever Phosphor components are passed as props.

### 7. Onboarding store STORAGE_VERSION bump

When step IDs change, bump `STORAGE_VERSION` and check it first in `getOnboardingState()`:

```ts
const STORAGE_VERSION = 2; // Was 1

export function getOnboardingState(): OnboardingState {
  if (typeof window === "undefined") return defaults();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults();
    const parsed = JSON.parse(raw) as OnboardingState;
    // Version check BEFORE any other guard — clears stale state
    if (parsed.version !== STORAGE_VERSION) return defaults();
    return parsed;
  } catch {
    return defaults();
  }
}
```

`defaults()` always returns state with `version: STORAGE_VERSION`, so new persisted state is always current.

## Prevention

### 1. Figma wins over plan text when they conflict

If the plan says "keep the 75px rail" but the Figma shows a flat sidebar, **implement the Figma**. Plans describe intent; Figma describes the experience. Treat Figma dimensions, layout structure, and component hierarchy as the ground truth for visual implementation.

### 2. Take a screenshot early, not at the end

Use `agent-browser screenshot` within the first hour of implementing UI changes to catch architectural mismatches before they compound:

```bash
agent-browser open http://localhost:3000/[route]
agent-browser screenshot /tmp/check.png
# Compare visually against Figma reference immediately
```

Don't wait until all phases are complete. A 15-second screenshot at Phase 0 would have caught this.

### 3. Read the Figma for layout structure, not just styling

Before writing a line of code, answer: "Is this a rail+panel layout or a flat list?" The answer determines the entire component architecture. Check:
- Total sidebar width (rail+panel vs flat)
- Are items horizontal (icon-left + text-right) or vertical (icon-above + label-below)?
- Is there a workspace/header row?
- Are footer items styled as nav items or utility icons?

### 4. Plans referencing "keep existing architecture" are red flags

The phrase "keep the 75px rail" in a plan with a Figma showing something different is a contradiction. When spotted, resolve before implementation: ask the Figma and the plan to agree, or pick Figma as authoritative.

### 5. Use agent-browser in the work skill PR screenshot step

The work skill explicitly requires before/after screenshots before creating a PR. This is the natural gate for catching visual mismatches — don't skip it, even if it feels like extra overhead.

## Related Docs

- `docs/solutions/best-practices/sidebar-panel-replacement-checklist-Sidebar-20260219.md` — integration checklist for adding sidebar panels (the old architecture)
- `docs/solutions/design-patterns/split-panel-to-sidebar-three-tier-consolidation.md` — the 3-tier pattern this redesign replaces
- `docs/solutions/ui-bugs/hydration-mismatch-localstorage-usestate-Sidebar-20260218.md` — localStorage hydration rules that still apply (never read in `useState()` initializer)

## Design References

**Figma reference** (shared in conversation, 2026-02-24):
- Single flat sidebar ~210px wide
- Workspace header: logo + "Spektra ▾" dropdown
- Items: 15-16px icon left + 13px text right, ~32px row height
- Active item: full-width `bg-muted` rounded rectangle
- Section headers: 10px uppercase gray, `opacity: 0.5`
- Sections: "Analytics" (Canvas/Metrics/Playbooks/Scouts/Data) and "Actions" (Monetisation/Forecasting/User segments/Credit)
- Footer: Settings + Account as regular nav items → click → Popover card

Screenshot of final implementation matching Figma: `/tmp/sidebar-data.png` (captured 2026-02-24)
