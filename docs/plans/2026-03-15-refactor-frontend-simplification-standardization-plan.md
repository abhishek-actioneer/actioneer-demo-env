# Frontend Simplification & Standardization Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce frontend complexity by eliminating dead code, extracting shared components, splitting monolithic state management, and standardizing hardcoded patterns — targeting ~1,500 LOC reduction and 4x fewer re-renders on common interactions.

**Architecture:** Four sequential phases, each independently shippable. Phase 1 is mechanical cleanup. Phase 2 extracts shared components from 5+ duplicated patterns. Phase 3 splits the 59-property ChatStateContext and 25-property SidebarContext into focused micro-contexts. Phase 4 adds semantic color tokens and framework modernizations.

**Tech Stack:** Next.js 16 (App Router) · React 19 · Tailwind CSS v4 · shadcn/ui (new-york) · lucide-react · CVA · cn() from `src/lib/utils.ts`

**Prior art:** Builds on the completed [Convention-First Refactor Plan](./2026-03-09-convention-first-refactor-plan.md) which established `apiFetch()`, typed SSE, and store consistency. This plan addresses the shared component and state management gaps that plan explicitly scoped out.

**Constraints:**
- No external state management libraries (no zustand/jotai/redux) — pure React Context + hooks per project convention
- Strictly monochrome UI — use `muted`, `foreground`, `border` tokens (CLAUDE.md rule)
- Canvas card renderers use inline styles (not Tailwind) for tldraw compatibility — do not change this
- Provider ordering in `layout-shell.tsx` matters — do not reorder without verifying upstream dependencies

**Institutional learnings to respect:**
- Never read `localStorage` in `useState` initializers (hydration mismatch — see `docs/solutions/ui-bugs/hydration-mismatch-localstorage-usestate-Sidebar-20260218.md`)
- Self-contained providers: components using context hooks must wrap themselves in the provider OR document the requirement (see `docs/solutions/runtime-errors/reactflow-provider-missing-canvasflow-context.md`)
- ESLint worktree issues: always add `.worktrees/**` to `globalIgnores` (see `docs/solutions/build-errors/eslint-worktrees-and-react-hooks-v7-false-positives...md`)

---

## File Structure Overview

### New files to create

| File | Responsibility |
|------|---------------|
| `src/components/shared/form-dialog.tsx` | Reusable form modal wrapping shadcn Dialog |
| `src/components/shared/detail-panel.tsx` | Reusable entity detail side panel |
| `src/components/shared/empty-state.tsx` | Centered empty state with icon + CTA |
| `src/components/shared/status-badge.tsx` | Semantic status indicator dot/badge |
| `src/lib/sql-highlighting.tsx` | `SqlHighlighted` component + `SQL_KEYWORDS` + `AGENT_ICONS` |
| `src/lib/subagent-config.ts` | `SUBAGENT_TASKS` config (single source of truth) |
| `src/hooks/use-analytics-stream.ts` | SSE event parsing extracted from use-analytics |
| `src/hooks/use-analytics-context.ts` | Knowledge/entity context building for analytics |

### Files to rename

| From | To | Reason |
|------|-----|--------|
| `src/lib/scout-store.ts` | `src/lib/scout-data.ts` | Read-only static data, not a store |
| `src/lib/connector-store.ts` | `src/lib/connector-data.ts` | Static data, no mutations |

### Files to delete

| File | Lines | Reason |
|------|-------|--------|
| `src/components/chat/agent-card.tsx` | 167 | Zero imports — dead code |
| `src/components/chat/entity-chip-bar.tsx` | 82 | Zero imports — dead code |
| `src/components/chat/inline-sources.tsx` | 209 | Exact duplicate of sources-panel.tsx |
| `src/lib/canvas-store.ts` | ~200 | Deprecated, replaced by board-store.ts |

### Files to modify (major changes)

| File | Change |
|------|--------|
| `src/components/chat/chat-state-provider.tsx` | Split 59-prop context into 4 focused contexts |
| `src/components/sidebar-context.tsx` | Split 25-prop context, remove version counters |
| `src/components/chat/chat-thread.tsx` | Replace 29 props with direct context consumption |
| `src/components/chat/chat-panel.tsx` | Remove prop drilling to ChatThread |
| `src/hooks/use-analytics.ts` | Extract stream processing + context building |
| `src/components/chat/task-panel.tsx` | Split 1,211-line file into 3 focused files |
| `src/components/layout-shell.tsx` | Add new split providers to tree |
| `src/app/globals.css` | Add `--success`, `--warning` semantic tokens |

---

## Phase 1: Dead Code Cleanup & File Renames

**Goal:** Remove ~660 LOC of dead/duplicate code, rename misnamed files, extract duplicated utilities.
**Risk:** Low — mechanical changes, no behavioral impact.
**Estimated effort:** 30–60 minutes.

---

### Task 1.1: Delete Dead Chat Components

**Files:**
- Delete: `src/components/chat/agent-card.tsx` (167 lines)
- Delete: `src/components/chat/entity-chip-bar.tsx` (82 lines)
- Delete: `src/components/chat/inline-sources.tsx` (209 lines)

- [ ] **Step 1: Verify zero imports for each file**

```bash
# Each command should return 0 results (excluding the file itself)
grep -r "agent-card" src/ --include="*.tsx" --include="*.ts" -l
grep -r "entity-chip-bar" src/ --include="*.tsx" --include="*.ts" -l
grep -r "inline-sources" src/ --include="*.tsx" --include="*.ts" -l
```

Expected: Only the files themselves appear (self-references), no external imports.

- [ ] **Step 2: Delete the three files**

```bash
rm src/components/chat/agent-card.tsx
rm src/components/chat/entity-chip-bar.tsx
rm src/components/chat/inline-sources.tsx
```

- [ ] **Step 3: Verify build passes**

```bash
pnpm build 2>&1 | tail -20
```

Expected: Build succeeds with no import errors.

- [ ] **Step 4: Commit**

```bash
git add -u src/components/chat/
git commit -m "refactor: delete 3 dead chat components (458 LOC)

Remove agent-card.tsx, entity-chip-bar.tsx, inline-sources.tsx.
All had zero external imports — confirmed dead code."
```

---

### Task 1.2: Extract Duplicated SQL Highlighting Utility

**Files:**
- Create: `src/lib/sql-highlighting.tsx`
- Modify: `src/components/chat/sources-panel.tsx`
- Modify: `src/components/chat/task-panel.tsx`

- [ ] **Step 1: Read existing implementations to understand the pattern**

Read `SqlHighlighted` from `src/components/chat/sources-panel.tsx` (lines ~32-57) and `SQL_KEYWORDS` Set and `AGENT_ICONS` map.

- [ ] **Step 2: Create `src/lib/sql-highlighting.tsx`**

Extract `SqlHighlighted`, `SQL_KEYWORDS`, and `AGENT_ICONS` into a shared module:

```tsx
// src/lib/sql-highlighting.tsx
"use client";

import {
  BarChart3, Users, Globe, TrendingUp, ShieldCheck, Layers,
  Sparkles, type LucideIcon
} from "lucide-react";

export const SQL_KEYWORDS = new Set([
  "SELECT", "FROM", "WHERE", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER",
  "ON", "AND", "OR", "NOT", "IN", "IS", "NULL", "AS", "GROUP", "BY",
  "ORDER", "HAVING", "LIMIT", "OFFSET", "UNION", "ALL", "DISTINCT",
  "CASE", "WHEN", "THEN", "ELSE", "END", "COUNT", "SUM", "AVG", "MAX",
  "MIN", "BETWEEN", "LIKE", "EXISTS", "INSERT", "UPDATE", "DELETE",
  "CREATE", "DROP", "ALTER", "TABLE", "INDEX", "VIEW", "WITH",
  "OVER", "PARTITION", "ROW_NUMBER", "RANK", "DENSE_RANK", "LAG",
  "LEAD", "FIRST_VALUE", "LAST_VALUE", "COALESCE", "CAST", "EXTRACT",
  "DATE_TRUNC", "INTERVAL", "CROSS", "FULL", "NATURAL", "USING",
  "RECURSIVE", "MATERIALIZED", "LATERAL", "FILTER", "WINDOW",
  "FETCH", "NEXT", "ROWS", "ONLY", "PERCENT", "TIES",
]);

export const AGENT_ICONS: Record<string, LucideIcon> = {
  "daily-metrics": BarChart3,
  "user-segmentation": Users,
  geographic: Globe,
  "rev-opt": TrendingUp,
  "data-quality": ShieldCheck,
  "cohort-retention": Layers,
  critique: Sparkles,
};

export function SqlHighlighted({ sql }: { sql: string }) {
  const tokens = sql.split(/(\s+|[(),;])/);
  return (
    <code className="text-xs font-mono whitespace-pre-wrap break-all">
      {tokens.map((token, i) => (
        <span
          key={i}
          className={
            SQL_KEYWORDS.has(token.toUpperCase())
              ? "text-blue-400 font-semibold"
              : ""
          }
        >
          {token}
        </span>
      ))}
    </code>
  );
}
```

- [ ] **Step 3: Update sources-panel.tsx to import from shared module**

Remove the inline `SQL_KEYWORDS`, `AGENT_ICONS`, and `SqlHighlighted` definitions. Replace with:

```tsx
import { SqlHighlighted, AGENT_ICONS } from "@/lib/sql-highlighting";
```

- [ ] **Step 4: Update task-panel.tsx to import from shared module**

Remove the inline `SqlHighlighted` definition. Replace with:

```tsx
import { SqlHighlighted } from "@/lib/sql-highlighting";
```

- [ ] **Step 5: Verify build passes**

```bash
pnpm build 2>&1 | tail -20
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/sql-highlighting.tsx src/components/chat/sources-panel.tsx src/components/chat/task-panel.tsx
git commit -m "refactor: extract SqlHighlighted + AGENT_ICONS to shared module

Removes duplicate SQL_KEYWORDS Set and AGENT_ICONS map from
sources-panel.tsx and task-panel.tsx into src/lib/sql-highlighting.tsx."
```

---

### Task 1.3: Extract Duplicated Subagent Config

**Files:**
- Create: `src/lib/subagent-config.ts`
- Modify: `src/components/chat/research-timeline.tsx`
- Modify: `src/components/chat/task-panel.tsx`

- [ ] **Step 1: Read SUBAGENT_TASKS from both files**

Read `research-timeline.tsx` (line ~16) and `task-panel.tsx` (line ~755) to understand both config shapes.

- [ ] **Step 2: Create `src/lib/subagent-config.ts`**

Merge both config shapes into a single typed object. The task-panel version has richer data (narratives, prompts), so use it as the base and add the task-list arrays from research-timeline:

```typescript
// src/lib/subagent-config.ts

export interface SubagentConfig {
  label: string;
  tasks: string[];
  narrative?: string;
}

export const SUBAGENT_TASKS: Record<string, SubagentConfig> = {
  "daily-metrics": {
    label: "Daily Metrics Agent",
    tasks: [
      "Querying daily revenue trends",
      "Analyzing transaction volumes",
      "Computing average order values",
    ],
    // ... narrative from task-panel.tsx
  },
  // ... remaining agents: user-segmentation, geographic, rev-opt,
  //     data-quality, cohort-retention, critique
};
```

- [ ] **Step 3: Update research-timeline.tsx to import from shared module**

Remove inline config. Import `SUBAGENT_TASKS` from `@/lib/subagent-config`.

- [ ] **Step 4: Update task-panel.tsx to import from shared module**

Remove inline `SUBAGENT_TASK_PROMPTS` / `SUBAGENT_TASKS`. Import from `@/lib/subagent-config`.

- [ ] **Step 5: Verify build passes**

```bash
pnpm build 2>&1 | tail -20
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/subagent-config.ts src/components/chat/research-timeline.tsx src/components/chat/task-panel.tsx
git commit -m "refactor: extract SUBAGENT_TASKS config to shared module

Single source of truth for subagent display names, task lists,
and narratives. Removes duplication between research-timeline
and task-panel."
```

---

### Task 1.4: Rename Misnamed Store Files

**Files:**
- Rename: `src/lib/scout-store.ts` → `src/lib/scout-data.ts`
- Rename: `src/lib/connector-store.ts` → `src/lib/connector-data.ts`
- Modify: All importers of these files

- [ ] **Step 1: Find all imports of scout-store**

```bash
grep -r "scout-store" src/ --include="*.ts" --include="*.tsx" -l
```

- [ ] **Step 2: Find all imports of connector-store**

```bash
grep -r "connector-store" src/ --include="*.ts" --include="*.tsx" -l
```

- [ ] **Step 3: Rename files**

```bash
git mv src/lib/scout-store.ts src/lib/scout-data.ts
git mv src/lib/connector-store.ts src/lib/connector-data.ts
```

- [ ] **Step 4: Update all import paths**

In every file found in steps 1-2, replace:
- `@/lib/scout-store` → `@/lib/scout-data`
- `@/lib/connector-store` → `@/lib/connector-data`

- [ ] **Step 5: Verify build passes**

```bash
pnpm build 2>&1 | tail -20
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: rename scout-store → scout-data, connector-store → connector-data

Both files contain read-only static data with no mutations.
Naming them *-store was incorrect per the project store/data convention."
```

---

### Task 1.5: Remove Deprecated canvas-store.ts

**Files:**
- Delete: `src/lib/canvas-store.ts`
- Modify: Any file importing from canvas-store

- [ ] **Step 1: Find all imports of canvas-store**

```bash
grep -r "canvas-store" src/ --include="*.ts" --include="*.tsx" -l
```

- [ ] **Step 2: For each importer, replace with board-store equivalent**

The board-store already has equivalent functions. Map: `getCanvasItems()` → `getBoardCards()`, `saveCanvasItem()` → `saveBoardCard()`, etc.

If only a single call site exists (likely `src/app/page.tsx`), replace the import and function call.

- [ ] **Step 3: Delete canvas-store.ts**

```bash
rm src/lib/canvas-store.ts
```

- [ ] **Step 4: Verify build passes**

```bash
pnpm build 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove deprecated canvas-store.ts (~200 LOC)

All canvas data now flows through board-store.ts.
board-store.ts already clears legacy canvas localStorage on init."
```

---

### Task 1.6: Delete Legacy sidebar-context.tsx in src/lib/

**Files:**
- Delete: `src/lib/sidebar-context.tsx` (68 lines — legacy SidebarOverrides API)

- [ ] **Step 1: Verify no source files import from `@/lib/sidebar-context`**

```bash
grep -r "from.*@/lib/sidebar-context" src/ --include="*.ts" --include="*.tsx" -l
```

The active provider is `@/components/sidebar-context` (not `@/lib/sidebar-context`). If there are importers, update them first.

- [ ] **Step 2: Delete the legacy file**

```bash
rm src/lib/sidebar-context.tsx
```

- [ ] **Step 3: Verify build passes**

```bash
pnpm build 2>&1 | tail -20
```

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "refactor: remove legacy src/lib/sidebar-context.tsx

Duplicate of src/components/sidebar-context.tsx with a different
API (SidebarOverrides) that is no longer used."
```

---

## Phase 2: Shared Component Extraction

**Goal:** Extract 4 shared components from 5+ duplicated patterns, reducing ~800 LOC across feature areas.
**Risk:** Medium — component API design must accommodate existing variation without over-abstraction.
**Estimated effort:** 2–4 hours.
**Prerequisite:** Phase 1 complete (dead code removed, clean baseline).

---

### Task 2.1: Create `src/components/shared/empty-state.tsx`

**Files:**
- Create: `src/components/shared/empty-state.tsx`
- Modify: `src/components/segments/segment-detail-panel.tsx` (first migration)

This is the simplest extraction — start here to establish the `shared/` directory pattern.

- [ ] **Step 1: Read the existing empty state pattern**

Read `src/components/segments/segment-detail-panel.tsx` — look for the centered empty state around lines 652-666. Also spot-check 2-3 other feature areas for variation.

- [ ] **Step 2: Create the shared component**

```tsx
// src/components/shared/empty-state.tsx
import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center py-12", className)}>
      <Icon className="size-10 text-muted-foreground/20 mb-3" />
      <h3 className="text-sm font-medium text-muted-foreground mb-1">{title}</h3>
      <p className="text-xs text-muted-foreground/70 max-w-[200px] mb-4">{description}</p>
      {action}
    </div>
  );
}
```

Import `cn` from `@/lib/utils`.

- [ ] **Step 3: Migrate segment-detail-panel.tsx to use EmptyState**

Replace the inline empty state JSX with:

```tsx
import { EmptyState } from "@/components/shared/empty-state";
// ...
<EmptyState
  icon={BarChart3}
  title="No segment selected"
  description="Select a segment from the list to view details"
/>
```

- [ ] **Step 4: Verify build passes and visual parity**

```bash
pnpm build 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
git add src/components/shared/empty-state.tsx src/components/segments/segment-detail-panel.tsx
git commit -m "refactor: extract EmptyState shared component

Replaces inline empty state patterns. First migration: segment-detail-panel.
Other feature areas can adopt incrementally."
```

- [ ] **Step 6: Migrate remaining empty states (batch)**

Search for inline empty state patterns and replace across feature areas:

```bash
grep -rn "text-muted-foreground/20.*mb-3" src/components/ --include="*.tsx" -l
```

Migrate each file to use `<EmptyState>`. Commit after each batch of 3-5 files.

---

### Task 2.2: Create `src/components/shared/form-dialog.tsx`

**Files:**
- Create: `src/components/shared/form-dialog.tsx`
- Modify: `src/components/segments/create-segment-modal.tsx` (first migration)

- [ ] **Step 1: Read existing modal implementations to understand variation**

Read these files to catalog the overlay/dialog pattern:
- `src/components/segments/create-segment-modal.tsx`
- `src/components/metric/create-metric-modal.tsx`
- `src/components/knowledge/knowledge-add-modal.tsx`
- `src/components/connectors/connector-modal.tsx`

Note differences in: max-width, loading state, footer layout, close behavior.

- [ ] **Step 2: Create the shared component**

```tsx
// src/components/shared/form-dialog.tsx
"use client";

import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface FormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  onSubmit: () => void | Promise<void>;
  submitLabel?: string;
  cancelLabel?: string;
  isLoading?: boolean;
  isDisabled?: boolean;
  maxWidth?: "sm" | "md" | "lg" | "xl";
  footer?: React.ReactNode; // override default footer
}

const MAX_WIDTH_MAP = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-lg",
  xl: "sm:max-w-xl",
} as const;

export function FormDialog({
  open, onOpenChange, title, description, children,
  onSubmit, submitLabel = "Create", cancelLabel = "Cancel",
  isLoading = false, isDisabled = false,
  maxWidth = "lg", footer,
}: FormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={MAX_WIDTH_MAP[maxWidth]}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-4 py-2">{children}</div>
        {footer ?? (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
              {cancelLabel}
            </Button>
            <Button onClick={onSubmit} disabled={isLoading || isDisabled}>
              {isLoading && <Loader2 className="size-4 mr-2 animate-spin" />}
              {isLoading ? `${submitLabel}...` : submitLabel}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Migrate create-segment-modal.tsx**

Replace the fixed overlay + custom dialog structure with `<FormDialog>`. Keep the form fields as children.

- [ ] **Step 4: Verify build passes and visual parity**

```bash
pnpm build 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
git add src/components/shared/form-dialog.tsx src/components/segments/create-segment-modal.tsx
git commit -m "refactor: extract FormDialog shared component

Wraps shadcn Dialog with standardized header, footer, loading state.
First migration: create-segment-modal. Reduces ~100 LOC per modal."
```

- [ ] **Step 6: Migrate remaining modals**

Migrate these files one at a time, verifying build after each:
- `src/components/metric/create-metric-modal.tsx`
- `src/components/metric/metric-edit-modal.tsx`
- `src/components/knowledge/knowledge-add-modal.tsx`
- `src/components/connectors/connector-modal.tsx`

Commit after each 2-3 file batch.

---

### Task 2.3: Create `src/components/shared/detail-panel.tsx`

**Files:**
- Create: `src/components/shared/detail-panel.tsx`
- Modify: `src/components/metric/metric-detail-panel.tsx` (first migration)

- [ ] **Step 1: Read existing detail panel implementations**

Read header/footer patterns in:
- `src/components/segments/segment-detail-panel.tsx`
- `src/components/metric/metric-detail-panel.tsx`
- `src/components/scout/scout-config-panel.tsx`

Note: padding (p-5 vs p-6), header layout (title + badge + kebab menu), delete confirmation pattern.

- [ ] **Step 2: Create the shared component**

```tsx
// src/components/shared/detail-panel.tsx
"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface DetailPanelProps {
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
  onDelete?: () => void;
  deleteLabel?: string;
  deleteDescription?: string;
  footer?: React.ReactNode;
  className?: string;
}

export function DetailPanel({
  title, subtitle, badge, headerActions, children,
  onDelete, deleteLabel = "Delete", deleteDescription,
  footer, className,
}: DetailPanelProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className={cn("h-full overflow-y-auto bg-background border-l border-border", className)}>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold truncate">{title}</h2>
              {badge}
            </div>
            {subtitle && (
              <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
            )}
          </div>
          {headerActions}
        </div>

        {/* Body */}
        {children}

        {/* Delete footer */}
        {onDelete && (
          <div className="pt-4 border-t border-border">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="size-4 mr-2" />
              {deleteLabel}
            </Button>
          </div>
        )}
      </div>

      {onDelete && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`Delete ${title}?`}
          description={deleteDescription ?? "This action cannot be undone."}
          onConfirm={() => { onDelete(); setConfirmDelete(false); }}
          variant="destructive"
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Migrate metric-detail-panel.tsx**

Replace the header/footer boilerplate with `<DetailPanel>`. Keep the body content sections as children.

- [ ] **Step 4: Verify build passes**

```bash
pnpm build 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
git add src/components/shared/detail-panel.tsx src/components/metric/metric-detail-panel.tsx
git commit -m "refactor: extract DetailPanel shared component

Standardizes header, delete confirmation, and scroll container.
First migration: metric-detail-panel."
```

- [ ] **Step 6: Migrate remaining detail panels**

Migrate incrementally: segment-detail-panel, scout-config-panel, forecast inspect-panel.

---

### Task 2.4: Create `src/components/shared/status-badge.tsx`

**Files:**
- Create: `src/components/shared/status-badge.tsx`
- Modify: `src/components/segments/segment-card.tsx`

- [ ] **Step 1: Read existing status color dictionaries**

Read `src/components/segments/segment-card.tsx` — find inline `STATUS_COLORS` dictionary.

- [ ] **Step 2: Create the shared component**

```tsx
// src/components/shared/status-badge.tsx
import { cn } from "@/lib/utils";

const STATUS_STYLES = {
  idle: "bg-muted-foreground/40",
  active: "bg-foreground",
  pushing: "bg-muted-foreground animate-pulse",
  synced: "bg-foreground",
  error: "bg-destructive",
  processing: "bg-muted-foreground animate-pulse",
  ok: "bg-foreground",
  failed: "bg-destructive",
} as const;

type StatusVariant = keyof typeof STATUS_STYLES;

interface StatusBadgeProps {
  variant: StatusVariant;
  label?: string;
  className?: string;
}

export function StatusBadge({ variant, label, className }: StatusBadgeProps) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className={cn("size-2 rounded-full", STATUS_STYLES[variant])} />
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
    </span>
  );
}
```

Note: Colors use monochrome tokens per CLAUDE.md's "strictly monochrome UI" rule, not `bg-emerald-500` / `bg-red-500`.

- [ ] **Step 3: Migrate segment-card.tsx**

Replace inline `STATUS_COLORS` with `<StatusBadge variant={status} />`.

- [ ] **Step 4: Verify build passes**

```bash
pnpm build 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
git add src/components/shared/status-badge.tsx src/components/segments/segment-card.tsx
git commit -m "refactor: extract StatusBadge shared component

Replaces inline STATUS_COLORS dictionaries with monochrome
semantic status indicator."
```

---

### Task 2.5: Add Semantic Color Tokens to globals.css

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Read current CSS custom properties**

Read `src/app/globals.css` — find the `:root` and `.dark` blocks to understand the existing token structure.

- [ ] **Step 2: Add semantic color tokens**

Add `--success` and `--warning` tokens to both `:root` and `.dark` blocks:

```css
/* In :root */
--success: oklch(0.65 0.15 145);
--warning: oklch(0.75 0.15 85);

/* In .dark */
--success: oklch(0.70 0.15 145);
--warning: oklch(0.80 0.15 85);
```

- [ ] **Step 3: Add Tailwind utility classes**

In the `@theme inline` block, add:

```css
--color-success: var(--success);
--color-warning: var(--warning);
```

This enables `text-success`, `bg-warning`, etc.

- [ ] **Step 4: Search-and-replace hardcoded colors**

Replace across the codebase:
- `text-red-500` / `text-red-600` → `text-destructive` (8 instances)
- `bg-red-500` → `bg-destructive` (where semantic)
- `text-emerald-600` / `bg-emerald-500` → `text-success` / `bg-success`
- `text-amber-600` / `bg-amber-400` → `text-warning` / `bg-warning`

**Important:** Only replace semantic uses (error/success/warning states). Keep hardcoded colors for decorative uses (chart colors, accent strips) that are intentional design choices.

- [ ] **Step 5: Verify build passes and no visual regressions**

```bash
pnpm build 2>&1 | tail -20
```

- [ ] **Step 6: Commit**

```bash
git add src/app/globals.css
# add all modified component files
git commit -m "refactor: replace 52 hardcoded colors with semantic tokens

Add --success and --warning CSS custom properties.
Replace text-red-500 → text-destructive, text-emerald-600 → text-success,
text-amber-600 → text-warning across the codebase."
```

---

## Phase 3: State Management Refactor

**Goal:** Split monolithic contexts to eliminate cascading re-renders. The 59-property ChatStateContext becomes 4 focused contexts. The 25-property SidebarContext is split. ChatThread drops from 29 props to ~5.
**Risk:** High — provider changes affect the entire app. Changes must be done atomically per context split to avoid broken intermediate states.
**Estimated effort:** 1–2 days.
**Prerequisite:** Phase 2 complete (shared components established).

**Key constraint:** No external state management (no zustand/jotai). Use React Context splitting only.

---

### Task 3.1: Split ChatStateContext into 4 Focused Contexts

**Files:**
- Create: `src/components/chat/chat-conversation-context.tsx`
- Create: `src/components/chat/chat-analytics-context.tsx`
- Create: `src/components/chat/chat-actions-context.tsx`
- Create: `src/components/chat/chat-entity-context.tsx`
- Modify: `src/components/chat/chat-state-provider.tsx` (becomes thin orchestrator)
- Modify: `src/components/layout-shell.tsx` (add new providers to tree)
- Modify: All consumers of `useChatState()`

The current `ChatStateContextValue` (lines 62-144 of `chat-state-provider.tsx`) has 59 properties grouped into these concerns:

```
Conversation (11 props) → ChatConversationContext
Analytics (5 props)     → ChatAnalyticsContext
Actions (24 props)      → ChatActionsContext
Entity (4 props)        → ChatEntityContext
Panel (7 props)         → keep in existing ChatStateContext (renamed)
DB/Refs/Page (8 props)  → distribute to relevant contexts
```

#### Sub-task 3.1a: Create ChatConversationContext

- [ ] **Step 1: Create the context file**

```tsx
// src/components/chat/chat-conversation-context.tsx
"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { ChatMessage } from "@/lib/types";

interface ChatConversationContextValue {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  activeConvId: string | null;
  isProcessing: boolean;
  sourceCanvasItemId: string | null;
  agentMsgIdRef: React.RefObject<string>;
  messagesRef: React.RefObject<ChatMessage[]>;
  handleNewChat: () => void;
  ensureConversation: (title: string) => string;
  saveCurrentConversation: (convId: string) => void;
  switchConversation: (id: string) => void;
  refreshChats: () => void;
}

const ChatConversationContext = createContext<ChatConversationContextValue | null>(null);

export function useChatConversation() {
  const ctx = useContext(ChatConversationContext);
  if (!ctx) throw new Error("useChatConversation must be used within ChatConversationProvider");
  return ctx;
}

export { ChatConversationContext };
export type { ChatConversationContextValue };
```

- [ ] **Step 2: Wire it into ChatStateProvider**

In `chat-state-provider.tsx`, wrap children with `ChatConversationContext.Provider` and pass the conversation-related values from `useConversation()`.

- [ ] **Step 3: Update consumers**

Find all consumers that only use conversation values (`messages`, `activeConvId`, `isProcessing`):

```bash
grep -rn "useChatState()" src/ --include="*.tsx" --include="*.ts"
```

For each consumer, check which properties it destructures. If it only uses conversation properties, switch to `useChatConversation()`.

- [ ] **Step 4: Verify build passes**

```bash
pnpm build 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/chat-conversation-context.tsx src/components/chat/chat-state-provider.tsx
git commit -m "refactor: extract ChatConversationContext from ChatStateContext

Splits conversation state (messages, activeConvId, isProcessing) into
a focused context. Consumers that only need conversation state no longer
re-render on action handler or entity changes."
```

#### Sub-task 3.1b: Create ChatActionsContext

- [ ] **Step 1: Create the context file**

```tsx
// src/components/chat/chat-actions-context.tsx
"use client";

import { createContext, useContext } from "react";
import type { FollowUpAction } from "@/lib/types";

interface ChatActionsContextValue {
  // Follow-up / Playbook / Knowledge handlers
  handleFollowUpAction: (action: FollowUpAction) => void;
  handleSaveAsPlaybook: (userQuery: string) => void;
  handleSavePlaybookPreview: (msgId: string) => void;
  handleSaveToKnowledge: (content: string, level: "global" | "user") => Promise<void>;
  handleDismissKnowledge: (msgId: string) => void;
  handleConnectorClick: (categoryId: string) => void;
  handleProceedWithout: (originalQuery: string) => void;
  handleUploadCSV: () => void;

  // Segment confirm handlers
  handleSegmentConfirm: (msgId: string, name: string) => void;
  handleSegmentCancel: (msgId: string) => void;
  handleSegmentRefine: (msgId: string, newDescription: string) => void;

  // Board from research
  handleSaveAsBoard: (userQuery: string) => void;
  isSavingBoard: boolean;

  // Segment creation
  segmentModal: { open: boolean; sql: string; defaultName: string; userCount: number | null; pushTo?: string } | null;
  isCreatingSegment: boolean;
  segmentToast: { name: string; id: string } | null;
  handleCreateSegment: (name: string, sql?: string) => void;
  closeSegmentModal: () => void;
  dismissSegmentToast: () => void;
}

const ChatActionsContext = createContext<ChatActionsContextValue | null>(null);

export function useChatActions() {
  const ctx = useContext(ChatActionsContext);
  if (!ctx) throw new Error("useChatActions must be used within ChatActionsProvider");
  return ctx;
}

export { ChatActionsContext };
export type { ChatActionsContextValue };
```

- [ ] **Step 2: Wire into ChatStateProvider and update consumers**

Same pattern as 3.1a — wrap children, pass action values, update consumers.

- [ ] **Step 3: Verify build and commit**

#### Sub-task 3.1c: Create ChatAnalyticsContext

Handles: `handleSend`, `handleStop`, `deepResearch`, `setDeepResearch`, `generatedReport`.

Same pattern as above.

#### Sub-task 3.1d: Create ChatEntityContext

Handles: `entityCatalog`, `runCatalog`, `entityLookup`, `handleEntityClick`.

Same pattern as above.

#### Sub-task 3.1e: Slim down ChatStateProvider

After extracting 4 contexts, `ChatStateProvider` becomes a thin orchestrator (~60 lines) that:
1. Composes the 8 hooks (unchanged)
2. Wraps children in the 4 new context providers
3. Only directly exposes: `panel`, `setPanel`, `activeCitation`, panel handlers, `chatInputRef`, `liveResponseIds`, `dbStatus`, `checkHealth`, `pageEntity`, `setPageEntity`

Keep `useChatState()` as a convenience hook that reads all 4 + the remaining panel context (for backward compatibility during migration).

- [ ] **Step 1: Update `useChatState()` to compose sub-contexts**

```tsx
export function useChatState() {
  const conversation = useChatConversation();
  const analytics = useChatAnalytics();
  const actions = useChatActions();
  const entities = useChatEntities();
  const panel = useContext(ChatPanelStateContext); // the slimmed-down remainder
  if (!panel) throw new Error("useChatState must be used within ChatStateProvider");
  return { ...conversation, ...analytics, ...actions, ...entities, ...panel };
}
```

This preserves backward compatibility — existing consumers don't need to change immediately. New code should use the focused hooks.

- [ ] **Step 2: Verify build passes**

```bash
pnpm build 2>&1 | tail -20
```

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/
git commit -m "refactor: split ChatStateContext (59 props) into 4 focused contexts

ChatConversationContext (12 props) - messages, processing state
ChatAnalyticsContext (5 props) - send handlers, deep research toggle
ChatActionsContext (20 props) - follow-up, playbook, knowledge, segment handlers
ChatEntityContext (4 props) - entity catalog and lookup

useChatState() preserved as convenience hook composing all 4.
Panel/DB/ref props remain in slimmed ChatStateProvider (~18 props)."
```

---

### Task 3.2: Eliminate ChatThread 29-Prop Drilling

**Files:**
- Modify: `src/components/chat/chat-thread.tsx`
- Modify: `src/components/chat/chat-panel.tsx`

**Prerequisite:** Task 3.1 complete (split contexts available).

- [ ] **Step 1: Read ChatThread to identify which props map to which context**

Current 29 props (from `ChatThreadProps` interface at lines 27-59 of `chat-thread.tsx`):

| Prop | Source Context |
|------|---------------|
| `messages`, `isProcessing`, `conversationId`, `liveResponseIds` | ChatConversation |
| `onViewTask`, `onSubagentClick`, `onCitationClick`, `activeCitation`, `selectedSubagentId`, `isTaskPanelOpen` | ChatPanel (remaining) |
| `onFollowUpAction`, `onConnectorClick`, `onProceedWithout`, `onUploadCSV` | ChatActions |
| `onSaveAsPlaybook`, `onSaveAsBoard`, `isSavingBoard`, `onSavePlaybookPreview` | ChatActions |
| `onSaveToKnowledge`, `onDismissKnowledge` | ChatActions |
| `onSegmentConfirm`, `onSegmentCancel`, `onSegmentRefine` | ChatActions |
| `entityLookup`, `onEntityClick` | ChatEntity |
| `onChartPinned`, `onAddToFollowUp`, `onAddToKnowledge` | Local (canvas events) |
| `hideMinimap`, `compact` | Layout props (keep as props) |

- [ ] **Step 2: Refactor ChatThread to use contexts directly**

Replace the 29-prop interface with:

```tsx
interface ChatThreadProps {
  hideMinimap?: boolean;
  compact?: boolean;
  onChartPinned?: () => void;
  onAddToFollowUp?: (text: string) => void;
  onAddToKnowledge?: (text: string) => void;
}
```

Inside ChatThread, call the focused hooks:

```tsx
export function ChatThread({ hideMinimap, compact, onChartPinned, onAddToFollowUp, onAddToKnowledge }: ChatThreadProps) {
  const { messages, isProcessing, activeConvId } = useChatConversation();
  const { handleViewTask, handleSubagentClick, handleCitationClick, activeCitation } = useChatState();
  const actions = useChatActions();
  const { entityLookup, handleEntityClick } = useChatEntities();
  // ...
}
```

- [ ] **Step 3: Update ChatPanel to remove prop drilling**

In `chat-panel.tsx`, simplify the `<ChatThread>` call from 25+ props to ~5:

```tsx
// Before (lines 301-335)
<ChatThread messages={chat.messages} isProcessing={...} onViewTask={...} ... />

// After
<ChatThread hideMinimap compact={isCompact} />
```

- [ ] **Step 4: Verify build passes**

```bash
pnpm build 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/chat-thread.tsx src/components/chat/chat-panel.tsx
git commit -m "refactor: eliminate ChatThread 29-prop drilling

ChatThread now uses useChatConversation(), useChatActions(),
useChatEntities() directly. Props reduced from 29 to 5
(layout-only: hideMinimap, compact, onChartPinned, etc.)."
```

---

### Task 3.3: Decompose use-analytics.ts (928 → ~500 lines)

**Files:**
- Create: `src/hooks/use-analytics-stream.ts`
- Create: `src/hooks/use-analytics-context.ts`
- Modify: `src/hooks/use-analytics.ts`

- [ ] **Step 1: Read use-analytics.ts to identify extraction boundaries**

Read the full file. Identify the SSE event processing loop, the context-building logic (knowledge/entity context), and the credit deduction section.

- [ ] **Step 2: Extract SSE stream processing**

Create `src/hooks/use-analytics-stream.ts`:
- Move the SSE event parsing logic (the `for await` loop that processes NDJSON lines)
- Move the message-building callbacks that construct `ChatMessage` objects from events
- Export a `processAnalyticsStream(response, callbacks)` function

- [ ] **Step 3: Extract context building**

Create `src/hooks/use-analytics-context.ts`:
- Move the knowledge context assembly (reading knowledge entries, building context string)
- Move the entity context assembly (page entity, entity references)
- Export a `buildAnalyticsContext(datasetId, pageEntity, knowledgeEntries)` function

- [ ] **Step 4: Slim use-analytics.ts to orchestrator**

`useAnalytics` becomes ~500 lines:
- `handleSend` calls `buildAnalyticsContext()` → classify → execute SQL → `processAnalyticsStream()`
- Owns only orchestration and state management
- No inline parsing or context assembly

- [ ] **Step 5: Verify build passes**

```bash
pnpm build 2>&1 | tail -20
```

- [ ] **Step 6: Commit**

```bash
git add src/hooks/use-analytics-stream.ts src/hooks/use-analytics-context.ts src/hooks/use-analytics.ts
git commit -m "refactor: decompose use-analytics (928 → ~500 lines)

Extract SSE stream processing to use-analytics-stream.ts.
Extract knowledge/entity context building to use-analytics-context.ts.
use-analytics.ts becomes thin orchestrator."
```

---

### Task 3.4: Split task-panel.tsx (1,211 → 3 files)

**Files:**
- Create: `src/components/chat/main-agent-panel.tsx`
- Create: `src/components/chat/subagent-detail-panel.tsx`
- Modify: `src/components/chat/task-panel.tsx` (becomes router only)

- [ ] **Step 1: Read task-panel.tsx to identify component boundaries**

Identify the 4 inline components:
- `TaskPanel` (router, lines ~32-62)
- `MainAgentPanel` (lines ~340-837, ~500 lines)
- `SubagentDetailPanel` (lines ~837-1186, ~350 lines)
- `TimelineBlock` (lines ~66-340, used by MainAgentPanel)

- [ ] **Step 2: Extract MainAgentPanel + TimelineBlock**

Move to `src/components/chat/main-agent-panel.tsx`. Include `TimelineBlock` as it's only used here.

- [ ] **Step 3: Extract SubagentDetailPanel**

Move to `src/components/chat/subagent-detail-panel.tsx`.

- [ ] **Step 4: Slim task-panel.tsx to router**

```tsx
// src/components/chat/task-panel.tsx (~50 lines)
import { MainAgentPanel } from "./main-agent-panel";
import { SubagentDetailPanel } from "./subagent-detail-panel";

export function TaskPanel({ ... }) {
  if (selectedSubagentId) return <SubagentDetailPanel ... />;
  return <MainAgentPanel ... />;
}
```

- [ ] **Step 5: Verify build passes**

```bash
pnpm build 2>&1 | tail -20
```

- [ ] **Step 6: Commit**

```bash
git add src/components/chat/task-panel.tsx src/components/chat/main-agent-panel.tsx src/components/chat/subagent-detail-panel.tsx
git commit -m "refactor: split task-panel.tsx (1,211 lines) into 3 focused files

task-panel.tsx (50 lines) - router/dispatcher only
main-agent-panel.tsx (~500 lines) - agent overview + timeline
subagent-detail-panel.tsx (~350 lines) - subagent detail view"
```

---

## Phase 4: Framework Modernization (Optional, Ongoing)

**Goal:** Adopt modern Next.js 16 / React 19 patterns as new features are built.
**Risk:** Low if done incrementally per-page.
**Estimated effort:** Ongoing, 30-60 minutes per page conversion.
**Prerequisite:** Phases 1-3 complete.

These are not blocking changes — they should be adopted opportunistically when touching these areas.

---

### Task 4.1: Convert Simple Pages to Server Components

**Candidates** (pages with minimal interactivity):
- `src/app/billing/page.tsx`
- `src/app/knowledge/page.tsx`
- `src/app/connectors/page.tsx`
- `src/app/data-catalog/page.tsx`

**Pattern:** Remove `"use client"`, extract interactive portions into a `*-client.tsx` child component.

```tsx
// src/app/billing/page.tsx (Server Component)
import { BillingClient } from "./billing-client";
export default function BillingPage() {
  return <BillingClient />;
}

// src/app/billing/billing-client.tsx
"use client";
// ... existing page content
```

**Do not convert:** Chat page, canvas pages, deck pages — too deeply interactive.

---

### Task 4.2: Adopt shadcn Chart Wrapper

**Files:**
- Install: `npx shadcn add chart`
- Modify: `src/components/chart/report-chart.tsx`

Replace direct Recharts usage with shadcn's `ChartContainer` / `ChartTooltip` / `ChartLegend` for standardized theming and accessibility.

---

### Task 4.3: Replace `useContext` with `use()` (React 19)

Where context is consumed conditionally, replace `useContext()` with React 19's `use()`:

```tsx
// Before
const ctx = useContext(SomeContext);
if (!ctx) return null;

// After (React 19)
const ctx = use(SomeContext);
```

**Note:** `use()` can be called conditionally (after early returns, in if-blocks), unlike `useContext`. Only adopt where it simplifies code.

---

## Alternative Approaches Considered

| Approach | Why Rejected |
|----------|-------------|
| **Zustand/Jotai for state** | Project convention explicitly says "Non-goals: Zustand/Jotai migration." Pure React Context splitting achieves the same granular re-render control. |
| **Atomic design system** | Over-engineering for a prototype/demo app. The 4 shared components (`FormDialog`, `DetailPanel`, `EmptyState`, `StatusBadge`) cover 90% of duplication without introducing a complex component taxonomy. |
| **Remove tldraw entirely** | Tldraw powers the canvas view mode for boards and decks. Document view is primary, but canvas mode has value. Not worth removing. |
| **Single mega-context with `useSyncExternalStore`** | More complex than context splitting, harder for team to understand, and doesn't align with existing patterns. |

---

## Risk Analysis & Mitigation

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Provider ordering change breaks app | High | Do not reorder providers in `layout-shell.tsx`. New providers nest INSIDE existing ones. |
| Context split breaks consumers | High | Keep `useChatState()` as backward-compatible convenience hook that composes all sub-contexts. Migrate consumers incrementally. |
| Shared component API doesn't fit all variants | Medium | Start with the simplest extraction (EmptyState), validate with 3+ migrations before proceeding. Add `className` and `children` escape hatches. |
| Hardcoded color replacement changes visual appearance | Medium | Only replace semantic uses (error/success/warning). Keep decorative colors. Test in both light and dark themes. |
| Renamed store files break dynamic imports | Low | Use grep to find ALL import paths before renaming. Build verification catches any missed imports. |
| Re-render performance doesn't improve measurably | Low | The split is for code maintainability first, performance second. Even if re-renders don't change measurably, the 59→15 prop reduction makes the codebase more maintainable. |

---

## Success Metrics

| Metric | Before | Target |
|--------|--------|--------|
| Dead code LOC | 660 | 0 |
| Duplicate code LOC | ~300 | 0 |
| ChatStateContext properties | 59 | ~15 (remainder after split) |
| SidebarContext properties | 25 | Split into focused contexts |
| ChatThread prop count | 29 | 5 |
| Largest hook file | 928 lines | ~500 lines |
| Largest component file | 1,211 lines | ~500 lines |
| Hardcoded color instances | 52 | 0 (semantic uses) |
| Misnamed files | 2 | 0 |
| Feature areas with shared components | 0 | 4 (`FormDialog`, `DetailPanel`, `EmptyState`, `StatusBadge`) |

---

## References

### Internal
- Convention-first refactor plan: `docs/plans/2026-03-09-convention-first-refactor-plan.md`
- Sidebar state lifting pattern: `docs/solutions/design-patterns/lift-sidebar-state-to-layout-context.md`
- Provider self-containment: `docs/solutions/runtime-errors/reactflow-provider-missing-canvasflow-context.md`
- ESLint worktree config: `docs/solutions/build-errors/eslint-worktrees-and-react-hooks-v7-false-positives...md`
- Hydration mismatch lesson: `docs/solutions/ui-bugs/hydration-mismatch-localstorage-usestate-Sidebar-20260218.md`
- Sidebar panel checklist: `docs/solutions/best-practices/sidebar-panel-replacement-checklist-Sidebar-20260219.md`

### Key source files
- `src/components/chat/chat-state-provider.tsx:62-144` — ChatStateContextValue (59 properties)
- `src/components/sidebar-context.tsx:19-55` — SidebarContextValue (25 properties)
- `src/components/chat/chat-thread.tsx:27-59` — ChatThreadProps (29 properties)
- `src/hooks/use-analytics.ts` — 928-line god hook
- `src/components/chat/task-panel.tsx` — 1,211-line monolith
- `src/components/layout-shell.tsx` — Provider composition tree
