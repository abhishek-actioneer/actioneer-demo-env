# Unified Actions & Response Footer Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the dual action-pill + follow-up system with a unified Next Steps card, add a ChatGPT-style response footer (credits, feedback, copy, share), and kill the heuristic fallback so only the LLM generates suggestions.

**Architecture:** Three layers change: (1) new `ResponseFooter` component replaces `MessageMeta`, (2) new `NextSteps` component replaces both `InlineActions` and `SuggestedFollowUps`, (3) backend prompt simplified to emit only working action types in a unified array. The heuristic system (`action-heuristic.ts`, `mergeSegmentActions`) is deleted entirely.

**Tech Stack:** React 19, Tailwind CSS v4, lucide-react icons, Next.js App Router

---

## Task 1: Create `ResponseFooter` Component

**Files:**
- Create: `src/components/chat/response-footer.tsx`

**Step 1: Create the component file**

```tsx
"use client";

import { useState } from "react";
import { Zap, ThumbsUp, ThumbsDown, Copy, Check } from "lucide-react";
import type { ChatMessage } from "@/lib/types";

// Reuse the SlackIcon SVG from inline-actions.tsx (will be the only survivor)
function SlackIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#E01E5A"/>
      <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.527 2.527 0 0 1 2.521 2.521 2.527 2.527 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36C5F0"/>
      <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.27 0a2.528 2.528 0 0 1-2.522 2.521 2.527 2.527 0 0 1-2.521-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.522 2.522v6.312z" fill="#2EB67D"/>
      <path d="M15.165 18.956a2.528 2.528 0 0 1 2.522 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.521-2.522v-2.522h2.521zm0-1.27a2.527 2.527 0 0 1-2.521-2.522 2.528 2.528 0 0 1 2.521-2.522h6.313A2.528 2.528 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.521h-6.313z" fill="#ECB22E"/>
    </svg>
  );
}

interface ResponseFooterProps {
  message: ChatMessage;
}

export function ResponseFooter({ message }: ResponseFooterProps) {
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const [copied, setCopied] = useState(false);

  if (message.role === "user") return null;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleFeedback = (value: "up" | "down") => {
    setFeedback((prev) => (prev === value ? null : value));
  };

  const iconBtn =
    "p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground";

  return (
    <div className="flex items-center justify-end gap-1 mt-1.5">
      {message.creditCost != null && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground mr-1">
          <Zap className="w-3 h-3" />
          {message.creditCost} credits
        </span>
      )}

      <button onClick={() => handleFeedback("up")} className={iconBtn} aria-label="Good response">
        <ThumbsUp className={`w-3.5 h-3.5 ${feedback === "up" ? "fill-current text-foreground" : ""}`} />
      </button>

      <button onClick={() => handleFeedback("down")} className={iconBtn} aria-label="Bad response">
        <ThumbsDown className={`w-3.5 h-3.5 ${feedback === "down" ? "fill-current text-foreground" : ""}`} />
      </button>

      <button onClick={handleCopy} className={iconBtn} aria-label="Copy response">
        {copied ? <Check className="w-3.5 h-3.5 text-foreground" /> : <Copy className="w-3.5 h-3.5" />}
      </button>

      <button onClick={() => {}} className={iconBtn} aria-label="Share to Slack">
        <SlackIcon className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/chat/response-footer.tsx
git commit -m "feat: add ResponseFooter component with credits, feedback, copy, slack"
```

---

## Task 2: Wire `ResponseFooter` into `chat-thread.tsx`

**Files:**
- Modify: `src/components/chat/chat-thread.tsx`

**Step 1: Replace `MessageMeta` with `ResponseFooter`**

Add the import at the top of the file:
```tsx
import { ResponseFooter } from "./response-footer";
```

In all three sentinel message render sites (lines ~291, ~322, ~340), replace:
```tsx
<MessageMeta message={msg} />
```
with:
```tsx
<ResponseFooter message={msg} />
```

There are exactly 3 occurrences to replace.

**Step 2: Delete the `MessageMeta` component definition**

Remove the `MessageMeta` function (lines ~439-458) entirely. It is fully replaced.

**Step 3: Verify the dev server shows the footer**

Run: `pnpm dev`
Open localhost:3000, send any message, confirm footer appears with credit count, thumbs up/down, copy, slack icons.

**Step 4: Commit**

```bash
git add src/components/chat/chat-thread.tsx
git commit -m "feat: replace MessageMeta with ResponseFooter in chat thread"
```

---

## Task 3: Create `NextSteps` Component

**Files:**
- Create: `src/components/chat/next-steps.tsx`

**Step 1: Create the component file**

```tsx
"use client";

import { MessageSquare, Users, Eye, ArrowRight } from "lucide-react";
import type { FollowUpAction } from "@/lib/types";

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "follow-up-question": MessageSquare,
  "create-segment": Users,
  "create-segment-clevertap": Users,
  "create-segment-firebase": Users,
  "create-segment-bigquery": Users,
  "view-in-store": Eye,
};

interface NextStepsProps {
  actions: FollowUpAction[];
  onAction: (action: FollowUpAction) => void;
}

export function NextSteps({ actions, onAction }: NextStepsProps) {
  if (!actions.length) return null;

  return (
    <div className="mt-4 animate-fade-in-up">
      <div className="border border-border rounded-xl overflow-hidden divide-y divide-border">
        {actions.map((action) => {
          const Icon = TYPE_ICONS[action.type] ?? MessageSquare;
          return (
            <button
              key={action.id}
              onClick={() => onAction(action)}
              className="flex items-center gap-3 w-full px-3.5 py-3 text-left hover:bg-muted transition-colors group"
            >
              <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="flex-1 text-sm text-foreground leading-snug">{action.label}</span>
              <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/chat/next-steps.tsx
git commit -m "feat: add unified NextSteps component"
```

---

## Task 4: Wire `NextSteps` into `chat-thread.tsx`, remove old components

**Files:**
- Modify: `src/components/chat/chat-thread.tsx`
- Modify: `src/app/page.tsx`

**Step 1: Replace imports in `chat-thread.tsx`**

Remove:
```tsx
import { InlineActions } from "./inline-actions";
import { SuggestedFollowUps } from "./suggested-followups";
```

Add:
```tsx
import { NextSteps } from "./next-steps";
```

**Step 2: Replace render blocks in all three sites**

In each of the 3 sentinel message branches, replace the two separate blocks:
```tsx
{msg.followUpActions?.length && !msg.cardDismissed && onFollowUpAction && (
  <InlineActions
    actions={msg.followUpActions}
    onAction={onFollowUpAction}
    onDismiss={() => onDismissCard?.(msg.id)}
  />
)}
{msg.suggestedFollowUps?.length && onSendFollowUp && (
  <SuggestedFollowUps
    followUps={msg.suggestedFollowUps}
    onSend={onSendFollowUp}
  />
)}
```

With the single unified block:
```tsx
{msg.followUpActions?.length && onFollowUpAction && (
  <NextSteps
    actions={msg.followUpActions}
    onAction={onFollowUpAction}
  />
)}
```

Do this in all 3 render sites.

**Step 3: Remove `onDismissCard` and `onSendFollowUp` props from `ChatThread`**

In `chat-thread.tsx`, remove `onDismissCard` and `onSendFollowUp` from the component props interface (they are no longer needed — `NextSteps` has no dismiss, and follow-up questions go through `onAction`).

In `page.tsx`, remove `onDismissCard={handleDismissCard}` and `onSendFollowUp={handleSend}` from the `<ChatThread>` JSX props (lines ~393-407).

**Step 4: Simplify `handleFollowUpAction` in `page.tsx`**

In `page.tsx` (lines ~281-324), remove the "Coming soon!" toast fallback. The handler should only handle working types:

```tsx
const handleFollowUpAction = useCallback(
  (action: FollowUpAction) => {
    if (action.type === "follow-up-question") {
      handleSend(action.label);
      return;
    }
    if (
      action.type === "create-segment" ||
      action.type === "create-segment-clevertap" ||
      action.type === "create-segment-firebase" ||
      action.type === "create-segment-bigquery"
    ) {
      // ... existing segment modal logic (keep as-is) ...
      return;
    }
    if (action.type === "view-in-store") {
      router.push("/store");
      return;
    }
  },
  [messages, handleSend, router, agentMsgIdRef, openSegmentModal]
);
```

**Step 5: Verify dev server**

Run: `pnpm dev`
Send a message, confirm the unified Next Steps card appears below the response footer. Clicking a follow-up question should send it as a new message.

**Step 6: Commit**

```bash
git add src/components/chat/chat-thread.tsx src/app/page.tsx
git commit -m "feat: wire NextSteps into chat, replace InlineActions + SuggestedFollowUps"
```

---

## Task 5: Simplify LLM prompt in `action-recommender.ts`

**Files:**
- Modify: `src/lib/action-recommender.ts`

**Step 1: Rewrite the prompt constant**

Replace `RECOMMENDATION_PROMPT` (lines ~19-84) with a simplified version that only offers working action types and produces a unified `nextSteps` array:

```ts
const RECOMMENDATION_PROMPT = `You are the Action Recommendation Engine for Sentinel, an analytics platform.

Given a user's query and the analysis response, suggest 4-5 next steps the user might take. Each step is either a follow-up question or an action.

AVAILABLE TYPES:
1. "follow-up-question" — A specific follow-up question exploring a different angle. Always include 2-3 of these.
2. "create-segment" — When the analysis identifies a meaningful user cohort. Only suggest if the SQL queries involved user_id or similar user-level data.
3. "view-in-store" — When the analysis involves specific SKUs, products, or offers.

RULES:
- Return 4-5 items total, ordered by relevance
- Follow-up questions should be full sentences, specific to the data (not generic)
- Each item needs: type, label (display text), icon (one of: "message-circle", "users", "eye")
- For create-segment, set payload.pushTo to "clevertap" or "firebase" based on which is more relevant

OUTPUT FORMAT (JSON only, no markdown fences):
{
  "nextSteps": [
    { "type": "follow-up-question", "label": "Which acquisition channels have the highest 30-day retention?", "icon": "message-circle" },
    { "type": "create-segment", "label": "Create segment of users with >3 purchases in CleverTap", "icon": "users", "payload": { "pushTo": "clevertap" } },
    { "type": "follow-up-question", "label": "How does weekend vs weekday revenue compare?", "icon": "message-circle" }
  ]
}`;
```

**Step 2: Rewrite `generateRecommendations` function**

The function (lines ~86-128) should build a simpler prompt and return the new shape. Remove `buildStoreContext()` call and `offerPreview` handling:

```ts
export interface RecommendationOutput {
  actions: FollowUpAction[];
}

export async function generateRecommendations(input: {
  userQuery: string;
  responseText: string;
  queryResults?: string;
  mode: string;
  modelId?: ModelId;
}): Promise<RecommendationOutput> {
  const userPrompt = [
    `User query: ${input.userQuery}`,
    `Analysis response (truncated): ${input.responseText}`,
    input.queryResults ? `Query results context: ${input.queryResults}` : "",
    `Mode: ${input.mode}`,
  ].filter(Boolean).join("\n\n");

  const text = await generateText(`${RECOMMENDATION_PROMPT}\n\n${userPrompt}`, {
    jsonMode: true,
    modelId: input.modelId,
  });

  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const parsed = JSON.parse(cleaned);
  return transformToOutput(parsed);
}
```

**Step 3: Rewrite `transformToOutput` to produce unified array**

Replace the entire `transformToOutput` function (lines ~130-213):

```ts
const VALID_TYPES = new Set(["follow-up-question", "create-segment", "view-in-store"]);

function transformToOutput(raw: Record<string, unknown>): RecommendationOutput {
  const steps = Array.isArray(raw.nextSteps) ? raw.nextSteps : [];

  const actions: FollowUpAction[] = steps
    .filter((s: Record<string, unknown>) => typeof s.label === "string" && VALID_TYPES.has(s.type as string))
    .slice(0, 5)
    .map((s: Record<string, unknown>, i: number) => ({
      id: `next-step-${i}`,
      label: s.label as string,
      icon: (s.icon as string) || "message-circle",
      type: s.type as FollowUpAction["type"],
      payload: (s.payload as Record<string, unknown>) ?? undefined,
    }));

  return { actions };
}
```

**Step 4: Remove unused imports**

Remove `buildStoreContext` import and the `OfferPreview` / `suggestedFollowUps` related code. Remove the old `RecommendationOutput` type that included `offerPreview` and `suggestedFollowUps`.

**Step 5: Commit**

```bash
git add src/lib/action-recommender.ts
git commit -m "feat: simplify action-recommender to unified nextSteps, remove stubs"
```

---

## Task 6: Update SSE types and hook processing

**Files:**
- Modify: `src/lib/sse-types.ts` (line ~12)
- Modify: `src/hooks/use-analytics.ts`

**Step 1: Simplify SSE recommendations type in `sse-types.ts`**

Change the recommendations event type (line ~12) from:
```ts
| { type: "recommendations"; actions: FollowUpAction[]; offerPreview?: unknown }
```
to:
```ts
| { type: "recommendations"; actions: FollowUpAction[] }
```

**Step 2: In `use-analytics.ts`, delete `SEGMENT_ACTIONS` and `mergeSegmentActions`**

Delete lines ~157-193 entirely (the `SEGMENT_ACTIONS` constant and `mergeSegmentActions` function).

Also remove the import of `determineFollowUpActions` from `action-heuristic`:
```ts
// DELETE this import
import { determineFollowUpActions } from "@/lib/action-heuristic";
```

**Step 3: Simplify `pendingRecommendations` type**

Change line ~501 from:
```ts
let pendingRecommendations: { actions: FollowUpAction[]; suggestedFollowUps?: string[] } | null = null;
```
to:
```ts
let pendingRecommendations: FollowUpAction[] | null = null;
```

**Step 4: Simplify the `recommendations` case handler**

Replace lines ~828-845:
```ts
case "recommendations": {
  pendingRecommendations = event.actions as FollowUpAction[];
  if (doneReceived) {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === responseMsgId ? { ...m, followUpActions: pendingRecommendations! } : m
      )
    );
  }
  break;
}
```

**Step 5: Simplify the `done` case handler**

In the `done` case, where it currently merges segment actions and sets `suggestedFollowUps`, simplify to:
```ts
const actions = pendingRecommendations ?? [];
// ... set on message:
{ ...m, followUpActions: actions, creditCost: analyticsCost }
// (no suggestedFollowUps field)
```

**Step 6: Simplify the direct mode flow**

In the direct mode section (lines ~422-449), where it calls `/api/recommend` and strips segment actions, simplify to just pass through the actions array directly:
```ts
const recs = await recRes.json();
const directActions = (recs.actions ?? []) as FollowUpAction[];
// ... set on message:
{ ...m, variant: undefined, followUpActions: directActions }
// (no suggestedFollowUps field)
```

**Step 7: Commit**

```bash
git add src/lib/sse-types.ts src/hooks/use-analytics.ts
git commit -m "feat: simplify SSE + hook to unified actions, remove heuristic merge"
```

---

## Task 7: Update `analyze/route.ts` SSE send calls

**Files:**
- Modify: `src/app/api/analyze/route.ts`

**Step 1: Simplify the recommendations send calls**

In both deep mode (lines ~283-293) and quick mode (lines ~307-317), change the `send()` call from:
```ts
send({ type: "recommendations", actions: recs.actions, offerPreview: recs.offerPreview ?? null, suggestedFollowUps: recs.suggestedFollowUps ?? [] });
```
to:
```ts
send({ type: "recommendations", actions: recs.actions });
```

**Step 2: Commit**

```bash
git add src/app/api/analyze/route.ts
git commit -m "feat: simplify recommendations SSE event in analyze route"
```

---

## Task 8: Update types and delete dead code

**Files:**
- Modify: `src/lib/types.ts`
- Delete: `src/lib/action-heuristic.ts`
- Delete: `src/components/chat/inline-actions.tsx`
- Delete: `src/components/chat/suggested-followups.tsx`
- Delete: `src/components/chat/follow-up-actions.tsx`

**Step 1: Trim `FollowUpAction.type` union in `types.ts`**

Change lines ~33-45 from the full union to only working types:
```ts
  type:
    | "follow-up-question"
    | "create-segment"
    | "create-segment-clevertap"
    | "create-segment-firebase"
    | "create-segment-bigquery"
    | "view-in-store";
```

Remove: `refine-filters`, `save-memory`, `save-playbook`, `share-slack`, `schedule-report`, `set-alert`, `create-offer`.

**Step 2: Remove `suggestedFollowUps` from `ChatMessage`**

Delete lines ~217-218:
```ts
/** Suggested follow-up prompts (Perplexity-style rows) */
suggestedFollowUps?: string[];
```

**Step 3: Delete dead files**

```bash
rm src/lib/action-heuristic.ts
rm src/components/chat/inline-actions.tsx
rm src/components/chat/suggested-followups.tsx
rm src/components/chat/follow-up-actions.tsx
```

**Step 4: Check for any remaining imports of deleted files**

Search for any references to the deleted modules and remove them:
- `action-heuristic` — should only have been in `use-analytics.ts` (already removed in Task 6)
- `inline-actions` — should only have been in `chat-thread.tsx` (already removed in Task 4)
- `suggested-followups` — should only have been in `chat-thread.tsx` (already removed in Task 4)
- `follow-up-actions` — should be unused (was already unused)

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: delete heuristic, old action components, trim FollowUpAction type"
```

---

## Task 9: Verify end-to-end

**Files:** None (testing only)

**Step 1: Build check**

Run: `pnpm build`
Expected: Clean build, no TypeScript errors.

**Step 2: Manual test — Deep Research mode**

1. Open localhost:3000
2. Toggle Deep Research on
3. Ask "What are the revenue trends this month?"
4. Verify: Response footer appears (credits, thumbs up/down, copy, slack)
5. Verify: Unified Next Steps card appears below with 4-5 mixed items
6. Click a follow-up question — sends as new message
7. Click a segment action (if present) — opens CreateSegmentModal

**Step 3: Manual test — Quick Answer mode**

1. Toggle Deep Research off
2. Ask "How many orders today?"
3. Verify: Same footer + Next Steps card behavior

**Step 4: Manual test — Direct chat mode**

1. Ask "What is a cohort?"
2. Verify: Footer appears, Next Steps card appears with follow-up questions (no segment actions)

**Step 5: Manual test — LLM failure graceful degradation**

If recommendation call fails (e.g. network issue), verify:
- Response still renders fully
- Footer still shows (credits, feedback, copy)
- No Next Steps card (this is expected)
- No errors in console beyond the caught recommendation error

**Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found in e2e testing"
```
