# BEAD-011: Explorer route const reassignment — build blocker

**Severity:** CRITICAL
**Category:** Build / Dev Infra
**Page:** /api/explorer (affects /explore)
**Ship-Readiness Impact:** BLOCK
**PR:** #48

---

## Summary

`pnpm build` fails with `cannot reassign to a variable declared with 'const'` in `src/app/api/explorer/route.ts:145`. The `chartSpec` variable is destructured with `const` on line 109, then reassigned on line 145 inside the period-over-period comparison branch.

## Build Output

```
./src/app/api/explorer/route.ts:145:11
Ecmascript file had an error
 143 |             return merged;
 144 |           });
> 145 |           chartSpec = {
     |           ^^^^^^^^^
 146 |             ...chartSpec,
 147 |             data: mergedData,
 148 |             yKeys: [...chartSpec.yKeys, ...prevYKeys],

cannot reassign to a variable declared with `const`
```

## Root Cause

**File:** `src/app/api/explorer/route.ts`

Line 109 destructures as `const`:
```typescript
const { chartSpec, breakdownData, dates } = buildExplorerChartSpec(...)
```

Line 145 attempts reassignment:
```typescript
chartSpec = { ...chartSpec, data: mergedData, ... }
```

## Fix

Change the destructuring on line 109 to use `let`:
```typescript
let { chartSpec, breakdownData, dates } = buildExplorerChartSpec(...)
```

Alternatively, introduce a new variable `mergedChartSpec` and use that downstream.

## Impact

Blocks all production builds. No part of the app can be deployed until this is fixed.
