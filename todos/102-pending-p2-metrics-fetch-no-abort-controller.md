---
name: metrics-fetch-no-abort-controller
description: Metrics fetch in add-card-menu has no AbortController — rapid step cycling creates parallel orphaned requests; last response wins
type: bug
status: pending
priority: p2
issue_id: "102"
tags: [code-review, performance, add-card-menu, metrics]
---

## Problem Statement

The `useEffect` in `add-card-menu.tsx` that fetches metrics has no cleanup / abort mechanism. If a user clicks "Metric", goes back, then clicks "Metric" again before the first fetch resolves, a second request fires in parallel. Both are in-flight simultaneously with no deduplication. Whichever resolves last overwrites `metrics` state — potentially a stale earlier response.

Additionally, if the component unmounts while a fetch is in progress, `setMetrics` is still called on the unmounted component.

## Findings

- **File:** `src/components/board/add-card-menu.tsx:102–109`
- **Pattern:** `.then/.catch/.finally` with no cleanup return
- **Also missing:** Guard against re-fetching if metrics are already loaded (no caching in the effect)
- **metricsLoading flag** exists but is never checked before starting a new fetch

## Proposed Solutions

### Option A — AbortController + stale flag (Recommended)

```typescript
useEffect(() => {
  if (step !== "metric") return;
  let cancelled = false;
  const controller = new AbortController();
  setMetricsLoading(true);
  apiFetch<{ metrics: Metric[] }>("/api/metrics", { skipModel: true, datasetId })
    .then((data) => { if (!cancelled) setMetrics(data.metrics ?? []); })
    .catch(() => { if (!cancelled) setMetrics([]); })
    .finally(() => { if (!cancelled) setMetricsLoading(false); });
  return () => { cancelled = true; controller.abort(); };
}, [step, datasetId]);
```

Add a ref to cache after first load so subsequent step visits skip the network call:
```typescript
const metricsCache = useRef<Metric[] | null>(null);
// At top of effect: if (metricsCache.current) { setMetrics(metricsCache.current); return; }
// After .then: metricsCache.current = data.metrics ?? [];
```

Pros: Correct, prevents stale state, eliminates orphaned requests.

### Option B — Move metrics fetch to menu open (not step change)

Fetch on `open === true` instead of `step === "metric"`, so data is ready before the user reaches the metric step.

Pros: Better UX (no loading state on step entry). Cons: Fetches metrics even when user never clicks "Metric".

## Recommended Action

Option A — minimal, targeted fix. Option B as a UX enhancement later.

## Technical Details

- **Affected file:** `src/components/board/add-card-menu.tsx`
- **Note:** Also requires fixing the URL query param (see todo 100)

## Acceptance Criteria

- [ ] Click "Metric" step rapidly 5 times in succession — only 1 active request at a time
- [ ] Close the add-card menu while metrics are loading — no React state-on-unmounted-component warning in console
- [ ] Metrics load correctly on first visit to the step

## Work Log

- 2026-03-16: Identified in PR #42 code review via performance-oracle agent
