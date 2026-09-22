---
title: Living Deck
date: 2026-03-11
status: complete
---

# Living Deck — Brainstorm

## Concept

Move the weekly business review deck onto Sentinel. User uploads a PDF deck; Sentinel reconstructs it with live data, generates deep-research commentary per chart, and allows an AI challenge agent to question the commentary across all charts.

## Key Decisions

### Entry Point
- **Deck-first**: user uploads a PDF. Sentinel infers metrics and visualization preferences from it.
- KPI-first (future) explicitly deferred.

### Card Layout
- **Hub + satellites**: chart card is the hub (heavier border), satellite cards stacked below it.
- Satellites: Analysis (deep research summary), Follow-ups (2-3 AI questions), Challenge (appears after Challenge deck runs).

### Canvas Layout
- **Horizontal scroll** — one column per slide, left to right in deck order.
- Small monospace slide index above each cluster.
- Satellites stacked 6px below hub, clusters spaced 28px apart.

### Challenge Agent
- **Deck-wide button** ("Challenge deck") — one action runs across all charts as a batch.
- Creates one new sidebar conversation thread.
- Challenge satellite card per slide links to that thread, opens in new tab.

### Chart-to-context
- **"Ask about this →"** on hub card — creates a new conversation thread pre-seeded with chart title + SQL + data sample. Chat panel slides in from right.

### Commentary / Analysis
- NOT just 2-sentence AI text. **Deep research runs per chart** on refresh.
- Commentary card = concise summary (2-3 sentences) of that deep research.
- `commentaryThreadId` stored per slide — links to the full report in sidebar chat.
- Clicking the Analysis satellite opens the chat panel to that thread (full report visible, user can continue conversation).
- Renamed from "Commentary" → "Analysis" to signal depth.

### Re-analyze (Refresh)
- "↻ Re-analyze" button — re-runs SQL + re-runs deep research + regenerates commentary + new `commentaryThreadId`.
- Streams per-slide progress in top bar.

### Chat Panel
- Slides in from right **on demand** — not always visible.
- Triggered by: clicking Analysis satellite (loads existing thread) or "Ask about this" (creates new thread).
- Has ✕ close button. Does not conflict with left nav sidebar.
- Full deep research report rendered as existing report card.

### Architecture
- **Approach A**: `/decks` as a new top-level page, Deck as a first-class persistent entity.
- No tldraw — custom React layout.
- `deck-store.ts` + `slide-store.ts` follow existing in-memory Map + localStorage pattern.
- PDF processed via Gemini File API (`application/pdf` natively supported — no pdf2pic needed).
- Single Gemini call extracts all slides in one shot; file deleted after.

## Design Refinements (from frontend-design review)

- "Commentary" → "Analysis" label
- "Refresh all" → "↻ Re-analyze"
- Analysis satellite has ↗ icon (signals "open report") vs hub's "Ask about this →" (signals "new thread")
- Challenge card gets full foreground border (same weight as hub) — first-class finding
- Follow-up items have animated › arrow on hover — clearly clickable
- Slide index numbers above each cluster for orientation during horizontal scroll
- Column height concern: 4 stacked cards gets tall — collapsed state for analysis/follow-ups considered but deferred to implementation

## Open Questions (deferred)

- Collapsed vs expanded default for satellite cards
- Multiple decks: navigation between decks
- Scheduled re-analyze (cron)
