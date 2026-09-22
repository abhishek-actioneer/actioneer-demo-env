---
date: 2026-02-20
topic: chatbox-interaction-design
---

# Chatbox Interaction Design

## What We're Building

A three-layer chatbox intelligence system that makes Baby Sentinel's chat feel like it *understands the product* — not just the question. The primary user is a **curious explorer** asking broad questions, but the system should also feel intuitive to an **action-oriented PM** who wants to go from insight to action fast.

## Why This Approach

We explored three options: input-time intelligence only, response-time intelligence only, or both layers combined. We chose **both** with the input layer kept subtle — just enough to show the system "gets it" without turning the chatbox into a command palette. Power users get explicit `@` and `/run` escape hatches, but 90% of users never need them.

## The Three Layers

### Layer 1: Passive Detection (as you type)

- Fuzzy-match user input against known entities (metrics, segments, playbooks, knowledge entries, tables)
- Detect temporal phrases ("this week", "last 30 days", "since launch") and resolve to concrete date ranges
- Display detected context as **inline chips below the input** — small, non-intrusive, showing entity name + key stat (e.g., `Revenue ↓12% WoW` · `Nov 11–16`)
- All detected entities are **auto-injected** into the AI prompt context — no user action required
- Chips are informational only — they show the user what the system understood
- If no time phrase is found, a default date range chip is surfaced so the user sees what window the AI will query

### Layer 2: Power User Triggers (`@` and `/run`)

**`@` references (entities):**

| Entity | Example | What it injects |
|--------|---------|-----------------|
| Metric | `@Revenue` | Metric definition + current value + trend |
| Segment | `@Whale Users` | Segment SQL + user count |
| Playbook | `@Revenue Deep-Dive` | Playbook reference, can trigger run |
| Knowledge | `@Android revenue gap` | Documented insight content |
| Dataset table | `@daily_metrics` | Scopes query to specific table |

- `@` opens a searchable dropdown of entities grouped by type
- Typing `@rev` filters to matching entities across all types
- Selected `@` references render as styled inline tokens in the textarea

**`/` commands:**

| Command | Example | What it does |
|---------|---------|-------------|
| `/run` | `/run Revenue Deep-Dive` | Execute a playbook with optional params |

- `/run` opens a playbook picker — select a playbook, optionally set params, execute inline
- Only `/run` for now — `/deep`, `/quick`, `/pin` already have existing UI affordances

### Layer 3: Response Intelligence (after submit)

- The AI response references detected entities by name with links (clicking "Revenue" opens the metric page)
- Follow-up action cards appear below the response (existing `FollowUpAction` system)
- When a playbook was relevant, the response offers "Run Revenue Deep-Dive for full analysis" as an action
- Segment suggestions appear as actionable cards ("Create segment: Android users with 0 purchases this week")

## Key Decisions

- **Auto-inject all detected context**: No dismiss UI, no opt-in. The system is confident. This keeps the explorer flow frictionless.
- **Date range is always detected**: Temporal phrases resolve to dataset-aware ranges. If no time phrase is found, default range is surfaced as a chip so the user sees what window the AI will query.
- **`@` and `/run` are progressive disclosure**: Never required, never taught upfront. Power users discover them naturally. The passive layer handles 90% of use cases.
- **Entity detection is fuzzy**: "revenue" matches the Revenue metric even without `@`. "whale users" matches the Whale Users segment. Matching uses the entity name + description + tags.
- **Chips show, not ask**: The chips below input are read-only context indicators. No toggles, no checkboxes. They tell the user "I detected these" — that's it.

## Entity Detection Priority

When multiple entities match, rank by:

1. **Exact name match** (highest)
2. **Metric/KPI** (most commonly referenced)
3. **Segment**
4. **Playbook**
5. **Knowledge entry**
6. **Table name** (lowest — rarely referenced by explorers)

## Open Questions

- Should the chip bar persist after submit (showing what context was used), or clear with the input?
- Should `@` references work inside the AI response too (clickable entity links in the output)?
- What's the debounce/threshold for detection — every keystroke, or after a pause?

## Next Steps

-> `/workflows:plan` for implementation steps across `chat-input.tsx`, a new entity detection module, and prompt injection layer.
