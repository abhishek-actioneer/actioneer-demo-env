---
title: "feat: Chat-native segment creation"
type: feat
status: active
date: 2026-03-09
---

# Chat-Native Segment Creation

## Overview

Allow users to create segments directly from chat by typing natural language like "create a segment for high-volume utility tasks." The system generates SQL, previews the user count, and renders an inline confirmation card. The user always reviews and confirms before the segment is persisted.

## Problem Statement

Today, segment creation from chat requires a 5-step button-driven flow: ask a data question → wait for analysis → wait for follow-up recommendations → click "Create Segment" → fill modal. Users cannot simply say "create a segment for X" and have it work. The plumbing exists (`/api/segments/generate-sql`, `POST /api/segments`) but there's no chat-native orchestration connecting intent to action.

## Proposed Solution

Add a third classifier mode (`action`) that detects imperative commands. When the classifier returns `action` with `actionType: "create-segment"`, a new branch in `useAnalytics` handles the flow: generate SQL → execute count → render inline confirmation card → user confirms → segment created.

### Design Decisions

1. **Always confirm, never auto-create** — regardless of user count (0 or 12,000), the user always sees and approves.
2. **Inline card, not modal** — the confirmation card lives in the chat message stream as a `ChatMessage` variant, consistent with existing patterns (`connector-required`, `playbook-preview`).
3. **Action modes bypass Deep Research override** — if the classifier returns `action`, the Deep Research toggle does not force it to `analytics`.
4. **Compound queries are segment-only in V1** — "create a segment for X and show me Y" treats as segment creation only. Users can ask analytics separately.
5. **Edit means refine description, not raw SQL** — most users can't write SQL. The "Edit" action lets them type a refined description to re-generate. An "Edit SQL" toggle is available for power users.

## Technical Approach

### Phase 1: Classifier Extension

**Files:** `src/lib/prompts/classify.ts`, `src/app/api/classify/route.ts`, `src/hooks/use-analytics.ts`

Extend the classifier to return a richer response shape:

```typescript
interface ClassifyResult {
  mode: "analytics" | "direct" | "action";
  metricId?: string | null;
  actionType?: string;         // "create-segment" (extensible for future: "create-metric", "create-playbook")
  extractedDescription?: string; // The cleaned description extracted from the user message
}
```

**Classifier prompt changes:**
- Add a third mode `action` for imperative commands: "create a segment for ...", "make a segment of ...", "build a cohort of ..."
- The classifier extracts the description (strips "create a segment for/of/with" prefix)
- The existing BIAS RULE for analytics stays — "show me users who..." is analytics, "create a segment of users who..." is action

**Deep Research override (use-analytics.ts ~line 345):**
```typescript
// Action modes bypass Deep Research override
const classified = deepResearch
  ? await classifyQuery(text, modelHeaders, datasetId).then((r) =>
      r.mode === "action" ? r : { ...r, mode: "analytics" as const }
    )
  : await classifyQuery(text, modelHeaders, datasetId);
```

### Phase 2: Segment Creation Flow in useAnalytics

**File:** `src/hooks/use-analytics.ts`

Add a new branch after the classifier returns, alongside `direct` and `analytics`:

```
if (queryMode === "action" && classified.actionType === "create-segment") {
  // 1. Show "generating" indicator
  // 2. Call /api/segments/generate-sql with extractedDescription
  // 3. Execute count query via /api/query
  // 4. Insert segment-confirm ChatMessage variant into messages
}
```

**Steps in the branch:**
1. Replace "gathering" indicator with a "Creating segment..." shimmer message
2. `POST /api/segments/generate-sql` with `{ description: classified.extractedDescription }`
3. On success: wrap SQL in `SELECT COUNT(*) as cnt FROM (...) sub` and execute via `/api/query`
4. Derive `suggestedName` from the extracted description (capitalize, truncate to 50 chars)
5. Insert a `ChatMessage` with `variant: "segment-confirm"` and companion data
6. On SQL generation failure: insert an error message ("Couldn't generate a segment for that description. Try being more specific.")

### Phase 3: ChatMessage Variant + Inline Card

**Files:** `src/lib/types.ts`, `src/components/chat/chat-thread.tsx`, new `src/components/chat/segment-confirm-card.tsx`

**Types (types.ts):**
```typescript
// Add to ChatMessage variant union
variant?: "..." | "segment-confirm";

// Add companion field
segmentConfirm?: {
  suggestedName: string;
  sql: string;
  description: string;
  userCount: number | null;
  status: "ready" | "confirming" | "confirmed" | "cancelled" | "error";
  error?: string;
  segmentId?: string; // set after successful creation
};
```

**SegmentConfirmCard component:**

A monochrome card rendered in `chat-thread.tsx` when `msg.variant === "segment-confirm"`. Layout:

```
┌─────────────────────────────────────┐
│  Create Segment                     │
│  ─────────────────────────────────  │
│  Name: [High-Volume Utility Tasks]  │ ← editable inline
│                                     │
│  ▸ SQL Query                        │ ← collapsible, collapsed by default
│    SELECT DISTINCT customer_id ...  │
│                                     │
│  12,448 users                       │ ← or warning if 0/low
│                                     │
│  [Confirm]  [Refine]  [Cancel]      │
└─────────────────────────────────────┘
```

**States:**
- `ready` — shows confirm/refine/cancel buttons
- `confirming` — confirm button shows spinner, other buttons disabled
- `confirmed` — card transforms to success: "Segment created — View →"
- `cancelled` — card collapses to a muted "Cancelled" line
- `error` — shows error message with retry

**Warning thresholds:**
- 0 users: "No users match this criteria" (amber warning)
- <10 users: "Only N users match — is this intended?" (soft warning)
- Both still allow confirmation

**Compact mode (sidebar panel):** SQL section hidden by default, card uses smaller text sizes (`text-xs`).

### Phase 4: Confirm/Cancel/Refine Handlers

**File:** `src/components/chat/chat-state-provider.tsx`

Add three new callbacks exposed via `useChatState()`:

```typescript
handleSegmentConfirm: (msgId: string) => Promise<void>
handleSegmentCancel: (msgId: string) => void
handleSegmentRefine: (msgId: string, newDescription: string) => Promise<void>
```

**handleSegmentConfirm:**
1. Update message status to `"confirming"`
2. `POST /api/segments` with `{ name, sql, sourceConversationId: activeConvId }`
3. On success: update message status to `"confirmed"`, set `segmentId`
4. Refresh sidebar segments via existing `refreshSegments()` from `useSidebarContext()`
5. On error: update status to `"error"` with message

**handleSegmentCancel:**
1. Update message status to `"cancelled"`

**handleSegmentRefine:**
1. Update message status back to a loading state
2. Re-call `/api/segments/generate-sql` with new description
3. Re-execute count query
4. Update message with new SQL, count, and `"ready"` status

### Phase 5: Extend /api/segments/generate-sql (optional)

**File:** `src/app/api/segments/generate-sql/route.ts`

Optionally extend to also return a suggested name:

```typescript
// Response shape
{ sql: string; suggestedName?: string }
```

This can also be done client-side by cleaning the extracted description ("high-volume utility tasks" → "High-Volume Utility Tasks"). Client-side is simpler for V1.

## Files to Modify

| File | Change |
|------|--------|
| `src/lib/prompts/classify.ts` | Add `action` mode + description extraction to prompt |
| `src/app/api/classify/route.ts` | Parse `action` mode, `actionType`, `extractedDescription` from LLM response |
| `src/hooks/use-analytics.ts` | Add action branch in `handleSend`, bypass Deep Research override for actions |
| `src/lib/types.ts` | Add `"segment-confirm"` variant + `segmentConfirm` data field to `ChatMessage` |
| `src/components/chat/chat-thread.tsx` | Render `SegmentConfirmCard` for the new variant |
| `src/components/chat/segment-confirm-card.tsx` | **New file** — inline confirmation card component |
| `src/components/chat/chat-state-provider.tsx` | Add confirm/cancel/refine handlers, expose via context |

## Acceptance Criteria

- [ ] User can type "create a segment for X" and get an inline confirmation card
- [ ] Card shows: editable name, collapsible SQL, user count (or warning)
- [ ] Confirm creates the segment and shows success with link to `/segments/[id]`
- [ ] Cancel dismisses the card gracefully
- [ ] Refine lets user type a new description to re-generate SQL
- [ ] Works in both main chat and sidebar panel chat
- [ ] Deep Research toggle does not interfere with segment creation
- [ ] SQL generation failure shows helpful error message
- [ ] 0-user segments show a warning but still allow confirmation
- [ ] Card state survives in conversation history (persisted as ChatMessage)

## Edge Cases

- **Classifier misses intent** → falls through to analytics/direct, user gets a normal response (graceful degradation)
- **Compound query** ("create segment for X and show me Y") → V1 treats as segment creation only
- **SQL generation returns UNSUPPORTED_QUERY** → error message with suggestion to refine
- **Count query times out** → show card with `userCount: null` and "Count unavailable" note, allow confirm
- **Duplicate segment names** → allowed (API doesn't enforce uniqueness today)
- **Dataset has no `sentinel_segments` table** → the `POST /api/segments` route handles this (creates on first insert or errors)

## What's NOT in Scope (V1)

- Natural language refinement ("but only from the last 30 days") — cancel and re-describe instead
- Unifying the existing follow-up action path with inline cards — both coexist
- Push-to-integration from the inline card (Salesforce, CleverTap, etc.)
- Metric/playbook/scout creation from chat (future, same pattern)

## Sources

- Classifier: `src/lib/prompts/classify.ts`, `src/app/api/classify/route.ts`
- Segment SQL gen: `src/app/api/segments/generate-sql/route.ts`
- Segment CRUD: `src/app/api/segments/route.ts`
- ChatMessage types: `src/lib/types.ts:178`
- Inline card patterns: `connector-required`, `playbook-preview`, `save-to-knowledge` variants
- Classifier misrouting learnings: `docs/solutions/logic-errors/classifier-misrouting-composite-queries.md`
- Follow-up action patterns: `docs/solutions/design-patterns/follow-up-actions-card-redesign.md`
- Segment UX patterns: `docs/solutions/design-patterns/segment-detail-panel-ux-patterns.md`
