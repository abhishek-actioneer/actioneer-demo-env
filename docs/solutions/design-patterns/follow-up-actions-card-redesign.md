---
title: "Follow-Up Actions Redesign: Pill Buttons to Merged ChatInput Card"
date: 2026-02-16
category: design-patterns
module: Chat Interface
severity: medium
tags:
  - chat-ui
  - component-redesign
  - action-prioritization
  - integration-actions
  - brand-svgs
  - component-merging
affected_components:
  - src/lib/types.ts
  - src/lib/action-heuristic.ts
  - src/components/chat/follow-up-actions.tsx
  - src/components/chat/chat-input.tsx
  - src/components/chat/chat-thread.tsx
  - src/app/page.tsx
---

# Follow-Up Actions Redesign: Pill Buttons to Merged ChatInput Card

## Problem

Follow-up actions rendered as flat horizontal pill buttons with equal visual weight. "Create Segment" (high-value, creates state) looked identical to "Set Alert" (placeholder). The toolbar pattern felt disconnected from the conversational flow, and there was no support for follow-up questions or freeform input.

## Root Cause

No visual hierarchy in the action system. All actions used the same pill-button styling with lucide icons, making it impossible for users to distinguish high-value integration actions from generic utilities. The actions were architecturally separate from the chat input, creating two disconnected interaction surfaces.

## Solution — Three Iterations

### Iteration 1: Standalone NextStepsCard

Created a card component with numbered rows (1, 2, 3), brand SVG logos (Slack, Firebase, CleverTap), "Something else" row, and dismiss button. Rendered inline after the response in `chat-thread.tsx`.

### Iteration 2: Simplify

Removed numbered badges (visual clutter) and the "Something else" row (redundant — the chat input already serves that purpose).

### Iteration 3: Merge into ChatInput (final)

Moved action rows directly into the `ChatInput` component. When actions exist, they render above the textarea within the same card border. Textarea placeholder changes to "Something else...". One unified surface.

```
┌──────────────────────────────────────────────────────┐
│  What would you like to do next?                  ✕  │
│  💬  Which cohort has the highest churn rate?     →  │
│  [Slack logo]  Share to Slack                     →  │
│  [Brain icon]  Save to memory                     →  │
│  ────────────────────────────────────────────────── │
│  Something else...                                   │
│  🟢 Connected    Deep Research              [↑]     │
└──────────────────────────────────────────────────────┘
```

## Key Code Patterns

**Priority-based slot allocation** (`src/lib/action-heuristic.ts`):
- Max 3 actions: 1 follow-up question + 2 integration actions
- Priority: segment creation > Slack > memory > filters > playbook
- Context-aware: segment actions only appear when queries contain `user_id`

**State management** (`src/app/page.tsx`):
- `activeActions` useMemo finds latest non-dismissed message's actions
- `cardDismissed` boolean on `ChatMessage` for persistent dismiss state
- Actions tied to specific messages, not global state

**Brand SVG icons** (`src/components/chat/chat-input.tsx`):
- Inline React components with official brand colors (Slack #E01E5A/#36C5F0/#2EB67D/#ECB22E, Firebase #FFCA28, CleverTap #EF4136)
- 16x16 rendering (`w-4 h-4`) with `BRAND_ICONS` and `LUCIDE_ICONS` registries

**Focus forwarding** (`src/components/chat/chat-input.tsx`):
- `forwardRef` + `useImperativeHandle` exposing `focus()` method
- Parent can programmatically focus input after action clicks

## Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| Merge card into ChatInput | One surface reduces cognitive load; "Something else" row was redundant with textarea |
| Brand SVGs over lucide icons | Signals "this leaves the app"; builds trust via visual recognition |
| Max 3 action slots | Prevents decision paralysis; forces priority ranking |
| Dismiss at message level | Respects user agency; actions can reappear for new messages |
| Priority-based selection | Deterministic, context-aware; same data always produces same order |

## Prevention Strategies

### 1. Component Merging Pattern
Before creating separate UI surfaces, audit whether they are always adjacent and share state. If a user can't dismiss one without affecting the other, they belong together.

### 2. Brand Assets for External Actions
Never use generic icons for actions that navigate to external services. Use official brand SVGs with verified colors. Store in a registry for reuse.

### 3. Feature Parity Across Code Paths
Follow-up actions must work in BOTH analytics and direct response paths. This was a past bug (see `docs/solutions/logic-errors/classifier-misrouting-composite-queries.md`). When modifying one path, always check the other.

### 4. Iterative Simplification
Track design iterations. The simplest version (merged card, no numbers, no separate "Something else" button) was the best. Resist premature complexity — start simple, add only when needed.

### 5. Deterministic Action Ranking
With constrained slots, make action selection deterministic and context-aware. Centralize filtering/ranking in a single pure function. No randomness.

## Related Documents

- **Plan:** `docs/plans/2026-02-16-feat-next-steps-card-plan.md` — Full implementation spec
- **Brainstorm:** `docs/brainstorms/2026-02-16-segments-and-actions-brainstorm.md` — Strategic context for the action system
- **Past bug:** `docs/solutions/logic-errors/classifier-misrouting-composite-queries.md` — Feature parity lesson
- **Race conditions:** `docs/reviews/race-conditions-review-segments-plan.md` — Async safety for action rendering
