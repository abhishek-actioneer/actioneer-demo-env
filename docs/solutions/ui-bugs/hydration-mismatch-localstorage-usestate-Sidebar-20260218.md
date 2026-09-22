---
module: Sidebar
date: 2026-02-18
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "Hydration failed because the server rendered HTML didn't match the client"
  - "Sidebar panel width mismatch: server renders w-0, client renders w-[220px]"
root_cause: async_timing
resolution_type: code_fix
severity: medium
tags: [hydration, localstorage, ssr, nextjs, usestate, useeffect]
---

# Troubleshooting: Hydration Mismatch from localStorage in useState Initializer

## Problem

The `/segments` page (and any page when the sidebar was pinned) threw a React hydration error because the sidebar's `pinned` state read from `localStorage` during `useState` initialization, producing different HTML on server vs client.

## Environment

- Module: Sidebar
- Stack: Next.js 16 (App Router) / React 19
- Affected Component: `src/components/sidebar.tsx` (line 69)
- Date: 2026-02-18

## Symptoms

- "Hydration failed because the server rendered HTML didn't match the client" error overlay in dev mode
- Diff showed sidebar panel container: server rendered `w-0` (collapsed), client rendered `w-[220px]` (expanded)
- Only triggered when `sidebar-pinned` was `"true"` in localStorage (i.e., user had previously pinned the sidebar)

## What Didn't Work

**Direct solution:** The problem was identified and fixed on the first attempt from the error screenshot.

## Solution

Defer the localStorage read from `useState` initializer to a `useEffect` that runs after hydration.

**Code changes:**

```tsx
// Before (broken):
const [pinned, setPinned] = useState(() => {
  if (typeof window !== "undefined") {
    return localStorage.getItem("sidebar-pinned") === "true";
  }
  return false;
});

// After (fixed):
const [pinned, setPinned] = useState(false);

// Restore pinned state from localStorage after hydration
useEffect(() => {
  const stored = localStorage.getItem("sidebar-pinned");
  if (stored === "true") setPinned(true);
}, []);
```

## Why This Works

1. **Root cause:** In Next.js App Router, `"use client"` components are still server-side rendered during SSR. The `useState` initializer runs on both server and client. On the server, `typeof window !== "undefined"` is `false`, so `pinned = false`. On the client, `localStorage` returns `"true"`, so `pinned = true`. This creates different initial HTML trees, triggering the hydration mismatch.

2. **Why the fix works:** By starting with `pinned = false` in both environments, the server and client produce identical HTML on first render. The `useEffect` fires only on the client after hydration completes, updating the state without causing a mismatch. The user sees a brief flash of the collapsed sidebar before it expands, which is acceptable.

3. **General principle:** Never read browser-only APIs (`localStorage`, `sessionStorage`, `window.*`) inside `useState` initializers in SSR-rendered components. Always defer to `useEffect`.

## Prevention

- **Rule:** Never use `localStorage`/`sessionStorage` in `useState` initializers for any component that renders during SSR (which is all `"use client"` components in Next.js App Router)
- **Pattern:** Always use `useState(defaultValue)` + `useEffect` for hydrating client-only state
- **Detection:** The `typeof window !== "undefined"` guard inside `useState` is a code smell — it "works" at runtime but still produces mismatched HTML during hydration

## Related Issues

No related issues documented yet.
