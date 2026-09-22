# Intersection Cards Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build rich intersection cards that surface provenance, thematic relevance, and pending actions in the chat panel — turning it from a passive input box into a proactive assistant that shows connections between what the user has already discovered and what they're currently looking at.

**Architecture:** Extend existing data models (`Conversation`, `PlaybookV2`, `KnowledgeEntry`) with provenance and tagging fields. Derive conversation tags at save time from message data (agent IDs, follow-up action types, metric references). Track pending action completion state. Rewrite `intersection-cards.ts` to produce rich, type-specific cards using real data. Build new card UI components in the chat panel.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS v4, localStorage persistence, in-memory stores

---

## Phase 1: Data Model Extensions

### Task 1: Add tags and pendingActions to Conversation type

**Files:**
- Modify: `src/lib/conversation-types.ts`

**Step 1: Add new fields to Conversation interface**

```typescript
// src/lib/conversation-types.ts
import type { ChatMessage } from "@/lib/types";

/** Derived tag representing a thematic domain this conversation touches */
export interface ConversationTag {
  domain: string;          // e.g. "segments", "metrics", "store", "retention"
  source: "agent" | "action" | "metric" | "keyword";
  weight: number;          // 0-1 relevance score (1 = direct, 0.5 = indirect)
}

/** A pending action that was suggested but not yet completed */
export interface PendingAction {
  id: string;
  type: string;            // follow-up action type e.g. "create-segment"
  label: string;
  messageId: string;       // which message suggested this
  createdAt: number;
  completedAt?: number;    // set when user acts on it
  dismissedAt?: number;    // set when user dismisses it
  payload?: Record<string, unknown>;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  sourceCanvasItemId?: string;
  datasetId?: string;
  /** Derived thematic tags for intersection matching */
  tags?: ConversationTag[];
  /** Follow-up actions that haven't been completed */
  pendingActions?: PendingAction[];
}

export interface ConversationSummary {
  id: string;
  title: string;
  datasetId?: string;
}
```

**Step 2: Verify the app still builds**

Run: `pnpm build`
Expected: Build succeeds (new optional fields don't break existing code)

**Step 3: Commit**

```bash
git add src/lib/conversation-types.ts
git commit -m "feat: add tags and pendingActions to Conversation type"
```

---

### Task 2: Add sourceConversationId to PlaybookV2

**Files:**
- Modify: `src/lib/playbook-types.ts`

**Step 1: Add field to PlaybookV2 interface**

Find the `PlaybookV2` interface and add after `changelog`:

```typescript
  /** ID of the conversation this playbook was built from */
  sourceConversationId?: string;
  /** The original user query that triggered the research */
  sourceQuery?: string;
```

**Step 2: Verify build**

Run: `pnpm build`
Expected: PASS

**Step 3: Commit**

```bash
git add src/lib/playbook-types.ts
git commit -m "feat: add sourceConversationId to PlaybookV2"
```

---

### Task 3: Add sourceConversationId to KnowledgeEntry

**Files:**
- Modify: `src/lib/knowledge-types.ts`

**Step 1: Add field to KnowledgeEntry interface**

Add after `referenceThread`:

```typescript
  /** ID of the conversation this knowledge was saved from */
  sourceConversationId?: string;
```

**Step 2: Verify build**

Run: `pnpm build`
Expected: PASS

**Step 3: Commit**

```bash
git add src/lib/knowledge-types.ts
git commit -m "feat: add sourceConversationId to KnowledgeEntry"
```

---

## Phase 2: Wire Provenance at Creation Time

### Task 4: Pass conversationId when saving playbooks

**Files:**
- Modify: `src/lib/playbook-builder.ts`
- Modify: `src/components/chat/chat-state-provider.tsx`

**Step 1: Add conversationId param to buildPlaybookFromResearch**

In `src/lib/playbook-builder.ts`, change the function signature and add the field to the returned playbook:

```typescript
export function buildPlaybookFromResearch(
  messages: ChatMessage[],
  userQuery: string,
  sourceConversationId?: string
): PlaybookV2 | null {
```

And in the return object (around line 94), add:

```typescript
  return {
    id: pbId,
    // ... existing fields ...
    changelog: [],
    sourceConversationId,
    sourceQuery: userQuery,
  };
```

**Step 2: Pass activeConvId in chat-state-provider**

In `src/components/chat/chat-state-provider.tsx`, find `handleSaveAsPlaybook` (around line 316). Change:

```typescript
const playbook = buildPlaybookFromResearch(messages, userQuery);
```

to:

```typescript
const playbook = buildPlaybookFromResearch(messages, userQuery, activeConvId ?? undefined);
```

**Step 3: Verify build**

Run: `pnpm build`
Expected: PASS

**Step 4: Commit**

```bash
git add src/lib/playbook-builder.ts src/components/chat/chat-state-provider.tsx
git commit -m "feat: pass sourceConversationId when building playbooks from research"
```

---

### Task 5: Pass conversationId when saving knowledge

**Files:**
- Modify: `src/components/chat/chat-state-provider.tsx`
- Modify: `src/app/api/knowledge/add/route.ts` (if it exists, otherwise skip API)

**Step 1: Update handleSaveToKnowledge to pass conversationId**

Find `handleSaveToKnowledge` (around line 345) in `src/components/chat/chat-state-provider.tsx`. Update the body:

```typescript
const handleSaveToKnowledge = useCallback(
  async (content: string, level: "global" | "user") => {
    try {
      const res = await fetch("/api/knowledge/add", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...modelHeaders },
        body: JSON.stringify({
          content,
          priority: "High",
          level,
          sourceConversationId: activeConvId ?? undefined,
        }),
      });
      if (res.ok) {
        const { entry } = await res.json();
        const { saveKnowledgeEntry } = await import("@/lib/knowledge-store");
        saveKnowledgeEntry({ ...entry, sourceConversationId: activeConvId ?? undefined });
      }
    } catch (err) {
      console.error("Failed to save knowledge:", err);
      toast.error("Failed to save to knowledge base.");
    }
  },
  [modelHeaders, activeConvId]
);
```

**Step 2: Verify build**

Run: `pnpm build`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/chat/chat-state-provider.tsx
git commit -m "feat: pass sourceConversationId when saving knowledge entries"
```

---

## Phase 3: Conversation Tagging

### Task 6: Create tag derivation utility

**Files:**
- Create: `src/lib/conversation-tagger.ts`

**Step 1: Implement the tagger**

This module derives tags from existing message data — no LLM call needed.

```typescript
// src/lib/conversation-tagger.ts

import type { ChatMessage } from "@/lib/types";
import type { ConversationTag } from "@/lib/conversation-types";

/**
 * Agent ID → thematic domain mapping.
 * Each agent implies relevance to certain page types.
 */
const AGENT_DOMAIN_MAP: Record<string, string[]> = {
  "data-quality": ["data-catalog"],
  "daily-metrics": ["metrics", "forecasting"],
  "cohort-retention": ["segments", "metrics"],
  "rev-opt": ["store", "metrics"],
  "user-segmentation": ["segments"],
  "geographic": ["store"],
  "critique": [],
};

/**
 * Follow-up action type → domain mapping.
 */
const ACTION_DOMAIN_MAP: Record<string, string[]> = {
  "create-segment": ["segments"],
  "create-segment-clevertap": ["segments", "connectors"],
  "create-segment-firebase": ["segments", "connectors"],
  "create-segment-bigquery": ["segments"],
  "view-in-store": ["store"],
  "follow-up-question": [],
};

/**
 * Derive thematic tags from conversation messages.
 * Called at save time — no LLM, purely heuristic.
 */
export function deriveConversationTags(messages: ChatMessage[]): ConversationTag[] {
  const tagMap = new Map<string, ConversationTag>();

  const addTag = (domain: string, source: ConversationTag["source"], weight: number) => {
    const existing = tagMap.get(domain);
    if (existing) {
      // Keep highest weight
      if (weight > existing.weight) {
        tagMap.set(domain, { domain, source, weight });
      }
    } else {
      tagMap.set(domain, { domain, source, weight });
    }
  };

  for (const msg of messages) {
    // 1. Agent subagent IDs → domain tags
    if (msg.agent?.subagents) {
      for (const sub of msg.agent.subagents) {
        const domains = AGENT_DOMAIN_MAP[sub.id];
        if (domains) {
          for (const d of domains) {
            addTag(d, "agent", 0.8);
          }
        }
      }
    }

    // 2. Follow-up action types → domain tags
    if (msg.followUpActions) {
      for (const action of msg.followUpActions) {
        const domains = ACTION_DOMAIN_MAP[action.type];
        if (domains) {
          for (const d of domains) {
            addTag(d, "action", 1.0); // direct intent signal
          }
        }
      }
    }

    // 3. MetricContext → metrics tag
    if (msg.metricContext?.metricId) {
      addTag("metrics", "metric", 1.0);
    }

    // 4. Connector info → connectors tag
    if (msg.connectorInfo) {
      addTag("connectors", "keyword", 0.7);
    }
  }

  return Array.from(tagMap.values());
}
```

**Step 2: Verify build**

Run: `pnpm build`
Expected: PASS

**Step 3: Commit**

```bash
git add src/lib/conversation-tagger.ts
git commit -m "feat: add conversation tag derivation utility"
```

---

### Task 7: Tag conversations at save time

**Files:**
- Modify: `src/lib/conversation-store.ts`

**Step 1: Read the file first**

Read `src/lib/conversation-store.ts` to understand the save flow.

**Step 2: Import tagger and call it in saveConversation/updateConversationMessages**

At the top of `conversation-store.ts`, add:

```typescript
import { deriveConversationTags } from "@/lib/conversation-tagger";
```

In `saveConversation(conv)`, before `conversationMap.set(...)`:

```typescript
export function saveConversation(conv: Conversation): void {
  ensureInitialized();
  // Derive tags from message content
  const tags = deriveConversationTags(conv.messages);
  conversationMap.set(conv.id, { ...conv, tags });
  persistToStorage();
}
```

In `updateConversationMessages(id, messages)`, before `conversationMap.set(...)`:

```typescript
  const tags = deriveConversationTags(strippedMessages);
  conversationMap.set(id, {
    ...existing,
    messages: strippedMessages,
    tags,
    updatedAt: Date.now(),
  });
```

(Where `strippedMessages` is the result of `stripVolatileVariants(messages)`.)

**Step 3: Verify build**

Run: `pnpm build`
Expected: PASS

**Step 4: Commit**

```bash
git add src/lib/conversation-store.ts
git commit -m "feat: derive and persist conversation tags at save time"
```

---

### Task 8: Track pending actions at save time

**Files:**
- Modify: `src/lib/conversation-store.ts`

**Step 1: Create a pending action extraction helper**

Add to `conversation-store.ts` (or a new util if preferred, but keeping it in-store is simpler):

```typescript
import type { PendingAction } from "@/lib/conversation-types";

function extractPendingActions(messages: ChatMessage[], existing?: PendingAction[]): PendingAction[] {
  const existingMap = new Map((existing || []).map(a => [a.id, a]));

  for (const msg of messages) {
    if (!msg.followUpActions) continue;
    for (const action of msg.followUpActions) {
      // Skip generic follow-up questions
      if (action.type === "follow-up-question") continue;

      const key = `${msg.id}-${action.id}`;
      if (!existingMap.has(key)) {
        existingMap.set(key, {
          id: key,
          type: action.type,
          label: action.label,
          messageId: msg.id,
          createdAt: msg.timestamp,
          payload: action.payload,
        });
      }
    }
  }

  return Array.from(existingMap.values());
}
```

**Step 2: Call it in saveConversation and updateConversationMessages**

Update both functions to also compute `pendingActions`:

```typescript
const pendingActions = extractPendingActions(conv.messages, conv.pendingActions);
conversationMap.set(conv.id, { ...conv, tags, pendingActions });
```

And in `updateConversationMessages`:

```typescript
const pendingActions = extractPendingActions(strippedMessages, existing.pendingActions);
conversationMap.set(id, {
  ...existing,
  messages: strippedMessages,
  tags,
  pendingActions,
  updatedAt: Date.now(),
});
```

**Step 3: Verify build**

Run: `pnpm build`
Expected: PASS

**Step 4: Commit**

```bash
git add src/lib/conversation-store.ts
git commit -m "feat: extract and persist pending actions at save time"
```

---

### Task 9: Add function to mark pending actions as completed

**Files:**
- Modify: `src/lib/conversation-store.ts`

**Step 1: Add markPendingActionCompleted export**

```typescript
/**
 * Mark a pending action as completed (or dismissed).
 * Call this when the user acts on a follow-up suggestion.
 */
export function markPendingAction(
  conversationId: string,
  actionId: string,
  status: "completed" | "dismissed"
): boolean {
  ensureInitialized();
  const conv = conversationMap.get(conversationId);
  if (!conv?.pendingActions) return false;

  const action = conv.pendingActions.find(a => a.id === actionId);
  if (!action) return false;

  if (status === "completed") {
    action.completedAt = Date.now();
  } else {
    action.dismissedAt = Date.now();
  }

  persistToStorage();
  return true;
}
```

**Step 2: Verify build**

Run: `pnpm build`
Expected: PASS

**Step 3: Commit**

```bash
git add src/lib/conversation-store.ts
git commit -m "feat: add markPendingAction to conversation store"
```

---

## Phase 4: Rewrite Intersection Cards

### Task 10: Rewrite intersection-cards.ts with rich data

**Files:**
- Modify: `src/lib/intersection-cards.ts`

**Step 1: Read current file, then rewrite with rich card types**

```typescript
/**
 * Intersection cards — surface connections between conversation history
 * and the current page. Three types:
 *   1. Provenance — entities created from conversations
 *   2. Pending — unacted follow-up actions relevant to current page
 *   3. Related — conversations thematically relevant to current page
 */

import { getAllConversations } from "@/lib/conversation-store";
import { getSavedPlaybookSummaries } from "@/lib/playbook-store";
import { getAllEntries } from "@/lib/knowledge-store";
import { getAllCanvasItems } from "@/lib/canvas-store";
import type { PageContext } from "@/lib/page-context";

export interface IntersectionCard {
  id: string;
  type: "provenance" | "related" | "pending";
  title: string;
  description: string;
  /** Optional CTA label */
  action?: string;
  /** Conversation this card references */
  conversationId?: string;
  /** Optional metadata for richer display */
  meta?: {
    agentCount?: number;
    queryCount?: number;
    timeAgo?: string;
    entityName?: string;
    actionType?: string;
    /** For pending actions — the action payload */
    payload?: Record<string, unknown>;
    /** For pending actions — the pending action ID for dismissal */
    pendingActionId?: string;
  };
}

// Follow-up action type → page type mapping
const ACTION_PAGE_MAP: Record<string, string[]> = {
  "create-segment": ["segments"],
  "create-segment-clevertap": ["segments"],
  "create-segment-firebase": ["segments"],
  "create-segment-bigquery": ["segments"],
  "view-in-store": ["store"],
};

function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

/**
 * Get intersection cards for the current page context.
 * Scans conversation history, playbooks, knowledge, and canvas for connections.
 */
export function getIntersectionCards(pageContext: PageContext): IntersectionCard[] {
  const cards: IntersectionCard[] = [];
  const { pageType } = pageContext;

  // Skip on home/general pages
  if (pageType === "general") return [];

  let conversations;
  try {
    conversations = getAllConversations();
  } catch {
    return [];
  }

  if (conversations.length === 0) return [];

  const seenConvIds = new Set<string>();

  // ── Type 3: Pending actions — unacted follow-ups relevant to this page ──
  for (const conv of conversations) {
    if (!conv.pendingActions?.length) continue;
    for (const pa of conv.pendingActions) {
      // Skip completed or dismissed
      if (pa.completedAt || pa.dismissedAt) continue;

      const targetPages = ACTION_PAGE_MAP[pa.type];
      if (!targetPages?.includes(pageType)) continue;

      seenConvIds.add(conv.id);
      cards.push({
        id: `pending-${pa.id}`,
        type: "pending",
        title: pa.label,
        description: `From "${conv.title}"`,
        action: pa.type.includes("segment") ? "Create" : "View",
        conversationId: conv.id,
        meta: {
          timeAgo: timeAgo(pa.createdAt),
          actionType: pa.type,
          payload: pa.payload,
          pendingActionId: pa.id,
        },
      });
    }
  }

  // ── Type 1: Provenance — entities on this page that were created from conversations ──

  if (pageType === "playbooks") {
    // Find playbooks with sourceConversationId
    try {
      const playbooks = getSavedPlaybookSummaries();
      for (const pb of playbooks) {
        // getSavedPlaybookSummaries returns summaries; we need to check full playbooks
        // This is a lightweight check — summaries don't have sourceConversationId
        // We'll check the title against conversation titles as a fallback
      }
    } catch { /* store may not be initialized */ }
  }

  if (pageType === "canvas") {
    try {
      const items = getAllCanvasItems();
      for (const item of items) {
        if (!item.sourceConversationId) continue;
        if (seenConvIds.has(item.sourceConversationId)) continue;

        const conv = conversations.find(c => c.id === item.sourceConversationId);
        if (!conv) continue;

        seenConvIds.add(conv.id);
        cards.push({
          id: `provenance-canvas-${item.id}`,
          type: "provenance",
          title: item.title,
          description: `Pinned from "${conv.title}"`,
          action: "See research",
          conversationId: conv.id,
          meta: { timeAgo: timeAgo(conv.updatedAt) },
        });
      }
    } catch { /* store may not be initialized */ }
  }

  if (pageType === "knowledge") {
    try {
      const entries = getAllEntries();
      for (const entry of entries) {
        const convId = entry.sourceConversationId;
        if (!convId) continue;
        if (seenConvIds.has(convId)) continue;

        const conv = conversations.find(c => c.id === convId);
        if (!conv) continue;

        seenConvIds.add(convId);
        cards.push({
          id: `provenance-knowledge-${entry.id}`,
          type: "provenance",
          title: entry.content.slice(0, 60) + (entry.content.length > 60 ? "..." : ""),
          description: `Saved from "${conv.title}"`,
          action: "See in context",
          conversationId: convId,
          meta: { timeAgo: timeAgo(conv.updatedAt) },
        });
      }
    } catch { /* store may not be initialized */ }
  }

  // Entity-level provenance: if we're on a detail page with an entity
  if (pageContext.entity) {
    const entity = pageContext.entity;

    // Segments: check sourceConversationId (stored in the segment, not in conversation)
    // This is surfaced by the segment detail page via entity context

    // Playbooks: check sourceConversationId on the playbook
    if (entity.type === "playbook") {
      // The playbook detail page sets entity — we can look up the playbook
      // But we don't have the full playbook here. The detail page should
      // inject provenance info via the entity.summary or a separate mechanism.
    }

    // Metrics: find conversations that discussed this metric
    if (entity.type === "metric") {
      for (const conv of conversations) {
        if (seenConvIds.has(conv.id)) continue;
        const mentionsMetric = conv.messages?.some(
          m => m.metricContext?.metricId === entity.id
        );
        if (mentionsMetric) {
          seenConvIds.add(conv.id);
          cards.push({
            id: `provenance-metric-${conv.id}`,
            type: "provenance",
            title: conv.title,
            description: `Referenced "${entity.name}" in analysis`,
            action: "Open",
            conversationId: conv.id,
            meta: { timeAgo: timeAgo(conv.updatedAt) },
          });
        }
      }
    }
  }

  // ── Type 2: Thematic relevance — conversations tagged with this page's domain ──
  for (const conv of conversations) {
    if (seenConvIds.has(conv.id)) continue;

    // Use tags if available (new system)
    if (conv.tags?.length) {
      const matchingTag = conv.tags.find(t => t.domain === pageType);
      if (matchingTag && matchingTag.weight >= 0.5) {
        const agentMsg = conv.messages?.find(m => m.role === "agent" && m.agent);
        const queryCount = agentMsg?.agent?.subagents.reduce(
          (sum, s) => sum + (s.queries?.length || 0), 0
        ) || 0;
        const agentCount = agentMsg?.agent?.subagents.length || 0;

        seenConvIds.add(conv.id);
        cards.push({
          id: `related-${conv.id}`,
          type: "related",
          title: conv.title,
          description: queryCount > 0
            ? `${queryCount} queries, ${agentCount} agents`
            : "Related research",
          action: "Open",
          conversationId: conv.id,
          meta: {
            queryCount,
            agentCount,
            timeAgo: timeAgo(conv.updatedAt),
          },
        });
      }
      continue; // Tags exist, trust them over agent heuristic
    }

    // Fallback: agent ID heuristic (for pre-tagged conversations)
    if (!conv.messages?.length) continue;
    const agentMsgs = conv.messages.filter(
      m => m.role === "agent" && m.agent?.subagents?.length
    );
    for (const agentMsg of agentMsgs) {
      const subagentIds = agentMsg.agent!.subagents.map(s => s.id);
      const AGENT_PAGE_MAP: Record<string, string[]> = {
        "data-quality": ["data-catalog"],
        "daily-metrics": ["metrics", "forecasting"],
        "cohort-retention": ["segments"],
        "rev-opt": ["store"],
        "user-segmentation": ["segments"],
        "geographic": ["store"],
      };
      const matching = subagentIds.filter(id => AGENT_PAGE_MAP[id]?.includes(pageType));
      if (matching.length > 0) {
        const queryCount = agentMsg.agent!.subagents.reduce(
          (sum, s) => sum + (s.queries?.length || 0), 0
        );
        seenConvIds.add(conv.id);
        cards.push({
          id: `related-${conv.id}`,
          type: "related",
          title: conv.title,
          description: `${queryCount} queries across ${subagentIds.length} agents`,
          action: "Open",
          conversationId: conv.id,
          meta: {
            queryCount,
            agentCount: subagentIds.length,
            timeAgo: timeAgo(conv.updatedAt),
          },
        });
        break;
      }
    }
  }

  // Prioritize: pending > provenance > related
  const priority: Record<string, number> = { pending: 0, provenance: 1, related: 2 };
  cards.sort((a, b) => priority[a.type] - priority[b.type]);

  return cards.slice(0, 5);
}
```

**Step 2: Verify build**

Run: `pnpm build`
Expected: PASS

**Step 3: Commit**

```bash
git add src/lib/intersection-cards.ts
git commit -m "feat: rewrite intersection cards with provenance, tags, and pending actions"
```

---

## Phase 5: Enhanced Card UI

### Task 11: Update IntersectionCardComponent in chat-panel.tsx

**Files:**
- Modify: `src/components/chat/chat-panel.tsx`

**Step 1: Read the current file, then update the IntersectionCardComponent**

Replace the existing `IntersectionCardComponent` (around line 359-378) with a richer version:

```tsx
function IntersectionCardComponent({
  card,
  onAction,
}: {
  card: IntersectionCard;
  onAction?: (card: IntersectionCard) => void;
}) {
  const TYPE_STYLES: Record<string, string> = {
    provenance: "bg-foreground/[0.06] text-foreground/70",
    related: "bg-foreground/[0.06] text-foreground/70",
    pending: "bg-foreground/[0.08] text-foreground/80",
  };
  const TYPE_LABELS: Record<string, string> = {
    provenance: "Origin",
    related: "Related",
    pending: "Action",
  };

  return (
    <button
      onClick={() => onAction?.(card)}
      className="w-full flex items-start gap-2 p-2.5 rounded-lg border border-border hover:border-foreground/20 hover:bg-muted/50 transition-all text-left group"
    >
      <span
        className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded shrink-0 mt-0.5 ${TYPE_STYLES[card.type]}`}
      >
        {TYPE_LABELS[card.type]}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium text-foreground leading-tight line-clamp-1">
          {card.title}
        </p>
        <p className="text-[11px] text-muted-foreground/70 mt-0.5 leading-relaxed line-clamp-1">
          {card.description}
          {card.meta?.timeAgo && (
            <span className="text-muted-foreground/50"> · {card.meta.timeAgo}</span>
          )}
        </p>
      </div>
      {card.action && (
        <span className="text-[11px] font-medium text-muted-foreground/50 group-hover:text-foreground transition-colors shrink-0 mt-0.5">
          {card.action} &rarr;
        </span>
      )}
    </button>
  );
}
```

**Step 2: Move TYPE_STYLES and TYPE_LABELS inside the component or remove the module-level ones**

Remove the module-level `TYPE_STYLES` and `TYPE_LABELS` constants (lines 15-25) since they're now inside the component.

**Step 3: Wire onAction in EmptyState**

In the `EmptyState` component, add an `onAction` handler and pass it through. The handler should load the referenced conversation:

```tsx
function EmptyState({
  pageContext,
  onSend,
  onLoadConversation,
}: {
  pageContext: PageContext;
  onSend: (text: string) => void;
  onLoadConversation?: (conversationId: string) => void;
}) {
```

And in the intersection card rendering:

```tsx
{intersections.slice(0, 2).map((card) => (
  <IntersectionCardComponent
    key={card.id}
    card={card}
    onAction={(c) => {
      if (c.conversationId && onLoadConversation) {
        onLoadConversation(c.conversationId);
      }
    }}
  />
))}
```

**Step 4: Pass onLoadConversation from ChatContent**

In `ChatContent`, pass a handler that loads the conversation. This uses the existing `handleNewChat` or a router push:

```tsx
<EmptyState
  pageContext={pageContext}
  onSend={chat.handleSend}
  onLoadConversation={(convId) => {
    // Load conversation into chat panel
    // This needs to be wired to chat state
  }}
/>
```

Note: Full conversation loading (resuming a conversation from its ID) may require additional work in chat-state-provider. For now, the card click can be a no-op or navigate to `/?conv=<id>`. This is acceptable for the initial implementation.

**Step 5: Verify build**

Run: `pnpm build`
Expected: PASS

**Step 6: Commit**

```bash
git add src/components/chat/chat-panel.tsx
git commit -m "feat: enhanced intersection card UI with rich metadata"
```

---

### Task 12: Mark pending actions as completed on follow-up action clicks

**Files:**
- Modify: `src/components/chat/chat-state-provider.tsx`

**Step 1: Read the handleFollowUpAction function**

Find `handleFollowUpAction` in `chat-state-provider.tsx`.

**Step 2: Add completion tracking**

After the action is executed successfully (e.g., after segment creation, store navigation), call `markPendingAction`:

```typescript
import { markPendingAction } from "@/lib/conversation-store";

// Inside handleFollowUpAction, after the action executes:
if (activeConvId) {
  // Find the pending action that matches this follow-up
  const conv = getConversation(activeConvId);
  const matching = conv?.pendingActions?.find(
    pa => pa.type === action.type && !pa.completedAt && !pa.dismissedAt
  );
  if (matching) {
    markPendingAction(activeConvId, matching.id, "completed");
  }
}
```

**Step 3: Verify build**

Run: `pnpm build`
Expected: PASS

**Step 4: Commit**

```bash
git add src/components/chat/chat-state-provider.tsx
git commit -m "feat: mark pending actions as completed when follow-ups are acted on"
```

---

## Phase 6: Connectors Intersection (Bonus)

### Task 13: Track blocked-by-connector conversations

**Files:**
- Modify: `src/lib/intersection-cards.ts`

**Step 1: Add connector tracking to getIntersectionCards**

In `getIntersectionCards`, add a section for the `connectors` page type:

```typescript
// ── Connectors page: conversations blocked by missing connectors ──
if (pageType === "connectors") {
  const blockedByConnector = new Map<string, string[]>(); // connectorName → convTitles

  for (const conv of conversations) {
    if (!conv.messages?.length) continue;
    for (const msg of conv.messages) {
      if (msg.connectorInfo?.name) {
        const name = msg.connectorInfo.name;
        const titles = blockedByConnector.get(name) || [];
        if (!titles.includes(conv.title)) {
          titles.push(conv.title);
          blockedByConnector.set(name, titles);
        }
      }
    }
  }

  for (const [connectorName, titles] of blockedByConnector) {
    cards.push({
      id: `pending-connector-${connectorName}`,
      type: "pending",
      title: `Connect ${connectorName}`,
      description: `${titles.length} conversation${titles.length > 1 ? "s" : ""} limited by missing data`,
      action: "Connect",
      meta: {
        actionType: "connect",
        entityName: connectorName,
      },
    });
  }
}
```

**Step 2: Verify build**

Run: `pnpm build`
Expected: PASS

**Step 3: Commit**

```bash
git add src/lib/intersection-cards.ts
git commit -m "feat: surface blocked-by-connector conversations on connectors page"
```

---

## Phase 7: Verification

### Task 14: End-to-end manual verification

**Step 1: Start dev server**

Run: `pnpm dev`

**Step 2: Test provenance flow**

1. Go to `/` (home page)
2. Run a deep research query
3. Click "Save as Playbook" from the response
4. Navigate to `/playbooks` — check that the chat panel shows a provenance card linking back to the conversation

**Step 3: Test pending actions flow**

1. Run a query that produces "Create Segment" follow-up actions
2. Don't click the action
3. Navigate to `/segments`
4. Open chat panel — verify a pending action card appears
5. Go back, click "Create Segment" on the response
6. Navigate to `/segments` again — pending card should be gone (marked completed)

**Step 4: Test thematic relevance flow**

1. Run a deep research query that activates `cohort-retention` and `user-segmentation` agents
2. Navigate to `/segments`
3. Open chat panel — verify a "Related" card appears referencing the conversation

**Step 5: Test connectors flow**

1. If a conversation has `connectorInfo` messages, navigate to `/connectors`
2. Verify blocked-connector cards appear

**Step 6: Commit all changes**

```bash
git add -A
git commit -m "feat: intersection cards — provenance, tags, pending actions"
```

---

## Summary

| Phase | Tasks | What it does |
|-------|-------|-------------|
| 1. Data Models | 1-3 | Add `tags[]`, `pendingActions[]` to Conversation; `sourceConversationId` to Playbook and Knowledge |
| 2. Provenance Wiring | 4-5 | Pass conversation ID when creating playbooks and knowledge entries |
| 3. Tagging | 6-8 | Derive tags from agent IDs, action types, metric refs at save time; extract pending actions |
| 4. Completion Tracking | 9 | Mark pending actions as completed/dismissed |
| 5. Intersection Rewrite | 10 | Rich intersection cards using tags, provenance links, and pending action state |
| 6. UI | 11-12 | Enhanced card component with metadata, action callbacks, completion tracking |
| 7. Connectors | 13 | Surface blocked-by-connector conversations |
| 8. Verification | 14 | Manual end-to-end testing |
