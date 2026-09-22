---
title: "feat: Cross-Feature Sidebar Reactivity & History Persistence"
type: feat
date: 2026-02-17
branch: v1-sv
brainstorm: docs/brainstorms/2026-02-17-cross-feature-consistency-brainstorm.md
---

# Cross-Feature Sidebar Reactivity & History Persistence

## Overview

Four remaining user stories from the cross-feature consistency initiative. These ensure the sidebar reflects live application state and that navigation between features feels connected. All changes are frontend-only — no new API endpoints needed.

## Problem Statement

1. **History panel broken from non-chat pages** — Clicking a chat thread in the sidebar history panel when on `/knowledge`, `/segments`, etc. navigates to `/` but doesn't load the conversation. The default `onSelectRef` is `() => router.push("/")` — it ignores the conversation ID.
2. **History panel empty on non-chat start** — `refreshChats()` only runs inside `page.tsx`'s mount effect. If the user lands on `/segments` first, the history panel shows "No chats found."
3. **Segments panel shows only mock data** — `SegmentsPanel` hardcodes `MOCK_SEGMENTS`. Real segments created from chat never appear.
4. **Segment detail has no link to source conversation** — `sourceConversationId` flows through the API end-to-end but no UI displays it.
5. **Playbook panel doesn't update after creation** — `PlaybooksPanel` reads from `getSavedPlaybookSummaries()` synchronously but nothing triggers a re-render when `savePlaybook()` is called.

## Proposed Solution

Extend `SidebarContext` with three new capabilities: (a) auto-refresh chats on mount + URL-driven conversation selection, (b) segments state with refresh, (c) playbook version counter for reactivity. Add a "Created from" link in the segment detail panel.

## Technical Approach

### Key Design Decisions

1. **URL-driven conversation selection** — Change the default `onSelectRef` to `(id) => router.push("/?conv=${id}")`. The chat page reads `searchParams` on mount and calls `switchConversation`. This is clean, bookmarkable, and requires no new context state.

2. **Segments in context (not in panel)** — Follow the same pattern as `chats`/`refreshChats`. Add `segments` state + `refreshSegments()` to `SidebarContext`. The panel reads from context synchronously (consistent with the "sync-only panels" rule from `docs/solutions/design-patterns/split-panel-to-sidebar-three-tier-consolidation.md`). Context fetches on mount and after segment creation.

3. **Playbook bump pattern** — Add `playbookVersion` counter + `notifyPlaybookSaved()` to context. `PlaybooksPanel` reads `playbookVersion` to force re-render. This mirrors the existing `setTick`/`bump` pattern in `SidebarProvider`.

4. **Conversation title lookup via context** — Segment detail page uses `useSidebarContext().chats` to find the conversation title by `sourceConversationId`. No extra API call needed.

---

## Implementation Phases

### Phase 1: SidebarContext Extensions

**Files:** `src/components/sidebar-context.tsx`

Add to `SidebarContextValue` interface:
- `segments: SegmentDisplay[]` — cached segment list for sidebar panel
- `refreshSegments: () => Promise<void>` — fetch from `/api/segments`, merge with mocks
- `playbookVersion: number` — bumped when a playbook is saved
- `notifyPlaybookSaved: () => void` — increments `playbookVersion`

Add `useEffect` inside `SidebarProvider`:
- Call `refreshChats()` on mount (fixes empty history when landing on non-chat page)
- Call `refreshSegments()` on mount

Change default `onSelectRef`:
- From: `() => router.push("/")`
- To: `(id: string) => router.push("/?conv=${id}")`

**Acceptance criteria:**
- [x] `SidebarContextValue` has `segments`, `refreshSegments`, `playbookVersion`, `notifyPlaybookSaved`
- [x] Provider calls `refreshChats()` and `refreshSegments()` on mount via `useEffect`
- [x] Default `onSelectRef` passes conversation ID as query param
- [x] `refreshSegments` fetches `/api/segments`, converts via `toSegmentDisplay`, merges with `MOCK_SEGMENTS` (mocks first, then real, deduped by ID, max 8 for panel)

### Phase 2: History Panel — URL-driven Selection (US-2)

**Files:** `src/app/page.tsx`

Read `searchParams` on mount (via `useSearchParams()` from `next/navigation`):
- If `conv` param present and different from `activeConvId`, call `switchConversation(conv)`
- Clear the URL param after loading (via `router.replace("/")`) to keep URL clean

**Edge cases:**
- Invalid/deleted conversation ID → `switchConversation` already handles 404 by setting empty messages
- User already viewing the target conversation → skip (check `activeConvId`)
- Processing in progress → skip (existing guard in `switchConversation`)

**Acceptance criteria:**
- [x] Clicking a thread in sidebar history from `/knowledge` or `/segments` navigates to `/?conv=<id>` and loads that conversation
- [x] History panel shows conversations even when user first lands on a non-chat page
- [x] URL is cleaned up after conversation loads (no stale `?conv=` param)

### Phase 3: Segments Panel — Real Data (US-3)

**Files:** `src/components/sidebar.tsx` (SegmentsPanel function)

Rewrite `SegmentsPanel` to read from `useSidebarContext().segments` instead of `MOCK_SEGMENTS`:

```tsx
function SegmentsPanel() {
  const router = useRouter();
  const { segments } = useSidebarContext();
  // segments already filtered/merged/sliced in context
  // ... rest stays the same
}
```

After segment creation in `page.tsx` (`handleCreateSegment`), call `refreshSegments()` alongside the existing toast.

**Files:** `src/app/page.tsx` — destructure `refreshSegments` from context, call after successful segment creation (line ~1397).

**Edge cases:**
- DuckDB offline → `/api/segments` returns error → `refreshSegments` catches and keeps existing mock data
- No real segments exist → panel shows mocks only (same as today)

**Acceptance criteria:**
- [x] Sidebar segments panel shows real segments merged with mocks
- [x] Creating a segment from chat causes the sidebar panel to update (after toast)
- [x] Panel gracefully degrades to mocks-only if API is unavailable

### Phase 4: Segment Detail — Source Conversation Link (US-4)

**Files:** `src/components/segments/segment-detail-panel.tsx`

Add below the header metadata line (after "Created {dateStr} · by {segment.creator}"):

```tsx
{segment.sourceConversationId && (
  <p className="text-sm text-muted-foreground mt-1">
    Created from{" "}
    <button
      onClick={() => router.push(`/?conv=${segment.sourceConversationId}`)}
      className="text-emerald-600 hover:text-emerald-700 hover:underline font-medium"
    >
      {conversationTitle || "a chat conversation"}
    </button>
  </p>
)}
```

Get `conversationTitle` by looking up `segment.sourceConversationId` in the `chats` array from `useSidebarContext()`. If not found (conversation deleted or not yet loaded), fall back to generic label.

Add `useRouter` import (not currently imported in this component).

**Edge cases:**
- `sourceConversationId` is undefined (mock segments, or segments created without a conversation) → link hidden entirely
- Conversation was deleted → shows "a chat conversation" (no title available)
- Clicking link while on segment detail → navigates to `/?conv=<id>`, loads conversation

**Acceptance criteria:**
- [x] Segments created from chat show "Created from [conversation title]" link
- [x] Clicking the link navigates to chat with that conversation loaded
- [x] Link is hidden for mock segments and segments without a source conversation
- [x] Graceful fallback when conversation title is not available

### Phase 5: Playbook Sidebar Reactivity (US-6)

**Files:** `src/components/sidebar.tsx` (PlaybooksPanel function)

Read `playbookVersion` from context to force re-render:

```tsx
function PlaybooksPanel() {
  const router = useRouter();
  const { playbookVersion } = useSidebarContext();
  // playbookVersion is read but not displayed — forces re-render when bumped
  void playbookVersion;
  const saved = getSavedPlaybookSummaries();
  // ... rest stays the same
}
```

**Files:** `src/app/page.tsx`

In `handleSaveAsPlaybook` and `handleSavePlaybookPreview`: after `savePlaybook(playbook)`, call `notifyPlaybookSaved()`.

**Acceptance criteria:**
- [x] Creating a playbook from chat (both deep research "Save as Playbook" and `/playbook` command) causes sidebar playbooks panel to show the new entry
- [x] No page reload needed

### Phase 6: Build Verification

- [x] `pnpm build` passes with no errors
- [x] `pnpm lint` passes (no new errors — all pre-existing)

---

## Files Changed Summary

| File | Changes |
|------|---------|
| `src/components/sidebar-context.tsx` | Add `segments`, `refreshSegments`, `playbookVersion`, `notifyPlaybookSaved` to context. Add mount effects. Change default `onSelectRef`. |
| `src/app/page.tsx` | Read `?conv=` param on mount. Call `refreshSegments` after segment creation. Call `notifyPlaybookSaved` after playbook saves. |
| `src/components/sidebar.tsx` | `SegmentsPanel`: read from context. `PlaybooksPanel`: read `playbookVersion` from context. |
| `src/components/segments/segment-detail-panel.tsx` | Add "Created from" link using `sourceConversationId` + `useSidebarContext`. |

## Dependencies

- US-1 (chat conversation persistence) — **completed** in previous session
- US-5 (don't navigate away on segment creation) — **completed** in previous session

## References

- Brainstorm: `docs/brainstorms/2026-02-17-cross-feature-consistency-brainstorm.md`
- Pattern: `docs/solutions/design-patterns/lift-sidebar-state-to-layout-context.md` (callback ref + bump pattern)
- Pattern: `docs/solutions/design-patterns/split-panel-to-sidebar-three-tier-consolidation.md` (sync-only sidebar panels rule)
- Pattern: `docs/solutions/design-patterns/segment-detail-panel-ux-patterns.md` (state reset patterns)
