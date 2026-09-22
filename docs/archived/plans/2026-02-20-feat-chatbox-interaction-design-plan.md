---
title: Chatbox Interaction Design — Three-Layer Intelligence System
type: feat
date: 2026-02-20
brainstorm: docs/brainstorms/2026-02-20-chatbox-interaction-design-brainstorm.md
---

# Chatbox Interaction Design — Three-Layer Intelligence System

## Overview

Build a three-layer chatbox intelligence system that makes Baby Sentinel's chat feel like it *understands the product* — not just the question. The system passively detects entities and time ranges as the user types (Layer 1), offers `@` mentions and `/run` commands for power users (Layer 2), and renders entity-aware responses with clickable links (Layer 3).

The primary user is a **curious explorer** (90%) who never touches `@` or `/run`. The system auto-detects context and injects it into the AI prompt, showing small chips below the input so the user sees what the system understood. Power users (10%) get explicit `@` references and `/run` playbook execution as progressive disclosure.

## Problem Statement

Currently, the chat has **zero entity awareness**. The AI receives only the user's raw text plus static knowledge/schema context. If a user asks "why is revenue dropping for whale users?", the system:
- Does not know "Revenue" is a tracked metric with current value + trend
- Does not know "whale users" is a defined segment with SQL + user count
- Cannot scope the query to the right time range unless the user specifies one explicitly
- Cannot link entity names in the response back to their detail pages

This gap means the AI generates generic SQL from scratch instead of leveraging the rich entity definitions already in the system.

## Proposed Solution

Three layers that work independently but compound together:

1. **Passive detection** — fuzzy-match input text against all entity stores, show detected context as chips below the textarea, auto-inject into prompt
2. **Power user triggers** — `@` opens a searchable entity dropdown with inline tokens; `/run` executes playbooks
3. **Response intelligence** — AI wraps entity names in `[[EntityName]]` syntax; custom markdown renderer converts to clickable links

## Technical Approach

### Architecture

```
┌─────────────────────────────────────────────────┐
│                   ChatInput                      │
│  ┌───────────────────────────────────────────┐   │
│  │  <textarea> (hidden, handles all input)   │   │
│  │  Visual overlay (renders @tokens styled)  │   │
│  └───────────────────────────────────────────┘   │
│  ┌───────────────────────────────────────────┐   │
│  │  Chip bar (detected entities + date range)│   │
│  └───────────────────────────────────────────┘   │
│  ┌───────────────────────────────────────────┐   │
│  │  @ Dropdown (positioned above textarea)   │   │
│  └───────────────────────────────────────────┘   │
│  Bottom bar: connected · deep research · send    │
└─────────────────────────────────────────────────┘

Detection flow:
  keystroke → 300ms debounce → detectEntities(text, catalog)
  → chips update + detectedEntities state set
  → on submit: buildEntityContext(detectedEntities) injected into prompt
```

**Key architectural decisions:**

| Decision | Choice | Rationale |
|----------|--------|-----------|
| `@` token rendering | Ghost textarea + visual overlay | Preserves native textarea behavior (mobile keyboards, a11y, IME). Minimal regression risk vs contentEditable or Lexical. |
| Entity detection | Client-side, debounced | All entity stores are client-accessible via `getAll*()`. ~44 entities total — trivially fast. |
| Context injection | New `buildEntityContext()` fn | Follows existing pattern (`buildKnowledgeContext()`, `buildStoreContext()`). Fourth injection point. |
| Response entity links | Prompt engineering (`[[Name]]`) + markdown post-processing | No API changes needed. Leverages existing custom markdown renderer. |
| Fuzzy matching | Word-boundary tokenization + substring on entity names/descriptions | Simple, deterministic, no external library. Priority ranking resolves ambiguity. |

### Implementation Phases

#### Phase 1: Entity Registry + Detection Engine

**Goal:** Build the unified entity catalog and fuzzy detection module as pure functions (no React).

**Files:**
- `src/lib/entity-types.ts` — unified entity types
- `src/lib/entity-registry.ts` — collects all entities from existing stores
- `src/lib/entity-detector.ts` — fuzzy matching + priority ranking + deduplication
- `src/lib/temporal-parser.ts` — date phrase detection + resolution

**Entity registry design:**

```typescript
// src/lib/entity-types.ts
export type EntityType = "metric" | "segment" | "playbook" | "knowledge" | "table" | "scout";

export interface DetectableEntity {
  id: string;
  type: EntityType;
  name: string;                    // Display name (required for all types)
  description?: string;            // Used for fuzzy matching
  tags?: string[];                 // Additional match terms
  stat?: string;                   // Chip display: "↓12% WoW", "1,234 users", etc.
  route?: string;                  // Navigation target when clicked
  contextPayload: Record<string, unknown>; // Injected into prompt (metric def, segment SQL, etc.)
}

export interface DetectedEntity {
  entity: DetectableEntity;
  matchType: "exact" | "fuzzy";    // How it was matched
  matchedOn: string;               // Which input token triggered the match
  source: "passive" | "explicit";  // Passive detection vs @reference
}

export interface DetectedDateRange {
  phrase: string;                  // Original text: "last 30 days"
  start: string;                   // ISO date
  end: string;                     // ISO date
  isDefault: boolean;              // True when no phrase found, using dataset default
}
```

**Entity registry** (`src/lib/entity-registry.ts`):

```typescript
import { getAllMetrics } from "./metric-store";
import { getAllEntries } from "./knowledge-store";
import { getSavedPlaybookSummaries } from "./playbook-store";
import { getScouts } from "./scout-store";
import { CATALOG_TABLES } from "./catalog-data";
// Segments come from SidebarContext (React), passed in as parameter

export function buildEntityCatalog(segments: SegmentDisplay[]): DetectableEntity[] {
  return [
    ...getAllMetrics().map(m => ({
      id: m.id, type: "metric" as const, name: m.name,
      description: m.description, tags: [m.category],
      stat: formatMetricStat(m),   // "↓12% WoW" or "$4.2M"
      route: `/metrics`,
      contextPayload: { definition: m.description, value: m.value, change: m.changePercent, sql: m.sql },
    })),
    ...segments.map(s => ({ /* similar mapping */ })),
    ...getSavedPlaybookSummaries().map(p => ({ /* similar mapping */ })),
    ...getAllEntries().map(k => ({
      id: k.id, type: "knowledge" as const,
      name: k.content.slice(0, 60),  // Use first 60 chars as pseudo-name (knowledge has no title field)
      description: k.content,
      stat: k.category,
      route: undefined,             // Knowledge entries open in sidebar panel
      contextPayload: { content: k.content, level: k.level, category: k.category },
    })),
    ...CATALOG_TABLES.map(t => ({ /* similar mapping */ })),
    ...getScouts().map(s => ({ /* similar mapping */ })),
  ];
}
```

**Detection algorithm** (`src/lib/entity-detector.ts`):

```typescript
export function detectEntities(
  inputText: string,
  catalog: DetectableEntity[],
  explicitRefs: string[] = [],  // IDs of @-referenced entities (always included)
): DetectedEntity[] {
  const inputTokens = tokenize(inputText);  // Split on whitespace/punctuation, lowercase
  const matches: DetectedEntity[] = [];

  for (const entity of catalog) {
    // Skip tokens < 4 chars for fuzzy (prevents "rev" → "Revenue" flicker)
    const match = findMatch(inputTokens, entity);
    if (match) matches.push(match);
  }

  // Deduplicate: if same entity matched passively AND explicitly, keep explicit
  // Priority rank: exact > fuzzy; metric > segment > playbook > knowledge > table > scout
  return deduplicateAndRank(matches, explicitRefs);
}
```

**Priority ranking** (from brainstorm):
1. Exact name match (highest)
2. Metric/KPI
3. Segment
4. Playbook
5. Knowledge entry
6. Table name (lowest)

**Temporal parser** (`src/lib/temporal-parser.ts`):

```typescript
const TEMPORAL_PATTERNS = [
  { pattern: /last (\d+) days?/i, resolve: (n) => subDays(today, n) },
  { pattern: /this week/i, resolve: () => startOfWeek(today) },
  { pattern: /last (\d+) weeks?/i, resolve: (n) => subWeeks(today, n) },
  { pattern: /since ([\w\s]+)/i, resolve: (phrase) => parseNaturalDate(phrase) },
  // ... more patterns
];

export function detectDateRange(inputText: string, datasetBounds: { min: string; max: string }): DetectedDateRange {
  for (const { pattern, resolve } of TEMPORAL_PATTERNS) {
    const match = inputText.match(pattern);
    if (match) return { phrase: match[0], start: resolve(match[1]), end: today, isDefault: false };
  }
  // Default: last 30 days (or dataset max range)
  return { phrase: "Last 30 days", start: subDays(today, 30), end: today, isDefault: true };
}
```

**Success criteria:**
- [x] `detectEntities()` returns ranked, deduplicated matches for any input string
- [x] `detectDateRange()` resolves temporal phrases to concrete ISO dates
- [x] `buildEntityCatalog()` aggregates all 6 entity types from existing stores
- [x] Unit-testable: no React dependencies, pure functions

---

#### Phase 2: Chip Bar UI

**Goal:** Render detected entities + date range as chips below the textarea in `ChatInput`.

**Files:**
- `src/components/chat/chat-input.tsx` — integrate detection + render chips
- `src/components/chat/entity-chip-bar.tsx` — new component for chip row

**Layout (within ChatInput, after textarea, before bottom bar):**

```
┌──────────────────────────────────────────────┐
│ [action rows — existing]                     │
│ ┌──────────────────────────────────────────┐ │
│ │ textarea                                 │ │
│ └──────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────┐ │  ← NEW
│ │ 📊 Revenue ↓12% · 👥 Whale Users 1.2k · │ │
│ │ 📅 Last 30 days        +2 more           │ │
│ └──────────────────────────────────────────┘ │
│ Connected · Deep Research [toggle] · [Send]  │
└──────────────────────────────────────────────┘
```

**Chip bar rules:**
- Max **5 chips** visible + "+N more" overflow indicator
- Date range chip always occupies one slot (last position)
- Chips are **read-only** — no dismiss, no toggle
- Entity chips show: type icon + name + stat (truncated)
- Date range chip shows: calendar icon + resolved range text
- Chip bar **hidden** when no entities detected AND no text in input (no default date chip on empty input)
- Chip bar **clears** on submit (detected entities stored on the message instead)

**Chip appearance:**
- Small pill shape, `text-xs`, `bg-muted`, `rounded-full`, `px-2 py-0.5`
- Type icon: small colored dot or emoji (📊 metric, 👥 segment, 📋 playbook, 💡 knowledge, 🗂 table)
- Subtle, non-intrusive — should not visually compete with the textarea

**State flow:**
```
value changes → 300ms debounce → detectEntities(value, catalog) + detectDateRange(value, bounds)
→ setDetectedEntities(results) → chip bar re-renders
→ on submit: pass detectedEntities to handleSend() → clear chips
```

**Success criteria:**
- [x] Chips render below textarea, above bottom bar
- [x] Max 5 chips with overflow indicator
- [x] Date range chip always present when user has typed text
- [x] Chips clear on submit
- [x] 300ms debounce on detection (no flicker during fast typing)
- [x] No visual regression when no entities detected (chip bar hidden)

---

#### Phase 3: Context Injection Pipeline

**Goal:** Inject detected entities into the AI prompt for both analytics and direct response paths.

**Files:**
- `src/lib/entity-context.ts` — new: `buildEntityContext()` function
- `src/app/page.tsx` — pass detected entities through handleSend
- `src/app/api/analyze/route.ts` — receive + inject entity context
- `src/app/api/chat/route.ts` — receive + inject entity context
- `src/app/api/classify/route.ts` — receive entity context for better classification

**Context format** (similar to existing `buildKnowledgeContext()`):

```typescript
// src/lib/entity-context.ts
export function buildEntityContext(entities: DetectedEntity[], dateRange: DetectedDateRange): string {
  if (entities.length === 0 && dateRange.isDefault) return "";

  const sections: string[] = [];

  if (!dateRange.isDefault) {
    sections.push(`[Time Range] ${dateRange.phrase} → ${dateRange.start} to ${dateRange.end}`);
  }

  // Group by type, serialize key metadata only (not full contextPayload)
  const grouped = groupBy(entities, e => e.entity.type);
  for (const [type, items] of Object.entries(grouped)) {
    const lines = items.map(e => {
      const { name, contextPayload } = e.entity;
      return `- ${name}: ${summarizePayload(type, contextPayload)}`;
    });
    sections.push(`[Detected ${capitalize(type)}s]\n${lines.join("\n")}`);
  }

  return `\n--- Detected Context ---\n${sections.join("\n\n")}\n--- End Detected Context ---\n`;
}
```

**Token budget:** Cap serialized entity context at ~2000 tokens. If over budget, prioritize by: explicit `@` refs first, then by entity type priority ranking, truncating lower-priority entities.

**Injection points:**
1. **Classifier** (`/api/classify`): Append entity context so classifier can make better analytics/direct decisions (e.g., if metrics are detected, lean toward analytics)
2. **Analyze** (`/api/analyze`): Inject after knowledge context, before user query, in the SQL generation system prompt
3. **Chat** (`/api/chat`): Inject after knowledge context for direct responses

**Data flow:**
```
ChatInput.handleSend(text, detectedEntities, dateRange)
  → page.tsx passes entities in fetch body
  → API route calls buildEntityContext(entities, dateRange)
  → Appended to system prompt alongside existing buildKnowledgeContext()
```

**Critical lesson from documented solutions:** Entity context must be injected in BOTH analytics and direct paths. The classifier misrouting solution (`docs/solutions/logic-errors/classifier-misrouting-composite-queries.md`) documented that features wired to only one path silently break in the other.

**Success criteria:**
- [x] `buildEntityContext()` produces a formatted string from detected entities
- [x] Entity context injected in `/api/classify`, `/api/analyze`, AND `/api/chat`
- [x] Token budget cap prevents context overflow
- [x] Existing `buildKnowledgeContext()` and `buildStoreContext()` remain untouched

---

#### Phase 4: `@` Mention Dropdown + Inline Tokens

**Goal:** Type `@` to open a searchable entity dropdown; selected entities render as styled inline tokens.

**Files:**
- `src/components/chat/chat-input.tsx` — `@` trigger detection, overlay rendering
- `src/components/chat/mention-dropdown.tsx` — new: searchable entity picker
- `src/components/chat/mention-overlay.tsx` — new: visual overlay for inline tokens

**`@` trigger behavior:**
- Typing `@` anywhere in the textarea opens the dropdown immediately (no debounce)
- Subsequent characters filter the dropdown: `@rev` → shows "Revenue", "Revenue Deep-Dive"
- Dropdown grouped by entity type (Metrics, Segments, Playbooks, Knowledge, Tables)
- Arrow keys navigate, Enter selects, Escape closes
- Clicking outside closes the dropdown, `@text` remains as plain text

**Dropdown design:**
- Positioned **above** the textarea (popover-style), anchored to cursor position
- Max height: 280px with scroll
- Each row: type icon + entity name + stat preview
- Groups separated by type header labels
- Max 20 results shown (performance cap)

**Inline token rendering (ghost textarea approach):**
1. The actual `<textarea>` is **visually hidden** but still handles all input (position: absolute, opacity: 0)
2. A `<div>` overlay mirrors the textarea content, rendering `@EntityName` segments as styled `<span>` chips
3. The overlay div matches the textarea's font, padding, line-height exactly
4. Cursor blinking is handled by the hidden textarea; visual focus is styled on the overlay

**Token data model:**
```typescript
interface MentionToken {
  entityId: string;
  entityType: EntityType;
  displayName: string;
  startIndex: number;  // Position in the raw text
  endIndex: number;
}
```

**Backspace behavior:** Pressing Backspace into a token deletes the entire token atomically (replaces the `@EntityName` text with empty string). This avoids partial-token states.

**Interaction with passive detection:** Explicitly `@`-referenced entities are:
- Always included in `detectedEntities` (not filtered by debounce or fuzzy threshold)
- Shown as chips with a distinct "explicit" style (slightly different border/icon)
- Given highest priority in context injection (never truncated by token budget)

**Accessibility:**
- Dropdown: `role="listbox"`, items `role="option"`, `aria-activedescendant` for keyboard nav
- Tokens in overlay: `aria-label="Mentioned entity: Revenue"` on each span
- Chip bar: `role="status"`, `aria-live="polite"` for screen reader announcements

**Success criteria:**
- [ ] `@` opens dropdown immediately with full entity list
- [ ] Typing after `@` filters results across all entity types
- [ ] Arrow key + Enter selection works
- [ ] Selected entity renders as styled token in overlay
- [ ] Backspace deletes entire token atomically
- [ ] Multiple `@` references supported in same message
- [ ] Dropdown positions correctly (no off-screen overflow)
- [ ] Keyboard accessible (listbox ARIA pattern)

---

#### Phase 5: `/run` Playbook Execution

**Goal:** Type `/run` to open a playbook picker and execute inline.

**Files:**
- `src/components/chat/chat-input.tsx` — `/run` trigger detection
- `src/components/chat/playbook-picker.tsx` — new: playbook selection + param form
- `src/app/page.tsx` — `/run` execution handler

**`/run` behavior:**
- `/run` must be the **first token** in the input (matching existing `/playbook` convention)
- Typing `/run` shows a playbook picker dropdown (similar to `@` dropdown but playbook-only)
- Selecting a playbook shows an inline param form if the playbook has `PlaybookParam[]`
- Confirming executes the playbook via the existing analysis pipeline
- Output appears as a standard analysis response in the chat thread

**Playbook sources:** Merge saved playbooks (`getSavedPlaybookSummaries()`) with preseeded scout playbooks (`getScouts()` → extract `.playbook` references). This addresses the gap where scout playbooks are not in `savedPlaybooks`.

**Relationship with existing `/playbook` command:**
- `/playbook` (existing) = save current analysis as a new playbook
- `/run` (new) = execute an existing playbook
- Both coexist. No changes to existing `/playbook` handling.

**Success criteria:**
- [ ] `/run` opens playbook picker when typed as first token
- [ ] Picker shows both saved and preseeded playbooks
- [ ] Parameter form renders for playbooks with params
- [ ] Execution produces standard analysis response
- [ ] Coexists with existing `/playbook` command

---

#### Phase 6: Response Entity Links (Layer 3)

**Goal:** Make entity names in AI responses clickable, linking to their detail pages/panels.

**Files:**
- `src/lib/markdown.tsx` — extend custom renderer with `[[EntityName]]` parsing
- `src/app/api/analyze/route.ts` — add prompt instruction for `[[]]` syntax
- `src/app/api/chat/route.ts` — add prompt instruction for `[[]]` syntax

**Prompt engineering:**
Add to the synthesis system prompt:
```
When referencing entities that were provided in the Detected Context section,
wrap their names in double brackets: [[Revenue]], [[Whale Users]], [[daily_metrics]].
Only use this syntax for entities that were explicitly provided in context.
```

**Markdown renderer extension:**
```typescript
// In src/lib/markdown.tsx, add a parsing step:
// [[EntityName]] → <button onClick={() => navigateToEntity(name)} className="entity-link">EntityName</button>

function parseEntityLinks(text: string, entityMap: Map<string, DetectableEntity>): ReactNode[] {
  // Split on [[...]] pattern
  // For each match, look up entity in entityMap
  // Render as clickable link with appropriate navigation
}
```

**Navigation targets:**
| Entity Type | Click Action |
|-------------|-------------|
| Metric | Navigate to `/metrics` (or open metrics sidebar panel) |
| Segment | Navigate to `/segments/{id}` |
| Playbook | Navigate to `/playbooks/{id}` |
| Knowledge | Open knowledge sidebar panel |
| Table | Navigate to `/catalog` |
| Scout | Navigate to `/scouts/{id}` |

**Fallback:** If the AI outputs `[[SomeName]]` that doesn't match any known entity, render as plain bold text (no link). This handles hallucinated entity names gracefully.

**Success criteria:**
- [ ] AI responses use `[[EntityName]]` syntax for detected entities
- [ ] Markdown renderer converts `[[]]` to clickable links
- [ ] Clicking entity link navigates to appropriate page/panel
- [ ] Unknown `[[]]` references degrade to bold text (no broken links)
- [ ] Works in both analytics (deep research) and direct response paths

---

## Alternative Approaches Considered

| Approach | Why Rejected |
|----------|-------------|
| **Lexical/Slate/TipTap** for rich textarea | Massive dependency, breaks mobile keyboards, accessibility regression, overkill for prototype |
| **contentEditable div** | Manual cursor management, IME issues, accessibility nightmare |
| **Server-side entity detection** | Adds latency, unnecessary — entity stores are client-accessible |
| **Structured output** for response entity links | Requires API schema changes, more complex than prompt engineering for prototype |
| **Dismissable chips** | Adds interaction complexity for 0 benefit — auto-inject is the design philosophy |

## Acceptance Criteria

### Functional Requirements

- [ ] Typing in chat input triggers entity detection after 300ms debounce
- [ ] Detected entities appear as chips below the textarea
- [ ] Date range is always resolved (explicit phrase or default)
- [ ] `@` opens searchable entity dropdown grouped by type
- [ ] Selected `@` entities render as styled inline tokens
- [ ] `/run` opens playbook picker and executes selected playbook
- [ ] Detected entities are injected into AI prompt (both analytics and direct paths)
- [ ] AI responses contain clickable entity links via `[[EntityName]]` syntax
- [ ] Entity links navigate to appropriate detail pages

### Non-Functional Requirements

- [ ] Detection completes in <50ms for ~44 entities (no perceptible lag)
- [ ] No visual flicker during fast typing (debounce + word-boundary matching)
- [ ] Keyboard accessible: dropdown navigation, chip bar announced to screen readers
- [ ] No regression in existing chat functionality (follow-up actions, deep research toggle, send/stop)

### Quality Gates

- [ ] `pnpm build` passes after each phase
- [ ] Manual test: type "revenue dropping for whale users last 30 days" → see 3 chips (Revenue metric, Whale Users segment, date range)
- [ ] Manual test: type `@Rev` → dropdown shows Revenue metric → select → token appears → submit → AI response references `[[Revenue]]` as clickable link
- [ ] Manual test: `/run Revenue Deep-Dive` → picker opens → execute → analysis appears

## Dependencies & Prerequisites

- All existing entity stores (`metric-store`, `knowledge-store`, `playbook-store`, `scout-store`, `catalog-data`) must remain stable
- `SidebarContext` must continue providing `segments` array
- Custom markdown renderer (`src/lib/markdown.tsx`) must remain extensible

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Ghost textarea + overlay misalignment | Medium | High | Match font, padding, line-height exactly. Test across browsers. |
| False positive entity detection ("review" → "Revenue") | Medium | Medium | Word-boundary tokenization, min 4-char fuzzy threshold, exact-only for short tokens |
| Token budget overflow with many entities | Low | Medium | Cap at 2000 tokens, priority-based truncation |
| AI ignoring `[[]]` prompt instruction | Low | Medium | Fallback renders `[[]]` as bold text. Can switch to post-processing if needed. |
| Mobile keyboard issues with hidden textarea | Medium | Low | Test on iOS Safari + Android Chrome. Prototype-only, not production. |

## Future Considerations

- **Conversational context detection (v2):** Use previous messages to resolve ambiguous references ("tell me more about that segment")
- **Knowledge entry titles:** Add a `title` field to `KnowledgeEntry` type for better matching and display
- **Entity tags:** Add `tags: string[]` to `Metric`, `Segment`, `Scout` types for richer fuzzy matching
- **Chip persistence on messages:** Show detected entities as subtle metadata on user messages in the thread (traceability)
- **`/deep` and `/quick` commands:** Currently handled by toggle; could add as slash commands for keyboard-first users

## References & Research

### Internal References

- Brainstorm: `docs/brainstorms/2026-02-20-chatbox-interaction-design-brainstorm.md`
- Chat input: `src/components/chat/chat-input.tsx`
- Entity stores: `src/lib/metric-store.ts`, `src/lib/knowledge-store.ts`, `src/lib/playbook-store.ts`, `src/lib/scout-store.ts`
- Catalog tables: `src/lib/catalog-data.ts`
- Segments: `src/components/segments/mock-segments.ts` + `/api/segments`
- Follow-up actions: `src/lib/action-heuristic.ts`, `src/lib/action-recommender.ts`
- Context injection: `src/lib/knowledge-context.ts`, `src/lib/store-context.ts`, `src/lib/schema.ts`
- Markdown renderer: `src/lib/markdown.tsx`
- Main page: `src/app/page.tsx`

### Documented Solutions Applied

- `docs/solutions/design-patterns/follow-up-actions-card-redesign.md` — priority-based slot allocation, focus forwarding, state management patterns
- `docs/solutions/logic-errors/classifier-misrouting-composite-queries.md` — cross-path injection (analytics + direct), prompt hardening
- `docs/solutions/design-patterns/lift-sidebar-state-to-layout-context.md` — context provider pattern for state persistence

### Open Questions Resolved

| Question | Decision |
|----------|----------|
| Should chip bar persist after submit? | **No.** Chips clear on submit. Detected entities stored as metadata on the chat message for traceability (future enhancement). |
| Should `@` references work in AI response? | **Yes.** Via `[[EntityName]]` prompt engineering + markdown renderer post-processing. |
| What debounce for detection? | **300ms** after last keystroke. Immediate on `@` trigger. Skip detection for input < 3 chars. |
| Max visible chips? | **5** + "+N more" overflow. Date range always occupies one slot. |
| `/run` vs `/playbook`? | **Coexist.** `/playbook` = save, `/run` = execute. No changes to existing `/playbook`. |
