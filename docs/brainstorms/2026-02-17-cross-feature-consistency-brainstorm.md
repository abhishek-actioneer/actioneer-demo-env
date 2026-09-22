# Cross-Feature Consistency: Message Thread & History Persistence

**Date:** 2026-02-17
**Status:** Draft
**Branch:** v1-sv

## What We're Building

A set of improvements that make the product feel cohesive — where actions in one part of the app are reflected everywhere else. Right now, several features are siloed: chat conversations vanish on navigation, segments created from chat have no link back, and the sidebar panels show stale/mock data instead of real state.

## Why This Matters

A user exploring Baby Sentinel today would hit these friction points:
- Ask a question in chat, navigate to Segments, come back — conversation gone
- Create a segment from a chat insight — get navigated away, lose the conversation
- Look at sidebar segments panel — see only mock data, not their real segments
- Click a thread in sidebar history — may not work (known bug)

The product should feel like one connected workspace, not separate pages with no memory.

## User Stories

### US-1: Chat conversations persist across page navigation
**As a user**, I want my chat conversations to survive when I navigate to Segments, Playbooks, or Metrics and come back, **so that** I don't lose my analysis context.

**Current state:** Messages stored in React `useState` + `useRef(savedChatsRef)` in `page.tsx`. When the component unmounts (navigation away), all state is lost. The `INITIAL_CHATS` preloaded conversations reload, but any new conversations or messages are gone.

**Acceptance criteria:**
- Navigate away from chat to any page and return — messages still there
- New conversations created during the session appear in sidebar history
- Active conversation ID is preserved

### US-2: Sidebar history panel shows real conversation list
**As a user**, I want the sidebar History panel to always reflect my actual conversations, **so that** I can quickly switch between threads.

**Current state:** `chatList` is initialized from `INITIAL_CHATS` (6 hardcoded entries). New conversations get appended to state but are lost on navigation. The `SidebarContext` syncs `chats` from `page.tsx` via `useEffect`, but only while the chat page is mounted.

**Acceptance criteria:**
- Sidebar shows both preloaded and user-created conversations
- Conversation list persists across page navigations
- Clicking a thread reliably switches to that conversation (fixes known bug)

### US-3: Sidebar segments panel shows real segments
**As a user**, I want the sidebar Segments panel to show segments I've actually created (not just mock data), **so that** I can quickly access my work.

**Current state:** `SegmentsPanel` in `sidebar.tsx` hardcodes `MOCK_SEGMENTS.filter(s => !s.archived).slice(0, 8)`. The landing page (`/segments`) fetches real segments via API and merges them with mocks. The sidebar panel never fetches.

**Acceptance criteria:**
- Sidebar segments panel fetches real segments from `/api/segments` and merges with mocks
- Newly created segments appear in the sidebar without page refresh
- Consistent ordering between sidebar panel and landing page

### US-4: Segment detail links back to source conversation
**As a user**, I want to see which chat conversation created a segment and navigate back to it, **so that** I can review the context of my analysis.

**Current state:** `sourceConversationId` is stored in the segments DB table and returned by the API, but no UI ever displays or links to it. After creating a segment from chat, `router.push(/segments/${id})` navigates away and the conversation is effectively lost.

**Acceptance criteria:**
- Segment detail page shows "Created from conversation: [title]" with a link
- Clicking the link navigates back to chat with that conversation loaded
- Works for both newly created and previously saved segments

### US-5: Creating a segment from chat doesn't lose the conversation
**As a user**, I want to create a segment from my chat analysis without losing my place in the conversation, **so that** I can continue my analysis.

**Current state:** `handleCreateSegment` calls `router.push(/segments/${data.id})` immediately after creation, navigating the user away from chat. Combined with US-1 (no persistence), the conversation is gone.

**Acceptance criteria:**
- After creating a segment, user stays in chat (or gets a non-disruptive confirmation)
- A toast/banner confirms segment creation with a link to view it
- Conversation continues uninterrupted

### US-6: Playbooks created from chat appear in sidebar immediately
**As a user**, I want playbooks I create during a chat session to show up in the sidebar Playbooks panel right away, **so that** the app feels connected.

**Current state:** `PlaybooksPanel` reads from `getSavedPlaybookSummaries()` which uses localStorage. Playbooks saved via `savePlaybook()` during chat do persist in localStorage, but the sidebar panel may not re-render to reflect new entries until a page reload.

**Acceptance criteria:**
- Creating a playbook from chat triggers sidebar playbooks panel update
- No page reload needed to see the new playbook

## Key Decisions

1. **Storage for chat persistence:** Move conversation data to `SidebarContext` (already exists as the shared state layer) or introduce `sessionStorage`/`localStorage`. Context is simpler; storage survives hard refreshes.
2. **Sidebar panels — sync vs async:** Currently panels are synchronous (mock data). Adding API fetches introduces loading states. Keep it simple: fetch once on panel open, cache in context.
3. **Segment creation UX:** Toast notification instead of navigation. Let user choose when to visit the segment detail.
4. **Scope:** These are all frontend-only changes. No new API endpoints needed (segments API already exists and works).

## Open Questions

1. Should chat messages persist across browser sessions (localStorage) or just within a tab session (React context/sessionStorage)?
2. Should the sidebar panels auto-refresh or only refresh on panel open?
3. Priority ordering — which user stories to implement first?

## Implementation Priority (Suggested)

1. **US-1** — Chat persistence (foundational; everything else depends on conversations surviving)
2. **US-2** — Sidebar history (directly follows from US-1)
3. **US-5** — Don't navigate away on segment creation (quick UX fix)
4. **US-3** — Real segments in sidebar (API fetch in panel)
5. **US-4** — Source conversation link (requires US-1 to be useful)
6. **US-6** — Playbook sidebar reactivity (minor polish)
