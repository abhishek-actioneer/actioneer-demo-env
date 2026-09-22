# Client-Side & Server-Side Persistence Patterns Research

**Date:** 2026-02-18
**Focus:** Understanding the full data flow for conversations and canvas items, preparing for localStorage-backed migration.

---

## Executive Summary

Baby Sentinel currently uses a **hybrid persistence model**:
- **Canvas items** (charts, reports, insights): localStorage-backed with version control and demo seeding
- **Conversations** (chat threads): Server-only in-memory Map with no persistence

The codebase demonstrates two distinct patterns. Understanding both is essential for migrating conversations to localStorage while maintaining the existing canvas persistence.

---

## 1. Canvas Store Pattern (localStorage-backed)

### File: `/src/lib/canvas-store.ts`

**Storage Strategy:**
- In-memory `Map<string, CanvasItem>` with debounced localStorage persistence
- STORAGE_KEY: `"baby-sentinel-canvas-items"`
- STORAGE_VERSION: `2` (version-based cache invalidation)

**Key Architecture Elements:**

```typescript
const canvasMap = new Map<string, CanvasItem>();
let initialized = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

const STORAGE_KEY = "baby-sentinel-canvas-items";
const STORAGE_VERSION = 2;
```

### Initialization: `ensureInitialized()`

**Critical: Version Check Runs BEFORE Initialized Guard**

This is the pattern to follow for conversations:

```typescript
function ensureInitialized() {
  // 1. Version check — runs BEFORE initialized guard to detect mismatch
  if (typeof window !== "undefined") {
    const storedVersion = localStorage.getItem(STORAGE_KEY + "-version");
    if (storedVersion !== String(STORAGE_VERSION)) {
      // ← Version mismatch triggers cache clear
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_KEY + "-version");
      canvasMap.clear();
      initialized = false;
      localStorage.setItem(STORAGE_KEY + "-version", String(STORAGE_VERSION));
    }
  }

  // 2. Guard: skip if already initialized this session
  if (initialized) return;
  initialized = true;

  // 3. Restore from localStorage
  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const items: CanvasItem[] = JSON.parse(stored);
        items.forEach((item) => canvasMap.set(item.id, item));
        return; // ← Early return: don't seed demo if restore succeeds
      }
    } catch {
      // Fall through to demo seed
    }
  }

  // 4. Fallback: seed with demo data
  DEMO_ITEMS.forEach((item) => canvasMap.set(item.id, item));
}
```

### Persistence: `persistToStorage()`

Uses **300ms debounce** to batch writes:

```typescript
function persistToStorage() {
  if (typeof window === "undefined") return; // SSR guard
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    try {
      const items = Array.from(canvasMap.values());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // localStorage full or unavailable — ignore silently
    }
  }, 300);
}
```

### Demo Data Seeding

Pre-seeded demo data (DEMO_ITEMS) includes:
- 2 charts (Weekly Revenue Trend, Cohort Retention Rates)
- 2 reports (Weekly Revenue Report, User Engagement Summary)
- 4 insights (APAC revenue drop, retention churn, signup growth, mobile abandonment)

All pinned with ISO timestamps. Insights have `dismissed: false` initially.

### Public API

| Function | Behavior | Triggers Persist |
|----------|----------|------------------|
| `getAllCanvasItems()` | Returns all items as array | No |
| `getCanvasItem(id)` | Returns single item or undefined | No |
| `saveCanvasItem(item)` | Sets in map, calls persistToStorage | **Yes (debounced)** |
| `removeCanvasItem(id)` | Deletes from map, calls persistToStorage | **Yes (debounced)** |
| `getCanvasItemSummaries()` | Returns sorted summaries (id, type, title, pinnedAt, severity) | No |
| `getInsights()` | Returns non-dismissed insights | No |
| `getCanvasItemByTitle(title)` | Finds chart by title | No |

---

## 2. Conversation Store Pattern (Server-only, in-memory)

### File: `/src/lib/conversation-store.ts`

**Storage Strategy:**
- In-memory `Map<string, Conversation>` with **no persistence**
- Only seeded from PRESEEDED_CONVERSATIONS on initialization
- Lost on server restart

```typescript
const conversationMap = new Map<string, Conversation>();
let initialized = false;

function ensureInitialized() {
  if (!initialized) {
    PRESEEDED_CONVERSATIONS.forEach((conv) => {
      conversationMap.set(conv.id, conv);
    });
    initialized = true;
  }
}
```

### Data Model: `Conversation`

```typescript
export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  sourceCanvasItemId?: string;  // Link to canvas item (e.g., report that started this conversation)
}

export interface ConversationSummary {
  id: string;
  title: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "sentinel" | "agent";
  content: string;
  timestamp: number;
  agent?: AgentInfo;                          // Multi-subagent trace info
  variant?: "gathering" | "streaming" | "report-cta" | "connector-required" | "playbook-preview" | "save-as-playbook" | "save-to-knowledge";
  followUpActions?: FollowUpAction[];
  connectorInfo?: ConnectorRequirement;
  playbookPreview?: PlaybookPreviewData;
  userQuery?: string;                         // Original user query for playbook save
  knowledgeSuggestion?: {
    content: string;
    suggestedLevel: "global" | "user";
  };
  cardDismissed?: boolean;
}
```

### Public API

| Function | Behavior |
|----------|----------|
| `saveConversation(conv)` | Upserts into map (no persistence) |
| `getConversation(id)` | Returns single conv or undefined |
| `getAllConversations()` | Returns all, sorted by `updatedAt` descending |
| `getConversationSummaries()` | Returns sorted summaries |
| `updateConversationMessages(id, messages)` | Strips volatile variants, updates `updatedAt` |
| `deleteConversation(id)` | Deletes from map |

### Volatile Message Variants

The `stripVolatileVariants()` helper removes transient state before persistence:

```typescript
function stripVolatileVariants(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .filter((m) => m.variant !== "gathering" && m.variant !== "streaming")
    .map((m) => {
      if (m.variant === "gathering" || m.variant === "streaming") {
        const { variant, ...rest } = m;
        return rest as ChatMessage;
      }
      return m;
    });
}
```

**Variants filtered:** `"gathering"`, `"streaming"`
**Kept:** All other variants including `"report-cta"`, `"connector-required"`, `"playbook-preview"`, `"save-as-playbook"`, `"save-to-knowledge"`

---

## 3. API Routes

### GET `/api/conversations` — List Conversations

```typescript
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("summary") === "true") {
    return Response.json(getConversationSummaries());
  }
  return Response.json(getAllConversations());
}
```

**Used by:** `sidebar-context.tsx::refreshChats()` with `?summary=true`
**Called on:** Mount, visibility change (tab focus), after new conversation created

### POST `/api/conversations` — Create Conversation

```typescript
export async function POST(req: Request) {
  const body = await req.json();
  const { id, title, messages, sourceCanvasItemId } = body as Partial<Conversation>;

  if (!id || !title) {
    return Response.json(
      { error: "id and title are required" },
      { status: 400 }
    );
  }

  const now = Date.now();
  const conv: Conversation = {
    id,
    title,
    messages: messages ?? [],
    createdAt: now,
    updatedAt: now,
    sourceCanvasItemId,
  };

  saveConversation(conv);
  return Response.json(conv, { status: 201 });
}
```

**Used by:** `page.tsx::handlePlaybookCreate()` and `page.tsx::handleSavePlaybookPreview()`

### GET `/api/conversations/[id]` — Fetch Conversation

```typescript
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const conv = getConversation(id);
  if (!conv) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json(conv);
}
```

**Used by:** `page.tsx::switchConversation()`
**Error handling:** Shows toast + refreshes sidebar on 404

### PATCH `/api/conversations/[id]` — Save Messages

```typescript
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { messages } = body as { messages: unknown[] };

  if (!Array.isArray(messages)) {
    return Response.json(
      { error: "messages array is required" },
      { status: 400 }
    );
  }

  const updated = updateConversationMessages(id, messages as ChatMessage[]);
  if (!updated) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
```

**Fire-and-forget:** Client doesn't wait for response
**Called from:** `page.tsx::saveMessages()` whenever messages change

### DELETE `/api/conversations/[id]` — Delete Conversation

```typescript
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  deleteConversation(id);
  return new Response(null, { status: 204 });
}
```

---

## 4. Sidebar Context Integration

### File: `/src/components/sidebar-context.tsx`

**Context Value:**
```typescript
interface SidebarContextValue {
  chats: ChatEntry[];           // Array of summaries
  activeId: string | null;      // Current conversation ID
  onNewChat: () => void;        // Sidebar button click handler
  onSelect: (id: string) => void; // Sidebar item click handler
  setChats: (chats: ChatEntry[]) => void;
  setActiveId: (id: string | null) => void;
  setOnNewChat: (fn: () => void) => void;
  setOnSelect: (fn: (id: string) => void) => void;
  setOnSearchClick: (fn: (() => void) | undefined) => void;
  refreshChats: () => Promise<void>;  // ← Fetches from API
  segments: SegmentDisplay[];
  refreshSegments: () => Promise<void>;
  playbookVersion: number;    // Version bump pattern
  notifyPlaybookSaved: () => void;
  canvasVersion: number;      // Version bump pattern
  notifyCanvasChanged: () => void;
}
```

**Key Method: `refreshChats()`**

```typescript
const refreshChats = useCallback(async () => {
  try {
    const res = await fetch("/api/conversations?summary=true");
    if (res.ok) {
      const summaries: ChatEntry[] = await res.json();
      setChats(summaries);
    }
  } catch {
    console.error("Failed to refresh chats");
  }
}, []);
```

**Called from:**
1. **Mount:** `useEffect(() => { refreshChats(); }, [...])`
2. **Visibility change:** Tab focus event (`visibilitychange`)
3. **After new conversation:** `handlePlaybookCreate()` calls `refreshChats()`
4. **On conversation 404:** `switchConversation()` calls `refreshChats()`

---

## 5. Page.tsx Persistence Flow

### File: `/src/app/page.tsx`

**Function: `saveMessages()`**

```typescript
const saveMessages = useCallback((convId: string, msgs: ChatMessage[]) => {
  fetch(`/api/conversations/${convId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: msgs }),
  }).catch((err) => console.error("Failed to save conversation:", err));
}, []);
```

**Fire-and-forget behavior:**
- No awaiting
- No error toast (only console.error)
- Does not block UI

**Called from 4 Places:**

#### 1. `switchConversation()` — Before switching away
```typescript
const switchConversation = useCallback(
  async (id: string) => {
    if (isProcessing) return;
    // Save current conversation before switching
    if (activeConvId && messages.length > 0) {
      saveMessages(activeConvId, messages);  // ← Fire-and-forget
    }
    // Then fetch target conversation
    const res = await fetch(`/api/conversations/${id}`);
    if (res.ok) {
      const conv = await res.json();
      setMessages(conv.messages ?? []);
      // ...
    }
  },
  [isProcessing, activeConvId, messages, refreshChats, saveMessages]
);
```

#### 2. `handleNewChat()` — Before starting new conversation
```typescript
const handleNewChat = useCallback(() => {
  if (isProcessing) return;
  if (activeConvId && messages.length > 0) {
    saveMessages(activeConvId, messages);  // ← Fire-and-forget
  }
  setMessages([]);
  setActiveConvId(null);
  // ...
}, [isProcessing, activeConvId, messages, saveMessages]);
```

#### 3. **Unmount handler** — Before navigation away
```typescript
const activeConvIdRef = useRef(activeConvId);
const messagesRef = useRef(messages);
activeConvIdRef.current = activeConvId;
messagesRef.current = messages;

useEffect(() => {
  return () => {
    if (activeConvIdRef.current && messagesRef.current.length > 0) {
      saveMessages(activeConvIdRef.current, messagesRef.current);  // ← Fire-and-forget
    }
  };
}, [saveMessages]);
```

#### 4. `handlePlaybookCreate()` — After streaming completes
```typescript
finally {
  setIsProcessing(false);
  abortRef.current = null;
  if (convId) {
    const cid = convId;
    setTimeout(() => {
      setMessages((latest) => {
        saveMessages(cid, latest);  // ← Fire-and-forget
        return latest;
      });
    }, 0);  // ← Deferred to next tick
  }
}
```

**Deferred save:** Uses `setTimeout(..., 0)` to defer until after current render cycle completes.

### Conversation Loading: `switchConversation()`

```typescript
const res = await fetch(`/api/conversations/${id}`);
if (res.ok) {
  const conv = await res.json();
  setMessages(conv.messages ?? []);
  setSourceCanvasItemId(conv.sourceCanvasItemId ?? null);
  const agentMsg = (conv.messages ?? []).find((m: ChatMessage) => m.role === "agent");
  agentMsgIdRef.current = agentMsg?.id ?? "";
} else {
  setMessages([]);
  setSourceCanvasItemId(null);
  toast.info("This conversation is no longer available.");
  refreshChats();  // ← Resync sidebar
  return;
}
```

**Error recovery:** 404 triggers sidebar refresh to catch deletions.

---

## 6. Data Flow Diagrams

### Canvas Item Lifecycle (with localStorage)

```
User Action (save chart)
    ↓
saveCanvasItem(item)
    ↓
canvasMap.set(item.id, item)
    ↓
persistToStorage()
    ↓
[300ms debounce timer]
    ↓
localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
```

### Conversation Lifecycle (Server-only, Current)

```
User creates conversation
    ↓
POST /api/conversations { id, title }
    ↓
saveConversation(conv) → conversationMap.set()
    ↓
[In-memory only]

[Later] User sends message
    ↓
setMessages([...])
    ↓
PATCH /api/conversations/{id} { messages }
    ↓
updateConversationMessages(id, messages)
    ↓
conversationMap.set(id, { ...old, messages, updatedAt })
    ↓
[In-memory only, lost on restart]
```

### Sidebar Refresh Flow

```
Mount
  ↓
refreshChats() [fetch /api/conversations?summary=true]
  ↓
API returns [ { id, title }, ... ]
  ↓
setChats(summaries)
  ↓
Sidebar renders list

User clicks conversation
  ↓
onSelect(id) calls switchConversation(id)
  ↓
[Save current] saveMessages(activeConvId, messages)
  ↓
[Fetch target] GET /api/conversations/{id}
  ↓
API returns { id, title, messages, createdAt, updatedAt, sourceCanvasItemId }
  ↓
setMessages(conv.messages)
  ↓
Chat renders thread
```

---

## 7. Preseeded Data

### Conversations

**Source:** `/src/lib/conversation-data.ts`

Pre-seeded conversation sets:
- `funnel`: Shopping funnel analysis (view → cart → purchase)
- `revenue`: Daily revenue trends
- `brands`: Top brands by revenue
- `retention`: Customer retention analysis

Each includes:
- User message (question)
- Agent message (with complete subagent info)
- Sentinel message (analysis markdown)

Exported as `PRESEEDED_CONVERSATIONS` and used to seed `conversationMap` on init.

### Canvas Items

**Source:** `/src/lib/canvas-store.ts` (DEMO_ITEMS)

Demo data seeded to localStorage on first visit:
- 2 charts (bar, line)
- 2 reports (weekly revenue, engagement)
- 4 insights (critical, warning, info severity levels)

All have `pinnedAt` ISO timestamp and position/size for canvas layout.

---

## 8. Key Patterns to Replicate for Conversation Migration

### Pattern 1: Version Control

```typescript
const STORAGE_VERSION = 1;  // Bump on breaking changes

function ensureInitialized() {
  const storedVersion = localStorage.getItem(KEY + "-version");
  if (storedVersion !== String(STORAGE_VERSION)) {
    // Clear old data, reset, seed demo
  }
  if (initialized) return;
  initialized = true;
  // Restore or seed
}
```

### Pattern 2: Debounced Persistence

```typescript
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function persistToStorage() {
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    localStorage.setItem(KEY, JSON.stringify(data));
  }, 300);  // ← Batch writes
}
```

### Pattern 3: Silent Failures

```typescript
try {
  localStorage.setItem(KEY, JSON.stringify(data));
} catch {
  // localStorage full or unavailable — ignore
}
```

### Pattern 4: Early Return on Successful Restore

```typescript
if (stored) {
  // Restore from localStorage
  items.forEach((item) => map.set(item.id, item));
  return;  // ← Don't seed demo if restore succeeds
}
// Fallback: seed demo
```

### Pattern 5: Fire-and-Forget API Calls

```typescript
const saveMessages = useCallback((convId: string, msgs: ChatMessage[]) => {
  fetch(`/api/conversations/${convId}`, {
    method: "PATCH",
    body: JSON.stringify({ messages: msgs }),
  }).catch((err) => console.error("Failed:", err));  // ← Error logged but not exposed
}, []);
```

---

## 9. Migration Considerations

### What Will Change

1. **Conversation persistence**: Currently lost on server restart → will survive restart
2. **Data duplication**: Conversations stored both in-memory AND in localStorage
3. **Storage quota**: Need to respect localStorage 5-10MB limits
4. **Sync strategy**: Client writes → server eventually; possible divergence

### What Should Stay the Same

1. **API structure**: Keep CRUD endpoints identical for backward compatibility
2. **Volatile variants**: Still strip `"gathering"` and `"streaming"` before persist
3. **Fire-and-forget saves**: Don't change UX with async waits
4. **Sidebar refresh**: Keep polling on mount, visibility change, 404 recovery
5. **Preseeded data**: Keep initial demo conversations

### Edge Cases to Handle

1. **localStorage full**: Silently fail, app continues (no toast, console.error only)
2. **Corrupted JSON**: Fall back to preseeded conversations
3. **Version mismatch**: Clear old data, reseed demo, bump STORAGE_VERSION
4. **Concurrent tabs**: Multiple windows writing to same storage (last-write-wins)
5. **Server restart**: Restore from localStorage, server in-memory map also re-populated

---

## 10. File Structure Summary

| File | Purpose | Current Behavior |
|------|---------|------------------|
| `/src/lib/canvas-store.ts` | Canvas persistence | localStorage + demo seeding |
| `/src/lib/conversation-store.ts` | Conversation in-memory store | Server-only, lost on restart |
| `/src/lib/conversation-data.ts` | Preseeded conversations | Loaded on init |
| `/src/lib/conversation-types.ts` | Conversation/ChatMessage types | Type definitions |
| `/src/lib/types.ts` | Global types (ChatMessage, AgentInfo, etc.) | Type definitions |
| `/src/components/sidebar-context.tsx` | Sidebar state + fetch logic | Calls `/api/conversations?summary=true` |
| `/src/app/page.tsx` | Main chat UI | Calls `saveMessages()` on 4 lifecycle events |
| `/src/app/api/conversations/route.ts` | List/create conversations | GET, POST endpoints |
| `/src/app/api/conversations/[id]/route.ts` | Get/update/delete conversation | GET, PATCH, DELETE endpoints |

---

## 11. Recommended Next Steps

1. **Create `conversation-store-v2.ts`** (or refactor existing) to add localStorage persistence following canvas-store pattern
2. **Implement version control** with STORAGE_VERSION bumping
3. **Add debounced persistence** to `saveConversation()` and `updateConversationMessages()`
4. **Handle message stripping** before localStorage (already done in API layer)
5. **Keep API endpoints unchanged** for backward compatibility
6. **Test edge cases**: quota full, corrupted JSON, version mismatch, concurrent tabs
7. **Monitor logs** for localStorage failures (currently silent)

---

## Appendix: Key Type Definitions

### ChatEntry (Sidebar)
```typescript
export interface ChatEntry {
  id: string;
  title: string;
}
```

### Conversation
```typescript
export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  sourceCanvasItemId?: string;
}
```

### ChatMessage (Full)
```typescript
export interface ChatMessage {
  id: string;
  role: "user" | "sentinel" | "agent";
  content: string;
  timestamp: number;
  agent?: AgentInfo;
  variant?: "gathering" | "streaming" | "report-cta" | "connector-required" | "playbook-preview" | "save-as-playbook" | "save-to-knowledge";
  followUpActions?: FollowUpAction[];
  connectorInfo?: ConnectorRequirement;
  playbookPreview?: PlaybookPreviewData;
  userQuery?: string;
  knowledgeSuggestion?: {
    content: string;
    suggestedLevel: "global" | "user";
  };
  cardDismissed?: boolean;
}
```

---

**Document Status:** Complete Research
**Last Updated:** 2026-02-18
**Next Action:** Plan localStorage migration implementation based on canvas-store pattern
