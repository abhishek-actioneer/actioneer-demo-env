# Chat Folders Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Spotify-style chat folders to the sidebar so users can organize conversations into named groups, with folder filtering in the search modal.

**Architecture:** New `folder-store.ts` module (localStorage, same pattern as `conversation-store.ts`) holds folder CRUD. `Conversation` type gains `folderId`. Sidebar history panel renders folders above recent chats with expand/collapse and context menus. Search modal adds a folder filter dropdown and folder name labels on chat rows.

**Tech Stack:** React 19, Next.js 16 App Router, shadcn/ui (DropdownMenu, Select, ConfirmDialog), Tailwind CSS v4, localStorage persistence.

**Spec:** `docs/superpowers/specs/2026-03-12-chat-folders-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|----------------|
| `src/lib/folder-store.ts` | Folder CRUD, localStorage persistence, chat↔folder operations |
| `src/components/sidebar/folder-section.tsx` | Folder list with expand/collapse, `+` create button, inline rename input |
| `src/components/sidebar/chat-context-menu.tsx` | `•••` context menu for chat items (add/move to folder, remove, delete) |
| `src/components/sidebar/folder-context-menu.tsx` | `•••` context menu for folder items (rename, delete) |

### Modified Files

| File | Change |
|------|--------|
| `src/lib/conversation-types.ts` | Add `folderId?: string` to `Conversation` and `ConversationSummary` |
| `src/lib/conversation-store.ts` | Include `folderId` in summaries, add `getUncategorizedChats()`, add `setConversationFolder()` |
| `src/components/sidebar-context.tsx` | Add `folders`, `refreshFolders()`, `folderVersion` to context |
| `src/components/sidebar/panels.tsx` | Rewrite `HistoryPanel` to integrate folder section, context menus, "See all" |
| `src/components/chat/search-modal.tsx` | Add folder filter dropdown, folder name labels on chat rows |
| `src/components/sidebar.tsx` | Pass `folders` to `HistoryPanel`, pass `folders` to `SearchModal` |

---

## Chunk 1: Data Layer

### Task 1: Add `folderId` to Conversation types

**Files:**
- Modify: `src/lib/conversation-types.ts`

- [ ] **Step 1: Add `folderId` to `Conversation`**

In `src/lib/conversation-types.ts`, add `folderId?: string` to both interfaces:

```typescript
// In Conversation interface, after pendingActions:
/** Folder this conversation belongs to (undefined = uncategorized) */
folderId?: string;
```

```typescript
// In ConversationSummary, after datasetId:
folderId?: string;
```

- [ ] **Step 2: Verify no type errors**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors (folderId is optional, so all existing code is fine).

- [ ] **Step 3: Commit**

```bash
git add src/lib/conversation-types.ts
git commit -m "feat(folders): add folderId to Conversation and ConversationSummary types"
```

---

### Task 2: Update conversation-store to support folderId

**Files:**
- Modify: `src/lib/conversation-store.ts`

- [ ] **Step 1: Include `folderId` in `getConversationSummaries`**

In `src/lib/conversation-store.ts`, update the `.map()` at the end of `getConversationSummaries` (around line 116):

```typescript
// Before:
.map(({ id, title, datasetId }) => ({ id, title, datasetId }));

// After:
.map(({ id, title, datasetId, folderId }) => ({ id, title, datasetId, folderId }));
```

- [ ] **Step 2: Add `getUncategorizedChats` function**

Add after `getConversationSummaries`:

```typescript
/** Returns recent conversations with no folder, scoped to dataset. */
export function getUncategorizedChats(datasetId?: string): ConversationSummary[] {
  return getConversationSummaries(datasetId).filter((c) => !c.folderId);
}
```

- [ ] **Step 3: Add `setConversationFolder` function**

Add after `getUncategorizedChats`:

```typescript
/** Set or clear the folderId on a conversation. */
export function setConversationFolder(conversationId: string, folderId: string | undefined): boolean {
  ensureInitialized();
  const conv = conversationMap.get(conversationId);
  if (!conv) return false;
  conversationMap.set(conversationId, { ...conv, folderId });
  persistToStorage();
  return true;
}
```

- [ ] **Step 4: Verify no type errors**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: Clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/conversation-store.ts
git commit -m "feat(folders): add folderId to summaries, getUncategorizedChats, setConversationFolder"
```

---

### Task 3: Create folder-store.ts

**Files:**
- Create: `src/lib/folder-store.ts`

- [ ] **Step 1: Create the folder store**

Create `src/lib/folder-store.ts`:

```typescript
import { setConversationFolder, getConversationSummaries } from "./conversation-store";
import type { ConversationSummary } from "./conversation-types";

/* ── Types ── */

export interface Folder {
  id: string;
  name: string;
  datasetId: string;
  createdAt: number;
}

/* ── State ── */

const folderMap = new Map<string, Folder>();
let initialized = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

const STORAGE_KEY = "baby-sentinel-folders";
const STORAGE_VERSION = 1;

/* ── Initialization ── */

function ensureInitialized() {
  if (typeof window !== "undefined") {
    const storedVersion = localStorage.getItem(STORAGE_KEY + "-version");
    if (storedVersion !== String(STORAGE_VERSION)) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_KEY + "-version");
      folderMap.clear();
      initialized = false;
      localStorage.setItem(STORAGE_KEY + "-version", String(STORAGE_VERSION));
    }
  }

  if (initialized) return;
  initialized = true;

  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const items: Folder[] = JSON.parse(stored);
        items.forEach((f) => folderMap.set(f.id, f));
      }
    } catch {
      // Corrupted data — start fresh
    }
  }
}

/* ── Persistence ── */

function persistToStorage() {
  if (typeof window === "undefined") return;
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    try {
      const items = Array.from(folderMap.values());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // localStorage full or unavailable
    }
  }, 300);
}

function flushToStorage() {
  if (typeof window === "undefined") return;
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  try {
    const items = Array.from(folderMap.values());
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // silent
  }
}

/* ── Public API ── */

/** Create a new folder. Returns the created folder. */
export function createFolder(name: string, datasetId: string): Folder {
  ensureInitialized();
  const trimmed = name.trim().slice(0, 50);
  if (!trimmed) throw new Error("Folder name cannot be empty");
  const folder: Folder = {
    id: crypto.randomUUID(),
    name: trimmed,
    datasetId,
    createdAt: Date.now(),
  };
  folderMap.set(folder.id, folder);
  flushToStorage(); // Synchronous — folder must exist before adding chats
  return folder;
}

/** Rename an existing folder. */
export function renameFolder(id: string, name: string): boolean {
  ensureInitialized();
  const folder = folderMap.get(id);
  if (!folder) return false;
  const trimmed = name.trim().slice(0, 50);
  if (!trimmed) return false;
  folderMap.set(id, { ...folder, name: trimmed });
  persistToStorage();
  return true;
}

/** Delete a folder. All conversations in it become uncategorized. */
export function deleteFolder(id: string): boolean {
  ensureInitialized();
  if (!folderMap.has(id)) return false;
  // Clear folderId on all conversations in this folder
  const summaries = getConversationSummaries();
  for (const s of summaries) {
    if (s.folderId === id) {
      setConversationFolder(s.id, undefined);
    }
  }
  folderMap.delete(id);
  flushToStorage();
  return true;
}

/** Get all folders for a dataset, sorted by createdAt descending (newest first). */
export function getFolders(datasetId: string): Folder[] {
  ensureInitialized();
  return Array.from(folderMap.values())
    .filter((f) => f.datasetId === datasetId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Get a single folder by ID. */
export function getFolder(id: string): Folder | undefined {
  ensureInitialized();
  return folderMap.get(id);
}

/** Add a chat to a folder (moves it if already in another folder). */
export function addChatToFolder(conversationId: string, folderId: string): boolean {
  ensureInitialized();
  if (!folderMap.has(folderId)) return false;
  return setConversationFolder(conversationId, folderId);
}

/** Remove a chat from its folder (becomes uncategorized). */
export function removeChatFromFolder(conversationId: string): boolean {
  return setConversationFolder(conversationId, undefined);
}

/** Get all chats in a specific folder. */
export function getChatsInFolder(folderId: string): ConversationSummary[] {
  ensureInitialized();
  return getConversationSummaries().filter((c) => c.folderId === folderId);
}
```

- [ ] **Step 2: Verify no type errors**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: Clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/folder-store.ts
git commit -m "feat(folders): create folder-store with CRUD, localStorage persistence"
```

---

### Task 4: Add folders to sidebar context

**Files:**
- Modify: `src/components/sidebar-context.tsx`

- [ ] **Step 1: Import folder store and add state**

At the top of `src/components/sidebar-context.tsx`, add import:

```typescript
import { getFolders, type Folder } from "@/lib/folder-store";
```

Add to `SidebarContextValue` interface:

```typescript
folders: Folder[];
refreshFolders: () => void;
folderVersion: number;
notifyFolderChanged: () => void;
```

- [ ] **Step 2: Add state and callbacks in SidebarProvider**

Inside `SidebarProvider`, after the `boardVersion` state, add:

```typescript
const [folders, setFolders] = useState<Folder[]>([]);
const [folderVersion, setFolderVersion] = useState(0);

const notifyFolderChanged = useCallback(() => {
  setFolderVersion((v) => v + 1);
}, []);

const refreshFolders = useCallback(() => {
  setFolders(getFolders(currentDatasetId));
}, [currentDatasetId]);
```

Add an effect to refresh folders (after the refreshChats effect):

```typescript
useEffect(() => {
  refreshFolders();
}, [refreshFolders, folderVersion]);
```

- [ ] **Step 3: Add to provider value**

In the `<SidebarContext.Provider value={...}>`, add `folders`, `refreshFolders`, `folderVersion`, and `notifyFolderChanged`.

- [ ] **Step 4: Verify no type errors**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: Clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar-context.tsx
git commit -m "feat(folders): add folders state and refresh to SidebarContext"
```

---

## Chunk 2: Sidebar UI — Context Menus

### Task 5: Create chat-context-menu component

**Files:**
- Create: `src/components/sidebar/chat-context-menu.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/sidebar/chat-context-menu.tsx`:

```typescript
"use client";

import { useState } from "react";
import { MoreHorizontal, FolderPlus, FolderInput, FolderMinus, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { Folder } from "@/lib/folder-store";

interface ChatContextMenuProps {
  chatId: string;
  currentFolderId?: string;
  folders: Folder[];
  onAddToFolder: (chatId: string, folderId: string) => void;
  onRemoveFromFolder: (chatId: string) => void;
  onNewFolder: (chatId: string) => void;
  onDelete: (chatId: string) => void;
}

export function ChatContextMenu({
  chatId,
  currentFolderId,
  folders,
  onAddToFolder,
  onRemoveFromFolder,
  onNewFolder,
  onDelete,
}: ChatContextMenuProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const isInFolder = !!currentFolderId;
  const otherFolders = folders.filter((f) => f.id !== currentFolderId);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-muted transition-all shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="text-[13px]">
              {isInFolder ? (
                <>
                  <FolderInput className="w-3.5 h-3.5 mr-2" />
                  Move to folder
                </>
              ) : (
                <>
                  <FolderPlus className="w-3.5 h-3.5 mr-2" />
                  Add to folder
                </>
              )}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-44">
              {otherFolders.map((folder) => (
                <DropdownMenuItem
                  key={folder.id}
                  className="text-[13px]"
                  onClick={() => onAddToFolder(chatId, folder.id)}
                >
                  {folder.name}
                </DropdownMenuItem>
              ))}
              {otherFolders.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem
                className="text-[13px]"
                onClick={() => onNewFolder(chatId)}
              >
                <FolderPlus className="w-3.5 h-3.5 mr-2" />
                New folder
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          {isInFolder && (
            <DropdownMenuItem
              className="text-[13px]"
              onClick={() => onRemoveFromFolder(chatId)}
            >
              <FolderMinus className="w-3.5 h-3.5 mr-2" />
              Remove from folder
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />

          <DropdownMenuItem
            className="text-[13px] text-destructive focus:text-destructive"
            onClick={() => setShowDeleteConfirm(true)}
          >
            <Trash2 className="w-3.5 h-3.5 mr-2" />
            Delete chat
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Delete conversation"
        description="Delete this conversation? This cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => onDelete(chatId)}
      />
    </>
  );
}
```

- [ ] **Step 2: Verify no type errors**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: Clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/sidebar/chat-context-menu.tsx
git commit -m "feat(folders): create ChatContextMenu with folder actions and delete"
```

---

### Task 6: Create folder-context-menu component

**Files:**
- Create: `src/components/sidebar/folder-context-menu.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/sidebar/folder-context-menu.tsx`:

```typescript
"use client";

import { useState } from "react";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface FolderContextMenuProps {
  folderId: string;
  folderName: string;
  onRename: (folderId: string) => void;
  onDelete: (folderId: string) => void;
}

export function FolderContextMenu({
  folderId,
  folderName,
  onRename,
  onDelete,
}: FolderContextMenuProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-muted transition-all shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem
            className="text-[13px]"
            onClick={() => onRename(folderId)}
          >
            <Pencil className="w-3.5 h-3.5 mr-2" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-[13px] text-destructive focus:text-destructive"
            onClick={() => setShowDeleteConfirm(true)}
          >
            <Trash2 className="w-3.5 h-3.5 mr-2" />
            Delete folder
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Delete folder"
        description={`Delete "${folderName}"? Chats inside will be uncategorized.`}
        confirmLabel="Delete"
        onConfirm={() => onDelete(folderId)}
      />
    </>
  );
}
```

- [ ] **Step 2: Verify no type errors**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: Clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/sidebar/folder-context-menu.tsx
git commit -m "feat(folders): create FolderContextMenu with rename and delete"
```

---

## Chunk 3: Sidebar UI — Folder Section and History Panel

### Task 7: Create folder-section component

**Files:**
- Create: `src/components/sidebar/folder-section.tsx`

- [ ] **Step 1: Create the folder section component**

Create `src/components/sidebar/folder-section.tsx`. This component renders the expandable folder list with inline rename and create:

```typescript
"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Folder as FolderIcon, FolderOpen, ChevronRight, Plus } from "lucide-react";
import type { Folder } from "@/lib/folder-store";
import type { ConversationSummary } from "@/lib/conversation-types";
import { FolderContextMenu } from "./folder-context-menu";
import { ChatContextMenu } from "./chat-context-menu";
import { SECTION_HEADER, ITEM, PRIMARY, EMPTY } from "./panel-styles";

interface FolderSectionProps {
  folders: Folder[];
  chats: ConversationSummary[];
  activeId: string | null;
  onSelectChat: (id: string) => void;
  onAddToFolder: (chatId: string, folderId: string) => void;
  onRemoveFromFolder: (chatId: string) => void;
  onDeleteChat: (chatId: string) => void;
  onCreateFolder: (name: string) => void;
  onRenameFolder: (folderId: string, name: string) => void;
  onDeleteFolder: (folderId: string) => void;
  /** Called when a new folder is created via context menu, so the chat can be added after creation. */
  onNewFolderForChat: (chatId: string) => void;
}

export function FolderSection({
  folders,
  chats,
  activeId,
  onSelectChat,
  onAddToFolder,
  onRemoveFromFolder,
  onDeleteChat,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onNewFolderForChat,
}: FolderSectionProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createValue, setCreateValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);

  // Focus rename input when it appears
  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

  // Focus create input when it appears
  useEffect(() => {
    if (isCreating) createInputRef.current?.focus();
  }, [isCreating]);

  const toggleExpand = useCallback((folderId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }, []);

  const handleStartRename = useCallback((folderId: string) => {
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return;
    setRenamingId(folderId);
    setRenameValue(folder.name);
  }, [folders]);

  const handleConfirmRename = useCallback(() => {
    if (renamingId && renameValue.trim()) {
      onRenameFolder(renamingId, renameValue.trim());
    }
    setRenamingId(null);
    setRenameValue("");
  }, [renamingId, renameValue, onRenameFolder]);

  const handleStartCreate = useCallback(() => {
    setIsCreating(true);
    setCreateValue("");
  }, []);

  const handleConfirmCreate = useCallback(() => {
    if (createValue.trim()) {
      onCreateFolder(createValue.trim());
    }
    setIsCreating(false);
    setCreateValue("");
  }, [createValue, onCreateFolder]);

  const chatsInFolder = useCallback((folderId: string) => {
    return chats.filter((c) => c.folderId === folderId);
  }, [chats]);

  if (folders.length === 0 && !isCreating) {
    return (
      <div className="flex items-center justify-between px-2.5 pt-2 pb-1">
        <p className={SECTION_HEADER + " !p-0"}>Folders</p>
        <button
          onClick={handleStartCreate}
          className="p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center justify-between px-2.5 pt-2 pb-1">
        <p className={SECTION_HEADER + " !p-0"}>Folders</p>
        <button
          onClick={handleStartCreate}
          className="p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {/* Create new folder inline input */}
      {isCreating && (
        <div className="px-2.5 py-1">
          <div className="flex items-center gap-2">
            <FolderIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <input
              ref={createInputRef}
              type="text"
              value={createValue}
              onChange={(e) => setCreateValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleConfirmCreate();
                if (e.key === "Escape") {
                  setIsCreating(false);
                  setCreateValue("");
                }
              }}
              onBlur={handleConfirmCreate}
              placeholder="Folder name..."
              maxLength={50}
              className="flex-1 text-[13px] bg-transparent border-b border-border focus:border-foreground focus:outline-none py-0.5 min-w-0"
            />
          </div>
        </div>
      )}

      {/* Folder list */}
      {folders.map((folder) => {
        const isExpanded = expandedIds.has(folder.id);
        const isRenaming = renamingId === folder.id;
        const folderChats = chatsInFolder(folder.id);

        return (
          <div key={folder.id}>
            {/* Folder row */}
            <div
              className={`${ITEM} group cursor-pointer`}
              onClick={() => toggleExpand(folder.id)}
            >
              <ChevronRight
                className={`w-3 h-3 text-muted-foreground shrink-0 transition-transform duration-200 ${
                  isExpanded ? "rotate-90" : ""
                }`}
              />
              {isExpanded ? (
                <FolderOpen className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              ) : (
                <FolderIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              )}

              {isRenaming ? (
                <input
                  ref={renameInputRef}
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleConfirmRename();
                    if (e.key === "Escape") {
                      setRenamingId(null);
                      setRenameValue("");
                    }
                  }}
                  onBlur={handleConfirmRename}
                  onClick={(e) => e.stopPropagation()}
                  maxLength={50}
                  className="flex-1 text-[13px] bg-transparent border-b border-border focus:border-foreground focus:outline-none py-0 min-w-0"
                />
              ) : (
                <span className="text-[13px] text-foreground truncate flex-1">
                  {folder.name}
                </span>
              )}

              <span className="text-[11px] text-muted-foreground shrink-0">
                {folderChats.length}
              </span>

              <FolderContextMenu
                folderId={folder.id}
                folderName={folder.name}
                onRename={handleStartRename}
                onDelete={onDeleteFolder}
              />
            </div>

            {/* Expanded folder contents */}
            <div
              className="grid transition-[grid-template-rows] duration-300 ease-out"
              style={{ gridTemplateRows: isExpanded ? "1fr" : "0fr" }}
            >
              <div className="overflow-hidden">
                {folderChats.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground pl-10 py-1.5">
                    No chats
                  </p>
                ) : (
                  folderChats.map((chat) => (
                    <div
                      key={chat.id}
                      className={`${ITEM} group pl-10 ${
                        chat.id === activeId ? "bg-muted" : ""
                      }`}
                      onClick={() => onSelectChat(chat.id)}
                    >
                      <div className="min-w-0 flex-1">
                        <p className={PRIMARY}>{chat.title}</p>
                      </div>
                      <ChatContextMenu
                        chatId={chat.id}
                        currentFolderId={folder.id}
                        folders={folders}
                        onAddToFolder={onAddToFolder}
                        onRemoveFromFolder={onRemoveFromFolder}
                        onNewFolder={onNewFolderForChat}
                        onDelete={onDeleteChat}
                      />
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Verify no type errors**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: Clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/sidebar/folder-section.tsx
git commit -m "feat(folders): create FolderSection with expand/collapse, inline rename/create"
```

---

### Task 8: Rewrite HistoryPanel to integrate folders

**Files:**
- Modify: `src/components/sidebar/panels.tsx`

- [ ] **Step 1: Update HistoryPanel imports and props**

In `src/components/sidebar/panels.tsx`, update the HistoryPanel to accept folders and all the action callbacks. Replace the existing `HistoryPanel` function (lines ~39-83) with:

```typescript
import { FolderSection } from "./folder-section";
import { ChatContextMenu } from "./chat-context-menu";
import type { Folder } from "@/lib/folder-store";
import type { ConversationSummary } from "@/lib/conversation-types";
```

Add these imports at the top (merge with existing imports).

Then replace the HistoryPanel:

```typescript
export function HistoryPanel({
  chats,
  folders,
  activeId,
  onSelect,
  onSearchClick,
  onAddToFolder,
  onRemoveFromFolder,
  onDeleteChat,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onNewFolderForChat,
}: {
  chats: ConversationSummary[];
  folders: Folder[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onSearchClick?: () => void;
  onAddToFolder: (chatId: string, folderId: string) => void;
  onRemoveFromFolder: (chatId: string) => void;
  onDeleteChat: (chatId: string) => void;
  onCreateFolder: (name: string) => void;
  onRenameFolder: (folderId: string, name: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onNewFolderForChat: (chatId: string) => void;
}) {
  const uncategorized = chats.filter((c) => !c.folderId);

  return (
    <>
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <input
            type="text"
            readOnly
            onClick={onSearchClick}
            placeholder="Search..."
            className="w-full pl-7 pr-2 py-1.5 text-[13px] border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring/20 cursor-pointer"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-1.5">
        {/* Folder section */}
        <FolderSection
          folders={folders}
          chats={chats}
          activeId={activeId}
          onSelectChat={onSelect}
          onAddToFolder={onAddToFolder}
          onRemoveFromFolder={onRemoveFromFolder}
          onDeleteChat={onDeleteChat}
          onCreateFolder={onCreateFolder}
          onRenameFolder={onRenameFolder}
          onDeleteFolder={onDeleteFolder}
          onNewFolderForChat={onNewFolderForChat}
        />

        {/* Recent (uncategorized) section */}
        <p className={SECTION_HEADER}>Recent</p>
        <div>
          {uncategorized.map((chat) => (
            <div
              key={chat.id}
              className={`${ITEM} group ${chat.id === activeId ? "bg-muted" : ""}`}
              onClick={() => onSelect(chat.id)}
            >
              <div className="min-w-0 flex-1">
                <p className={PRIMARY}>{chat.title}</p>
              </div>
              <ChatContextMenu
                chatId={chat.id}
                folders={folders}
                onAddToFolder={onAddToFolder}
                onRemoveFromFolder={onRemoveFromFolder}
                onNewFolder={onNewFolderForChat}
                onDelete={onDeleteChat}
              />
            </div>
          ))}
          {uncategorized.length === 0 && <p className={EMPTY}>No recent chats</p>}
        </div>

        {/* See all */}
        <button
          onClick={onSearchClick}
          className="mx-1 mb-3 mt-1 px-2.5 py-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors text-left"
        >
          See all →
        </button>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Also update the history-panel.tsx standalone file**

The file `src/components/sidebar/history-panel.tsx` is a duplicate. Delete it or update to re-export from panels.tsx. Check which one is actually imported by sidebar.tsx. The sidebar imports from `./panels` so the standalone file may be unused. Verify with:

Run: `grep -r "history-panel" src/ --include="*.tsx" --include="*.ts"`

If nothing imports it, delete the standalone file. If something does, update it to re-export:

```typescript
export { HistoryPanel } from "./panels";
```

- [ ] **Step 3: Verify no type errors**

Run: `npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 4: Commit**

```bash
git add src/components/sidebar/panels.tsx src/components/sidebar/history-panel.tsx
git commit -m "feat(folders): rewrite HistoryPanel with folder section, context menus, see all"
```

---

### Task 9: Wire up sidebar.tsx with folder actions

**Files:**
- Modify: `src/components/sidebar.tsx`

- [ ] **Step 1: Import folder store functions**

At the top of `src/components/sidebar.tsx`, add:

```typescript
import {
  createFolder,
  renameFolder as renameFolderStore,
  deleteFolder as deleteFolderStore,
  addChatToFolder,
  removeChatFromFolder,
} from "@/lib/folder-store";
import { deleteConversation } from "@/lib/conversation-store";
import { useDataset } from "@/lib/dataset-context";
```

- [ ] **Step 2: Add folder action handlers in Sidebar component**

Inside the `Sidebar` function, destructure `folders`, `refreshFolders`, `notifyFolderChanged` from `useSidebarContext()`. Also get `datasetId` from `useDataset()`.

Add these handlers:

```typescript
const { folders, refreshFolders, notifyFolderChanged } = useSidebarContext();
const { datasetId } = useDataset();

const handleAddToFolder = useCallback((chatId: string, folderId: string) => {
  addChatToFolder(chatId, folderId);
  refreshChats();
  refreshFolders();
}, [refreshChats, refreshFolders]);

const handleRemoveFromFolder = useCallback((chatId: string) => {
  removeChatFromFolder(chatId);
  refreshChats();
  refreshFolders();
}, [refreshChats, refreshFolders]);

const handleDeleteChat = useCallback((chatId: string) => {
  deleteConversation(chatId);
  refreshChats();
  refreshFolders();
}, [refreshChats, refreshFolders]);

const handleCreateFolder = useCallback((name: string) => {
  createFolder(name, datasetId);
  notifyFolderChanged();
}, [datasetId, notifyFolderChanged]);

const handleRenameFolder = useCallback((folderId: string, name: string) => {
  renameFolderStore(folderId, name);
  notifyFolderChanged();
}, [notifyFolderChanged]);

const handleDeleteFolder = useCallback((folderId: string) => {
  deleteFolderStore(folderId);
  notifyFolderChanged();
  refreshChats();
}, [notifyFolderChanged, refreshChats]);

// For "New folder" from chat context menu — create folder then add chat
const [pendingChatForFolder, setPendingChatForFolder] = useState<string | null>(null);

const handleNewFolderForChat = useCallback((chatId: string) => {
  setPendingChatForFolder(chatId);
  // The FolderSection's create input will handle the rest
  // We need a way to signal to FolderSection to start creating
  // For now, we'll use a ref or state approach
}, []);
```

Note: The `handleNewFolderForChat` flow needs the FolderSection to start its create mode and then, on confirm, add the pending chat. This requires passing `pendingChatForFolder` down and having FolderSection's `onCreateFolder` also add the chat. Update `handleCreateFolder`:

```typescript
const handleCreateFolder = useCallback((name: string) => {
  const folder = createFolder(name, datasetId);
  if (pendingChatForFolder) {
    addChatToFolder(pendingChatForFolder, folder.id);
    setPendingChatForFolder(null);
    refreshChats();
  }
  notifyFolderChanged();
}, [datasetId, notifyFolderChanged, pendingChatForFolder, refreshChats]);

const handleNewFolderForChat = useCallback((_chatId: string) => {
  setPendingChatForFolder(_chatId);
}, []);
```

- [ ] **Step 3: Update HistoryPanel rendering**

Update the `HistoryPanel` call (around line 287) to pass all new props. Also need to destructure `refreshChats` from `useSidebarContext()`:

```typescript
{activePanel === "history" && (
  <HistoryPanel
    chats={chats}
    folders={folders}
    activeId={activeId}
    onSelect={onSelect}
    onSearchClick={handleOpenSearch}
    onAddToFolder={handleAddToFolder}
    onRemoveFromFolder={handleRemoveFromFolder}
    onDeleteChat={handleDeleteChat}
    onCreateFolder={handleCreateFolder}
    onRenameFolder={handleRenameFolder}
    onDeleteFolder={handleDeleteFolder}
    onNewFolderForChat={handleNewFolderForChat}
  />
)}
```

- [ ] **Step 4: Pass folders to SearchModal**

Update the `SearchModal` rendering to pass folders:

```typescript
{searchOpen && (
  <SearchModal
    chats={chats}
    folders={folders}
    activeMessages={activeMessages}
    activeId={activeId}
    onSelect={(id) => {
      onSelect(id);
      setSearchOpen(false);
    }}
    onClose={() => setSearchOpen(false)}
  />
)}
```

- [ ] **Step 5: Trigger FolderSection create mode when pendingChatForFolder is set**

Pass `pendingChatForFolder` as `startCreating` prop to FolderSection via HistoryPanel. This requires adding the prop to both components. In FolderSection, when `startCreating` becomes truthy, set `isCreating = true`:

Add to FolderSectionProps:
```typescript
startCreating?: boolean;
```

Add effect in FolderSection:
```typescript
useEffect(() => {
  if (startCreating) setIsCreating(true);
}, [startCreating]);
```

Thread it through HistoryPanel by adding `startCreating?: boolean` prop and passing to FolderSection.

Then in sidebar.tsx, pass `startCreating={!!pendingChatForFolder}` to HistoryPanel.

- [ ] **Step 6: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | head -30`

- [ ] **Step 7: Commit**

```bash
git add src/components/sidebar.tsx
git commit -m "feat(folders): wire up folder actions in sidebar with HistoryPanel and SearchModal"
```

---

## Chunk 4: Search Modal Update

### Task 10: Add folder filter dropdown and labels to search modal

**Files:**
- Modify: `src/components/chat/search-modal.tsx`

- [ ] **Step 1: Update SearchModal props and state**

In `src/components/chat/search-modal.tsx`, update the props interface and add folder state:

```typescript
import type { Folder } from "@/lib/folder-store";

interface SearchModalProps {
  chats: ChatEntry[];
  folders?: Folder[];
  activeMessages?: ChatMessage[];
  activeId?: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}
```

Inside the component, add:

```typescript
const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
```

- [ ] **Step 2: Update filtering logic**

Replace the existing `filtered` memo with one that also applies folder filter:

```typescript
const filtered = useMemo(() => {
  let items = chats;
  // Folder filter
  if (selectedFolderId) {
    items = items.filter((c) => (c as any).folderId === selectedFolderId);
  }
  // Text search
  if (search) {
    const q = search.toLowerCase();
    items = items.filter((c) => c.title.toLowerCase().includes(q));
  }
  return items;
}, [chats, search, selectedFolderId]);
```

Note: `ChatEntry` currently has `{ id, title }`. We need to extend it or use the full `ConversationSummary` type. The simplest approach: update `ChatEntry` to include optional `folderId`:

In `src/components/sidebar.tsx`, update the `ChatEntry` interface:

```typescript
export interface ChatEntry {
  id: string;
  title: string;
  folderId?: string;
}
```

Then the filtering can use `c.folderId` directly.

- [ ] **Step 3: Build a folder lookup map for labels**

Inside the component:

```typescript
const folderLookup = useMemo(() => {
  const map = new Map<string, string>();
  if (folders) {
    for (const f of folders) {
      map.set(f.id, f.name);
    }
  }
  return map;
}, [folders]);
```

- [ ] **Step 4: Add folder filter dropdown in the search header**

After the search input and before the close button, add a folder filter dropdown. Use a simple `<select>` or shadcn `Select`. For simplicity and monochrome styling, use a native select styled with Tailwind:

```typescript
{folders && folders.length > 0 && (
  <select
    value={selectedFolderId ?? ""}
    onChange={(e) => setSelectedFolderId(e.target.value || null)}
    className={`${TEXT_SM} bg-transparent border border-border rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring/20 text-foreground shrink-0`}
  >
    <option value="">All chats</option>
    {folders.map((f) => (
      <option key={f.id} value={f.id}>{f.name}</option>
    ))}
  </select>
)}
```

Place this in the search header `<div>`, between the input and close button.

- [ ] **Step 5: Add folder label to each chat row**

In the chat row button, add a folder name label between the title and timestamp:

```typescript
<button
  key={chat.id}
  onMouseEnter={() => setHoveredId(chat.id)}
  onClick={() => {
    onSelect(chat.id);
    onClose();
  }}
  className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
    hoveredId === chat.id
      ? "bg-muted"
      : "hover:bg-muted/50"
  }`}
>
  <p className={`${TEXT_SM} text-foreground truncate flex-1`}>{chat.title}</p>
  {(chat as any).folderId && folderLookup.get((chat as any).folderId) && (
    <span className={`${TEXT_XS} ${TEXT_MUTED} shrink-0 truncate max-w-[100px]`}>
      {folderLookup.get((chat as any).folderId)}
    </span>
  )}
  <span className={`${TEXT_XS} ${TEXT_MUTED} shrink-0 whitespace-nowrap`}>
    {getRelativeTime(globalIdx)}
  </span>
</button>
```

Once `ChatEntry` has `folderId`, remove the `as any` casts and use `chat.folderId` directly.

- [ ] **Step 6: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | head -30`

- [ ] **Step 7: Test manually**

Run: `pnpm dev`

1. Open sidebar → History panel should show "Folders" header with `+` button and "Recent" section
2. Click `+` → inline input appears, type a folder name, press Enter → folder created
3. Hover a chat in Recent → `•••` appears, click → context menu with "Add to folder"
4. Add a chat to the folder → chat moves from Recent to folder
5. Click folder → expands with smooth animation, shows the chat
6. Hover folder `•••` → Rename, Delete folder options work
7. Cmd+K → search modal shows folder dropdown, folder labels on chat rows
8. Select a folder in dropdown → filters to that folder's chats

- [ ] **Step 8: Commit**

```bash
git add src/components/chat/search-modal.tsx src/components/sidebar.tsx
git commit -m "feat(folders): add folder filter dropdown and labels to search modal"
```

---

## Chunk 5: Polish and Edge Cases

### Task 11: Handle ChatEntry type update and cleanup

**Files:**
- Modify: `src/components/sidebar.tsx` (ChatEntry type)
- Modify: `src/components/sidebar-context.tsx` (map chats with folderId)

- [ ] **Step 1: Update ChatEntry to include folderId**

In `src/components/sidebar.tsx`, update:

```typescript
export interface ChatEntry {
  id: string;
  title: string;
  folderId?: string;
}
```

- [ ] **Step 2: Update refreshChats in sidebar-context.tsx**

In `src/components/sidebar-context.tsx`, the `refreshChats` callback maps `ConversationSummary` to `ChatEntry`. Update it to include `folderId`:

```typescript
const refreshChats = useCallback(async () => {
  const summaries = getConversationSummaries(currentDatasetId);
  setChats(summaries.map(({ id, title, folderId }) => ({ id, title, folderId })));
}, [currentDatasetId]);
```

- [ ] **Step 3: Remove all `as any` casts from search-modal.tsx**

Now that `ChatEntry` has `folderId`, replace `(chat as any).folderId` with `chat.folderId` in search-modal.tsx.

- [ ] **Step 4: Remove duplicate history-panel.tsx if unused**

Check if `src/components/sidebar/history-panel.tsx` is imported anywhere. If not, delete it.

- [ ] **Step 5: Verify and test**

Run: `npx tsc --noEmit 2>&1 | head -20`
Run: `pnpm dev` and test the full flow.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(folders): clean up ChatEntry type, remove duplicates, final polish"
```
