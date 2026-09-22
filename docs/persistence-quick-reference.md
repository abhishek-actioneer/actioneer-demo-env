# Persistence Patterns — Quick Reference

## Canvas Store (localStorage-backed)
**Location:** `/src/lib/canvas-store.ts`

```typescript
// Initialization
ensureInitialized()
  ├─ Check version in localStorage
  ├─ Clear old data if version mismatch
  ├─ Restore from localStorage OR
  └─ Seed with DEMO_ITEMS

// Public API
getAllCanvasItems(): CanvasItem[]
getCanvasItem(id): CanvasItem | undefined
saveCanvasItem(item): void           // Triggers debounced persist
removeCanvasItem(id): void           // Triggers debounced persist
getCanvasItemSummaries(): CanvasItemSummary[]
getInsights(): CanvasItem[]
getCanvasItemByTitle(title): CanvasItem | undefined

// Storage
STORAGE_KEY: "baby-sentinel-canvas-items"
STORAGE_VERSION: 2
persistToStorage(): debounced 300ms writes
```

## Conversation Store (Server-only, in-memory)
**Location:** `/src/lib/conversation-store.ts`

```typescript
// Initialization
ensureInitialized()
  ├─ Seed from PRESEEDED_CONVERSATIONS
  └─ Set initialized = true

// Public API
saveConversation(conv): void         // Upserts, no persist
getConversation(id): Conversation | undefined
getAllConversations(): Conversation[]
getConversationSummaries(): ConversationSummary[]
updateConversationMessages(id, messages): boolean  // Strips volatile, updates updatedAt
deleteConversation(id): void

// Data Model
Conversation {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
  sourceCanvasItemId?: string
}

// Message Variants Stripped Before Persist
stripVolatileVariants(messages)
  ├─ Filters out: "gathering", "streaming"
  └─ Keeps: "report-cta", "connector-required", "playbook-preview", "save-as-playbook", "save-to-knowledge"
```

## API Endpoints

### GET `/api/conversations`
Query param: `?summary=true` → returns summaries only
Returns: `ConversationSummary[]` or `Conversation[]`

### GET `/api/conversations/[id]`
Returns: `Conversation` or 404

### POST `/api/conversations`
Body: `{ id, title, messages?, sourceCanvasItemId? }`
Returns: `Conversation` (201)

### PATCH `/api/conversations/[id]`
Body: `{ messages: ChatMessage[] }`
Returns: `{ ok: true }` or error

### DELETE `/api/conversations/[id]`
Returns: 204 No Content

## Sidebar Context
**Location:** `/src/components/sidebar-context.tsx`

```typescript
refreshChats(): Promise<void>
  └─ fetch("/api/conversations?summary=true")
     └─ setChats(summaries)

// Called from:
// - Mount: useEffect
// - Tab visibility change: visibilitychange event
// - After new conversation: handlePlaybookCreate()
// - On fetch error (404): switchConversation()
```

## Page.tsx Save Flow

### saveMessages() — Fire-and-Forget
```typescript
const saveMessages = useCallback((convId: string, msgs: ChatMessage[]) => {
  fetch(`/api/conversations/${convId}`, {
    method: "PATCH",
    body: JSON.stringify({ messages: msgs }),
  }).catch((err) => console.error(...));
}, []);
```

### Called From:
1. **switchConversation()** — before loading different conversation
2. **handleNewChat()** — before starting fresh
3. **Unmount handler** — before navigation away
4. **handlePlaybookCreate()** — after streaming completes (deferred)

### Message Loading: switchConversation()
```typescript
const res = await fetch(`/api/conversations/${id}`);
const conv = await res.json();
setMessages(conv.messages ?? []);

// On 404:
toast.info("This conversation is no longer available.");
refreshChats();  // Resync sidebar
```

## Version Control Pattern
```typescript
const STORAGE_VERSION = 2;

function ensureInitialized() {
  // ← Version check BEFORE initialized guard
  const storedVersion = localStorage.getItem(KEY + "-version");
  if (storedVersion !== String(STORAGE_VERSION)) {
    localStorage.removeItem(KEY);
    localStorage.removeItem(KEY + "-version");
    map.clear();
    initialized = false;
    localStorage.setItem(KEY + "-version", String(STORAGE_VERSION));
  }

  if (initialized) return;
  initialized = true;
  // restore or seed
}
```

## Debounced Persistence Pattern
```typescript
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function persistToStorage() {
  if (typeof window === "undefined") return;  // ← SSR guard
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      // localStorage full or unavailable — silent fail
    }
  }, 300);
}
```

## Preseeded Data

### Canvas (DEMO_ITEMS)
- 2 charts: Weekly Revenue, Cohort Retention
- 2 reports: Weekly Revenue Report, User Engagement
- 4 insights: APAC drop, retention churn, signup growth, mobile abandonment

### Conversations (PRESEEDED_CONVERSATIONS)
- funnel: Shopping funnel analysis
- revenue: Daily revenue trends
- brands: Top brands by revenue
- retention: Customer retention analysis

Each has: user message + agent message + sentinel analysis

## Key Data Types

```typescript
// From /src/lib/types.ts
interface ChatMessage {
  id: string;
  role: "user" | "sentinel" | "agent";
  content: string;
  timestamp: number;
  agent?: AgentInfo;          // Subagent trace
  variant?: string;           // "gathering", "streaming", etc.
  followUpActions?: FollowUpAction[];
  connectorInfo?: ConnectorRequirement;
  playbookPreview?: PlaybookPreviewData;
  userQuery?: string;
  knowledgeSuggestion?: { content: string; suggestedLevel: string };
  cardDismissed?: boolean;
}

// From /src/lib/conversation-types.ts
interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  sourceCanvasItemId?: string;
}

interface ConversationSummary {
  id: string;
  title: string;
}
```

## Migration Checklist (for localStorage backing)

- [ ] Create conversation-store v2 with localStorage
- [ ] Add STORAGE_VERSION with version check before init guard
- [ ] Implement 300ms debounced persistence
- [ ] Handle stripVolatileVariants before JSON.stringify
- [ ] Keep API endpoints unchanged
- [ ] Test localStorage full scenario (silent fail)
- [ ] Test corrupted JSON (fallback to preseeded)
- [ ] Test version mismatch (clear + reseed)
- [ ] Test concurrent tab writes (last-write-wins)
- [ ] Update MEMORY.md with new pattern

## Related Files

| File | Purpose |
|------|---------|
| `/src/lib/canvas-store.ts` | Reference implementation (localStorage) |
| `/src/lib/canvas-types.ts` | Canvas data types |
| `/src/lib/conversation-store.ts` | Current target (add localStorage) |
| `/src/lib/conversation-data.ts` | Preseeded conversation data |
| `/src/lib/conversation-types.ts` | Conversation/ChatMessage types |
| `/src/components/sidebar-context.tsx` | Sidebar state + fetch logic |
| `/src/app/page.tsx` | Chat UI + saveMessages() |
| `/src/app/api/conversations/route.ts` | List/create endpoints |
| `/src/app/api/conversations/[id]/route.ts` | Get/update/delete endpoints |
