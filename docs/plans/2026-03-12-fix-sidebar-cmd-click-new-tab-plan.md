---
title: "fix: Sidebar cmd+click opens items in new tab"
type: fix
date: 2026-03-12
---

# fix: Sidebar cmd+click opens items in new tab

## Overview

Every navigable item in the sidebar uses `<button onClick={() => router.push(path)}>` instead of a native anchor or Next.js `<Link>`. Because buttons have no `href`, the browser has no URL to act on when the user cmd+clicks — the OS-level "open in new tab" gesture is silently swallowed.

The fix is to replace `<button>` + `router.push` with `<Link href={path}>` (which renders as a native `<a>` tag) wherever the destination URL is known at render time.

## Problem Statement

Three surfaces in the sidebar are affected:

| Surface | File | Current pattern |
|---|---|---|
| Rail icons (Segments, Metrics, Playbooks, etc.) | `src/components/sidebar.tsx` | `<button onClick={() => router.push(path)}>` |
| Panel list items (entity rows + "View All →" footers) | `src/components/sidebar/panels.tsx` | `<button onClick={() => router.push(path)}>` |
| History panel chat items | `src/components/sidebar/history-panel.tsx` | `<button onClick={() => onSelect(id)}>` |

There is one existing `<Link>` usage in `src/components/sidebar/nav-list-panel.tsx`, but that component is currently unused.

## Proposed Solution

### Strategy by surface

**Simple navigation items** (panel list items with static paths, "View All →" footers):

Direct swap — replace `<button onClick={() => router.push(path)}>` with `<Link href={path}>`. Next.js `<Link>` renders as `<a>`, giving the browser a URL to act on.

**Panel items with side effects on click** (Canvas board items that call `setActiveBoardId`):

Use `<Link href={path} onClick={sideEffectHandler}>`. The `onClick` fires on same-tab clicks and still applies the side effect; cmd+click bypasses it (acceptable — new tab mounts fresh).

**RailIcon** (has `onHover` side effect for panel expansion, and one non-navigating button):

Add an `href?: string` prop. When `href` is present → render `<Link href={href} onMouseEnter={onHover}>`. When absent → keep `<button>`. This handles the "New Chat" rail button which has no target URL (it resets conversation state, not just navigates).

**History panel items** (have `onSelect` side effect that saves the current conversation before switching):

Use the two-path pattern: add `href={"/?conv=" + id}` to the element so the browser sees a URL, but attach an `onClick` that calls `e.preventDefault()` for unmodified clicks and then calls `onSelect(id)`. When `e.metaKey || e.ctrlKey` is true, skip `preventDefault` so the browser handles the cmd+click natively (new tab).

**Pure-action footers** ("New Board" in CanvasPanel):

Keep as `<button>`. These create resources before navigating, so there is no pre-existing URL to put in an `href`.

## Technical Considerations

- **`FOOTER` CSS class** in `panels.tsx` must gain `block` (or `flex`) — buttons are `display: block` by default but `<Link>` renders as inline. Without this, the "View All →" footer will clip padding and not fill the sidebar width.
- **`onMouseEnter` prefetch calls** on list items in `PlaybooksPanel`, `MetricsPanel`, `ScoutsPanel`, `StorePanel` — Next.js `<Link>` already prefetches on hover automatically. The explicit `router.prefetch` calls on `onMouseEnter` become dead code and should be removed.
- **Connector item href encoding** — `ConnectorsPanel` builds paths with a connector name. Ensure `encodeURIComponent(name)` is preserved when constructing the `href` string (the router accepted unencoded strings; `href` in an anchor does not).
- **KnowledgePanel** — all items navigate to `/knowledge` (no per-item pages). Works correctly with `<Link>`, but cmd+click opens the same list page for every item with no scroll-to or highlight. Acceptable as-is.

## Acceptance Criteria

- [x] Cmd+clicking a rail icon (Segments, Metrics, Playbooks, Forecasting, Catalog) opens the page in a new browser tab
- [x] Cmd+clicking a panel list item (a specific Segment, Metric, Playbook) opens that entity's page in a new tab
- [x] Cmd+clicking a "View All →" footer button opens the list page in a new tab
- [x] Cmd+clicking a history conversation opens `/?conv={id}` in a new tab
- [x] Normal (unmodified) click on all above items continues to work exactly as before — no double navigation, no lost conversation state
- [x] The "New Chat" rail icon still resets conversation state on normal click; cmd+clicking it opens `/` in a new tab (acceptable)
- [x] The "New Board" footer in CanvasPanel remains a `<button>` and still creates a board on click
- [x] Canvas board panel items call `setActiveBoardId` on same-tab click and open the board page in a new tab on cmd+click
- [x] "View All →" footer links fill full width (not clipped) after switching to `<Link>` — `block` added to `FOOTER` CSS token
- [x] Right-click → "Open Link in New Tab" works on all converted items (validates `<a>` tag rendered)

## Implementation Plan

### Step 1 — `RailIcon` in `sidebar.tsx`

Add `href?: string` prop. Conditionally render `<Link href={href}>` or `<button>` based on presence of `href`. Pass `href` at all call sites that correspond to navigable pages (Segments, Metrics, etc.). Leave "New Chat" as a `<button>`.

```tsx
// src/components/sidebar.tsx

// Before (simplified):
function RailIcon({ onClick, onHover, ... }) {
  return <button onClick={onClick} onMouseEnter={onHover}>...</button>;
}

// After:
function RailIcon({ href, onClick, onHover, ... }) {
  if (href) {
    return <Link href={href} onMouseEnter={onHover}>...</Link>;
  }
  return <button onClick={onClick} onMouseEnter={onHover}>...</button>;
}
```

### Step 2 — Panel list items in `panels.tsx`

For each entity panel (Segments, Metrics, Playbooks, Scouts, Connectors, StorePanel, MetricTreePanel):

```tsx
// Before:
<button onClick={() => router.push(`/segments/${s.id}`)} className={ITEM}>
  {s.name}
</button>

// After:
<Link href={`/segments/${s.id}`} className={ITEM}>
  {s.name}
</Link>
```

Remove any `onMouseEnter={() => router.prefetch(...)}` calls made redundant by `<Link>`'s built-in prefetch.

For CanvasPanel board items (have `setActiveBoardId` side effect):

```tsx
<Link
  href={`/canvas?board=${b.id}`}
  className={ITEM}
  onClick={() => setActiveBoardId(b.id)}
>
  {b.name}
</Link>
```

Keep "New Board" footer as `<button>`.

### Step 3 — `FOOTER` CSS token

Add `block` to the `FOOTER` class string so `<Link>` (inline by default) fills full width.

```tsx
// Before:
const FOOTER = "mx-1.5 mb-3 mt-1 px-2.5 py-1.5 text-[13px] font-medium text-muted-foreground ...text-left w-auto";

// After:
const FOOTER = "block mx-1.5 mb-3 mt-1 px-2.5 py-1.5 text-[13px] font-medium text-muted-foreground ...text-left w-auto";
```

### Step 4 — "View All →" footer buttons in `panels.tsx`

These are simple navigations — direct swap to `<Link>`:

```tsx
// Before:
<button onClick={() => router.push("/segments")} className={FOOTER}>
  View all segments →
</button>

// After:
<Link href="/segments" className={FOOTER}>
  View all segments →
</Link>
```

### Step 5 — History panel items in `history-panel.tsx`

Use two-path pattern to preserve `onSelect` side effects on same-tab clicks:

```tsx
// Before:
<button onClick={() => onSelect(chat.id)} className={ITEM}>
  {chat.title}
</button>

// After:
<a
  href={`/?conv=${chat.id}`}
  className={ITEM}
  onClick={(e) => {
    if (!e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      onSelect(chat.id);
    }
    // modified click falls through to browser default (new tab)
  }}
>
  {chat.title}
</a>
```

> Note: Uses native `<a>` rather than Next.js `<Link>` because `<Link>` intercepts all clicks and the `e.preventDefault()` pattern works more predictably with plain anchors here.

### Step 6 — Connector item href encoding

Verify and fix `encodeURIComponent` usage when building href strings:

```tsx
// Ensure name is encoded in the href
<Link href={`/connectors?connect=${encodeURIComponent(c.name)}&category=${c.categoryId}`} ...>
```

## Files Changed

| File | Change |
|---|---|
| `src/components/sidebar.tsx` | `RailIcon`: add `href?: string` prop, conditional `<Link>` vs `<button>` |
| `src/components/sidebar/panels.tsx` | Entity list items → `<Link>`, "View All" footers → `<Link>`, FOOTER token gets `block`, Canvas board items → `<Link onClick={...}>`, "New Board" stays `<button>`, remove redundant `router.prefetch` on hover |
| `src/components/sidebar/history-panel.tsx` | Chat items → `<a href onClick={two-path}>` |

## References

- Root cause confirmed in: `src/components/sidebar.tsx` (RailIcon, lines 328–355), `src/components/sidebar/panels.tsx` (all panel item lists)
- Existing `<Link>` usage (unused): `src/components/sidebar/nav-list-panel.tsx`
- FOOTER class definition: `src/components/sidebar/panels.tsx` (search for `const FOOTER`)
- SpecFlow edge cases: "New Board" must stay a button (creates resource before navigating); History items need two-path pattern to preserve save-before-switch guarantee
