---
status: pending
priority: p2
issue_id: "046"
tags: [code-review, performance, pr-28]
dependencies: []
---

# checkVisibleReport fires unthrottled on every streaming token (DOM queries per-token)

## Problem Statement

During deep-mode streaming, `checkVisibleReport` in `chat-thread.tsx` is called synchronously (bypassing rAF throttling) on every streaming token. This causes dozens of `querySelectorAll` + `getBoundingClientRect` calls per second, forcing layout flushes on dirty frames.

The rAF throttle only guards the **user-initiated scroll event** path. There is a second path via `useEffect` re-fire that is **unthrottled**.

## Findings

**Root cause chain:**

1. Each streaming token → `setMessages(...)` in `use-analytics.ts`
2. → `ChatThread` re-renders
3. → `deepReports` useMemo runs: creates a **new Map** on every `messages` change (structural identity lost, even when report content is unchanged)
4. → Because `deepReports` is a new Map reference, `checkVisibleReport` useCallback (which has `deepReports` in its deps at line 180) is **recreated**
5. → Because `checkVisibleReport` is a new function reference, the `useEffect` at line 183 re-fires
6. → The initial check on line 188 calls `checkVisibleReport()` **synchronously** — bypassing the rAF guard

**At ~80 tokens/sec during a 60-second deep research stream:** ~4,800 layout reads via `querySelectorAll` + `getBoundingClientRect` on DOM-dirty frames.

**File:** `src/components/chat/chat-thread.tsx`
**Lines:** 118–203

## Proposed Solutions

### Option A: Fingerprint-based deepReports memoization (Recommended)

Add an intermediate memo that produces a stable string key for report content changes. `deepReports` depends on this string instead of the full `messages` array:

```ts
const reportFingerprint = useMemo(() =>
  messages
    .filter(m => m.role === "sentinel" && !m.variant && m.content.length > 0 && !m.isAnalyticsResponse)
    .map(m => `${m.id}:${m.content.length}`)
    .join("|"),
  [messages]);

const deepReports = useMemo(() => {
  const map = new Map<string, string>();
  for (const m of messages) {
    if (m.role === "sentinel" && !m.variant && m.content.length > 0 && !m.isAnalyticsResponse) {
      map.set(m.id, m.content);
    }
  }
  return map;
}, [reportFingerprint, messages]); // reportFingerprint stabilizes between non-report updates
```

**Pros:** Reduces unthrottled checks from ~4,800 to ~0 for non-sentinel message updates; eliminates the useEffect re-fire during agent status updates, user messages, etc.
**Cons:** Slightly more complex; still fires on content growth (which is intentional)

### Option B: Add rAF throttle to the initial useEffect check

Instead of calling `checkVisibleReport()` synchronously in the useEffect (line 188), schedule it via rAF:

```ts
useEffect(() => {
  if (minimapRafRef.current != null) cancelAnimationFrame(minimapRafRef.current);
  minimapRafRef.current = requestAnimationFrame(() => {
    checkVisibleReport();
    minimapRafRef.current = null;
  });
}, [checkVisibleReport]);
```

**Pros:** Simpler change; rAF coalesces multiple rapid re-fires
**Cons:** Doesn't fix the root cause (Map reference instability); still schedules rAF work on every streaming token

**Recommended: Option A (reduces the problem frequency) + Option B as belt-and-suspenders**

## Technical Details

- **Affected file:** `src/components/chat/chat-thread.tsx` lines 118–203
- **PR context:** PR #28 introduced deepReports useMemo + checkVisibleReport
- **Threshold:** Noticeable at 20+ message threads with 2+ deep reports and fast streaming

## Acceptance Criteria

- [ ] `deepReports` Map reference is stable across non-report message updates (agent status, user messages, etc.)
- [ ] `checkVisibleReport` does not fire more than once per rAF during streaming
- [ ] Minimap still updates correctly when report content grows during streaming
- [ ] Minimap correctly switches between reports on scroll

## Work Log

- 2026-03-03: Identified during PR #28 code review (performance-oracle agent)
