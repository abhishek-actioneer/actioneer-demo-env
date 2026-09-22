---
title: "Sidebar pinned state resets on navigation in Next.js App Router"
date: 2026-02-17
category: "State Management"
severity: "medium"
component: "Sidebar"
symptom: "User-pinned sidebar state (pinned, hoveredItem) lost on router.push() navigation between pages"
root_cause: "Sidebar component rendered independently in 9 page files; each navigation caused unmount/remount cycle, destroying local useState state"
solution_type: "Architecture Refactor"
framework: "Next.js 16 App Router + React 19"
tags:
  - state-persistence
  - layout-state
  - provider-pattern
  - context-api
  - next-js-routing
  - unmount-remount
affected_files_count: 11
files_created: 2
files_modified: 10
---

# Sidebar Pinned State Resets on Navigation

## Symptom

When a user pins the sidebar detail panel and then clicks a different tab in the icon rail, the sidebar unpins. The `pinned` and `hoveredItem` states reset to their defaults on every route change.

## Root Cause

The `Sidebar` component was rendered individually in **9 page files**. It was **not** in the shared `layout.tsx`. Every `router.push()` navigation caused a full unmount/remount cycle, destroying all local state — `useState(false)` for `pinned` reset on every mount.

**Affected files (each rendered its own `<Sidebar>`):**
- `src/app/page.tsx` (chat home — dynamic props)
- `src/app/knowledge/page.tsx`
- `src/app/metrics/page.tsx`
- `src/app/metrics/[id]/page.tsx`
- `src/app/playbooks/page.tsx`
- `src/app/playbooks/[id]/page.tsx`
- `src/app/segments/page.tsx`
- `src/app/segments/[id]/page.tsx`
- `src/app/connectors/page.tsx`

The root cause at the code level was `src/components/sidebar.tsx:62` — `useState(false)` resets on every mount.

## Solution

Centralize Sidebar into the root layout via a `SidebarContext` provider. One Sidebar instance mounts once and never unmounts during navigation.

### Phase 1: React Context Provider

Created `src/components/sidebar-context.tsx` with a `SidebarProvider` and `useSidebarContext` hook. Stores `chats`, `activeId`, and callback refs (`onNewChat`, `onSelect`, `onSearchClick`) so the chat page can swap in live handlers without re-rendering the entire tree.

```tsx
// Key pattern: callback refs + manual bump for re-render
const onNewChatRef = useRef<() => void>(() => router.push("/"));
const onSelectRef = useRef<(id: string) => void>(() => router.push("/"));

const [, setTick] = useState(0);
const bump = useCallback(() => setTick((t) => t + 1), []);

const setOnNewChat = useCallback((fn: () => void) => {
  onNewChatRef.current = fn;
  bump();
}, [bump]);
```

### Phase 2: Sidebar Reads from Context

Removed all props from `Sidebar`. It now reads from `useSidebarContext()` and derives `activePage` from `usePathname()`:

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

Added `useEffect` to reset `hoveredItem` on route change when not pinned:

```tsx
useEffect(() => {
  if (!pinned) setHoveredItem(null);
}, [pathname, pinned]);
```

Removed vestigial `collapsed` / `onToggleCollapse` props.

### Phase 3: Layout Shell (Server/Client Split)

Created `src/components/layout-shell.tsx` as a client component wrapping `SidebarProvider` + `Sidebar` + content. This is needed because `layout.tsx` must stay a server component (exports `metadata`).

```tsx
"use client";
export function LayoutShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-hidden">{children}</main>
      </div>
    </SidebarProvider>
  );
}
```

### Phase 4: Root Layout

Updated `src/app/layout.tsx` to wrap children with `LayoutShell`:

```tsx
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={...}>
        <LayoutShell>{children}</LayoutShell>
      </body>
    </html>
  );
}
```

### Phase 5: Chat Page Syncs Live State

The chat page (`src/app/page.tsx`) injects live state into context via `useEffect` hooks placed after callback definitions:

```tsx
const { setChats, setActiveId, setOnNewChat, setOnSelect, setOnSearchClick } = useSidebarContext();

useEffect(() => { setChats(chatList); }, [chatList, setChats]);
useEffect(() => { setActiveId(activeConvId); }, [activeConvId, setActiveId]);
useEffect(() => { setOnNewChat(() => handleNewChat); }, [handleNewChat, setOnNewChat]);
useEffect(() => { setOnSelect(() => switchConversation); }, [switchConversation, setOnSelect]);
useEffect(() => {
  setOnSearchClick(() => setSearchOpen(true));
  return () => setOnSearchClick(undefined);
}, [setOnSearchClick]);
```

**Important:** These effects must be placed **after** `handleNewChat` and `switchConversation` are defined, otherwise TypeScript reports "used before declaration."

### Phase 6: Remove Sidebar from 8 Non-Chat Pages

Each page had the same pattern removed:
- Removed `import { Sidebar }` and `import { INITIAL_CHATS }`
- Removed `<Sidebar chats={...} activeId={...} ... />` JSX
- Changed `<div className="flex h-screen">` to `<div className="flex flex-col h-full min-w-0">`
- Removed extra closing `</div>` from the old flex wrapper
- Detail pages with multiple returns (loading/not-found/main) simplified all returns

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Server/client split (LayoutShell) | Root layout stays server component for metadata export |
| Callback refs + bump | Avoids re-rendering the entire sidebar tree when chat page swaps handlers |
| hoveredItem resets on nav unless pinned | Prevents stale panel content (e.g. Segments panel open on Metrics page) |
| No localStorage persistence | In-session only — matches prototype scope |
| activePage from usePathname() | Handles sub-routes like `/segments/mock-hv-mobile` via `startsWith` |

## Prevention Strategies

### 1. Persistent UI Ownership Rule

UI elements that maintain state across navigation (sidebars, toasts, global modals) must live in the root layout, never in individual page files. Add a comment block to `layout.tsx` listing persistent components.

### 2. Warning Signs

| Red Flag | What It Means |
|----------|---------------|
| Same component imported in multiple `page.tsx` files | Likely should be in layout |
| `useState` for UI state + navigation dependency | State will reset on route change |
| Same layout wrapper (`<div className="flex h-screen">`) duplicated across pages | Shell should be in layout |
| Props drilled identically to same component across pages | Extract to Context |

### 3. Best Practices for Next.js App Router

- **Root layout** renders shell components (Sidebar, Topbar, Toast)
- **Page files** render page-specific content only
- **Context** bridges data between pages and shell components
- **URL state** (`searchParams`, dynamic routes) for feature-scoped state

### 4. When Per-Page Rendering is Acceptable

- Stateless components (no `useState`) — no state to lose
- Different layouts per route group (e.g., admin vs. main app)
- Modal-only pages that don't share the app shell
- Feature-specific sidebars that are fundamentally different

## Related Documentation

- [Split Panel to Sidebar Three-Tier Consolidation](./split-panel-to-sidebar-three-tier-consolidation.md) — The 3-tier navigation pattern (sidebar hover panel → landing page → detail route) that all features follow
- [Post-Merge Missing Navigation Entry Point](../integration-issues/post-merge-missing-navigation-entry-point.md) — Predecessor issue; route-based vs. in-page state navigation mismatch
- [Segment Detail Panel UX Patterns](./segment-detail-panel-ux-patterns.md) — React hooks and state sync patterns for list-detail layouts
- [Follow-Up Actions Card Redesign](./follow-up-actions-card-redesign.md) — Component consolidation pattern (merging multiple components into one surface)

## Verification

- `pnpm build` passes
- Navigate between all pages — sidebar persists, `pinned` state survives
- Pin panel, switch tabs → panel stays pinned
- Hover panel shows correct content for current page (not stale)
- Chat page history panel shows live chat list
- Non-chat pages show `INITIAL_CHATS` in history panel
- `activePage` highlighting works on all routes including sub-routes
