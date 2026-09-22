# Metric Creation Flow — Wiring Table Selection to Generation

## Problem

The metric creation flow is ~70% built but broken at a critical junction. After the user selects a table in the `metric-table-select` card, nothing happens. The code marks the card as "confirmed" and stops. The LLM is never called to generate SQL/formula, and the confirm card is never rendered.

## Expected Flow

```
User: "create a metric called X which calculates Y"
  → Pattern match → stub Metric (v0) → table-select card

User: selects table
  → Phase loader: "Analyzing schema..." → "Generating SQL..." → "Computing value..."
  → POST /api/metric-update with table + description
  → metric-update-confirm card (SQL, formula, description, explanation)

User: clicks "Suggest edits"
  → Chat input prefilled → user types changes
  → Phase loader again → new confirm card
  → Loop until satisfied

User: clicks "Publish for review"
  → PendingMetricUpdate added to store → approval flow on metric detail page
```

## Changes

### 1. Trigger generation after table confirmation

**File:** `src/hooks/use-action-handlers.ts` or `src/hooks/use-analytics.ts`

New function `handleMetricGenerate(metricId, metricName, description, table)`:
- Inserts a `metric-generating` loader message into chat
- Calls `POST /api/metric-update` with `{ metricName, description, table, currentSql: "", currentFormula: "", userRequest: description }`
- Updates loader phases as work progresses
- On success: replaces loader with `metric-update-confirm` card
- On failure: replaces loader with error + retry

### 2. Phase-based loader (new chat variant)

**New variant:** `metric-generating` on ChatMessage

**New component:** `src/components/chat/metric-generating-card.tsx`

Three phases rendered as a vertical timeline with shimmer:
1. "Analyzing table schema..." (active immediately)
2. "Generating SQL & formula..." (active after ~1.5s)
3. "Computing metric value..." (active after ~3s)

Active phase: spinner + normal text. Completed phases: checkmark + muted text. Future phases: muted + dimmed.

### 3. Wire table confirm → generation

**File:** `src/components/chat/chat-thread.tsx`

`handleMetricTableSelect` currently just marks the card as confirmed. After marking, it should call `handleMetricGenerate` with the metric info from the card data.

### 4. Edit loop via chat

**File:** `src/components/chat/metric-update-confirm-card.tsx`

"Suggest edits" button:
- Changes card status to `"editing"` (visually dims the card)
- Calls `injectText()` from `useChatPanel()` to prefill chat input with context like "Edit [metric name]: "
- User types changes → classified as `metric_update` → existing flow handles regeneration
- New `metric-update-confirm` card appears after generation

### 5. Table relevance sorting

**File:** `src/components/chat/metric-table-select-card.tsx`

Simple keyword matching: tokenize metric name + description, score each table name by matching tokens. Show top 5 as "Recommended" section, rest collapsed under "Show all tables".

No LLM call — pure string matching.

## Files Touched

| File | Change |
|------|--------|
| `src/lib/types.ts` | Add `metric-generating` variant, add `metricGenerating` field |
| `src/components/chat/metric-generating-card.tsx` | New — phase loader component |
| `src/components/chat/chat-thread.tsx` | Render new variant, wire table confirm → generate |
| `src/hooks/use-analytics.ts` | Add `handleMetricGenerate` function |
| `src/hooks/use-action-handlers.ts` | Wire generation trigger after table confirm |
| `src/components/chat/metric-update-confirm-card.tsx` | Add "Suggest edits" → inject text into chat |
| `src/components/chat/metric-table-select-card.tsx` | Sort tables by relevance, recommended section |

## Not Changing

- `/api/metric-update` route — already generates SQL/formula via Gemini
- Approval flow — works once confirm card is rendered
- Metric detail page `?creating=true` — leave as-is for now, creation happens in chat
