---
title: "refactor: Migrate @phosphor-icons/react to HugeIcons"
type: refactor
date: 2026-02-25
---

# refactor: Migrate @phosphor-icons/react to HugeIcons

## Overview

Replace all `@phosphor-icons/react` icon usage with the HugeIcons library (`@hugeicons/react` + `@hugeicons/core-free-icons`). This is a pure visual/library swap — no feature behavior changes. 6 source files are affected across the sidebar and onboarding subsystems.

## Problem Statement / Motivation

The project currently uses two icon libraries (`@phosphor-icons/react` and `lucide-react`). Migrating the Phosphor icons to HugeIcons consolidates to a preferred visual style and makes the sidebar/onboarding icons consistent with the broader design direction.

> ⚠️ **Lucide is NOT a migration target.** It's used across 60+ files in chat, metrics, canvas, and other features. Only Phosphor icons are being replaced.

## Scope

**6 affected files:**

| File | Phosphor Icons |
|---|---|
| `src/components/sidebar.tsx` | 11 icons + `IconWeight` type |
| `src/components/sidebar/workspace-switcher.tsx` | 5 icons |
| `src/components/sidebar/account-popup.tsx` | 5 icons |
| `src/components/sidebar/settings-popup.tsx` | 7 icons |
| `src/components/onboarding/onboarding-widget.tsx` | 10 icons + `IconWeight` type |
| `src/components/sidebar/panels.tsx` | 3 icons |

**Total: 33 distinct Phosphor icons** to replace.

## Proposed Solution

### Architecture Difference (Critical)

HugeIcons uses a **renderer + data** pattern, fundamentally different from Phosphor:

```tsx
// Phosphor: icon IS a React component
import { Database } from '@phosphor-icons/react';
<Database size={16} weight="fill" />

// HugeIcons: icon is a data object, passed to a renderer
import { HugeiconsIcon } from '@hugeicons/react';
import { Database01Icon } from '@hugeicons/core-free-icons';
<HugeiconsIcon icon={Database01Icon} size={16} />
```

This means:
- **Dynamic icon arrays** (e.g., `STEPS` in onboarding, nav items in sidebar) currently store `React.ComponentType<{ size, weight, className }>`. After migration, they store `IconSvgElement`.
- **No `weight` prop exists** in the free tier. The free tier is stroke-rounded only.
- **Active/inactive state** (currently `weight="fill"` vs `weight="duotone"`) is replaced by `altIcon` + `showAlt` props, or by importing from separate pro style packages.

### Free Tier Strategy for Active/Inactive States

The free tier (`@hugeicons/core-free-icons`) only includes stroke-rounded icons — there is no duotone or solid variant. Two options for handling active state:

**Option A — `altIcon`/`showAlt`** (recommended if Pro is available):
```tsx
// Import stroke variant from free tier, solid from pro
import { Database01Icon } from '@hugeicons/core-free-icons';
import { Database01Icon as Database01SolidIcon } from '@hugeicons-pro/core-solid-rounded';

<HugeiconsIcon icon={Database01Icon} altIcon={Database01SolidIcon} showAlt={isActive} size={16} />
```

**Option B — strokeWidth variation** (free tier only):
```tsx
// Thicker stroke for active, thinner for inactive
<HugeiconsIcon icon={Database01Icon} size={16} strokeWidth={isActive ? 2 : 1.5} />
```

**Option C — color/opacity** (free tier only):
```tsx
// Use className to differentiate active vs inactive
<HugeiconsIcon icon={Database01Icon} size={16} className={isActive ? "text-foreground" : "text-muted-foreground"} />
```

> The plan author should decide which approach to take before implementation. Option B or C work with the free tier and are the simplest.

### Recommended Wrapper Component

Create a thin wrapper to enforce project defaults and keep call sites clean:

```tsx
// src/components/ui/icon.tsx
import { HugeiconsIcon, type HugeiconsProps, type IconSvgElement } from '@hugeicons/react';

export type { IconSvgElement };

export type IconProps = Omit<HugeiconsProps, 'ref'> & {
  icon: IconSvgElement;
  size?: number;
};

export function Icon({ size = 16, strokeWidth = 1.5, ...props }: IconProps) {
  return <HugeiconsIcon size={size} strokeWidth={strokeWidth} {...props} />;
}
```

This provides a single place to change defaults (size, strokeWidth) across all icons.

## Technical Considerations

### TypeScript Type Changes

`IconWeight` from `@phosphor-icons/react` is used as a generic constraint in two files:

```ts
// Before — in sidebar.tsx and onboarding-widget.tsx
import { type IconWeight } from "@phosphor-icons/react";
icon: React.ComponentType<{ size?: number; weight?: IconWeight; className?: string }>;

// After — icon is data, not a React component
import { type IconSvgElement } from '@hugeicons/react';
icon: IconSvgElement;
```

The `SidebarItem` component in sidebar.tsx, the `STEPS` array in onboarding-widget.tsx, and the `THEMES` array in settings-popup.tsx all need this type change.

### Package Changes

```bash
# Remove
pnpm remove @phosphor-icons/react

# Add
pnpm add @hugeicons/react @hugeicons/core-free-icons
```

No changes to `next.config.ts` needed — HugeIcons is pure ESM/CJS with no native Node bindings (unlike DuckDB which is in `serverExternalPackages`).

### Memory Update Required

After migration, update `MEMORY.md` to replace the Phosphor sidebar pattern entry with the HugeIcons pattern.

## Icon Mapping Table

All 33 Phosphor icons and their proposed HugeIcons equivalents. **Verify icon names against `@hugeicons/core-free-icons` type definitions before implementing** — numbered variants (01, 02, 03) differ visually and should be browsed at hugeicons.com.

| Phosphor Icon | Proposed HugeIcons Equivalent | Notes |
|---|---|---|
| `PlusCircle` | `PlusSignCircleIcon` | Verify variant |
| `ChatCircle` | `Message01Icon` | Or `BubbleChatIcon` |
| `SquaresFour` | `Grid01Icon` | Or `LayoutGrid01Icon` |
| `ChartBar` | `BarChart01Icon` | Verify variant |
| `BookOpenText` | `BookOpen01Icon` | Or `Book01Icon` |
| `MagnifyingGlass` | `Search01Icon` | Confirmed in research |
| `Database` | `Database01Icon` | Confirmed in research |
| `Users` | `UserGroupIcon` | Or `UserMultipleIcon` |
| `ChartLine` | `LineChartIcon` | Or `ChartLineData01Icon` |
| `UsersThree` | `UserGroup03Icon` | Verify variant |
| `CurrencyCircleDollar` | `DollarCircleIcon` | Or `Money01Icon` |
| `Buildings` | `Building01Icon` | Or `Building02Icon` |
| `UploadSimple` | `Upload01Icon` | Or `UploadCircle01Icon` |
| `Check` | `Tick01Icon` | Confirmed in research |
| `CaretDown` | `ArrowDown01Icon` | Or `ChevronDownIcon` |
| `Trash` | `Delete01Icon` | Confirmed in research |
| `UserCircle` | `UserCircleIcon` | Or `User02Icon` |
| `Translate` | `LanguageCircleIcon` | Or `Translate01Icon` |
| `Info` | `InformationCircleIcon` | Or `AlertCircleIcon` |
| `Question` | `HelpCircleIcon` | Or `QuestionIcon` |
| `SignOut` | `Logout01Icon` | Confirmed in research |
| `GearSix` | `Settings01Icon` | Confirmed in research |
| `Receipt` | `Invoice01Icon` | Or `ReceiptIcon` |
| `Robot` | `ArtificialIntelligence01Icon` | Or `Robot01Icon` |
| `Sun` | `Sun01Icon` | Confirmed in research |
| `Moon` | `Moon01Icon` | Confirmed in research |
| `Desktop` | `Computer01Icon` | Or `MonitorIcon` |
| `Heart` | `FavouriteIcon` | Or `Heart01Icon` |
| `ChartPie` | `PieChart01Icon` | Or `PieChartIcon` |
| `CheckCircle` | `CheckmarkCircle01Icon` | Confirmed in research |
| `Circle` | `RadioButtonIcon` | Or empty circle equivalent |
| `CaretUp` | `ArrowUp01Icon` | Or `ChevronUpIcon` |
| `BookOpen` | `BookOpen01Icon` | Same as `BookOpenText` mapping |
| `Plugs` | `PlugConnectedIcon` | Or `ConnectIcon` |

> ⚠️ Browse [hugeicons.com](https://hugeicons.com) or inspect `@hugeicons/core-free-icons` type definitions to pick the best variant for each icon.

## Acceptance Criteria

- [ ] `@phosphor-icons/react` is removed from `package.json`
- [ ] `@hugeicons/react` and `@hugeicons/core-free-icons` are installed
- [ ] All 6 files have no remaining Phosphor imports
- [ ] `IconWeight` type import is fully removed
- [ ] `src/components/ui/icon.tsx` wrapper component exists
- [ ] `SidebarItem` icon prop type updated from `React.ComponentType<...>` to `IconSvgElement`
- [ ] `STEPS` array in `onboarding-widget.tsx` uses `IconSvgElement` type
- [ ] `THEMES` array in `settings-popup.tsx` uses `IconSvgElement` type
- [ ] Active/inactive icon states work visually (sidebar nav items, settings theme toggle)
- [ ] `pnpm build` passes with no TypeScript errors
- [ ] `pnpm lint` passes clean
- [ ] All sidebar items render icons at correct sizes (11–16px)
- [ ] Onboarding widget renders all step icons correctly
- [ ] `MEMORY.md` updated to reflect HugeIcons pattern (replacing Phosphor sidebar entry)

## Dependencies & Risks

**Risks:**

1. **Free tier lacks duotone/solid variants** — active/inactive state differentiation currently relies on `weight="fill"` vs `weight="duotone"`. Must pick an alternative strategy (strokeWidth, opacity, or Pro license) before implementing.
2. **Icon name mismatches** — HugeIcons has numbered variants (01, 02, 03) and some icons have non-obvious names. The mapping table above is approximate; verify each icon visually at hugeicons.com.
3. **`Circle` icon** — Phosphor's bare `Circle` (used in onboarding for incomplete steps) has no obvious HugeIcons equivalent. May need a custom SVG or a `RadioButtonIcon`.
4. **Bundle size** — HugeIcons uses a renderer + data pattern. Verify no tree-shaking regressions in production build.

**No risk:** `lucide-react` is untouched. This migration is fully scoped to Phosphor consumers only.

## References & Research

### Internal References

- Sidebar component: `src/components/sidebar.tsx`
- Workspace switcher: `src/components/sidebar/workspace-switcher.tsx`
- Account popup: `src/components/sidebar/account-popup.tsx`
- Settings popup: `src/components/sidebar/settings-popup.tsx`
- Onboarding widget: `src/components/onboarding/onboarding-widget.tsx`
- Panels: `src/components/sidebar/panels.tsx`
- Existing icon UI components: `src/components/ui/`
- Institutional learning (sidebar icons): `docs/solutions/ui-bugs/sidebar-icon-rail-vs-flat-mismatch.md`

### External References

- HugeIcons React quick start: https://hugeicons.com/docs/integrations/react/quick-start
- HugeIcons wrapper pattern: https://hugeicons.com/docs/integrations/react/wrapper
- HugeIcons best practices: https://hugeicons.com/docs/integrations/react/best-practices
- HugeIcons core packages: https://hugeicons.com/docs/core-packages
- `@hugeicons/react` npm: https://www.npmjs.com/package/@hugeicons/react
- `@hugeicons/core-free-icons` npm: https://www.npmjs.com/package/@hugeicons/core-free-icons
- Icon browser: https://hugeicons.com (search for icon names + variants)

### Related Work

- Sidebar redesign PR #16 (branch `feat/sidebar-ux-redesign`) — this migration builds on top of the flat sidebar that PR established
