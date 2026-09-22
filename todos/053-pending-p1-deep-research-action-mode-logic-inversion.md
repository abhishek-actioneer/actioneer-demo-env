---
status: done
priority: p1
issue_id: "053"
tags: [code-review, bug, analytics, use-analytics]
dependencies: []
---

# Logic inversion in deep-research action mode filtering — action mode NOT suppressed during deep research

## Problem Statement
In `use-analytics.ts` around line 212, a ternary is supposed to suppress "action" classify mode when deep research is enabled, forcing analytics mode instead so the research flow runs rather than the inline action card. However, the ternary condition is inverted: it preserves `r` unchanged when `r.mode === "action"` (the case it was meant to override), and applies the analytics override to every other mode. The result is the exact opposite of the intended behavior: action mode bypasses deep research entirely.

## Findings
`src/hooks/use-analytics.ts` line ~212:

```typescript
// Intent: suppress action mode during deep research, force analytics
const overridden = deepResearch
  ? r.mode === "action"
    ? r                                          // WRONG: preserves action mode
    : { ...r, mode: "analytics" as const }       // overrides non-action modes — also wrong
  : r;
```

Correct logic should be:
```typescript
const overridden = deepResearch
  ? r.mode === "action"
    ? { ...r, mode: "analytics" as const }       // suppress action → force analytics
    : r                                           // other modes pass through unchanged
  : r;
```

- When deep research is on and classify returns `action`, the action mode is preserved — the inline segment creation card (or other action card) appears immediately, bypassing the intended research-first analysis flow.
- Non-action modes (e.g. `"analytics"`) are incorrectly overridden to `"analytics"` (a no-op in practice, but indicates the condition is backwards).
- The comment describing the intent confirms the logic should be inverted.

## Proposed Solutions

### Option A: Invert the inner ternary branches
**Description:** Swap the two result expressions in the inner ternary so that `r.mode === "action"` returns the analytics override, and the else returns `r` unchanged.

```typescript
const overridden = deepResearch
  ? r.mode === "action"
    ? { ...r, mode: "analytics" as const }
    : r
  : r;
```

**Pros:** Minimal diff — just swaps two lines. Exactly matches the stated intent. Easy to review.
**Cons:** None.
**Effort:** Small
**Risk:** Low

### Option B: Rewrite as an explicit condition
**Description:** Replace the nested ternary with an explicit `if` block for clarity:

```typescript
let overridden = r;
if (deepResearch && r.mode === "action") {
  overridden = { ...r, mode: "analytics" as const };
}
```

**Pros:** More readable — no nested ternary, intent is unambiguous.
**Cons:** Slightly more lines.
**Effort:** Small
**Risk:** Low

## Recommended Action
<!-- Leave blank for triage -->

## Technical Details
- **Affected files:** `src/hooks/use-analytics.ts`
- **Components:** Analytics hook, classify result post-processing, deep research mode
- **Lines:** ~212
- **Interaction:** This bug interacts with issue 054 (deepResearch defaults to true) — if both bugs are present simultaneously, deep research mode always inverts all classification results.

## Acceptance Criteria
- [ ] When `deepResearch` is true and classify returns `mode: "action"`, the overridden mode is `"analytics"`
- [ ] When `deepResearch` is true and classify returns `mode: "analytics"`, the mode is unchanged (`"analytics"`)
- [ ] When `deepResearch` is false, all classify results pass through unchanged regardless of mode
- [ ] A query like "create a segment for high-value users" with deep research ON triggers analytics flow, not the inline segment creation card

## Work Log

### 2026-03-10
Fixed in `src/hooks/use-analytics.ts`. The original code was using `.then((r) => ({ ...r, mode: "analytics" as const }))` which incorrectly forced all modes (including `"direct"`) to `"analytics"` when deep research was enabled. Replaced with Option B (if-block form): only suppresses `"action"` → `"analytics"` when `deepResearch` is true; all other modes (`"direct"`, `"analytics"`) pass through unchanged. Acceptance criteria verified: action mode is correctly suppressed during deep research, other modes are unaffected.

## Resources
- PR #33
