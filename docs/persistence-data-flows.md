# Persistence Data Flows — Detailed Diagrams

## Current State: Dual-System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Baby Sentinel                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Canvas Items (localStorage-backed)                    │
│  ├─ In-memory Map                                      │
│  ├─ localStorage persistence (debounced)              │
│  ├─ Demo seeding (DEMO_ITEMS)                         │
│  └─ Version control (STORAGE_VERSION)                 │
│                                                         │
│  Conversations (Server in-memory only)                │
│  ├─ In-memory Map                                      │
│  ├─ API endpoints (CRUD)                              │
│  ├─ Demo seeding (PRESEEDED_CONVERSATIONS)            │
│  └─ Lost on restart ✗                                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 1. Canvas Store Lifecycle (with Persistence)

### 1a. First Visit (No localStorage data)

```
User visits app (browser)
         ↓
page.tsx mounted
         ↓
Components import canvas-store
         ↓
Canvas API called (e.g., getAllCanvasItems())
         ↓
ensureInitialized()
         ↓
┌─ Check localStorage version
│      ↓
│  STORAGE_KEY + "-version" not found? → initialize to false
│      ↓
└─ if initialized → return (already done)
         ↓
initialized = false? → proceed
         ↓
Try restore from localStorage
    localStorage.getItem("baby-sentinel-canvas-items")
         ↓
    ❌ Not found
         ↓
Seed with DEMO_ITEMS
    canvasMap.set(item.id, item) for each demo item
         ↓
initialized = true
         ↓
return [] to caller (caller sees demo items on next call)
         ↓
Canvas UI renders with demo charts, reports, insights
```

### 1b. User Saves/Deletes Canvas Item

```
User pins chart OR adds insight
         ↓
Component calls saveCanvasItem(item)
         ↓
ensureInitialized()
         ↓
canvasMap.set(item.id, item)
         ↓
persistToStorage()
         ↓
┌─ if debounceTimer active: clearTimeout()
│
└─ Set new timer: setTimeout(300ms) {
       try {
           items = Array.from(canvasMap.values())
           localStorage.setItem("baby-sentinel-canvas-items", JSON.stringify(items))
       } catch (e) {
           // localStorage full or unavailable — ignore
       }
   }
         ↓
Return immediately to component (debounce happens in background)
```

### 1c. Next Session (localStorage has data)

```
User refreshes or returns to app
         ↓
page.tsx mounted
         ↓
Canvas API called (e.g., getAllCanvasItems())
         ↓
ensureInitialized()
         ↓
Check version
    localStorage.getItem("baby-sentinel-canvas-items-version")
         ↓
    ✓ Found: version = "2" (matches STORAGE_VERSION)
         ↓
Check initialized flag
    if (initialized) return
         ↓
    ❌ Not yet
         ↓
initialized = true
         ↓
Try restore from localStorage
    localStorage.getItem("baby-sentinel-canvas-items")
         ↓
    ✓ Found: JSON array of saved items
         ↓
Parse and populate canvasMap
    JSON.parse(stored)
         ↓
    items.forEach(item => canvasMap.set(item.id, item))
         ↓
return  ← Early return, don't seed demo
         ↓
initialized = true (already set)
         ↓
Next call returns saved items
```

### 1d. Version Mismatch (Cache Invalidation)

```
Developer updates STORAGE_VERSION from 2 to 3
         ↓
User refreshes app
         ↓
ensureInitialized()
         ↓
Check version
    localStorage.getItem("baby-sentinel-canvas-items-version")
         ↓
    Found: "2" but STORAGE_VERSION = 3
         ↓
    ❌ MISMATCH
         ↓
Clear old data
    localStorage.removeItem("baby-sentinel-canvas-items")
    localStorage.removeItem("baby-sentinel-canvas-items-version")
    canvasMap.clear()
    initialized = false
         ↓
Set new version
    localStorage.setItem("baby-sentinel-canvas-items-version", "3")
         ↓
Continue initialization
         ↓
initialized = true
         ↓
Seed with new DEMO_ITEMS
         ↓
Canvas UI shows fresh demo state
```

---

## 2. Conversation Store Lifecycle (Current: Server-only)

### 2a. Server Start (In-memory initialization)

```
Next.js dev server starts
         ↓
conversation-store.ts loaded
         ↓
conversationMap = new Map()
initialized = false
         ↓
API route created: GET /api/conversations
         ↓
[Waiting for client requests...]
```

### 2b. First Client Request (Sidebar refresh)

```
page.tsx mounted
         ↓
sidebar-context.tsx mounted
         ↓
useEffect() calls refreshChats()
         ↓
fetch("/api/conversations?summary=true")
         ↓
GET /api/conversations (route.ts)
         ↓
if (searchParams.get("summary") === "true")
    getConversationSummaries()
         ↓
    ensureInitialized()
         ↓
    ❌ initialized = false
         ↓
    Load PRESEEDED_CONVERSATIONS
         ↓
    PRESEEDED_CONVERSATIONS.forEach(conv => {
        conversationMap.set(conv.id, conv)
    })
         ↓
    initialized = true
         ↓
    Return conversationMap.values() (all 4 preseeded)
         ↓
Response.json(getConversationSummaries())
         ↓
   [{ id: "funnel", title: "Shopping Funnel..." }, ...]
         ↓
Client receives summaries
         ↓
setChats(summaries)
         ↓
Sidebar renders conversation list
```

### 2c. User Creates New Conversation

```
User runs `/playbook` command
         ↓
page.tsx::handlePlaybookCreate()
         ↓
const convId = createId()  // "a1b2c3d4"
         ↓
POST /api/conversations
    Body: { id: "a1b2c3d4", title: "/playbook ..." }
         ↓
POST handler (route.ts)
         ↓
saveConversation(conv)
         ↓
ensureInitialized()  ← Already true from earlier request
         ↓
conversationMap.set("a1b2c3d4", {
    id: "a1b2c3d4",
    title: "/playbook ...",
    messages: [],
    createdAt: now,
    updatedAt: now
})
         ↓
Response.json(conv, 201)
         ↓
Client receives conversation
         ↓
setActiveConvId("a1b2c3d4")
         ↓
refreshChats()  ← Fetch updated list
         ↓
Sidebar now shows new conversation + preseeded ones
```

### 2d. User Sends Message (Stream Complete)

```
User asks question
         ↓
classifyQuery() → GET /api/classify
         ↓
Classify as "analytics" or "direct"
         ↓
fetch("/api/analyze") → stream events
         ↓
[Streaming updates to setMessages()]
    - phase: "generating_sql"
    - sql: [subagent queries]
    - query_result: [execution results]
    - summary: [agent analysis]
    - text: [streamed response tokens]
         ↓
setMessages([ ...prev, userMsg, agentMsg, sentinelMsg ])
         ↓
[All streaming done]
         ↓
finally { saveMessages(activeConvId, messages) }
         ↓
PATCH /api/conversations/{id}
    Body: { messages: [user, agent, sentinel] }
         ↓
PATCH handler (route.ts)
         ↓
updateConversationMessages(id, messages)
         ↓
conversationMap.get(id) → existing conversation
         ↓
stripVolatileVariants(messages)  ← Remove "gathering", "streaming"
         ↓
conversationMap.set(id, {
    ...existing,
    messages: [stripped messages],
    updatedAt: Date.now()
})
         ↓
Response.json({ ok: true })
         ↓
Client continues (fire-and-forget, no wait)
```

### 2e. User Switches Conversations

```
User clicks different conversation in sidebar
         ↓
sidebar.tsx calls onSelect(id)
         ↓
page.tsx::switchConversation("revenue")
         ↓
Check: if (activeConvId && messages.length > 0)
         ↓
    ✓ True: save current first
         ↓
    saveMessages(activeConvId, messages)  ← Fire-and-forget
         ↓
    PATCH /api/conversations/{old-id}
         ↓
[No wait for response]
         ↓
Fetch new conversation
         ↓
GET /api/conversations/revenue
         ↓
GET handler
         ↓
getConversation("revenue")
         ↓
conversationMap.get("revenue") → found
         ↓
Response.json(conversation)
         ↓
    {
        id: "revenue",
        title: "What are the daily revenue trends?",
        messages: [preloaded set],
        createdAt: 1,
        updatedAt: 1
    }
         ↓
Client receives
         ↓
setMessages(conv.messages)
         ↓
setSourceCanvasItemId(conv.sourceCanvasItemId ?? null)
         ↓
setActiveConvId("revenue")
         ↓
ChatThread renders new messages
```

### 2f. Server Restart (Data Lost)

```
Developer: npm run dev
         ↓
[Server exits]
         ↓
[All in-memory conversationMap cleared]
         ↓
[User keeps browser open or refreshes manually]
         ↓
User sees sidebar with old conversation list
    (cached in React state from sidebar-context)
         ↓
User clicks conversation
         ↓
switchConversation("funnel")
         ↓
GET /api/conversations/funnel
         ↓
[Server restarts]
         ↓
conversation-store.ts loaded fresh
         ↓
conversationMap = new Map()
initialized = false
         ↓
GET handler calls getConversation("funnel")
         ↓
ensureInitialized()
         ↓
Load PRESEEDED_CONVERSATIONS
         ↓
conversationMap.set("funnel", preseeded)
         ↓
getConversation("funnel") → found ✓
         ↓
Response.json(preseeded funnel)
         ↓
User message: "Show me the shopping funnel..."
Messages: [preloaded set]
         ↓
User sees restored preseeded conversation
         ↓
BUT: Any user-created conversations from before restart are GONE ✗
```

---

## 3. Sidebar Refresh Cycle

```
┌────────────────────────────────────────────────────────────┐
│  Sidebar Context Initialization & Refresh Triggers         │
└────────────────────────────────────────────────────────────┘

Mount
  ↓
useEffect(() => { refreshChats(); }, [refreshChats])
  ↓
  fetch("/api/conversations?summary=true")
  ├─ GET → conversationStore.getConversationSummaries()
  └─ JSON response: [{ id, title }, ...]
  ↓
  setChats(summaries) → Redux/Context state
  ↓
  Sidebar renders <ChatList chats={chats} />
  ↓
  Each item is clickable
         ↓
         User clicks item
         ↓
         onSelect(id) → switchConversation(id)
         ↓
         [See section 2e for details]


Visibility Change (Tab loses/gains focus)
  ↓
  useEffect(() => {
    document.addEventListener("visibilitychange", handleVisibility)
    if (document.visibilityState === "visible") {
      refreshChats()
    }
  }, [])
  ↓
  Reason: Catch server restarts while backgrounded
  ↓
  Resync sidebar state


Error Recovery (404 on GET conversation)
  ↓
  switchConversation(id)
  ↓
  GET /api/conversations/{id}
  ↓
  404 Not Found
  ↓
  setMessages([])
  toast.info("This conversation is no longer available.")
  refreshChats()  ← Resync sidebar
  ↓
  Sidebar updates to remove deleted conversation


After New Conversation Created
  ↓
  handlePlaybookCreate()
  ↓
  POST /api/conversations { id, title }
  ↓
  refreshChats()  ← Fetch new list including new conv
  ↓
  Sidebar shows new conversation
```

---

## 4. Message Save Flow (All 4 Triggers)

```
┌──────────────────────────────────────────────────────────┐
│  Four Lifecycle Points Where saveMessages() is Called    │
└──────────────────────────────────────────────────────────┘

1. SWITCH CONVERSATION
   ↓
   User clicks different conversation
   ↓
   switchConversation(id) called
   ↓
   if (activeConvId && messages.length > 0) {
       saveMessages(activeConvId, messages)  ← Fire-and-forget
   }
   ↓
   PATCH /api/conversations/{old-id} { messages }
   ↓
   (No wait)
   ↓
   Load new conversation


2. NEW CHAT
   ↓
   User clicks "New Chat" button
   ↓
   handleNewChat() called
   ↓
   if (activeConvId && messages.length > 0) {
       saveMessages(activeConvId, messages)  ← Fire-and-forget
   }
   ↓
   PATCH /api/conversations/{id} { messages }
   ↓
   setMessages([])
   setActiveConvId(null)


3. UNMOUNT (Navigation away)
   ↓
   User navigates to /canvas or /playbooks
   ↓
   page.tsx component unmounts
   ↓
   useEffect return cleanup handler
   ↓
   if (activeConvIdRef.current && messagesRef.current.length > 0) {
       saveMessages(activeConvIdRef.current, messagesRef.current)
   }
   ↓
   PATCH /api/conversations/{id} { messages }
   ↓
   (Component already unmounting, no wait)


4. STREAMING COMPLETE (Deferred)
   ↓
   handlePlaybookCreate()
   ↓
   ... streaming completes ...
   ↓
   finally {
       setIsProcessing(false)
       if (convId) {
           setTimeout(() => {
               setMessages((latest) => {
                   saveMessages(convId, latest)  ← Fire-and-forget
                   return latest
               })
           }, 0)  ← Deferred to next tick
       }
   }
   ↓
   PATCH /api/conversations/{id} { messages }
   ↓
   (Deferred, no wait)


Common Pattern: Fire-and-Forget
┌────────────────────────────────────────┐
│ fetch(url, {method: "PATCH", ...})    │
│   .catch(err => console.error(...))   │
│                                        │
│ No await, no error toast, continues   │
└────────────────────────────────────────┘
```

---

## 5. Version Control Flow (Canvas Example)

```
┌──────────────────────────────────────────────────────────┐
│  Handling Schema Changes via STORAGE_VERSION              │
└──────────────────────────────────────────────────────────┘

Scenario: Add new field to CanvasItem (e.g., "tags: string[]")

Before: STORAGE_VERSION = 2
After:  STORAGE_VERSION = 3

Code change in canvas-store.ts:
const STORAGE_VERSION = 3;  ← Bump version

Next session:
User visits app
  ↓
getAllCanvasItems()
  ↓
ensureInitialized()
  ↓
Check version:
  localStorage.getItem("baby-sentinel-canvas-items-version")
    ↓
    Returns: "2"
    ↓
    Expected: "3"
    ↓
    ❌ MISMATCH DETECTED
  ↓
Clear old data:
  localStorage.removeItem("baby-sentinel-canvas-items")
  localStorage.removeItem("baby-sentinel-canvas-items-version")
  canvasMap.clear()
  initialized = false
  ↓
Set new version:
  localStorage.setItem("baby-sentinel-canvas-items-version", "3")
  ↓
Continue init:
  initialized = true
  (now initialized, skip further checks)
  ↓
Try restore (localStorage empty now):
  localStorage.getItem("baby-sentinel-canvas-items")
    ↓
    ❌ Not found
  ↓
Seed demo data (fresh, with new schema):
  DEMO_ITEMS.forEach(item => canvasMap.set(item.id, item))
    ↓
    All demo items include new "tags" field
  ↓
persistToStorage():
  localStorage.setItem("baby-sentinel-canvas-items", JSON.stringify(items))
    ↓
    Saves new schema version
  ↓
Result: Fresh start with new schema, old data discarded cleanly
```

---

## 6. Message Variant Lifecycle

```
┌──────────────────────────────────────────────────────────┐
│  Volatile vs. Persistent Message Variants                │
└──────────────────────────────────────────────────────────┘

User sends question
  ↓
setMessages([..., {
    id: "msg123",
    role: "sentinel",
    content: "Gathering data...",
    variant: "gathering"  ← Volatile (transient UI state)
}])
  ↓
[Query executes]
  ↓
setMessages([..., {
    id: "msg456",
    role: "sentinel",
    content: "Query 1 of 3...",
    variant: "streaming"  ← Volatile (transient UI state)
}])
  ↓
[Streaming completes]
  ↓
setMessages([..., {
    id: "msg789",
    role: "sentinel",
    content: "[Final markdown response]",
    variant: "report-cta"  ← Persistent (user might click)
}])
  ↓
finally { saveMessages(convId, messages) }
  ↓
PATCH /api/conversations/{id}
  Body: { messages: [...] }
  ↓
updateConversationMessages(id, messages)
  ↓
stripVolatileVariants(messages)
  ├─ Filter out: variants "gathering", "streaming"
  └─ Keep: all others including "report-cta"
  ↓
Save filtered messages:
  {
    id: "msg789",
    role: "sentinel",
    content: "[Final markdown]",
    variant: "report-cta"  ← Persisted
    // No "gathering" or "streaming" variants
  }
  ↓
conversationMap.set(id, {..., messages: filtered, updatedAt: now})
  ↓
Result: Next load shows clean final state, no transient UI state
```

---

## 7. Proposed: localStorage Conversation Persistence *(NOT YET IMPLEMENTED)*

> **TODO** — This section describes a proposed future enhancement. As of 2026-02-24, conversations are server-only in-memory and do not survive server restarts. See `docs/plans/2026-02-18-feat-conversation-localstorage-persistence-plan.md` (marked DEFERRED).

```
┌──────────────────────────────────────────────────────────┐
│  After Migration: Dual Persistence (localStorage + API)   │
└──────────────────────────────────────────────────────────┘

User sends message
  ↓
[Streaming + updates]
  ↓
finally { saveMessages(convId, messages) }
  ↓
PATCH /api/conversations/{id}
  ├─ Update server in-memory store
  ├─ Response: { ok: true }
  └─ (Fire-and-forget, no wait)
  ↓
[Client also persists locally] ← New behavior
  ↓
setTimeout(() => {
    persistConversationToStorage(id, messages)
}, 0)
  ↓
persistConversationToStorage(id, messages)
  ├─ If debounceTimer active: clearTimeout()
  ├─ Set new timer (300ms)
  └─ localStorage.setItem("baby-sentinel-conversations", JSON.stringify(all))
  ↓
Result:
  ├─ Server has messages (in-memory until next restart)
  ├─ localStorage has messages (persistent)
  └─ Both stay in sync via PATCH endpoint


On Server Restart:
  ↓
  [Server in-memory conversationMap cleared]
  ↓
  User doesn't notice (data restored from localStorage client-side)
  ↓
  Next PATCH request hits fresh server
  └─ Server will re-seed from PRESEEDED only, get 404, or client sends latest


On Tab Close & Reopen:
  ↓
  localhost.setItem writes to localStorage
  ├─ User-created conversations persist ✓
  └─ User edits within conversations persist ✓


Version Mismatch:
  ↓
  Developer updates Conversation schema
  ↓
  STORAGE_VERSION bumped
  ↓
  Old localStorage cleared
  ↓
  Reseed with PRESEEDED_CONVERSATIONS
  ↓
  Fresh start (any user-created convs from old schema lost)
```

---

**Diagram Status:** Complete
**Last Updated:** 2026-02-18
