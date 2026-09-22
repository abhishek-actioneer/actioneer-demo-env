---
title: "fix: Sidebar pinned state resets on navigation"
type: fix
date: 2026-02-17
---

# fix: Sidebar pinned state resets on navigation

## Overview

When a user pins the sidebar detail panel and then clicks a different tab in the icon rail, the sidebar unpins. This happens because each page renders its own `<Sidebar>` component — navigating via `router.push()` unmounts the old page's Sidebar and mounts a fresh one, resetting `useState(false)` for `pinned`.

## Problem Statement

The `Sidebar` component is rendered individually in 9 page files. It is **not** in the shared `layout.tsx`. Every `router.push()` navigation causes a full unmount/remount cycle, destroying all local state (`pinned`, `hoveredItem`).

**Affected files (each renders its own `<Sidebar>`):**
- `src/app/page.tsx` (chat home — dynamic props)
- `src/app/knowledge/page.tsx`
- `src/app/metrics/page.tsx`
- `src/app/metrics/[id]/page.tsx`
- `src/app/playbooks/page.tsx`
- `src/app/playbooks/[id]/page.tsx`
- `src/app/segments/page.tsx`
- `src/app/segments/[id]/page.tsx`
- `src/app/connectors/page.tsx`

## Proposed Solution: Single Sidebar in Root Layout via Context

**Approach B from analysis:** Render one `<Sidebar>` in the root layout (`layout.tsx`). Use a lightweight React Context so the chat home page can inject its dynamic props (`chats`, `activeId`, `onNewChat`, `onSelect`, `onSearchClick`) while all other pages use static defaults.

This was chosen over the route-group approach (Approach A) because:
- Approach A creates two Sidebar mount points (chat vs non-chat layout), so `pinned` still resets when navigating to/from `/`
- Approach A causes a visible layout flash during the chat ↔ non-chat boundary transition
- Approach B gives full persistence across ALL navigations with a single Sidebar instance

### Design Decisions (for this prototype)

| Question | Decision | Rationale |
|---|---|---|
| Should `hoveredItem` reset on route change? | **Yes, unless pinned** | Prevents stale panel content (e.g. Segments panel open on Metrics page). Use `useEffect` on `usePathname()` to reset when not pinned. |
| Search input on non-chat pages? | **Accept dead input** | Prototype — `onSearchClick` is `undefined`, input is visually present but non-functional. No regression from current behavior. |
| `pinned` persist across chat ↔ non-chat? | **Yes** | Primary motivation for choosing Approach B. |
| `onSelect(id)` contract? | **`router.push("/")`** | Current behavior on most non-chat pages. Chat page does not read `?chat=id` from URL today — wiring that up is a separate concern. |
| `activePage` derivation? | **`usePathname()` with `startsWith` matching** | Handles sub-routes like `/segments/mock-hv-mobile`. |
| `chatList` on non-chat pages? | **`INITIAL_CHATS` (static)** | Same as current behavior. Live chat list sync is a separate feature. |
| `localStorage` persistence? | **No** | In-session only. Matches prototype scope. |
| `collapsed`/`onToggleCollapse` props? | **Remove** | Vestigial — never used in render. Clean up during refactor. |

## Technical Approach

### Phase 1: Create `SidebarContext`

Create `src/components/sidebar-context.tsx`:

```tsx
// src/components/sidebar-context.tsx
"use client";

import { createContext, useContext, useState, useCallback } from "react";
import { INITIAL_CHATS } from "@/lib/chat-data";
import type { ChatEntry } from "@/components/sidebar";

interface SidebarContextValue {
  chats: ChatEntry[];
  activeId: string | null;
  onNewChat: () => void;
  onSelect: (id: string) => void;
  onSearchClick?: () => void;
  // Setters for chat page to inject dynamic values
  setChats: (chats: ChatEntry[]) => void;
  setActiveId: (id: string | null) => void;
  setOnNewChat: (fn: () => void) => void;
  setOnSelect: (fn: (id: string) => void) => void;
  setOnSearchClick: (fn: (() => void) | undefined) => void;
}

// Provider wraps root layout, Sidebar reads from it, chat page writes to it
```

**Key design:** Store callback refs so the chat page can swap in its live handlers on mount and restore defaults on unmount.

### Phase 2: Modify Sidebar to read from Context

Update `src/components/sidebar.tsx`:

1. Remove `SidebarProps` interface (or reduce to empty)
2. Remove all props — read `chats`, `activeId`, `onNewChat`, `onSelect`, `onSearchClick` from `useSidebarContext()`
3. Replace `activePage` prop with `usePathname()` + mapping function:

```tsx
function getActivePage(pathname: string): string {
  if (pathname.startsWith("/knowledge")) return "knowledge";
  if (pathname.startsWith("/metrics")) return "metrics";
  if (pathname.startsWith("/segments")) return "segments";
  if (pathname.startsWith("/playbooks")) return "playbooks";
  if (pathname.startsWith("/connectors")) return "connectors";
  return "chat";
}
```

4. Add `useEffect` to reset `hoveredItem` on pathname change (only when not pinned):

```tsx
const pathname = usePathname();
useEffect(() => {
  if (!pinned) setHoveredItem(null);
}, [pathname, pinned]);
```

5. Remove vestigial `collapsed` and `onToggleCollapse` props from the interface.

### Phase 3: Move Sidebar into root layout

Update `src/app/layout.tsx`:

```tsx
// src/app/layout.tsx
import { SidebarProvider } from "@/components/sidebar-context";
import { Sidebar } from "@/components/sidebar";

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={...}>
        <SidebarProvider>
          <div className="h-screen overflow-hidden flex">
            <Sidebar />
            <main className="flex-1 overflow-hidden">{children}</main>
          </div>
        </SidebarProvider>
      </body>
    </html>
  );
}
```

### Phase 4: Wire chat page to inject dynamic props

Update `src/app/page.tsx`:

1. Import `useSidebarContext`
2. On mount, call setters to inject live `chatList`, `activeConvId`, `handleNewChat`, `switchConversation`, `onSearchClick`
3. On unmount, restore defaults (so non-chat pages get static values)
4. Remove the `<Sidebar ...>` JSX from the page's render

```tsx
const { setChats, setActiveId, setOnNewChat, setOnSelect, setOnSearchClick } = useSidebarContext();

useEffect(() => {
  setChats(chatList);
  setActiveId(activeConvId);
  setOnNewChat(() => handleNewChat);
  setOnSelect(() => switchConversation);
  setOnSearchClick(() => () => setSearchOpen(true));

  return () => {
    // Restore defaults on unmount
    setChats(INITIAL_CHATS);
    setActiveId(null);
    setOnNewChat(() => () => router.push("/"));
    setOnSelect(() => () => router.push("/"));
    setOnSearchClick(undefined);
  };
}, [chatList, activeConvId]);
```

### Phase 5: Remove `<Sidebar>` from all other pages

Remove `<Sidebar>` imports and JSX from all 8 non-chat page files:
- `src/app/knowledge/page.tsx`
- `src/app/metrics/page.tsx`
- `src/app/metrics/[id]/page.tsx`
- `src/app/playbooks/page.tsx`
- `src/app/playbooks/[id]/page.tsx`
- `src/app/segments/page.tsx`
- `src/app/segments/[id]/page.tsx`
- `src/app/connectors/page.tsx`

Each page's outer `<div className="flex h-full">` wrapper that contained `<Sidebar>` + content can be simplified since the layout now provides the flex container.

### Phase 6: Verify

- `pnpm build` passes
- Navigate between all pages — sidebar persists, `pinned` state survives
- Pin panel, switch tabs → panel stays pinned
- Hover panel shows correct content for current page (not stale)
- Chat page history panel shows live chat list
- Non-chat pages show `INITIAL_CHATS` in history panel
- `activePage` highlighting works on all routes including sub-routes

## Acceptance Criteria

- [x] Sidebar renders once in root layout, never in individual pages
- [x] `pinned` state persists across ALL navigations (chat ↔ non-chat included)
- [x] `hoveredItem` resets on navigation when not pinned
- [x] `activePage` derived from `usePathname()` — correct icon highlighted on all routes
- [x] Chat page injects live `chatList`/`activeId`/handlers into context on mount
- [x] Chat page restores defaults on unmount
- [x] No layout shift or flash when navigating between pages
- [x] `pnpm build` passes
- [x] Vestigial `collapsed`/`onToggleCollapse` props removed

## References

- **Root cause analysis:** Sidebar at `src/components/sidebar.tsx:62` — `useState(false)` resets on every mount
- **Existing pattern docs:** `docs/solutions/design-patterns/split-panel-to-sidebar-three-tier-consolidation.md`
- **Merge history context:** `docs/solutions/integration-issues/post-merge-missing-navigation-entry-point.md`
- **Chat data constants:** `src/lib/chat-data.ts` — `INITIAL_CHATS`
