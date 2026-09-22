---
date: 2026-02-20
topic: suggestion-carousel
---

# Unified Suggestion Carousel

## What We're Building

Replace the current two separate suggestion surfaces — the "What would you like to do next?" action rows inside ChatInput and the standalone OfferPreviewCard message variant — with a single **horizontally scrollable card carousel** that appears below the last AI message in the chat thread.

The carousel renders a strip of consistently-sized cards (~120-160px tall) that can hold heterogeneous content: follow-up question cards, action cards (create segment, share to Slack), and rich preview cards (offer preview with pricing/audience/dates). This unifies all post-analysis suggestions into one discoverable, non-blocking surface.

## Why This Approach

**Considered:**
- **Approach A (Card Carousel)** — uniform cards, everything is a card ✅ chosen
- **Approach B (Mixed Strip)** — chips + one featured card; inconsistent heights
- **Approach C (Chips + Expandable)** — compact but hides offer details behind a click

**Chose A because:**
- Most scalable — easy to add new rich card types later (segment previews, chart thumbnails, playbook cards)
- Consistent visual language — no mixed heights or layout hacks
- Offer card keeps its at-a-glance value without extra clicks
- Industry pattern (App Store "Today" cards, Perplexity related questions)

## Key Decisions

- **Placement**: Below the last AI message, inside the chat scroll area (Perplexity-style). Tied to the specific response, not the input bar.
- **Lifecycle**: Persists until the next user message is sent. No auto-dismiss on typing. No explicit dismiss button needed (sending a message clears it).
- **Card sizing**: Fixed height (~140px), variable width per card type. Follow-up question cards are narrower (~180px), offer/action cards are wider (~260px).
- **Scroll behavior**: Single-row horizontal scroll, hidden scrollbar, right-edge fade mask to hint at more items. Touch-swipe on mobile.
- **Animation**: Slide-up + fade-in (200ms ease-out) after analysis completes. Individual cards stagger in with 40ms delay offset.
- **Card model — grouped options**: Each card is a container for *related* options, not one-option-per-card. This keeps the carousel compact (3-4 cards instead of 6-8) while making each card actionable.
- **Card types (initial)**:
  - `follow-up-questions` — groups all suggested questions into one card. Each question is a clickable row that sends it as a message.
  - `push-segment` — groups export/push destinations (BigQuery, Firebase, CleverTap) into one card. Each destination is a clickable row.
  - `offer-preview` — condensed offer card (SKU, pricing, audience, date range). Single "Create Offer" CTA. Customization opens a separate flow (not inline).
  - `action` — catch-all for other single actions (save playbook, share to Slack, etc.)
- **Modes**: Shows for both deep research and quick-answer mode, as relevant. The LLM recommender and heuristic engine both emit carousel cards.
- **Data source**: Same two engines (LLM recommender for deep mode, heuristic fallback) but output format changes to include card type + grouped options metadata.
- **Offer customization**: Always opens a separate flow. No inline editing in carousel cards.
- **Replaces**: The action rows inside ChatInput AND the OfferPreviewCard message variant. Both removed.

## Visual Reference

```
[... last AI message / agent cards ...]

┌───────────────────┐  ┌──────────────────────┐  ┌───────────────────┐
│ 💬 Follow up       │  │ 🏷️ Suggested Offer    │  │ 📤 Push Segment    │
│                    │  │ 500 Gems             │  │                    │
│ ○ What campaigns   │  │ $4.99 → $4.49  10%   │  │ ○ BigQuery         │
│   ran?             │  │ All players           │  │ ○ Firebase         │
│ ○ Incentivize more │  │ Feb 27 — Mar 6       │  │ ○ CleverTap        │
│   purchases        │  │                      │  │                    │
│ ○ View store       │  │ [Create Offer]       │  │                    │
│   metrics          │  │                      │  │                    │
└───────────────────┘  └──────────────────────┘  └───────────────────┘
                          ← swipe →

┌─────────────────────────────────────────────────────────────────────────────┐
│ Type a message...                                                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Open Questions

- Do we want a "See all" overflow button if there are 6+ cards, or is horizontal scroll sufficient?
- What's the max number of grouped options per card before it feels too dense? (Likely 4-5)
- Should the offer customization flow be a modal, a side panel, or a new chat message with a form?

## Next Steps

→ `/workflows:plan` for implementation details
