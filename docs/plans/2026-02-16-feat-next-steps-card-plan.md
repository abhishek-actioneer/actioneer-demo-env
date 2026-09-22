---
title: "feat: Next Steps Card — Claude Cowork-style inline actions"
type: feat
date: 2026-02-16
---

# Next Steps Card — Claude Cowork-style inline actions

## Overview

Replace the current horizontal pill buttons (`FollowUpActions`) with a card-based "Next Steps" component inspired by Claude Cowork. The card renders inline at the end of each assistant response with a fixed layout:

- **Row 1:** 1 LLM-generated follow-up question
- **Row 2-3:** 2 integration/action suggestions with **brand logos** (Slack, Firebase, CleverTap, etc.)
- **Row 4:** "Something else" freeform row (always last)

This makes the insight-to-action flow feel like a natural continuation of the conversation rather than a toolbar. Brand logos for integrations are a first-class design requirement — they signal "this leaves the app" and make the card visually rich.

## Problem Statement

The current follow-up actions are flat, equally-weighted pill buttons in a horizontal row. There's no visual hierarchy — "Create Segment" (high-value, creates state) looks identical to "Set Alert" (placeholder). The pills read like a toolbar, not like smart next steps. They also don't support follow-up questions or freeform input, which are the most common next moves after reading an analysis.

## Design Reference

Claude Cowork's pattern: a card with numbered rows, highlight-on-hover, a freeform "Something else" input row, and a dismiss button. Our adaptation:

```
┌──────────────────────────────────────────────────────────────────┐
│  What would you like to do next?                             ✕   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  1   💬  Which cohort has the highest churn rate?     →  │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  2   [CT]  Create segment in CleverTap                →  │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  3   [🔥]  Create segment in Firebase                 →  │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ✏️  Something else...                                           │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘

[CT] = CleverTap brand logo SVG    [🔥] = Firebase brand logo SVG
[⌗] = Slack brand logo SVG
```

### Card Layout Rules

- **Fixed 4-row layout:** 1 follow-up question + 2 integrations + "Something else"
- Row 1 is always an LLM-generated follow-up question (💬 icon from lucide)
- Rows 2-3 are integration actions with **real brand SVG logos** — not emoji, not lucide icons
- Row 4 "Something else" is visually distinct: lighter text, edit/pencil icon, no number badge
- Rows are clickable with hover highlight (`hover:bg-muted`)
- Numbered badges use muted circle style matching the Cowork reference
- Dismiss (✕) in top-right corner

### Brand Logo Requirements

Integration actions MUST use actual brand SVGs, not generic icons. These are inline SVG components:

| Integration | Logo | Size | Source |
|-------------|------|------|--------|
| Slack | Hash/octothorpe mark in Slack brand colors (#4A154B, #36C5F0, #2EB67D, #ECB22E) | 16×16 | Official Slack brand kit |
| Firebase | Flame icon in Firebase orange (#FFCA28) | 16×16 | Official Firebase brand |
| CleverTap | CT diamond/shield in CleverTap red (#EF4136) | 16×16 | Official CleverTap brand |

Logos are rendered at 16×16 (`w-4 h-4`) inside the action row, replacing where lucide icons would go. Each is a small inline React component (~15-25 lines of SVG path data).

## Key Design Decisions

These resolve the critical ambiguities from specflow analysis:

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Fixed slot layout** | 1 question + 2 integrations + "Something else" | Predictable layout. Slot 1 is always a follow-up question. Slots 2-3 are always integration/action suggestions with brand logos. Slot 4 is always "Something else". |
| **Follow-up questions** | Client-side only (V1) | Generate 1 suggested question from the LLM response text using a lightweight Gemini call at the end of the stream. No new SSE event needed — done in `page.tsx` after "done" event. |
| **"Something else" behavior** | Focus chat input only (no pre-fill) | Simpler, less confusing. User clicks → textarea gets focus → they type. |
| **Historical cards** | Only show on the **latest** assistant message | Keeps thread clean. Old messages lose their cards once a new response arrives. |
| **Card after action click** | Card stays visible | Users may want to do multiple things (e.g., create segment AND share to Slack). |
| **Dismiss persistence** | Per-message `cardDismissed` boolean on ChatMessage | Persists in `savedChatsRef`. Card doesn't reappear after dismiss. |
| **Disconnected integrations** | Show action with "(connect)" suffix | Clicking opens Data Connectors page. Don't hide — it's a discovery mechanism. |
| **Multiple providers for same action** | Show as separate rows | "Create segment in CleverTap" and "Create segment in Firebase" are distinct actions. Both can appear if relevant and connected. |
| **Card animation** | `fade-in-up` (already in codebase) | Matches subagent card animation pattern. |

## Action Type Catalog

| Type | Icon | Label | Handler | When Shown |
|------|------|-------|---------|------------|
| `follow-up-question` | `MessageCircle` (lucide) | LLM-generated question text | Send as new user message | Always (1-2 generated per response) |
| `save-memory` | `Brain` (lucide) | "Save to memory" | `alert("Coming soon!")` (V1) | Always |
| `save-playbook` | `Play` (lucide) | "Save as playbook" | `alert("Coming soon!")` (V1) | Deep mode only |
| `share-slack` | Slack SVG | "Share to Slack" | `alert("Coming soon!")` (V1) | Always |
| `create-segment-clevertap` | CleverTap SVG | "Create segment in CleverTap" | Opens `CreateSegmentModal` | When query has `user_id` |
| `create-segment-firebase` | Firebase SVG | "Create segment in Firebase" | Opens `CreateSegmentModal` | When query has `user_id` |
| `refine-filters` | `SlidersHorizontal` (lucide) | "Refine filters" | Pre-fills chat input with refinement prompt | When query has `user_id` |

### Slot Allocation Logic

The card has a **fixed 4-row layout** with deterministic slot assignment:

| Slot | Content | Fallback if unavailable |
|------|---------|------------------------|
| **Slot 1** | LLM-generated follow-up question | Generic question: "Tell me more about this" |
| **Slot 2** | Top integration action (by priority below) | Next best action from catalog |
| **Slot 3** | Second integration action | Next best action from catalog |
| **Slot 4** | "Something else" (always) | — |

**Integration/action priority** (for filling slots 2-3):

1. Create segment in CleverTap / Firebase (when query has `user_id`)
2. Share to Slack
3. Save to memory
4. Refine filters (when query has `user_id`)
5. Save as playbook (deep mode only)

## Technical Approach

### Files to Modify

| File | Change |
|------|--------|
| `src/lib/types.ts` | Extend `FollowUpAction` type with new action types, add `description?` field, add `cardDismissed?` to `ChatMessage` |
| `src/lib/action-heuristic.ts` | Rewrite to support new action types, priority ranking, and truncation to top 3 |
| `src/components/chat/follow-up-actions.tsx` | **Replace entirely** with `NextStepsCard` component |
| `src/components/chat/chat-thread.tsx` | Update import + render logic, add `onDismissCard` callback, only render for latest message |
| `src/app/page.tsx` | Add dismiss handler, add follow-up question generation after "done" event, update `handleFollowUpAction` for new types, expose `chatInputRef` for focus |
| `src/components/chat/chat-input.tsx` | Add `ref` forwarding or `onRequestFocus` callback prop |

### No New Files Needed (except SVG icons)

The `NextStepsCard` replaces `follow-up-actions.tsx` in-place. Brand SVGs for Slack, Firebase, CleverTap are inline in the component (small, 3 SVGs).

## Implementation Phases

### Phase 1: Types & Heuristic (foundation)

**`src/lib/types.ts`**

```typescript
export interface FollowUpAction {
  id: string;
  label: string;
  icon: string;           // lucide icon name OR "slack" | "firebase" | "clevertap"
  type:
    | "follow-up-question"
    | "create-segment"
    | "create-segment-clevertap"
    | "create-segment-firebase"
    | "refine-filters"
    | "save-memory"
    | "save-playbook"
    | "share-slack";
  description?: string;   // optional subtitle text
  payload?: Record<string, unknown>;
}

// Add to ChatMessage:
export interface ChatMessage {
  // ... existing fields
  followUpActions?: FollowUpAction[];
  cardDismissed?: boolean;  // NEW
}
```

**`src/lib/action-heuristic.ts`**

- Add all new action types
- Implement priority-based selection
- Return max 3 actions sorted by priority
- Accept optional `followUpQuestions: string[]` parameter for LLM-generated questions

### Phase 2: NextStepsCard Component

**`src/components/chat/follow-up-actions.tsx`** → rewrite as `NextStepsCard`

Component structure:
```
<div className="card container with border, rounded-xl, shadow-sm, fade-in-up animation">
  <div className="header row: 'What would you like to do next?' + dismiss X button">

  {actions.map((action, i) => (
    <button className="action row: number badge + icon + label + arrow, hover:bg-muted">
      <span className="number badge in muted circle">{i + 1}</span>
      <ActionIcon action={action} />  // lucide icon OR brand SVG
      <span className="label">{action.label}</span>
      <ArrowRight className="arrow on right" />
    </button>
  ))}

  <button className="something-else row: edit icon + 'Something else...' in muted text"
          onClick={onSomethingElse}>
  </button>
</div>
```

Key styling details:
- Card: `border border-border rounded-xl bg-card shadow-sm mt-4 overflow-hidden animate-fade-in-up`
- Header: `px-4 pt-4 pb-2 flex items-center justify-between`
- Action row: `w-full flex items-center gap-3 px-4 py-3 hover:bg-muted transition-colors border-t border-border/50`
- Number badge: `w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-medium`
- "Something else": `px-4 py-3 border-t border-border/50 text-muted-foreground`
- Brand icons: inline SVG components (~20 lines each for Slack, Firebase, CleverTap logos)

### Phase 3: Integration into Chat Thread

**`src/components/chat/chat-thread.tsx`**

```tsx
// Only show NextStepsCard on the LAST assistant message with actions
const lastActionMsgId = [...messages].reverse().find(m => m.followUpActions?.length)?.id;

// In render:
{msg.followUpActions && msg.followUpActions.length > 0
  && msg.id === lastActionMsgId
  && !msg.cardDismissed
  && onFollowUpAction && (
  <NextStepsCard
    actions={msg.followUpActions}
    onAction={onFollowUpAction}
    onDismiss={() => onDismissCard?.(msg.id)}
    onSomethingElse={onSomethingElse}
  />
)}
```

**`src/components/chat/chat-input.tsx`**

- Add `inputRef` forwarding via `React.forwardRef` or an `onRequestFocus` callback
- Parent calls `chatInputRef.current?.focus()` when "Something else" is clicked

### Phase 4: Page-level Wiring

**`src/app/page.tsx`**

1. Add `handleDismissCard(msgId)` — sets `cardDismissed: true` on the message
2. Add `handleSomethingElse()` — focuses the chat input textarea
3. Update `handleFollowUpAction` switch/case for new action types:
   - `follow-up-question` → call `handleSend(action.label)` to send as new message
   - `create-segment-clevertap` / `create-segment-firebase` → open `CreateSegmentModal` (same as current `create-segment`)
   - `save-memory`, `save-playbook`, `share-slack` → `alert("Coming soon!")` (V1 placeholder)
4. After "done" event: generate 1-2 follow-up questions via lightweight Gemini call, merge into actions array

### Follow-up Question Generation (Phase 4 detail)

After the analysis stream completes ("done" event), make a quick Gemini call:

```typescript
// In the "done" event handler, after determineFollowUpActions:
const questionPrompt = `Based on this analysis response, suggest 2 brief follow-up questions the user might ask. Return as JSON array of strings. Response text: "${responseText.slice(0, 500)}"`;
const questionsResponse = await fetch("/api/chat", { ... });
// Parse response, create FollowUpAction[] with type "follow-up-question"
// Merge with heuristic actions, apply priority ranking, slice to top 3
```

This is a non-blocking call — the card initially renders with heuristic-only actions, then updates when questions arrive.

## Acceptance Criteria

- [x] Card renders at the end of the latest assistant message (not historical messages)
- [x] Card has fixed 4-row layout: 1 follow-up question + 2 integration actions + "Something else"
- [x] Slot 1 is always an LLM-generated follow-up question; slots 2-3 are integration actions with brand logos
- [x] Clicking a follow-up question sends it as a new user message
- [x] Clicking "Something else" focuses the chat input
- [x] Clicking ✕ dismisses the card; it doesn't reappear for that message
- [x] Integration actions (Slack, CleverTap, Firebase) show brand SVG logos
- [x] Card works in both analytics and direct response paths
- [x] Card has `fade-in-up` entrance animation
- [x] Rows have hover highlight (`hover:bg-muted`)
- [x] Keyboard accessible (tab through rows, Enter to activate, Escape to dismiss)

## Dependencies & Risks

- **Follow-up question generation** adds a Gemini API call per response. Risk: latency. Mitigation: non-blocking, card renders immediately with heuristic actions, questions append async.
- **Brand SVGs** for Slack/Firebase/CleverTap need to be sourced. These are widely available as open-source SVGs. Keep them minimal (~20 lines each).
- **ChatInput ref forwarding** is a minor refactor but touches a stable component. Keep the change minimal — just add `forwardRef` or expose a focus method.

## References

- Current implementation: `src/components/chat/follow-up-actions.tsx`
- Action heuristic: `src/lib/action-heuristic.ts`
- Types: `src/lib/types.ts:27-32`
- Chat thread render: `src/components/chat/chat-thread.tsx:117-119`
- Action handler: `src/app/page.tsx:825-871`
- Action attachment: `src/app/page.tsx:721-732`
- Past learning: `docs/solutions/logic-errors/classifier-misrouting-composite-queries.md` — follow-up actions must work in BOTH analytics and direct paths
- Brainstorm: `docs/brainstorms/2026-02-16-segments-and-actions-brainstorm.md`
