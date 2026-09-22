---
title: React Hydration Mismatch in Playbook Page Due to localStorage Access in useMemo
date: "2026-02-24"
problem_type: ui-bugs
component: src/app/playbooks/[id]/page.tsx
symptom: React hydration mismatch error when playbook data differs between server and client renders
root_cause: getPlaybook() calling ensureInitialized() → localStorage.getItem() inside useMemo causes SSR to return MOCK_PLAYBOOK (no window) while client hydration returns persisted data with different runHistory
tags:
  - hydration
  - localStorage
  - SSR
  - React
  - Next.js
  - useMemo
  - useEffect
  - useState
  - store-pattern
related_files:
  - src/app/playbooks/[id]/page.tsx
  - src/lib/playbook-store.ts
severity: high
effort: low
recurrence_risk: medium
related_docs:
  - docs/solutions/ui-bugs/hydration-mismatch-localstorage-usestate-Sidebar-20260218.md
---

# React Hydration Mismatch: localStorage in useMemo (Playbook Page)

> **See also:** The earlier instance of this pattern affected the Sidebar via a `useState` initializer:
> [`hydration-mismatch-localstorage-usestate-Sidebar-20260218.md`](./hydration-mismatch-localstorage-usestate-Sidebar-20260218.md)
>
> This document covers the `useMemo` variant on the Playbook detail page.

## Symptom

Hard-refreshing `/playbooks/[id]` triggered a React hydration error. The run history section in the info panel rendered inconsistently:

- **Server render (SSR):** MOCK_PLAYBOOK data — e.g., `bg-yellow-500` badge, `Feb 16, 3:00pm` timestamp
- **Client render (after hydration):** localStorage data — e.g., `bg-emerald-500` badge, `Feb 24, 2026` timestamp

The error originated at `playbook-info-panel.tsx:373` where `{run.date}` rendered differently on server vs client. React detected the HTML mismatch and threw a hydration error, making the page unstable until a manual navigation.

## Investigation

1. Traced the data loading flow to `rawPlaybook = useMemo(...)` in `src/app/playbooks/[id]/page.tsx`
2. Found that `getPlaybook(playbookId)` was called inside the `useMemo` callback
3. Followed `getPlaybook()` into `src/lib/playbook-store.ts` → `ensureInitialized()` → `localStorage.getItem()`
4. During SSR: `typeof window === "undefined"`, so `localStorage` is unavailable → `getPlaybook()` returns `undefined` → fallback to `MOCK_PLAYBOOK`
5. During client hydration: `window` is defined → `localStorage` is accessible → `getPlaybook()` returns the stored playbook with different `runHistory`
6. Conclusion: server and client produce different HTML for the same component tree → hydration error

This is the same anti-pattern documented in the [Sidebar case](./hydration-mismatch-localstorage-usestate-Sidebar-20260218.md), but triggered via `useMemo` instead of a `useState` lazy initializer.

## Root Cause

React hydration requires that the initial HTML generated on the server is **byte-for-byte identical** to the HTML generated on the client's first render.

**`useMemo` executes synchronously during render** — both on the server and on the client during hydration. When its callback reads `localStorage` (via `getPlaybook()` → `ensureInitialized()`):

- **Server**: no `window` → store returns `undefined` → fallback to `MOCK_PLAYBOOK` (hardcoded yellow badge, Feb 16)
- **Client hydration**: `window` exists → store reads localStorage → returns stored playbook (emerald badge, Feb 24)

The server and client produce different `runHistory` arrays → different rendered HTML → React throws a hydration mismatch.

**Key principle**: Any code that runs synchronously during render (component body, `useMemo`, `useState` initializers) must produce identical output on server and client. Browser-only APIs are unavailable on the server, so they can never be called from these contexts.

## Fix

**File:** `src/app/playbooks/[id]/page.tsx`

**Before** (causes hydration mismatch):

```tsx
const rawPlaybook = useMemo(() => {
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  revision; // force re-read trick
  // Always check the store first — edits save there even for mock playbooks
  const fromStore = getPlaybook(playbookId);
  const result = fromStore ?? (isMock ? MOCK_PLAYBOOK : null) ?? TEMPLATE_PLAYBOOKS[playbookId] ?? null;
  // Shallow-copy so React detects mutations from addRunHistory / updatePlaybook
  return result ? { ...result } : null;
}, [playbookId, isMock, revision]);
```

**After** (hydration-safe):

```tsx
// Hydration-safe: initial state uses only static constants (same on server and client).
// After mount, useEffect reads localStorage and picks up any stored version.
const [rawPlaybook, setRawPlaybook] = useState<AnyPlaybook | null>(() => {
  const staticResult = (isMock ? MOCK_PLAYBOOK : null) ?? TEMPLATE_PLAYBOOKS[playbookId] ?? null;
  return staticResult ? { ...staticResult } : null;
});

// Re-runs on mount and whenever `revision` bumps (after mutations like apply annotations).
useEffect(() => {
  const fromStore = getPlaybook(playbookId);
  const result = fromStore ?? (isMock ? MOCK_PLAYBOOK : null) ?? TEMPLATE_PLAYBOOKS[playbookId] ?? null;
  setRawPlaybook(result ? { ...result } : null);
}, [playbookId, isMock, revision]);
```

## Why This Works

1. **`useState` initializer uses only static constants** — `MOCK_PLAYBOOK` and `TEMPLATE_PLAYBOOKS` are module-level imports, identical on server and client. Server and client produce the same initial HTML → no hydration mismatch.

2. **`useEffect` is client-only** — it runs after hydration is complete, when `window` and `localStorage` are safely accessible. It reads from the store and updates state, causing a re-render with the correct persisted data.

3. **`revision` dependency is preserved** — mutations (apply annotations, run playbook, etc.) bump `revision`, which causes the `useEffect` to re-run and pick up the latest store state. The existing reactivity pattern is unchanged.

4. **Template save-on-mount still works** — the existing effect that saves templates to the store also fires after mount. By the time it runs, `ensureInitialized()` has already populated the map from localStorage.

## The General Rule

> **Any store function that reads `localStorage` must ONLY be called from `useEffect`, never from `useMemo`, `useState` initializers, or the component body in SSR-rendered contexts.**

| Context | Runs on Server? | Safe for localStorage? |
|---|---|---|
| Component body (render) | Yes | ❌ No |
| `useMemo` callback | Yes | ❌ No |
| `useState` lazy initializer | Yes | ❌ No |
| `useEffect` callback | No | ✅ Yes |
| Event handlers | No | ✅ Yes |

## Code Smell Checklist

Flag these patterns in code review for SSR client components (`"use client"`):

- [ ] `useMemo` calling `getPlaybook()`, `getCanvas()`, or any store function
- [ ] `useState(() => getPlaybook())` — lazy initializer reading storage
- [ ] Direct store calls in component body: `const data = getPlaybook()`
- [ ] `typeof window !== 'undefined'` guards inside `useMemo` or `useState` (band-aid, not a fix)
- [ ] `ensureInitialized()` called outside `useEffect`

## Verification

1. Hard-refresh the playbook detail page — no hydration error in browser console
2. Run history renders correctly after mount (shows stored data, no flash to wrong data)
3. Applying annotations still works — revision bump triggers `useEffect` re-read
4. `pnpm build` passes with no TypeScript errors in `src/app/playbooks/[id]/page.tsx`
5. Check browser console for `"Hydration"` or `"Did not expect"` — none should appear
