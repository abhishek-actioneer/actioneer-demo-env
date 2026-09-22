# Sidebar Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace icon rail + hover detail panel with a single flat text sidebar, collapsible to mini icon rail.

**Architecture:** Rewrite `sidebar.tsx` as a single-column nav with inline chat history expansion. Remove all detail panel components. Keep sidebar-context, folder system, and search modal.

**Tech Stack:** React 19, Next.js App Router, Tailwind CSS v4, Lucide icons

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `src/components/sidebar.tsx` | **Rewrite** | New flat text sidebar with collapse/expand |
| `src/components/sidebar-context.tsx` | **Minor edit** | Move `ChatEntry` import (it's currently exported from sidebar.tsx) |
| `src/components/sidebar/panels.tsx` | **Delete most panels** | Keep only `HistoryPanel` logic (inline in sidebar), delete rest |
| `src/components/sidebar/panel-styles.ts` | **Keep** | Still used by folder-section, chat-context-menu |
| `src/components/layout-shell.tsx` | **No change** | Sidebar is already flex child |

---

### Task 1: Rewrite sidebar.tsx

**Files:**
- Rewrite: `src/components/sidebar.tsx`

- [ ] **Step 1: Write the new sidebar component**

Replace the entire sidebar with:
- Expanded mode (~220px): Logo + dataset switcher, New chat button, All chats (expandable inline section with folders + 5 recent + "See all"), flat nav items list, spacer, footer items (Data, Settings, Account)
- Collapsed mode (~56px): Icon-only mini rail with tooltips
- Toggle button in header to collapse/expand
- `collapsed` state persisted to localStorage key `sidebar-collapsed`
- CSS transition for width change
- Active state based on `getActivePage(pathname)`

- [ ] **Step 2: Move ChatEntry type**

`ChatEntry` is exported from `sidebar.tsx` and imported by `sidebar-context.tsx`. Move the type to `sidebar-context.tsx` or a shared types file to break the circular-ish dependency.

- [ ] **Step 3: Verify dev server runs**

Run: `pnpm dev` and check sidebar renders correctly.

- [ ] **Step 4: Commit**

```bash
git add src/components/sidebar.tsx src/components/sidebar-context.tsx
git commit -m "feat: redesign sidebar as flat text nav with collapse/expand"
```

### Task 2: Clean up dead panel code

**Files:**
- Modify: `src/components/sidebar/panels.tsx`

- [ ] **Step 1: Remove unused panel exports**

Delete: `KnowledgePanel`, `PlaybooksPanel`, `MetricsPanel`, `MetricTreePanel`, `SegmentsPanel`, `CanvasPanel`, `ScoutsPanel`, `ConnectorsPanel`, `StorePanel`, `UserPanel`. Keep `HistoryPanel` only if still referenced, otherwise delete entire file.

- [ ] **Step 2: Verify no broken imports**

Run: `pnpm build` to catch any dead references.

- [ ] **Step 3: Commit**

```bash
git add -u
git commit -m "chore: remove unused sidebar panel components"
```
