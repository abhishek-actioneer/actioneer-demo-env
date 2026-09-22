---
module: Sidebar
date: 2026-02-19
problem_type: best_practice
component: frontend_stimulus
symptoms:
  - "Need to replace or add a sidebar panel (e.g., Billing → Settings)"
  - "Multiple integration points across HoverPanel type, getActivePage, pageToPanel, RailIcon, panel header, panel content"
root_cause: missing_workflow_step
resolution_type: code_fix
severity: medium
tags: [sidebar, panel, hover-panel, settings, navigation, three-tier-pattern]
---

# Best Practice: Sidebar Panel Addition/Replacement Checklist

## Problem
Adding or replacing a sidebar panel requires changes at 7 specific integration points in `sidebar.tsx` plus an external panel component. Missing any one point causes type errors or silent rendering failures.

## Environment
- Module: Sidebar
- Framework: Next.js 16 / React 19
- Affected Component: `src/components/sidebar.tsx` (780+ lines)
- Date: 2026-02-19

## Symptoms
- Need to add a new panel (e.g., "Settings") or replace an existing one (e.g., "Billing" → "Settings")
- Multiple files and integration points must be updated in sync

## Solution

### 7-Point Integration Checklist

Every sidebar panel change requires updating these 7 points in `sidebar.tsx`, plus creating the panel component:

**1. `HoverPanel` type union** (~line 49)
```typescript
// Add or replace the panel name in the union
type HoverPanel = "history" | "knowledge" | ... | "settings" | "user" | null;
```

**2. `getActivePage()` function** (~line 51-61)
```typescript
// Map URL pathname to the page identifier
if (pathname.startsWith("/billing")) return "settings";
```

**3. `pageToPanel()` switch** (~line 88-102)
```typescript
// Map page identifier to the HoverPanel value
case "settings": return "settings";
```

**4. `RailIcon` block** (~line 213-220)
```typescript
// The icon button on the 75px rail
<RailIcon
  icon={Settings}
  label="Settings"
  active={activePage === "settings"}
  onHover={() => setHoveredItem("settings")}
  onClick={() => router.push("/settings")} // or setHoveredItem for panel-only
/>
```

**5. Panel header label** (~line 249-259)
```typescript
// The title shown at top of the 220px detail panel
{activePanel === "settings" && "Settings"}
```

**6. Panel content conditional** (~line 278-294)
```typescript
// Render the panel component
{activePanel === "settings" && <SettingsPanel />}
```

**7. Import statement** (~line 41)
```typescript
import { SettingsPanel } from "@/components/settings/settings-panel";
```

### Panel Component Pattern

Panel components follow this structure:
```typescript
"use client";

import { useSidebarContext } from "@/components/sidebar-context";

// Reuse sidebar's CSS constants for consistent styling
const ITEM = "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-muted transition-colors text-left";
const PRIMARY = "text-[13px] text-foreground truncate";
const SECONDARY = "text-[11px] text-muted-foreground truncate block";
const SECTION_HEADER = "text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-widest px-2.5 pt-2 pb-1";
const FOOTER = "mx-1.5 mb-3 mt-1 px-2.5 py-1.5 text-[13px] font-medium ...";
const ICON = "w-3.5 h-3.5 text-muted-foreground shrink-0";

export function SettingsPanel() {
  const { creditVersion } = useSidebarContext();
  void creditVersion; // Subscribe to version counter for reactivity

  return (
    <>
      <div className="flex-1 overflow-y-auto px-1.5">
        <p className={SECTION_HEADER}>Section Title</p>
        {/* Items */}
      </div>
      <button className={FOOTER}>View All →</button>
    </>
  );
}
```

### Key Design Rules

- **Panel-only vs. page-linked**: If the panel just opens a list of links (like Settings), `onClick` can use `setHoveredItem` instead of `router.push`. If it has a dedicated page, use `router.push`.
- **Reactivity**: Use `useSidebarContext()` version counters (e.g., `creditVersion`, `playbookVersion`) to trigger re-renders when data changes externally.
- **Sync data only**: Sidebar panels should use sync data (in-memory stores, imports). Never use `useEffect` to fetch inside panels.
- **CSS constants**: Duplicate the ITEM/PRIMARY/SECONDARY/etc. constants from `sidebar.tsx` into your panel file. They're intentionally not shared as a module to keep each panel self-contained.

## Why This Works

The sidebar uses a declarative pattern where 7 points must agree on the panel identifier string. The `HoverPanel` type union enforces type safety, and the conditional rendering chain (`getActivePage` → `pageToPanel` → `activePanel` → render) ensures correct panel display for both hover and pinned states.

## Prevention

- Use this checklist whenever adding/replacing a sidebar panel
- Search for the old panel name (e.g., `"billing"`) across sidebar.tsx to find all integration points
- Run `pnpm build` after changes — TypeScript will catch type union mismatches

## Related Issues

- See also: [split-panel-to-sidebar-three-tier-consolidation.md](../design-patterns/split-panel-to-sidebar-three-tier-consolidation.md) — the original 3-tier sidebar architecture
- See also: [lift-sidebar-state-to-layout-context.md](../design-patterns/lift-sidebar-state-to-layout-context.md) — sidebar context and version counter pattern
- See also: [post-merge-missing-navigation-entry-point.md](../integration-issues/post-merge-missing-navigation-entry-point.md) — what happens when an integration point is missed
