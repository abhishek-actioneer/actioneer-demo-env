# Chat Folders Design

## Problem

After extended use, the flat conversation list in the sidebar becomes unmanageable. Users cannot find previous chats. There is no way to group or categorize conversations.

## Solution

Spotify-style folders (playlists) for conversations. Users create named folders and file chats into them. One chat can belong to at most one folder. Uncategorized chats appear in a "Recent" section below folders. Both folders and chats are scoped per dataset — switching datasets shows only that dataset's folders and chats.

## Data Model

### New Type: `Folder`

```typescript
interface Folder {
  id: string;        // crypto.randomUUID
  name: string;
  datasetId: string;  // scoped to a dataset
  createdAt: number;
}
```

Folders are sorted by `createdAt` descending (newest first). No manual reordering.

### Conversation Change

Add optional `folderId` to `Conversation`:

```typescript
interface Conversation {
  // ...existing fields
  folderId?: string;  // undefined = uncategorized
}
```

Add `folderId` to `ConversationSummary` as well so the sidebar can group chats without extra lookups:

```typescript
interface ConversationSummary {
  id: string;
  title: string;
  datasetId?: string;
  folderId?: string;
}
```

### Storage

New localStorage key: `baby-sentinel-folders`

Same pattern as conversation store:
- In-memory `Map<string, Folder>` cache
- Debounced persist (300ms) to localStorage
- Version field for future migrations
- Synchronous `flushToStorage()` for critical operations (create folder + add chat)

New module: `src/lib/folder-store.ts`

Functions:
- `createFolder(name: string, datasetId: string): Folder`
- `renameFolder(id: string, name: string): void`
- `deleteFolder(id: string): void` — clears `folderId` on all conversations in the folder, then removes it
- `getFolders(datasetId: string): Folder[]` — returns folders for a dataset, sorted by `createdAt` desc
- `addChatToFolder(conversationId: string, folderId: string): void` — sets `folderId` on conversation, flushes both stores
- `removeChatFromFolder(conversationId: string): void` — clears `folderId`
- `getChatsInFolder(folderId: string): ConversationSummary[]`

All mutation functions trigger `refreshChats()` and `refreshFolders()` on the sidebar context to ensure immediate UI updates.

### Folder Name Validation

- Trim whitespace, reject empty
- Max 50 characters
- Duplicate names allowed
- Ellipsis truncation in sidebar if name overflows

## Sidebar History Panel

### Layout (top to bottom)

```
[Folders]                      +   ← section header + create button, hidden if no folders exist AND no + pressed
  📁 Retention Analysis (3)   •••  ← folder row, click to expand/collapse
    ↳ Chat title A            •••  ← indented chat, shown when expanded
    ↳ Chat title B            •••
    ↳ Chat title C            •••
  📁 Revenue Deep Dives (7)   •••  ← collapsed folder

[Recent]                           ← section header
  Chat title 1                •••  ← uncategorized chat (no folderId)
  Chat title 2                •••
  ...recent uncategorized chats

See all                            ← opens search modal
```

### Folder Row

- Left: folder icon (monochrome, `lucide-react` `Folder` or `FolderOpen` when expanded)
- Center: folder name + count badge (muted foreground)
- Right (hover): `•••` icon button → context menu
- Click anywhere on row (except •••): toggle expand/collapse
- Expand/collapse: CSS grid `0fr→1fr` transition (300ms ease-out), matching existing timeline pattern
- All folders start collapsed on page load (no persistence of expand state)

### Chat Row (inside folder or in Recent)

- Same as current chat items in history panel
- Right (hover): `•••` icon button → context menu
- Click: switch to that conversation (existing behavior)

### Recent Section

- Shows recent conversations where `folderId` is undefined, scoped to current dataset
- Sorted by `updatedAt` descending
- "See all" link at the bottom opens search modal

### "+" Create Folder Button

- Small `+` icon next to the "Folders" section header
- Clicking it inserts a new folder row at the top of the folders list with an auto-focused text input
- Enter confirms and creates the folder (empty, no chat added)
- Escape cancels and removes the row
- If no folders exist yet, clicking `+` also reveals the Folders section

### Empty States

- No folders yet: folders section hidden, just Recent + See all. The `+` button appears on hover of where the section header would be, or as a subtle affordance.
- Folder with no chats: show folder row with (0) count, expanded state shows "No chats" muted text
- No uncategorized chats: Recent section shows "No recent chats" muted text

## Context Menus

Using shadcn `DropdownMenu`.

### Chat Context Menu (uncategorized)

```
Add to folder  →  [folder list]
                   ─────────────
                   + New folder
─────────────────
Delete chat
```

### Chat Context Menu (in a folder)

```
Move to folder →  [other folders]
                   ─────────────
                   + New folder
─────────────────
Remove from folder
Delete chat
```

### Folder Context Menu

```
Rename
Delete folder
```

### "New folder" Action (from context menu submenu)

Context menu closes. A new folder row appears at the top of the Folders section with an auto-focused text input. Enter confirms, creates the folder, and moves the chat into it. Escape cancels.

### "Rename" Action

Replaces the folder name with an inline editable input. Enter to confirm, Escape to cancel.

### "Delete folder" Action

Confirm dialog: "Delete [folder name]? Chats inside will be uncategorized." On confirm, calls `deleteFolder(id)`.

### "Delete chat" Action

Confirm dialog: "Delete this conversation? This cannot be undone." On confirm, calls `deleteConversation(id)` from existing conversation store and refreshes sidebar.

## Search Modal Changes

### Folder Filter Dropdown

A dropdown selector at the top of the left pane:

- Default value: "All chats"
- Options: "All chats" + one entry per folder in the current dataset
- Selecting a folder filters the conversation list to only chats with that `folderId`
- "All chats" shows everything (current behavior)
- Uses shadcn `Select` component, monochrome styling

### Folder Label on Chat Rows

Each chat row in the left pane shows a small muted folder name label if the chat belongs to a folder:

```
Yesterday
  Chat title 1          Retention Analysis    11 hours ago
  Chat title 2                                11 hours ago
Last 7 Days
  Chat title 3          Revenue Deep Dives     3 days ago
```

- Label uses `text-muted-foreground text-xs`, positioned between title and timestamp
- No label if the chat is uncategorized
- Label is visible regardless of which folder filter is active (helps with context in "All chats" view)

### No Other Changes

- Text search filters by chat title (current behavior), composes with the folder dropdown filter
- Right pane preview: unchanged
- Time-based grouping (Yesterday / Last 7 Days / Older): unchanged, applies within the filtered set
- Keyboard navigation: unchanged

## Files to Create

| File | Purpose |
|------|---------|
| `src/lib/folder-store.ts` | Folder CRUD, localStorage persistence, chat↔folder operations |
| `src/components/sidebar/folder-section.tsx` | Folder list with expand/collapse, folder rows, `+` create button |
| `src/components/sidebar/chat-context-menu.tsx` | Context menu for chat items (add to folder, delete) |
| `src/components/sidebar/folder-context-menu.tsx` | Context menu for folder items (rename, delete) |

## Files to Modify

| File | Change |
|------|--------|
| `src/lib/conversation-types.ts` | Add `folderId?: string` to `Conversation` and `ConversationSummary` |
| `src/lib/conversation-store.ts` | Include `folderId` in `getConversationSummaries()`, add `getUncategorizedChats(datasetId)` |
| `src/components/sidebar/history-panel.tsx` | Integrate folder section above Recent, add `•••` hover actions, "See all" link |
| `src/components/chat/search-modal.tsx` | Add folder filter dropdown at top of left pane, folder name labels on chat rows |
| `src/lib/sidebar-context.tsx` | Expose `folders`, `refreshFolders()`, and folder mutation callbacks in context |

## Interactions Summary

| Action | Trigger | Result |
|--------|---------|--------|
| Create folder (standalone) | `+` next to Folders header | Inline input → creates empty folder |
| Create folder + add chat | "New folder" in chat context submenu | Inline input → creates folder, moves chat in |
| Add chat to folder | "Add to folder" → select folder | Sets `folderId`, chat moves from Recent to folder |
| Move chat between folders | "Move to folder" → select folder | Updates `folderId` |
| Remove chat from folder | "Remove from folder" | Clears `folderId`, chat returns to Recent |
| Rename folder | `•••` on folder → "Rename" | Inline edit on folder name |
| Delete folder | `•••` on folder → "Delete folder" | Confirm → removes folder, chats become uncategorized |
| Delete chat | `•••` on chat → "Delete chat" | Confirm → removes conversation from store |
| Expand/collapse folder | Click folder row | Accordion toggle with smooth animation |
| Filter by folder in search | Select folder in dropdown | Filters chat list to that folder |

## Out of Scope

- Drag-and-drop reordering of chats or folders
- Nested folders (folders within folders)
- Chat in multiple folders
- Folder colors or icons
- Auto-categorization / smart folders
- Server-side persistence (stays in localStorage)
- Expand/collapse state persistence across reloads
