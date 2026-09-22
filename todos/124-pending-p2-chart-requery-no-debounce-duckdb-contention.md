---
status: pending
priority: p2
issue_id: "124"
tags: [code-review, performance, chart-requery, pr-48]
dependencies: []
---

# No debounce on chart-requery — DuckDB contention on rapid grain/date picker input

## Problem Statement

`src/hooks/use-chart-requery.ts` fires immediately on every `GrainPicker` or `ChartDateRangePicker` change event with no debounce. Clicking through daily → weekly → monthly fires 3 sequential DuckDB calls. DuckDB's single-writer model queues each behind the prior one.

There's also no `AbortController` — stale in-flight responses still call `setSpec`/`onUpdateCard` on return, potentially overwriting a more recent response.

With 9 chart surfaces capable of triggering requeries, this produces stacked DuckDB queries under normal usage.

## Findings

Source: Performance Oracle.

- `use-chart-requery.ts:27–57` — `requery()` fires immediately with no debounce
- No AbortController in `use-chart-requery.ts`
- `InlineChart` in `markdown.tsx:24–33` and `ChartRenderer` in `chart-renderer.tsx:27–47` — both pass callbacks directly without debounce
- DuckDB's `busy_timeout` is on SQLite (meta-db), not DuckDB — doesn't help here

## Proposed Solutions

**Option A (Recommended): Debounce + AbortController in useChartRequery**
```ts
const abortRef = useRef<AbortController | null>(null);

const requery = useMemo(() => debounce(async (params) => {
  abortRef.current?.abort();
  abortRef.current = new AbortController();
  const result = await apiFetch("/api/chart-requery", {
    method: "POST",
    body: params,
    signal: abortRef.current.signal,
  });
  // ...
}, 300), []);
```
- 300ms debounce prevents rapid-fire DuckDB calls
- AbortController cancels stale in-flight requests
- Effort: Small | Risk: Low

## Technical Details

- **Affected files:** `src/hooks/use-chart-requery.ts`
- **Downstream:** `src/lib/markdown.tsx` (InlineChart), `src/components/chart/chart-renderer.tsx`

## Acceptance Criteria

- [ ] Grain picker changes debounced by 300ms before triggering requery
- [ ] Previous in-flight requery aborted when new one starts
- [ ] Stale responses do not overwrite current spec

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-23 | Created during PR #48 review (performance-oracle) | |

## Resources

- PR #48: Unified Chart System + Server Persistence
