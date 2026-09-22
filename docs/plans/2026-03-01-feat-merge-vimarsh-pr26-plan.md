---
title: "feat: Merge vimarsh branch (PR #26) into main"
type: feat
date: 2026-03-01
---

# Merge PR #26 into main — Parallelized Fix Plan

## Overview

PR #26 introduces research timeline polish, shimmer animations, the autocomplete dropdown, DuckDB malloc crash fix, and metrics improvements. It cannot merge as-is due to 2 active git conflicts with main and a performance regression (global DuckDB queue serializes all parallel analytics queries). This plan resolves every blocker and cleanup item before merging.

---

## Pre-Requisite (Sequential — Must Complete First)

### Step 0: Rebase vimarsh onto main

Rebase the `vimarsh` branch onto `main` to surface the 2 real conflicts:

```bash
git checkout vimarsh
git rebase origin/main
```

During rebase, resolve **two conflicts**:

#### Conflict A: `src/app/api/complete/route.ts`

Main's version (from PR #25) is strictly better:
- Adds `.max(500)` to the `prefix` Zod schema (security/quota guard)
- Uses `"cerebras-fast"` model ID (correct for autocomplete)
- Wraps Cerebras in try/catch with explicit Gemini fallback

**→ Take main's version** for all conflicting hunks.

#### Conflict B: `src/lib/llm.ts`

Main's version (from PR #25) is strictly better:
- Splits `CEREBRAS_GLM_MODEL` / `CEREBRAS_FAST_MODEL` with `cerebrasModel()` dispatch
- `ModelId` type already includes `"cerebras-fast"`

**→ Take main's version** for all conflicting hunks.

After conflicts are resolved:
```bash
git rebase --continue
git push origin vimarsh --force-with-lease
```

---

## Parallel Batch — All 8 tasks below are fully independent and can run simultaneously

### Task 1: Fix Global Queue → Per-Dataset Queue
**File:** `src/lib/db.ts`
**Priority:** 🔴 Critical (performance regression — blocks deep mode)

The single global `queueRef` serializes ALL DuckDB operations across ALL datasets. The deep-mode analyze route runs 17 queries in `Promise.all()` — they all queue behind each other now. Fix by using a **per-dataset queue map** so queries for different datasets can run concurrently, and operations within the same dataset still serialize.

**Changes:**

1. Replace `__duckdb_queue__` (single object) with `__duckdb_queues__` (Map<string, {promise}>):

```typescript
// DuckDBGlobal interface — replace:
__duckdb_queue__?: { promise: Promise<unknown> };
// with:
__duckdb_queues__?: Map<string, { promise: Promise<unknown> }>;
```

2. Initialize on globalThis:

```typescript
// Replace:
if (!g.__duckdb_queue__) g.__duckdb_queue__ = { promise: Promise.resolve() };
const queueRef = g.__duckdb_queue__;
// With:
if (!g.__duckdb_queues__) g.__duckdb_queues__ = new Map();
const queues = g.__duckdb_queues__;
```

3. Update `enqueue()` to accept a `dsId` parameter:

```typescript
function enqueue<T>(dsId: string, fn: () => Promise<T>): Promise<T> {
  let q = queues.get(dsId);
  if (!q) {
    q = { promise: Promise.resolve() };
    queues.set(dsId, q);
  }
  const qRef = q;
  const next = qRef.promise.then(() => fn(), () => fn());
  qRef.promise = next.catch(() => {});
  return next;
}
```

4. Update `initConnection(datasetId)` to pass `dsId` to `enqueue`:

```typescript
async function initConnection(datasetId: string): Promise<DuckDBConnection> {
  return enqueue(datasetId, async () => { ... });
}
```

5. Update `withConnection(datasetId, fn)` to pass `dsId`:

```typescript
export async function withConnection<T>(
  datasetId: string | undefined,
  fn: (conn: DuckDBConnection) => Promise<T>,
): Promise<T> {
  const dsId = datasetId || DEFAULT_DATASET;
  const conn = await getConnection(dsId);
  return enqueue(dsId, () => fn(conn));
}
```

6. Update exported `enqueue` signature (used by upload route after Task 2):

```typescript
export { enqueue };  // signature changes to enqueue(dsId, fn) — update all callers
```

**Acceptance criteria:**
- [ ] Deep mode analytics run sub-queries concurrently across 6 agents again
- [ ] Two different datasets can query concurrently
- [ ] Operations within the same dataset remain serialized (no malloc crash)

---

### Task 2: Fix Upload Route to Use `enqueue()`
**File:** `src/app/api/datasets/upload/route.ts`
**Priority:** 🟡 Important (upload bypasses crash protection)

The upload route does its own DuckDB calls (DESCRIBE, SELECT COUNT, MIN/MAX) outside the global queue. If an analytics query is running for the same DB file, they can collide and trigger the malloc crash.

**Changes:**

1. Remove the duplicate globalThis init block (lines ~6–10) — `db.ts` already handles this:

```typescript
// DELETE these lines:
const _g = globalThis as { __duckdb_instance_cache__?: ...; __duckdb_instances__?: ... };
if (!_g.__duckdb_instance_cache__) ...
if (!_g.__duckdb_instances__) ...
const instanceCache = _g.__duckdb_instance_cache__;
const instancePins = _g.__duckdb_instances__;
```

2. Import from `db.ts` instead:

```typescript
import { enqueue, getOrCreateInstance } from "@/lib/db";
```

3. Wrap every `conn.run()` in the upload handler with `enqueue(dbPath, ...)`. Use `dbPath` as the dataset ID for queue isolation (the upload-specific DB has its own path).

Example pattern for the schema introspection queries:
```typescript
const schema = await enqueue(dbPath, () => conn.run(`DESCRIBE ${tableName}`));
```

**Acceptance criteria:**
- [ ] Upload route no longer has its own globalThis init block
- [ ] All DuckDB calls in upload route go through `enqueue()`
- [ ] Concurrent upload + analytics doesn't crash

---

### Task 3: Remove `console.log` from `/api/complete`
**File:** `src/app/api/complete/route.ts`
**Priority:** 🟡 Important (fills server logs on every keystroke)

Line 40 (approximately, after conflict resolution):
```typescript
// DELETE this line:
console.log("[autocomplete] raw LLM response:", JSON.stringify(text).slice(0, 500));
```

The two `console.warn` calls below it (for unexpected JSON shape and general errors) are correct and should stay.

**Acceptance criteria:**
- [ ] No `console.log` calls remain in the autocomplete route
- [ ] `console.warn` for error cases stays

---

### Task 4: Delete Dead Code — `src/lib/tab-completion.ts`
**File:** `src/lib/tab-completion.ts`
**Priority:** 🟡 Important (133 lines with zero callers)

`getSuggestions()` is exported but nothing imports it. The LLM path in `use-autocomplete.ts` is what actually runs. The `_schemaContext` parameter with the underscore prefix was already a signal this was being phased out.

```bash
rm src/lib/tab-completion.ts
```

Verify no imports exist:
```bash
grep -r "tab-completion\|getSuggestions" src/
```

**Acceptance criteria:**
- [ ] File is deleted
- [ ] No TypeScript errors (nothing imported it)
- [ ] `pnpm build` still passes

---

### Task 5: Remove Dead `HighlightedText` Component
**File:** `src/components/chat/autocomplete-dropdown.tsx`
**Priority:** 🔵 Nice-to-have

The `HighlightedText` component (~80 lines at the top of the file) is defined but never used — the dropdown renders `{suggestion}` directly.

**Option A — Remove it** (simpler, if highlight-on-match feature is deferred):
- Delete the `HighlightedText` component definition
- Leave `{suggestion}` rendering as-is

**Option B — Wire it up** (better UX, highlight matching prefix in suggestions):
- Replace `{suggestion}` on line ~173 with `<HighlightedText text={suggestion} prefix={prefix} />`
- Pass `prefix` as a prop to `AutocompleteDropdown`

Decision: Remove (Option A) unless wiring it up is easy — this is a demo app.

**Acceptance criteria:**
- [ ] `HighlightedText` is either wired up and rendering, or fully deleted
- [ ] No dead component code remains in the file

---

### Task 6: Fix Autocomplete Eager-Fire Stale Prefix Contamination
**File:** `src/hooks/use-autocomplete.ts`
**Priority:** 🟡 Important (shows mixed-intent suggestions)

The eager-fire `.then()` handler (after the LLM call returns) calls `setSuggestions(prev => mergeSuggestions(prev, filtered))` without checking if the current prefix has diverged from the prefix that triggered the eager fire. If the user changed direction while the eager call was in-flight, stale suggestions get merged in.

**Minimum fix — add a prefix staleness check before merging:**

```typescript
// In the eager-fire .then() handler, before setSuggestions:
.then((data: { completions: string[] }) => {
  if (!data.completions || !Array.isArray(data.completions)) return;

  const completions = data.completions.filter(
    (s) => typeof s === "string" && s.trim().length > 0
  );
  cacheSet(datasetId, eagerPrefix, completions);

  // NEW: Only merge if current prefix still starts with the eager prefix
  // (user hasn't completely changed direction)
  const currentPrefix = prefixRef.current.trim().toLowerCase();
  const eagerPrefixNorm = eagerPrefix.toLowerCase();
  if (!currentPrefix.startsWith(eagerPrefixNorm.slice(0, Math.min(eagerPrefixNorm.length, 15)))) {
    return; // User changed direction — discard these stale suggestions
  }

  const filtered = completions.filter(
    (s) => s.toLowerCase().trim() !== currentPrefix
  );
  setSuggestions((prev) => mergeSuggestions(prev, filtered));
})
```

**Acceptance criteria:**
- [ ] Typing then backspacing completely doesn't show suggestions from prior prefix
- [ ] Suggestions from the eager fire still appear when user continues typing in the same direction

---

### Task 7: Remove Unused Props from `ResearchTimeline`
**File:** `src/components/chat/research-timeline.tsx`
**Priority:** 🔵 Nice-to-have

The interface declares `selectedSubagentId` and `isTaskPanelOpen` but the component never destructures or uses them.

1. Remove from the interface:
```typescript
// DELETE:
selectedSubagentId: string | null;
isTaskPanelOpen: boolean;
```

2. TypeScript will catch all call sites that pass these props — update them to stop passing the unused values.

**Acceptance criteria:**
- [ ] Interface only declares props actually used
- [ ] `pnpm build` passes without `unused variable` warnings

---

### Task 8: Fix No-Op Ternary in `report-chart.tsx`
**File:** `src/components/chart/report-chart.tsx`
**Priority:** 🔵 Nice-to-have

Find and fix:
```typescript
// Change:
strokeWidth={isAccent ? 1.5 : 1.5}
// To:
strokeWidth={1.5}
```

**Acceptance criteria:**
- [ ] No identical-branch ternaries in the file

---

## Final Step (Sequential — After All Parallel Tasks Complete)

### Step 9: Verify, Build, and Merge

```bash
# On vimarsh branch after rebase + all fixes applied
pnpm lint
pnpm build

# If clean:
gh pr merge 26 --merge --subject "feat: merge vimarsh research timeline, autocomplete, DuckDB fixes"
```

**Pre-merge checklist:**
- [ ] `git rebase origin/main` clean (Step 0)
- [ ] Per-dataset DuckDB queue implemented (Task 1)
- [ ] Upload route uses `enqueue()` (Task 2)
- [ ] `console.log` removed from `/api/complete` (Task 3)
- [ ] `tab-completion.ts` deleted (Task 4)
- [ ] `HighlightedText` resolved (Task 5)
- [ ] Eager-fire staleness check added (Task 6)
- [ ] Unused ResearchTimeline props removed (Task 7)
- [ ] No-op ternary fixed (Task 8)
- [ ] `pnpm lint` passes
- [ ] `pnpm build` passes

---

## Parallelization Map

```
Step 0: Rebase + resolve conflicts (MUST be first)
         │
         ▼
┌────────────────────────────────────────────────────┐
│  All 8 tasks run in parallel on vimarsh branch     │
│                                                    │
│  Task 1: Per-dataset queue (db.ts)                 │
│  Task 2: Upload route enqueue() (upload/route.ts)  │
│  Task 3: Remove console.log (complete/route.ts)    │
│  Task 4: Delete tab-completion.ts                  │
│  Task 5: Remove HighlightedText dead code          │
│  Task 6: Eager-fire staleness fix (use-auto…)      │
│  Task 7: Remove unused ResearchTimeline props      │
│  Task 8: Fix no-op ternary (report-chart.tsx)      │
└────────────────────────────────────────────────────┘
         │
         ▼
Step 9: Lint + build + merge to main
```

**Note on Task 1 ↔ Task 2 dependency:** Task 2 imports `enqueue` from `db.ts`. If `enqueue`'s signature changes in Task 1 (it gains a `dsId` parameter), Task 2 must use the new signature. These two tasks share a file contract — coordinate the `enqueue(dsId, fn)` API shape before splitting work.

---

## Out of Scope (Pre-existing Issues — Track Separately)

These exist on `main` today and are not introduced by PR #26:

- **Session middleware in `proxy.ts`** — needs renaming to `middleware.ts` and HMAC signing. Create a separate issue.
- **`read_csv` not blocked in SQL validator** — DuckDB file I/O via LLM-generated SQL. Create a separate security issue.
- **Metrics recompute concurrency guard** — multiple stale requests trigger redundant recomputes. Low priority for demo.

---

## References

- PR #26: `vimarsh` → `main` (GitHub)
- PR #25 commits on main: `b1e90b1`, `83cde99`, `934e114` (cerebras model split)
- `src/lib/db.ts` — DuckDB singleton, `enqueue()` export, `withConnection()`
- `src/app/api/analyze/route.ts` — runs 17 queries in `Promise.all()` (affected by Task 1)
- `src/app/api/datasets/upload/route.ts` — duplicate globalThis init (affected by Task 2)
- `src/app/api/complete/route.ts` — autocomplete endpoint (conflict resolution + Task 3)
- `src/lib/llm.ts` — model dispatch (conflict resolution)
- `src/hooks/use-autocomplete.ts` — eager-fire logic (Task 6)
- `src/lib/tab-completion.ts` — dead code to delete (Task 4)
- `src/components/chat/autocomplete-dropdown.tsx` — dead HighlightedText (Task 5)
- `src/components/chat/research-timeline.tsx` — unused props (Task 7)
- `src/components/chart/report-chart.tsx` — no-op ternary (Task 8)
