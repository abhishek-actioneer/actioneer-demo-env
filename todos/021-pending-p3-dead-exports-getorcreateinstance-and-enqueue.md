---
status: pending
priority: p3
issue_id: "021"
tags: [code-review, quality, db]
dependencies: []
---

# Dead exports: getOrCreateInstance and enqueue have no external callers

## Problem Statement

Two symbols are exported from `src/lib/db.ts` but have zero external callers:

```typescript
// db.ts:61
export async function getOrCreateInstance(dbPath: string): Promise<DuckDBInstance> { ... }

// db.ts:73
export { enqueue };
```

Confirmed by grep: no file outside `db.ts` imports either symbol. Both
`data-profiler.ts` and `upload/route.ts` call `instanceCache.getOrCreateInstance`
directly (the DuckDB library method), not the `db.ts` wrapper. The `enqueue`
export exists for anticipated external use that never materialised; all callers
use `withConnection` instead.

Unnecessary exports widen the public API surface, invite incorrect usage (callers
who need an instance may reach for the exported function without knowing it has
a race condition — see todo-016), and add maintenance burden (the export must
be kept stable even through internal refactors).

## Findings

- `src/lib/db.ts:61` — `export` on `getOrCreateInstance`; 0 external callers
- `src/lib/db.ts:73` — `export { enqueue }`; 0 external callers (ReadableStream `.enqueue()` calls in other files are the Web Streams API, not this function)

## Proposed Solutions

**Option A (Recommended): Remove both exports**

```typescript
// db.ts:61 — change to:
async function getOrCreateInstance(dbPath: string): Promise<DuckDBInstance> { ... }

// db.ts:73 — delete the line:
// export { enqueue };  ← remove
```

`getOrCreateInstance` remains callable from `initConnection` inside the same
module. `enqueue` remains callable from `withConnection`. No external behavior
changes.

Note: if todo-012 is addressed first (data-profiler + upload should call
`getOrCreateInstance` from `db.ts` instead of `instanceCache` directly), the
export should be KEPT at that point to allow those external callers. Coordinate
with todo-012.

- Effort: Trivial | Risk: None (no external callers)

## Technical Details

- `src/lib/db.ts:61,73`

## Acceptance Criteria

- [ ] Neither `getOrCreateInstance` nor `enqueue` appears in any `export` statement in `db.ts` (unless todo-012 requires the export)
- [ ] TypeScript compilation passes
- [ ] No external files break

## Work Log

- 2026-03-02: Found by code-simplicity-reviewer agent on PR #29
