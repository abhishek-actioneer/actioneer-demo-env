---
status: complete
priority: p1
issue_id: "121"
tags: [code-review, bug, chart, react, pr-48]
dependencies: []
---

# UnifiedChart local state not synced when spec prop changes after mount

## Problem Statement

`src/components/chart/unified-chart.tsx` initialises 5 local state values from the `spec` prop on mount only:

```ts
const [localType, setLocalType] = useState<ChartSpec["type"]>(spec.type);
const [localStacked, setLocalStacked] = useState(spec.stacked ?? false);
const [localAnnotations, setLocalAnnotations] = useState<ChartAnnotation[]>(spec.annotations ?? []);
const [localDateRange, setLocalDateRange] = useState<...>(spec.dateRange);
const [activeGrain, setActiveGrain] = useState<...>(spec.grain ?? "daily");
```

When the parent passes a new `spec` (e.g., after a successful requery in `InlineChart`), none of these values update. The chart renders with new data but `activeGrain` in the `GrainPicker` still shows the old grain label, `localDateRange` is stale, and `localAnnotations` won't include server-side changes.

In `InlineChart` (markdown.tsx), `setSpec` is called after requery: `setSpec((prev) => ({ ...prev, ...result.chartSpec!, type: prev.type }))`. The new `spec.grain` is ignored by `UnifiedChart` because `activeGrain` is frozen at mount time.

## Findings

Source: TypeScript reviewer.

- `unified-chart.tsx:78–82` — 5 useState calls initialised from props
- `lib/markdown.tsx:29` — `setSpec` called with new grain after requery
- `use-chart-requery.ts` — `onUpdateSpec` callback merges new chartSpec but local state in UnifiedChart won't reflect it
- Classic "derived state from props" anti-pattern

## Proposed Solutions

**Option A (Recommended): useEffect to sync from spec on specific field changes**
```ts
useEffect(() => {
  setLocalType(spec.type);
}, [spec.type]);

useEffect(() => {
  if (spec.grain) setActiveGrain(spec.grain);
}, [spec.grain]);

useEffect(() => {
  if (spec.dateRange) setLocalDateRange(spec.dateRange);
}, [spec.dateRange]);
```
Only sync fields that the parent meaningfully controls; don't sync fields owned exclusively by local UI interaction.

**Option B: Lift grain/dateRange state up to InlineChart**
- Remove `activeGrain` and `localDateRange` from UnifiedChart, pass as controlled props
- More invasive change but cleaner separation
- Effort: Medium | Risk: Medium

## Recommended Action

Option A — targeted `useEffect` syncs for grain and dateRange, which are the fields updated by requery.

## Technical Details

- **Affected files:** `src/components/chart/unified-chart.tsx:78–82`
- **Also affected:** `src/lib/markdown.tsx` (InlineChart), `src/hooks/use-chart-requery.ts`
- Symptoms: User changes grain from daily to weekly, chart data updates, but GrainPicker still shows "Daily"

## Acceptance Criteria

- [ ] GrainPicker shows correct grain label after a successful requery
- [ ] DateRangePicker shows updated range after requery
- [ ] Local user interactions (type switch, annotation add) still persist correctly

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-23 | Created during PR #48 review (typescript-reviewer) | useState(prop) is always a one-time initialiser — use useEffect for ongoing sync |
| 2026-03-23 | Fixed: added `useEffect` syncs for `activeGrain` and `localDateRange` in `unified-chart.tsx`. Did NOT sync `localType`, `localStacked`, or `localAnnotations` — these are owned by local user interaction; `InlineChart.setSpec` explicitly preserves `type: prev.type` on requery. |

## Resources

- PR #48: Unified Chart System + Server Persistence
