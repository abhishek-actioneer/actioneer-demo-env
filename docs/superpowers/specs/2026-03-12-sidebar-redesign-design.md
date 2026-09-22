# Sidebar Redesign — Flat Text Navigation

## Summary

Replace the current two-part sidebar (75px icon rail + 220px hover-to-expand detail panel) with a single flat text sidebar (~220px expanded, ~56px collapsed mini rail). All nav items are a flat list — no section headers, no grouping. Clicking a nav item navigates to its page. Chat history expands inline with folders, 5 recent threads, and a "See all" link.

## Structure (expanded, top to bottom)

```
┌─────────────────────┐
│ [Logo] Sentinel  v  │  ← Dataset switcher dropdown
├─────────────────────┤
│ + New chat           │
│   All chats    v     │  ← Expands inline
│     📁 Folder A      │
│       Chat 1         │
│       Chat 2         │
│     📁 Folder B      │
│       ...            │
│     Chat X           │  ← Up to 5 uncategorized
│     Chat Y           │
│     See all           │  ← Opens search modal
├─────────────────────┤
│  Canvas              │
│  Metrics             │
│  Metric Tree         │
│  Playbooks           │
│  Scouts              │
│  User Segments       │
│  Knowledge           │
│  Decks               │
├─────────────────────┤
│ (spacer)             │
│  Data                │  ← Connectors/data-catalog
│  Settings            │
│  Account             │
└─────────────────────┘
```

Width: ~220px expanded. Monochrome — `muted`, `foreground`, `border` tokens only.

## Collapsed State (Mini Rail)

- Width: ~56px, shows only icons centered vertically (no labels)
- Tooltip on hover showing the label
- Toggle button: collapse/expand icon in the sidebar header area (next to logo)
- Collapsed state persisted to `localStorage` key `sidebar-collapsed`
- "All chats" section hidden when collapsed (just shows the clock icon, clicking navigates to `/`)

## "All chats" Inline Expand

- Clicking "All chats" toggles an inline section open/closed
- Uses CSS grid `grid-template-rows: 0fr → 1fr` transition (300ms ease-out) — same pattern as existing folder expand
- Contents:
  1. **Folders** — reuse existing `FolderSection` component (expand/collapse, context menus, inline rename)
  2. **Recent** — up to 5 uncategorized chats (no `folderId`), sorted by `updatedAt` descending
  3. **"See all" link** — opens the search modal (`setSearchOpen(true)`)
- Active chat highlighted with `bg-muted`
- Chat/folder context menus work identically to today (move to folder, rename, delete, etc.)
- Cmd+K global shortcut still opens search modal

## Nav Items

Each nav item is a row: `icon (18px) + label (13px text) + optional right element`.

| Label | Icon | Route | Notes |
|-------|------|-------|-------|
| New chat | `Plus` | calls `onNewChat` | Distinct style — slightly different from nav items |
| All chats | `Clock` | inline expand | Chevron right/down on right side |
| Canvas | `LayoutDashboard` | `/canvas` | |
| Metrics | `BarChart3` | `/metrics` | |
| Metric Tree | `GitFork` | `/metric-tree` | |
| Playbooks | `NotebookPen` | `/playbooks` | |
| Scouts | `Radar` | `/scouts` | |
| User Segments | `UsersRound` | `/segments` | |
| Knowledge | `BookOpen` | `/knowledge` | |
| Decks | `Presentation` | `/decks` | |
| Data | `Database` | `/connectors` | Pinned to bottom |
| Settings | `Settings` | `/billing` | Pinned to bottom |
| Account | User avatar | user panel/page | Pinned to bottom |

Active state: `text-foreground font-medium` (or `bg-muted rounded-md`). Inactive: `text-muted-foreground hover:text-foreground hover:bg-muted/50`.

## Dataset Switcher

Top of sidebar — logo + dataset name + chevron. Clicking opens a dropdown to switch datasets. Reuses existing `DatasetProvider` / `useDataset()`. In collapsed mode, just shows the logo icon (clicking expands sidebar or shows dropdown).

## What Gets Removed

- **Icon rail** (`w-[75px]` column) — replaced by expanded text sidebar
- **Hover detail panel** (`w-[220px]` expanding panel) — gone entirely
- **`HoverPanel` type** and `hoveredItem` / `activePanel` state
- **All panel components** from `panels.tsx`: `HistoryPanel`, `KnowledgePanel`, `MetricsPanel`, `MetricTreePanel`, `SegmentsPanel`, `PlaybooksPanel`, `ScoutsPanel`, `CanvasPanel`, `ConnectorsPanel`, `StorePanel`, `UserPanel`
- **`RailIcon` component** — replaced by `NavItem`
- **Pin/unpin logic** — replaced by collapse/expand
- **Hover delay timer** (`leaveTimer`, `tryClose`) — no longer needed
- **`OnboardingWidget`** from sidebar (can relocate later if needed)

## What Stays

- `SearchModal` (Cmd+K) — still rendered by sidebar
- `SidebarProvider` context (`sidebar-context.tsx`) — still manages chats, folders, activeId, searchOpen
- Folder system: `folder-store.ts`, `folder-section.tsx`, `folder-context-menu.tsx`, `chat-context-menu.tsx`
- `getActivePage(pathname)` utility — for highlighting active nav item
- All folder CRUD callbacks (`handleAddToFolder`, `handleDeleteChat`, etc.)

## New Subcomponents

### `NavItem`
Row component: icon + label, click navigates. Props: `icon`, `label`, `href`, `active`, `onClick`, optional `right` slot (for chevron on "All chats").

### `ChatHistorySection`
Inline expandable section below "All chats". Composes `FolderSection` + recent chats list + "See all" button. Receives same props as current `HistoryPanel` (chats, folders, activeId, callbacks).

## Layout Integration

No changes to `layout-shell.tsx` provider tree. The sidebar still sits as the first child in the flex container. The `ChatPanel` (right side) is unaffected.

```
Sidebar (220px or 56px) | Main Content (flex-1) | ChatPanel (340-700px)
```

## Transition Plan

This is a rewrite of `sidebar.tsx`. The detail panel components (`panels.tsx`) become dead code and can be deleted. The folder components are reused as-is. `sidebar-context.tsx` needs minor cleanup (remove panel-related state if any) but largely stays intact.
