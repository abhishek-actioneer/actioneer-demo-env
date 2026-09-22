---
title: Model Switcher Disappeared from Sidebar
slug: model-switcher-disappeared-from-sidebar
date: 2026-03-16
status: resolved
category: ui-bugs
component: sidebar
tags: [model-picker, sidebar, panels, account-popover, regression]
symptoms:
  - Model switcher no longer visible in sidebar
  - No way for users to switch between Quick / Lightning models from the sidebar
  - The Account popover shows Theme and Billing/Usage but no Model section
related_files:
  - src/components/sidebar.tsx
  - src/components/sidebar/panels.tsx
  - src/lib/model-context.tsx
  - src/lib/model-registry.ts
---

## Problem

The model picker (Quick / Lightning toggle) disappeared from the sidebar. Previously it existed as a dedicated section in the `UserPanel` component inside `src/components/sidebar/panels.tsx` — styled similarly to the Theme (light/dark/system) switcher. After a full sidebar rewrite, the new `sidebar.tsx` never imported or rendered the model picker, silently dropping it from the UI.

## Timeline of What Happened

| Date | Commit | What happened |
|------|--------|---------------|
| Feb 24, 2026 | `26360e3` | Model picker added as a first-class section in `UserPanel` inside `src/components/sidebar/panels.tsx` |
| Mar 1, 2026 | `6a9cda8` | `panels.tsx` was kept but `layout-shell.tsx` switched to a redesigned sidebar file |
| Mar 12–13, 2026 | `602e024` | Full sidebar rewrite (`sidebar.tsx`) by Vimarsh — new file never imported `panels.tsx` or `useModel()`, dropping the model picker entirely |
| Mar 16, 2026 | — | Model picker re-added to Account popover in `sidebar.tsx` |

## Root Cause

`src/components/sidebar/panels.tsx` still exists and still contains a working `UserPanel` with a model switcher at lines 700–740. However, the current `src/components/sidebar.tsx` (written in a full rewrite) **never imports `panels.tsx`** and never calls `useModel()` or renders model selection UI anywhere.

The rewrite was scope-focused on layout / folder / board improvements and simply didn't carry the model picker forward. There was no lint error or TypeScript error to catch this — the missing feature was invisible at build time.

## Original Implementation (panels.tsx UserPanel)

```tsx
// src/components/sidebar/panels.tsx — lines 700-740
{/* Model */}
<div className="relative">
  <p className={SECTION_HEADER}>Model</p>
  <button
    className={`${ITEM} justify-between`}
    onClick={() => setModelDropdown((v) => !v)}
  >
    <div className="flex items-center gap-2 min-w-0">
      <Cpu className={ICON} />
      <p className={PRIMARY}>{model.label}</p>
    </div>
    <div className="flex items-center gap-1.5 shrink-0">
      <span className="text-[10px] text-muted-foreground font-medium">{model.badge}</span>
      <ChevronsUpDown className="w-3 h-3 text-muted-foreground" />
    </div>
  </button>
  {modelDropdown && (
    <div className="mt-0.5 mx-1 rounded-md border border-border bg-popover shadow-md z-50">
      {MODELS.map((m) => {
        const isActive = m.id === modelId;
        return (
          <button
            key={m.id}
            onClick={() => { switchModel(m.id as ModelId); setModelDropdown(false); }}
            className={`w-full flex items-center justify-between px-3 py-2 text-left transition-colors ${
              isActive ? "bg-muted" : "hover:bg-muted/50"
            }`}
          >
            <p className={`text-[13px] ${isActive ? "text-foreground font-medium" : "text-muted-foreground"}`}>{m.label}</p>
            <span className="text-[10px] text-muted-foreground">{m.badge}</span>
          </button>
        );
      })}
    </div>
  )}
</div>
```

## Fix Applied

Added the model picker directly into `src/components/sidebar.tsx`'s Account popover (portaled to `document.body`). It sits between the Theme section and the Log out button.

**1. Imports added:**
```ts
import { useModel } from "@/lib/model-context";
import { MODELS, type ModelId } from "@/lib/model-registry";
```

**2. Hook + state inside Sidebar component:**
```ts
const { modelId, model, switchModel } = useModel();
const [modelDropdown, setModelDropdown] = useState(false);
```

**3. Model section inserted in Account popover (after Theme divider):**
```tsx
<div className="mx-3 border-t border-border" />

{/* Model */}
<div className="py-1.5 px-1.5">
  <p className="px-3 py-1 text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Model</p>
  <button
    className="w-full flex items-center justify-between px-3 py-2 rounded-md hover:bg-muted transition-colors"
    onClick={() => setModelDropdown((v) => !v)}
  >
    <p className="text-[13px] text-foreground">{model.label}</p>
    <span className="text-[10px] text-muted-foreground font-medium">{model.badge}</span>
  </button>
  {modelDropdown && (
    <div className="mt-1 space-y-0.5">
      {MODELS.map((m) => {
        const isActive = m.id === modelId;
        return (
          <button
            key={m.id}
            onClick={() => { switchModel(m.id as ModelId); setModelDropdown(false); }}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-left transition-colors ${
              isActive ? "bg-muted" : "hover:bg-muted/50"
            }`}
          >
            <p className={`text-[13px] ${isActive ? "text-foreground font-medium" : "text-muted-foreground"}`}>{m.label}</p>
            <span className="text-[10px] text-muted-foreground">{m.badge}</span>
          </button>
        );
      })}
    </div>
  )}
</div>
```

## Prevention

**When doing a full component rewrite**, audit every hook and feature used by the old file before deleting or replacing it:

```bash
# Before replacing sidebar.tsx, check what unique hooks/features it used:
grep -n "useModel\|useForecast\|useScout" src/components/sidebar.tsx
```

Add a comment block at the top of any file that is the **sole render point** for a user-facing feature:

```tsx
// ⚠️ FEATURE CHECKLIST — ensure all of these survive any rewrite:
// - Model picker (useModel → Account popover)
// - Theme switcher (useTheme → Account popover)
// - Dataset switcher (useDataset → header)
// - Folder management (folder-store)
// - Board management (board-store)
```

**Dead code vs live code**: `src/components/sidebar/panels.tsx` still exists but is not imported anywhere. Before deleting it, extract any features it contains into the active sidebar. Do not rely on "this file has the code" — if the file isn't imported, the feature doesn't exist for users.

## Related

- `src/components/sidebar/panels.tsx` — legacy UserPanel with model picker (not currently imported)
- `src/lib/model-context.tsx` — `useModel()` hook, `ModelProvider`, localStorage persistence
- `src/lib/model-registry.ts` — `MODELS` array, `ModelId` type, `DEFAULT_MODEL`
- `src/lib/api-client.ts` — `setActiveModelId()` syncs module state; `x-model-id` header auto-injected by `apiFetch()`
