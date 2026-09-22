---
title: "Unified Suggestion Carousel"
type: feat
date: 2026-02-20
---

# Unified Suggestion Carousel

## Overview

Replace the two separate post-analysis suggestion surfaces — the "What would you like to do next?" action rows inside `ChatInput` and the standalone `OfferPreviewCard` message variant — with a single **horizontally scrollable card carousel** rendered below the last AI response in the chat thread.

The carousel renders a strip of consistently-sized cards (~140px tall) holding heterogeneous content: follow-up question groups, push-segment destination groups, offer preview cards, and catch-all action cards. This unifies all post-analysis suggestions into one discoverable, non-blocking surface.

**Brainstorm:** `docs/brainstorms/2026-02-20-suggestion-carousel-brainstorm.md`

## Problem Statement / Motivation

Post-analysis suggestions are currently split across two disconnected surfaces:
- **Action rows in ChatInput** — visually detached from the analysis they respond to. Positioned above the input bar, they feel like a toolbar, not a contextual recommendation.
- **OfferPreviewCard** — a standalone chat message with `variant: "offer-preview"`, rendered as a separate message in the thread. It breaks the visual flow and cannot be co-located with other suggestions.

This split means the user sees suggestions in two places with two different UI patterns, making the system feel less intelligent than it is. The carousel consolidates everything into a single, scannable surface tied to the specific response it relates to.

## Proposed Solution

A `<SuggestionCarousel>` component rendered inside `ChatThread`, positioned immediately after the sentinel response message that carries `followUpActions`. The carousel transforms the flat `FollowUpAction[]` + optional `OfferPreviewData` into grouped cards via a pure transformation function. After implementation, the action rows in `ChatInput` and the `OfferPreviewCard` message variant are removed.

## Technical Approach

### Key Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Carousel DOM position | Rendered inline in `ChatThread` after the response message, NOT as a separate `ChatMessage` | Avoids polluting the message store with UI-only state. Keeps conversation persistence clean. |
| offerPreview co-location | Store `offerPreview` directly on the response `ChatMessage` alongside `followUpActions` | Eliminates the separate offer-preview variant message. Single source of truth for carousel data. |
| Data transformation | Pure function `buildCarouselCards(actions, offerPreview)` in `carousel-types.ts` | Decouples grouping logic from rendering. Testable. Both engines (LLM + heuristic) output the same flat format. |
| Animation | CSS keyframes only (`@keyframes carousel-card-in`) + staggered `animation-delay` via inline styles | Matches existing project pattern (no framer-motion). `tw-animate-css` plugin already installed. |
| Horizontal scroll | Native `overflow-x: auto` + CSS `scrollbar-width: none` + right-edge fade mask via `mask-image` gradient | No carousel library needed. Touch-swipe works natively. |
| Card sizing | Fixed height 140px, variable width per card type (180px / 260px) | Per brainstorm decision. `min-width` on cards, `flex-shrink: 0`. |
| BigQuery destination | Add `create-segment-bigquery` to `FollowUpAction` type union | Aligns with existing `create-segment-clevertap` / `create-segment-firebase` pattern. |
| Carousel lifecycle | Clear on user message send (immediate, not on next response) | Simple: `handleSend` sets a flag or clears `followUpActions` before the next analysis begins. |
| Restored conversations | Do NOT render carousel for restored/loaded conversations | Only render for messages added during the current live session. Track via `liveResponseIds: Set<string>` in component state. |

### Data Model

```typescript
// src/lib/carousel-types.ts

/** A grouped card for the suggestion carousel */
type CarouselCard =
  | { type: "follow-up-questions"; items: FollowUpAction[] }
  | { type: "push-segment"; items: FollowUpAction[] }
  | { type: "offer-preview"; data: OfferPreviewData }
  | { type: "action"; item: FollowUpAction };

/** Card display metadata */
const CARD_META: Record<CarouselCard["type"], { icon: string; title: string; width: number }> = {
  "follow-up-questions": { icon: "💬", title: "Follow up", width: 180 },
  "push-segment":        { icon: "📤", title: "Push Segment", width: 260 },
  "offer-preview":       { icon: "🏷️", title: "Suggested Offer", width: 260 },
  "action":              { icon: "⚡", title: "Action", width: 220 },
};
```

### Grouping Rules

The `buildCarouselCards()` transformation function applies these rules to the flat `FollowUpAction[]`:

| Action Type(s) | Card Type | Grouping |
|---------------|-----------|----------|
| `follow-up-question` (all) | `follow-up-questions` | All grouped into one card. Max 4 visible, "+N more" if overflow. |
| `create-segment`, `create-segment-clevertap`, `create-segment-firebase`, `create-segment-bigquery` | `push-segment` | All grouped into one card. Each destination is a clickable row. |
| `create-offer` + `OfferPreviewData` present | `offer-preview` | Single card with pricing/audience/dates from `OfferPreviewData`. |
| `save-playbook`, `share-slack`, `save-memory`, `schedule-report`, `set-alert`, `view-in-store`, `refine-filters` | `action` | One card per action. Each is a standalone card with icon + label + description. |

**Card ordering:** `follow-up-questions` > `offer-preview` > `push-segment` > `action` cards (by type priority).

### Component Hierarchy

```
ChatThread
  └── messages.map(msg => ...)
        ├── <SentinelMessage /> or <DocumentView />
        ├── <MessageMeta />
        └── {shouldShowCarousel(msg) && (
              <SuggestionCarousel
                cards={buildCarouselCards(msg.followUpActions, msg.offerPreview)}
                onAction={onAction}
                onCreateOffer={onCreateOffer}
              />
            )}
```

```
SuggestionCarousel               // src/components/chat/suggestion-carousel.tsx
  ├── <div className="carousel-scroll-container">
  │     ├── <FollowUpQuestionsCard />
  │     ├── <OfferPreviewCard />    // new, compact version
  │     ├── <PushSegmentCard />
  │     └── <ActionCard />          // one per action
  └── <div className="fade-mask" />  // right edge gradient
```

## Implementation Phases

### Phase 1: Data Model + Transformation Layer

**Files:** `src/lib/carousel-types.ts` (new), `src/lib/types.ts` (modify)

- [x] Create `CarouselCard` type union and `CARD_META` constant in `carousel-types.ts`
- [x] Write `buildCarouselCards(actions: FollowUpAction[], offerPreview?: OfferPreviewData): CarouselCard[]` transformation function
- [x] Add `create-segment-bigquery` to the `FollowUpAction` type union in `types.ts`
- [x] Add `offerPreview?: OfferPreviewData` field to `ChatMessage` in `types.ts` (for co-location)
- [x] Update LLM recommender prompt in `action-recommender.ts` to include `create-segment-bigquery` as a valid type
- [x] Update heuristic engine in `action-heuristic.ts` to emit `create-segment-bigquery` when SQL references BigQuery-related patterns

**Acceptance criteria:**
- `buildCarouselCards` correctly groups all 13 action types
- `buildCarouselCards` produces an `offer-preview` card when `offerPreview` is present
- Card ordering follows priority: follow-up-questions > offer-preview > push-segment > actions
- Max 4 items per card for `follow-up-questions` and `push-segment`

### Phase 2: Carousel Shell + Card Components

**Files:** `src/components/chat/suggestion-carousel.tsx` (new), `src/app/globals.css` (modify)

- [x]Create `<SuggestionCarousel>` component with horizontal scroll container
- [x]Add CSS: `scrollbar-width: none`, `-webkit-overflow-scrolling: touch`, right-edge `mask-image` gradient fade
- [x]Add `@keyframes carousel-card-in` animation in `globals.css` — `opacity: 0, translateY(6px)` to normal, 200ms ease-out
- [x]Apply staggered `animation-delay` per card (40ms offset) via inline `style={{ animationDelay: `${i * 40}ms` }}`
- [x]Create `<FollowUpQuestionsCard>` — card header + clickable question rows (max 4 visible)
- [x]Create `<PushSegmentCard>` — card header + destination rows with platform icons
- [x]Create `<OfferPreviewCardCompact>` — condensed offer card (SKU, pricing with strikethrough, audience, date range, "Create Offer" CTA button)
- [x]Create `<ActionCard>` — single-action card with icon + label + description
- [x]All cards: fixed height 140px, variable width per `CARD_META`, `flex-shrink: 0`

**Acceptance criteria:**
- Carousel scrolls horizontally with hidden scrollbar
- Right-edge fade mask hints at more cards
- Cards stagger-animate in with 40ms offsets
- Touch-swipe works on mobile
- Each card type renders its content correctly

### Phase 3: Wire Into ChatThread + page.tsx

**Files:** `src/components/chat/chat-thread.tsx` (modify), `src/app/page.tsx` (modify)

- [x]Add `SuggestionCarousel` rendering in `ChatThread` after sentinel response messages
- [x]Add `shouldShowCarousel(msg, liveResponseIds)` guard: only show for messages with `followUpActions` that are in the live session set and not followed by a user message
- [x]Modify `page.tsx` `done` event handler (lines 1363-1401): store `offerPreview` on `responseMsgId` instead of creating a separate offer-preview message
- [x]Modify `page.tsx` direct-flow handler (lines 969-1013): same — store `offerPreview` on the response message
- [x]Add `liveResponseIds: Set<string>` to component state; populate when `responseMsgId` is created during `handleSend`
- [x]Clear carousel on user message send: in `handleSend`, clear `followUpActions` from the previous response message OR rely on `shouldShowCarousel` checking "no user message after this response"
- [x]Pass `onAction` and `onCreateOffer` callbacks through to `SuggestionCarousel`
- [x]Update auto-scroll logic in `ChatThread` to scroll past the carousel when it appears (move `bottomRef` below carousel position)

**Acceptance criteria:**
- Carousel appears below the last AI response after analysis completes
- Carousel does NOT appear for restored conversations
- Carousel disappears when the user sends the next message
- Clicking a follow-up question sends it as a message (and clears the carousel)
- Clicking a push-segment destination opens `CreateSegmentModal`
- Clicking "Create Offer" dispatches the offer creation flow
- Auto-scroll brings the carousel into view

### Phase 4: Remove Old Surfaces

**Files:** `src/components/chat/chat-input.tsx` (modify), `src/components/chat/chat-thread.tsx` (modify), `src/app/page.tsx` (modify)

- [x]Remove `actions`, `onAction`, `onDismissActions` props from `ChatInput`
- [x]Remove the "What would you like to do next?" action rows UI block from `ChatInput` (lines 231-263)
- [x]Remove the `variant === "offer-preview"` rendering branch from `ChatThread` (lines 215-233)
- [x]Remove the separate offer-preview message injection from `page.tsx` `done` handler (lines 1388-1401) and direct-flow handler (lines 1001-1013)
- [x]Remove `activeActions` computed value from `page.tsx` (lines 1775-1779)
- [x]Remove `cardDismissed` flag handling from `page.tsx` if no longer used
- [x]Delete `src/components/chat/follow-up-actions.tsx` (the `NextStepsCard` component — appears unused)
- [x]Verify the standalone `OfferPreviewCard` in `src/components/store/offer-preview-card.tsx` is only used by the chat thread variant; if so, refactor or keep for the new compact carousel version

**Acceptance criteria:**
- No action rows appear in `ChatInput`
- No standalone offer-preview messages appear in the chat thread
- All suggestion/action UI flows through the carousel exclusively
- No dead code remains

### Phase 5: Accessibility + Polish

**Files:** `src/components/chat/suggestion-carousel.tsx` (modify)

- [x]Add `role="region"` + `aria-label="Suggested actions"` to carousel container
- [x]Add `role="group"` + `aria-label` per card
- [x]Ensure all clickable rows are `<button>` elements with descriptive `aria-label`
- [x]Add keyboard navigation: Tab to reach carousel, arrow left/right between cards, Tab/arrow down within a card, Enter/Space to activate
- [x]Focus management: after modal close (segment creation), return focus to the carousel card that triggered it
- [x]Test touch targets: ensure clickable rows are at least 36px tall (aim for 40px)
- [x]Test single-card scenario: no scroll affordance needed, card centered or left-aligned
- [x]Test mobile viewport (375px): ensure first card is fully visible with peek of second card

**Acceptance criteria:**
- Keyboard-only users can navigate the carousel and activate actions
- Screen readers announce the carousel region and individual cards
- Focus returns correctly after modal interactions
- Touch targets meet minimum size requirements

## Post-Action Card States

| Action | Card State After | Carousel State |
|--------|-----------------|----------------|
| Click follow-up question | N/A — sends message, carousel clears | Cleared (new user message) |
| Click push-segment destination | Card unchanged (modal opens) | Persists during modal. Persists after modal close. |
| Click "Create Offer" | Card shows brief "Created" confirmation (checkmark icon, 1.5s), then reverts | Persists |
| Click save-playbook / share-slack / save-memory | Card shows brief "Done" confirmation (checkmark, 1.5s), then reverts | Persists |
| Click view-in-store / schedule-report / set-alert | Card unchanged (navigates or opens flow) | Persists |

## Defaults for Open Questions

| Question | Default | Rationale |
|----------|---------|-----------|
| Overflow at 6+ cards? | Horizontal scroll is sufficient. No "See all" button. | Fade mask hints at more. Extra button adds complexity. |
| Max items per card? | 4 visible rows. "+N more" text if overflow. | 140px height / ~32px per row after header = ~3-4 rows. |
| Offer customization flow? | Opens as a modal (existing pattern from store module). | Consistent with `CreateSegmentModal`. No new navigation pattern needed. |
| Carousel during streaming? | Only appears after `done` + `recommendations` events are both processed. | Prevents flash of incomplete data. |

## References & Research

### Internal References
- Brainstorm: `docs/brainstorms/2026-02-20-suggestion-carousel-brainstorm.md`
- Current action rows: `src/components/chat/chat-input.tsx:231-263`
- Current offer preview: `src/components/store/offer-preview-card.tsx`, `src/components/chat/chat-thread.tsx:215-233`
- FollowUpAction type: `src/lib/types.ts:27-46`
- OfferPreviewData type: `src/lib/types.ts:160-171`
- LLM recommender: `src/lib/action-recommender.ts`
- Heuristic engine: `src/lib/action-heuristic.ts`
- SSE event handling: `src/app/page.tsx:1329-1401`
- ChatThread rendering: `src/components/chat/chat-thread.tsx`
- Icon resolver (duplicated): `src/components/chat/chat-input.tsx:53-77`, `src/components/chat/follow-up-actions.tsx:53-75`
- Existing animations: `src/app/globals.css:148-197`
- Entity chip bar (chip pattern reference): `src/components/chat/entity-chip-bar.tsx`

### Institutional Learnings
- `docs/solutions/follow-up-actions-card-redesign.md` — brand icon registry pattern, component merging
- `docs/solutions/segments-implementation-solutions.md` — state sync with prop changes, keyboard nav in lists
- Pattern: "Never use Tailwind arbitrary values with CSS variables" — use inline `style={{}}` for dynamic values (MEMORY.md)
- Pattern: `animate-fade-in-up` is the standard chat message entrance animation (globals.css)
