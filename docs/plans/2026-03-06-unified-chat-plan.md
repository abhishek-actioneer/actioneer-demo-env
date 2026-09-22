# Unified Persistent Chat — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make chat a persistent, context-aware layer available on every page — surviving navigation, aware of page context, and surfacing intersection cards connecting chat history to the current view.

**Architecture:** Lift all chat state from `page.tsx` into a global `ChatStateProvider` at `LayoutShell` level. Wire the existing UI shell (FAB, panel, provider) to real chat state. Inject page context into LLM prompts. Surface intersection cards by scanning conversation history against current page.

**Tech Stack:** Next.js 16 App Router, React 19 Context, existing hooks (useConversation, useAnalytics, usePanel, useSegmentCreation, usePlaybookCreation), localStorage persistence via conversation-store.ts

---

## Phase 1: Global Chat State Provider

Lift all chat state from `src/app/page.tsx` (lines 78-328) into a single provider that lives in `LayoutShell`, so state survives navigation.

### Task 1: Create ChatStateProvider

**Files:**
- Create: `src/components/chat/chat-state-provider.tsx`

**Step 1: Create the provider shell**

Extract all hook calls and handler functions from `HomeInner` (page.tsx:78-328) into a new provider. This is the biggest single task — it moves ~250 lines of state + handlers into a context.

The provider must hold:
- `useConversation()` — messages, activeConvId, isProcessing, etc.
- `useAnalytics()` — handleSend, handleStop, deepResearch, generatedReport
- `usePanel()` — panel state, citation, handlers
- `useSegmentCreation()` — modal state, create handler
- `usePlaybookCreation()` — playbook create, connector, CSV upload
- `useDbHealth()` — dbStatus, checkHealth
- Entity catalogs (entityCatalog, runCatalog, entityLookup)
- All callback handlers (handleFollowUpAction, handleSaveAsPlaybook, handleSaveToKnowledge, etc.)
- `chatInputRef` — forwarded ref for programmatic input control
- `liveResponseIds` ref

```typescript
// src/components/chat/chat-state-provider.tsx
"use client";

import { createContext, useContext, useRef, useState, useCallback, useMemo, type ReactNode } from "react";
import type { ChatInputHandle } from "@/components/chat/chat-input";
import type { ChatMessage, FollowUpAction } from "@/lib/types";
import type { DetectableEntity } from "@/lib/entity-types";
import type { PanelState } from "@/hooks/use-panel";
// ... all other imports from page.tsx

interface ChatState {
  // Conversation
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  activeConvId: string | null;
  isProcessing: boolean;
  sourceCanvasItemId: string | null;

  // Analytics
  handleSend: (text: string, entityContext?: any) => void;
  handleStop: () => void;
  deepResearch: boolean;
  setDeepResearch: React.Dispatch<React.SetStateAction<boolean>>;
  generatedReport: string | null;

  // Panel
  panel: PanelState;
  setPanel: (p: PanelState) => void;
  activeCitation: any;
  handleViewTask: () => void;
  handleSubagentClick: (id: string) => void;
  handleClosePanel: () => void;
  handleCitationClick: (c: any) => void;
  sourcesAgents: any[];

  // Actions
  handleFollowUpAction: (action: FollowUpAction) => void;
  handleSaveAsPlaybook: (userQuery: string) => void;
  handleSavePlaybookPreview: (msgId: string) => void;
  handleSaveToKnowledge: (content: string, level: "global" | "user") => Promise<void>;
  handleDismissKnowledge: (msgId: string) => void;
  handleConnectorClick: (id: string) => void;
  handleProceedWithout: () => void;
  handleUploadCSV: (file: File) => void;

  // Segment
  segmentModal: any;
  isCreatingSegment: boolean;
  segmentToast: any;
  handleCreateSegment: (name: string, sql: string) => void;
  closeSegmentModal: () => void;
  dismissSegmentToast: () => void;

  // Catalogs
  entityCatalog: DetectableEntity[];
  runCatalog: DetectableEntity[];
  entityLookup: Map<string, DetectableEntity>;
  handleEntityClick: (entity: DetectableEntity) => void;

  // Refs
  chatInputRef: React.RefObject<ChatInputHandle | null>;
  liveResponseIds: React.MutableRefObject<Set<string>>;

  // DB
  dbStatus: "checking" | "ready" | "offline";
  checkHealth: () => void;
}

const ChatStateContext = createContext<ChatState | null>(null);

export function ChatStateProvider({ children }: { children: ReactNode }) {
  // Move ALL hook calls and handlers from HomeInner here
  // ...
  return (
    <ChatStateContext.Provider value={value}>
      {children}
    </ChatStateContext.Provider>
  );
}

export function useChatState(): ChatState {
  const ctx = useContext(ChatStateContext);
  if (!ctx) throw new Error("useChatState must be used within ChatStateProvider");
  return ctx;
}
```

**Step 2: Commit**

```bash
git add src/components/chat/chat-state-provider.tsx
git commit -m "feat: create ChatStateProvider shell with full type interface"
```

### Task 2: Move hook calls into ChatStateProvider

**Files:**
- Modify: `src/components/chat/chat-state-provider.tsx`
- Modify: `src/app/page.tsx`

**Step 1: Move all hook calls from HomeInner into ChatStateProvider**

Cut lines 78-328 from `page.tsx` HomeInner and paste into the provider body. This includes:
- `useConversation()` call (line 129-138)
- `usePanel()` call (line 148-152)
- `useSegmentCreation()` call (line 155-159)
- `usePlaybookCreation()` call (line 162-170)
- `useAnalytics()` call (line 173-187)
- `useDbHealth()` call (line 190)
- Entity catalog memos (lines 88-115)
- All handler callbacks (lines 117-327)
- Refs: `chatInputRef`, `liveResponseIds`, `agentMsgIdRef`, `messagesRef`
- State: `autocompleteOpen`, `inputHasContent`

Note: `useRouter()` and `useSearchParams()` stay in page.tsx since they're page-specific. But `router.push` is used in several handlers (handleEntityClick, handleFollowUpAction, handleSaveAsPlaybook). These handlers need router access — either pass router into the provider or keep those handlers in page.tsx.

**Decision:** Pass `router` as a prop to ChatStateProvider, or use `useRouter()` inside the provider since it's a client component and works in any component under Next.js.

**Step 2: Update HomeInner to consume ChatState**

```typescript
function HomeInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const chat = useChatState();

  // URL param effects stay here (segment, playbook params)
  // ...

  // Render uses chat.messages, chat.handleSend, etc.
}
```

**Step 3: Verify app still works**

```bash
pnpm dev
# Test: open home page, send a message, verify deep research works
# Test: sidebar conversation switching works
# Test: segment creation from follow-up action works
```

**Step 4: Commit**

```bash
git add src/components/chat/chat-state-provider.tsx src/app/page.tsx
git commit -m "refactor: move all chat state from page.tsx into ChatStateProvider"
```

### Task 3: Wire ChatStateProvider into LayoutShell

**Files:**
- Modify: `src/components/layout-shell.tsx`

**Step 1: Add ChatStateProvider to the provider tree**

```typescript
// layout-shell.tsx
import { ChatStateProvider } from "@/components/chat/chat-state-provider";

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/login") return <>{children}</>;

  return (
    <DatasetProvider>
      <ModelProvider>
        <SidebarProvider>
          <ChatStateProvider>
            <ChatPanelProvider>
              <div className="flex h-screen overflow-hidden">
                <Sidebar />
                <main className="flex-1 min-w-0 overflow-hidden">{children}</main>
                <ChatPanel />
              </div>
              <ChatFAB />
            </ChatPanelProvider>
          </ChatStateProvider>
        </SidebarProvider>
      </ModelProvider>
    </DatasetProvider>
  );
}
```

ChatStateProvider wraps ChatPanelProvider because ChatPanelProvider is the UI shell (open/close state), while ChatStateProvider holds the actual chat data. They're separate concerns.

**Step 2: Verify**

```bash
pnpm dev
# Navigate between pages — chat state should survive
# Open home, start deep research, click segments in sidebar, click back — should still see messages
```

**Step 3: Commit**

```bash
git add src/components/layout-shell.tsx
git commit -m "feat: wire ChatStateProvider into LayoutShell provider tree"
```

### Task 4: Handle sidebar sync

**Files:**
- Modify: `src/components/chat/chat-state-provider.tsx`
- Possibly modify: `src/hooks/use-conversation.ts`

**Problem:** `useConversation` currently calls `useSidebarContext()` to sync `setActiveId`, `setOnNewChat`, `setOnSelect`, `setActiveMessages`. This must still work when the hook is called from the provider instead of from page.tsx.

**Step 1: Verify useSidebarContext is available**

Since `ChatStateProvider` is nested inside `SidebarProvider` in LayoutShell, `useSidebarContext()` will work. No code changes needed if `useConversation` already calls it internally.

**Step 2: Test sidebar interaction**

```bash
pnpm dev
# Click sidebar conversations — should switch active conversation
# Start new chat from sidebar — should clear messages
# Verify conversation list updates after sending messages
```

**Step 3: Commit (if changes needed)**

```bash
git add -A
git commit -m "fix: ensure sidebar sync works with lifted ChatStateProvider"
```

---

## Phase 2: Wire Panel to Real Chat

Connect the existing UI shell panel (`ChatPanel`) to the real chat state, replacing mock content with actual ChatThread + ChatInput.

### Task 5: Replace mock panel content with real chat components

**Files:**
- Modify: `src/components/chat/chat-panel.tsx`

**Step 1: Import and render ChatThread + ChatInput in the panel**

Replace the mock empty state, suggested action cards, and disabled input with the real chat components. The panel should show:
- When no messages: suggested actions + intersection cards (keep existing)
- When messages exist: ChatThread + ChatInput (real, functional)

```typescript
// chat-panel.tsx
import { useChatState } from "@/components/chat/chat-state-provider";
import { useChatPanel } from "@/components/chat/chat-panel-provider";
import { ChatThread } from "@/components/chat/chat-thread";
import { ChatInput } from "@/components/chat/chat-input";

export function ChatPanel() {
  const { isOpen, close, pageContext } = useChatPanel();
  const chat = useChatState();

  if (!isOpen) return null;

  const hasMessages = chat.messages.length > 0;

  return (
    <div className="w-[400px] shrink-0 border-l border-border bg-background flex flex-col h-full animate-in slide-in-from-right-4 duration-200">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-14 border-b border-border shrink-0">
        {/* ... existing header ... */}
      </div>

      {/* Chat content */}
      {hasMessages ? (
        <>
          <div className="flex-1 overflow-hidden relative">
            <ChatThread
              messages={chat.messages}
              isProcessing={chat.isProcessing}
              onViewTask={chat.handleViewTask}
              onSubagentClick={chat.handleSubagentClick}
              selectedSubagentId={null}
              isTaskPanelOpen={false}
              onCitationClick={chat.handleCitationClick}
              activeCitation={chat.activeCitation}
              onFollowUpAction={chat.handleFollowUpAction}
              onConnectorClick={chat.handleConnectorClick}
              onProceedWithout={chat.handleProceedWithout}
              onUploadCSV={chat.handleUploadCSV}
              onSaveAsPlaybook={chat.handleSaveAsPlaybook}
              onSavePlaybookPreview={chat.handleSavePlaybookPreview}
              onSaveToKnowledge={chat.handleSaveToKnowledge}
              onDismissKnowledge={chat.handleDismissKnowledge}
              conversationId={chat.activeConvId ?? undefined}
              onChartPinned={() => {}}
              liveResponseIds={chat.liveResponseIds.current}
              entityLookup={chat.entityLookup}
              onEntityClick={chat.handleEntityClick}
              onAddToFollowUp={(text) => chat.chatInputRef.current?.setQuotedContext(text)}
              onAddToKnowledge={(text) => chat.handleSaveToKnowledge(text, "global")}
              hideMinimap={true}
            />
          </div>
          <div className="shrink-0 border-t border-border">
            <ChatInput
              ref={chat.chatInputRef}
              onSend={chat.handleSend}
              onStop={chat.handleStop}
              deepResearch={chat.deepResearch}
              onToggleDeepResearch={() => chat.setDeepResearch(d => !d)}
              isProcessing={chat.isProcessing}
              entityCatalog={chat.entityCatalog}
              runCatalog={chat.runCatalog}
            />
          </div>
        </>
      ) : (
        <>
          {/* Existing empty state: suggested actions + intersection cards */}
          <div className="flex-1 overflow-y-auto px-4 py-5 space-y-6">
            {/* ... keep existing empty state content ... */}
          </div>
          {/* Real input (not disabled) */}
          <div className="shrink-0 border-t border-border p-3">
            <ChatInput
              ref={chat.chatInputRef}
              onSend={chat.handleSend}
              onStop={chat.handleStop}
              deepResearch={chat.deepResearch}
              onToggleDeepResearch={() => chat.setDeepResearch(d => !d)}
              isProcessing={chat.isProcessing}
              entityCatalog={chat.entityCatalog}
              runCatalog={chat.runCatalog}
            />
          </div>
        </>
      )}
    </div>
  );
}
```

**Step 2: Verify panel works**

```bash
pnpm dev
# Navigate to /segments, click FAB, panel opens
# Type a question, hit send — should stream response
# Messages should appear in the panel's ChatThread
# Navigate to /metrics — panel stays open with same messages
```

**Step 3: Commit**

```bash
git add src/components/chat/chat-panel.tsx
git commit -m "feat: wire chat panel to real ChatThread and ChatInput"
```

### Task 6: Make suggested actions trigger real queries

**Files:**
- Modify: `src/components/chat/chat-panel.tsx`

**Step 1: Wire SuggestedActionCard onClick to handleSend**

```typescript
function SuggestedActionCard({ action, onSend }: { action: SuggestedAction; onSend: (text: string) => void }) {
  return (
    <button
      onClick={() => onSend(action.prompt)}
      className="w-full text-left p-3 rounded-lg border border-border hover:border-foreground/20 hover:bg-muted/50 transition-all group"
    >
      {/* ... existing content ... */}
    </button>
  );
}
```

Pass `chat.handleSend` as `onSend` prop from the parent.

**Step 2: Commit**

```bash
git add src/components/chat/chat-panel.tsx
git commit -m "feat: suggested actions trigger real chat queries"
```

### Task 7: Reconcile home page rendering

**Files:**
- Modify: `src/app/page.tsx`

**Problem:** Home page currently renders its own ChatThread and ChatInput directly. With the state lifted to ChatStateProvider, page.tsx should still render the full-page chat experience but consume state from the provider instead of holding it locally.

**Step 1: Refactor HomeInner to use useChatState()**

```typescript
function HomeInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const chat = useChatState();
  const { notifyCanvasChanged } = useSidebarContext();
  const { dataset, datasetId } = useDataset();
  const [autocompleteOpen, setAutocompleteOpen] = useState(false);
  const [inputHasContent, setInputHasContent] = useState(false);

  // URL param effects (segment, playbook) stay here
  // ...

  const hasMessages = chat.messages.length > 0;

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* DB status banner */}
      {/* ... */}
      <main className="flex-1 overflow-hidden">
        <div className="flex h-full">
          <div className={`flex-1 min-w-0 ${hasMessages ? "relative" : "flex flex-col"}`}>
            {hasMessages ? (
              <>
                <ChatThread
                  messages={chat.messages}
                  isProcessing={chat.isProcessing}
                  {/* ... all props from chat state ... */}
                />
                <div className="absolute bottom-0 left-0 right-0 z-10">
                  <ChatInput
                    ref={chat.chatInputRef}
                    onSend={chat.handleSend}
                    {/* ... */}
                  />
                </div>
              </>
            ) : (
              <ChatWelcome onPromptClick={(p) => chat.handleSend(p)} hidePrompts={autocompleteOpen || inputHasContent}>
                <ChatInput ref={chat.chatInputRef} onSend={chat.handleSend} {/* ... */} />
              </ChatWelcome>
            )}
          </div>
          {/* Task/Sources panels */}
        </div>
      </main>
      {/* Segment modal + toast */}
    </div>
  );
}
```

**Step 2: Verify home page still works identically**

```bash
pnpm dev
# Full regression test on home page:
# - Welcome screen with prompts
# - Deep research flow
# - Agent timeline, task panel, sources panel
# - Follow-up actions, segment creation
# - Sidebar conversation switching
```

**Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "refactor: HomeInner consumes useChatState instead of local hooks"
```

---

## Phase 3: Page Context Injection

Make the chat aware of what page the user is on and inject that context into LLM prompts.

### Task 8: Inject page context into chat prompts

**Files:**
- Modify: `src/components/chat/chat-state-provider.tsx`
- Modify: `src/hooks/use-analytics.ts` (or wherever handleSend constructs the LLM prompt)

**Step 1: Pass pageContext from ChatPanelProvider into the analytics pipeline**

The chat needs to know the current page when sending a message. Two approaches:
- **Option A:** Read `useChatPanel().pageContext` inside ChatStateProvider — requires ChatStateProvider to be nested inside ChatPanelProvider (currently it wraps it)
- **Option B:** Have ChatStateProvider also compute pageContext from `usePathname()` directly

Go with Option B to keep providers independent.

```typescript
// In ChatStateProvider:
const pathname = usePathname();
const pageContext = useMemo(() => getPageContext(pathname), [pathname]);
```

Then pass `pageContext` to `useAnalytics` or modify `handleSend` to include it:

```typescript
// When building the LLM prompt, prepend page context:
const contextPrefix = pageContext.pageType !== "general"
  ? `[User is currently on the ${pageContext.pageLabel} page. Tailor your response accordingly.]\n\n`
  : "";
```

**Step 2: Update the classify/analyze API calls to include page context**

In `use-analytics.ts`, the `handleSend` function calls `/api/classify` and then `/api/analyze` or `/api/chat`. Add `pageContext` to the request body so the server can inject it into the Gemini prompt.

```typescript
// In the fetch body:
body: JSON.stringify({
  messages: [...],
  pageContext: { pageType, pageLabel, entity },
  // ...existing fields
})
```

**Step 3: Server-side prompt injection**

In the API route, read `pageContext` from the request body and prepend it to the system prompt:

```typescript
// In /api/analyze or /api/chat route:
const pageContextStr = pageContext?.pageType !== "general"
  ? `The user is currently viewing the ${pageContext.pageLabel} page${pageContext.entity ? ` — specifically "${pageContext.entity.name}"` : ""}. Keep this context in mind.\n`
  : "";
```

**Step 4: Commit**

```bash
git add src/components/chat/chat-state-provider.tsx src/hooks/use-analytics.ts src/app/api/analyze/route.ts src/app/api/chat/route.ts
git commit -m "feat: inject page context into LLM prompts"
```

### Task 9: Entity context from detail pages

**Files:**
- Modify: `src/components/chat/chat-panel-provider.tsx`
- Create: `src/hooks/use-page-entity.ts` (or add to existing page components)

**Step 1: Create a mechanism for detail pages to declare their entity**

Detail pages (e.g. `/segments/[id]`, `/playbooks/[id]`) know which entity they're showing. They need to push that into the chat context.

Add a `setEntity` function to ChatPanelProvider:

```typescript
// In ChatPanelProvider:
const [entity, setEntity] = useState<PageContext["entity"] | undefined>();

// Reset entity on pathname change
useEffect(() => setEntity(undefined), [pathname]);

// Include in context value
const value = useMemo(
  () => ({
    ...existingValues,
    pageContext: { ...pageContext, entity },
    setEntity,
  }),
  [/* deps */]
);
```

**Step 2: Call setEntity from detail pages**

```typescript
// In segments/[id]/page.tsx:
const { setEntity } = useChatPanel();
useEffect(() => {
  if (segment) {
    setEntity({ id: segment.id, name: segment.name, type: "segment", summary: `${segment.userCount} users` });
  }
}, [segment, setEntity]);
```

Same pattern for playbook detail, metric detail, scout detail, etc.

**Step 3: Commit**

```bash
git add src/components/chat/chat-panel-provider.tsx
git commit -m "feat: detail pages can declare entity context for chat"
```

### Task 10: Show page context badge in ChatInput

**Files:**
- Modify: `src/components/chat/chat-input.tsx`

**Step 1: Add an optional context badge below the input**

When chat is open on a non-home page, show a small context pill indicating what page the chat is aware of.

```typescript
// New prop on ChatInput:
interface ChatInputProps {
  // ...existing
  contextBadge?: { label: string; entity?: string };
}

// Render below input:
{contextBadge && (
  <div className="flex items-center gap-1.5 mt-2 px-0.5">
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium bg-foreground/[0.06] text-muted-foreground rounded-md">
      <span className="w-1.5 h-1.5 rounded-full bg-foreground/30" />
      {contextBadge.label}
    </span>
    {contextBadge.entity && (
      <span className="text-[11px] text-muted-foreground/50 truncate">
        {contextBadge.entity}
      </span>
    )}
  </div>
)}
```

**Step 2: Pass contextBadge from ChatPanel**

```typescript
<ChatInput
  contextBadge={{
    label: pageContext.pageLabel,
    entity: pageContext.entity?.name,
  }}
  // ...
/>
```

**Step 3: Commit**

```bash
git add src/components/chat/chat-input.tsx src/components/chat/chat-panel.tsx
git commit -m "feat: context badge on ChatInput showing current page awareness"
```

---

## Phase 4: Conversation Persistence Across Navigation

Ensure conversations survive route changes without losing state.

### Task 11: Verify persistence already works

**With state lifted to ChatStateProvider in LayoutShell, conversations should already persist across navigation** because the provider doesn't unmount when child pages change. This task is verification only.

**Step 1: Test navigation persistence**

```bash
pnpm dev
# 1. Go to home, start a deep research query
# 2. While streaming, click "Segments" in sidebar
# 3. Click back to home — messages should still be there
# 4. Open chat panel on /segments — same messages visible
# 5. Send a new message from the panel on /segments — works
# 6. Navigate to /metrics — panel still shows conversation
```

**Step 2: Test conversation switching**

```bash
# 1. Have 2+ conversations in sidebar
# 2. Switch between them — messages update correctly
# 3. Start new chat — clears messages, creates new conversation
# 4. Navigate away and back — new conversation persists
```

**Step 3: If issues found, fix them. If not, just commit a note.**

### Task 12: Handle active streaming during navigation

**Files:**
- Modify: `src/hooks/use-analytics.ts` (if needed)

**Problem:** If the user starts a deep research query on home, navigates to /segments, the streaming AbortController might get cleaned up. Need to verify the abort ref survives.

**Step 1: Check AbortController lifecycle**

`abortRef` is created in `useAnalytics`. Since `useAnalytics` is now called inside `ChatStateProvider` (which doesn't unmount), the abort ref should survive navigation.

**Step 2: Test active streaming navigation**

```bash
pnpm dev
# 1. Start deep research
# 2. Navigate to another page during streaming
# 3. Open chat panel — streaming should continue
# 4. Navigate back to home — streaming should still be going
# 5. Click Stop — should abort correctly
```

**Step 3: Commit if changes needed**

```bash
git add -A
git commit -m "fix: ensure streaming survives navigation via lifted state"
```

### Task 13: Save conversation on navigation (belt & suspenders)

**Files:**
- Modify: `src/hooks/use-conversation.ts` (if needed)

**Problem:** `useConversation` saves to localStorage on unmount. With the lifted provider, it only unmounts on full app close (or hard refresh). We need to also save periodically and on `beforeunload`.

**Step 1: Verify existing save logic**

`use-conversation.ts` already:
- Saves on unmount via `useEffect` cleanup
- The `flushToStorage()` pattern exists for synchronous saves

Since the provider won't unmount during navigation anymore, we need to ensure saves happen:
- After each message is added (already done via the save-after-streaming logic)
- On `beforeunload` event
- Periodically (optional, for safety)

**Step 2: Add beforeunload handler in ChatStateProvider**

```typescript
useEffect(() => {
  const save = () => flushToStorage();
  window.addEventListener("beforeunload", save);
  return () => window.removeEventListener("beforeunload", save);
}, []);
```

This may already exist in `use-conversation.ts`. Verify and add if missing.

**Step 3: Commit**

```bash
git add -A
git commit -m "fix: ensure conversation saves on beforeunload"
```

---

## Phase 5: Intersection Cards (Real Data)

Replace mock intersection cards with real data from conversation history.

### Task 14: Create intersection card data layer

**Files:**
- Create: `src/lib/intersection-cards.ts`

**Step 1: Build functions to compute intersection cards from conversation history**

```typescript
// src/lib/intersection-cards.ts

import { getConversationSummaries, loadConversation } from "@/lib/conversation-store";
import type { PageContext } from "@/lib/page-context";

export interface IntersectionCard {
  id: string;
  type: "provenance" | "related" | "pending";
  title: string;
  description: string;
  action?: string;
  conversationId?: string;
  actionPayload?: Record<string, unknown>;
}

/**
 * Compute intersection cards for the current page by scanning conversation history.
 */
export function getIntersectionCards(pageContext: PageContext): IntersectionCard[] {
  const cards: IntersectionCard[] = [];

  // Type 1: Provenance — entities created from conversations
  cards.push(...getProvenanceCards(pageContext));

  // Type 3: Pending actions — unacted follow-up suggestions
  cards.push(...getPendingActionCards(pageContext));

  // Type 2: Thematic relevance — conversations topically related to current page
  cards.push(...getRelatedCards(pageContext));

  return cards.slice(0, 5); // Cap at 5 cards to avoid clutter
}
```

**Step 2: Implement getProvenanceCards**

Scan segments for `sourceConversationId`, canvas items for `sourceConversationId`, etc. Match against current pageType.

**Step 3: Implement getPendingActionCards**

Scan all conversations for `followUpActions` that haven't been acted on. Match against current pageType:
- `create-segment` actions → show on `/segments`
- `view-in-store` actions → show on `/store`
- Research with many queries but no saved playbook → show on `/playbooks`

**Step 4: Implement getRelatedCards**

Scan conversation messages for agent IDs that map to current page:
- `cohort-retention` / `user-segmentation` agents → relevant to `/segments`
- `rev-opt` agent → relevant to `/store`
- `daily-metrics` agent → relevant to `/metrics`

**Step 5: Commit**

```bash
git add src/lib/intersection-cards.ts
git commit -m "feat: intersection card data layer with provenance, pending, and related types"
```

### Task 15: Wire intersection cards into ChatPanel

**Files:**
- Modify: `src/components/chat/chat-panel.tsx`

**Step 1: Replace getMockIntersections with getIntersectionCards**

```typescript
import { getIntersectionCards } from "@/lib/intersection-cards";

// In ChatPanel:
const intersections = useMemo(
  () => getIntersectionCards(pageContext),
  [pageContext]
);
```

**Step 2: Wire action buttons on intersection cards**

When user clicks an intersection card action (e.g. "Create segment", "Open research"), trigger the appropriate handler:
- "Resume conversation" → switch to that conversation
- "Create segment" → open segment modal
- "Save as playbook" → trigger playbook creation

**Step 3: Commit**

```bash
git add src/components/chat/chat-panel.tsx
git commit -m "feat: wire real intersection cards into chat panel"
```

---

## Phase 6: Polish & Edge Cases

### Task 16: Panel behavior on home page

**Files:**
- Modify: `src/components/chat/chat-panel-provider.tsx`
- Modify: `src/components/chat/chat-fab.tsx`

**Step 1: Decide home page behavior**

Currently: FAB hidden on home, panel forced closed. This is correct — home page IS the full chat experience. No changes needed unless we want the panel to also be available on home for a secondary conversation (future consideration).

**Step 2: Verify no conflicts**

```bash
pnpm dev
# Home page: no FAB, no panel, full-page chat works
# Any other page: FAB visible, panel works
```

### Task 17: Panel ↔ Home page conversation sync

**Files:**
- Modify: `src/components/chat/chat-panel.tsx` (if needed)

**Problem:** User opens panel on /segments, starts a conversation. Then navigates to home. The home page should show the same conversation (since they share ChatStateProvider).

**Step 1: Verify this already works**

Since both home page and panel consume `useChatState()`, they share the same messages array. This should work automatically.

**Step 2: Test**

```bash
pnpm dev
# 1. Open panel on /segments
# 2. Send a message
# 3. Navigate to home — should see the same conversation
# 4. Send another message on home
# 5. Navigate to /segments, open panel — should see both messages
```

### Task 18: Keyboard shortcut to toggle panel

**Files:**
- Modify: `src/components/chat/chat-panel-provider.tsx`

**Step 1: Add Cmd+K or similar shortcut**

```typescript
// In ChatPanelProvider:
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "j") {
      e.preventDefault();
      if (!isHomePage) toggle();
    }
  };
  document.addEventListener("keydown", handler);
  return () => document.removeEventListener("keydown", handler);
}, [isHomePage, toggle]);
```

Use Cmd+J (not Cmd+K which is often used for command palettes).

**Step 2: Commit**

```bash
git add src/components/chat/chat-panel-provider.tsx
git commit -m "feat: Cmd+J keyboard shortcut to toggle chat panel"
```

---

## Implementation Order Summary

| Phase | Tasks | Dependencies | Effort |
|-------|-------|-------------|--------|
| 1. Global State | Tasks 1-4 | None | Large — biggest refactor |
| 2. Wire Panel | Tasks 5-7 | Phase 1 | Medium |
| 3. Page Context | Tasks 8-10 | Phase 1 | Medium |
| 4. Persistence | Tasks 11-13 | Phase 1 | Small — mostly verification |
| 5. Intersections | Tasks 14-15 | Phase 2 | Medium |
| 6. Polish | Tasks 16-18 | All above | Small |

**Critical path:** Phase 1 → Phase 2 → test. Phases 3-6 can be parallelized after Phase 2.

**Estimated total:** 18 tasks across 6 phases. Phase 1 is the riskiest (large refactor touching core state). Recommend committing frequently and testing after each task.

---

## Open Decisions (resolve during implementation)

1. **Task/Sources panel in sidebar mode:** When chat panel is open on a non-home page, should clicking "View Sources" open a sources panel inside the chat panel, or should it only work on the home page full-screen view?
   - Recommendation: Hide task/sources panel in panel mode for now. Only show on home full-screen.

2. **Deep research in panel:** The 400px panel is narrow for the full agent timeline + report. Options:
   - Allow it but render compact
   - Auto-expand to full screen for deep research
   - Only allow quick answers in panel
   - Recommendation: Allow it — ChatThread already handles narrow widths. The minimap is hidden (`hideMinimap={true}`).

3. **Conversation scope:** Should panel conversations be separate from home conversations, or shared?
   - Recommendation: Shared. One conversation at a time, visible everywhere. User can switch via sidebar.
