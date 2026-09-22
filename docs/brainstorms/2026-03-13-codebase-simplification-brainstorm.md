# Codebase Simplification Brainstorm

**Date:** 2026-03-13
**Status:** Complete — CLAUDE.md updated, docs written

## What We're Doing

Not simplifying the code itself (everything is in flux), but simplifying how future AI sessions and human developers understand and extend it. The goal: make CLAUDE.md and architecture docs accurate enough that any new feature can be added by following patterns — no archeology required.

## What We Found

### Scale
- **344 files** — 156 components, 101 lib, 77 app, 9 hooks
- **46 API routes** across 10 feature domains
- **30 files over 200 lines**, 6 over 700 lines

### Well-Designed Patterns (just undocumented)

**Store / Data split** — Every entity has:
- `*-data.ts` → static seed data (`PRESEEDED_*`, `TEMPLATE_*` constants). Immutable.
- `*-store.ts` → runtime in-memory CRUD (`Map<string, T>` + `ensureInitialized()`). Calls `invalidateCatalog()` on mutations.

This is clean. It was just never written down anywhere useful.

**Hooks composition in ChatStateProvider** — 8 hooks composed into one context:
`useConversation`, `usePanel`, `useSegmentCreation`, `usePlaybookCreation`, `useAnalytics`, `useActionHandlers`, `useDbHealth`, `useDirectStream`

This is intentional — each hook owns one concern. Don't merge them.

**Provider tree order matters** — upstream providers inject config that downstream providers depend on.
`DatasetProvider → ModelProvider → SidebarProvider → EntityCatalogProvider → ChatStateProvider → ChatPanelProvider`

### Duplication (no shared UI abstractions yet)

Every feature area reimplements the same patterns:
| Pattern | Appears in |
|---------|-----------|
| Delete confirmation dialog | metric, segment, playbook, knowledge, scout, canvas |
| Detail side panel (header + content + actions) | metric, segment, playbook, scout, canvas, forecast |
| Card with hover dropdown menu | knowledge, segment, store-insight, integration |
| Modal with form + submit | segment, playbook, knowledge, metric (×2), connector |
| Empty state (icon + heading + CTA) | segments, metrics, playbooks, scouts, knowledge |

These aren't blocking anything now, but every new entity adds ~200 more lines of duplicated boilerplate. The CLAUDE.md should at minimum document the expected shape so new code is consistent.

### catalog-invalidation.ts Gap

`folder-store.ts` does not call `invalidateCatalog()` on mutations. All other stores with entities do. Either folders aren't in the entity catalog (correct) or this is a silent bug (needs verification).

### CLAUDE.md Gaps Found

The existing CLAUDE.md:
- Only mentions chat/sidebar/ui in "Frontend Components" — ignores canvas (34 files), deck (2), forecast (4), metric (7), playbook (4), segments (8), etc.
- Lists 3 stores calling `invalidateCatalog()` — incomplete
- Has no documentation on the store/data split pattern
- Has no documentation on the hooks composition architecture
- Has no guidance on UI patterns to reuse vs. create fresh

## Key Decisions

1. **Update CLAUDE.md** — expand architecture section to cover all feature areas, document the store/data pattern, document hooks, add UI pattern guidance
2. **No code changes now** — this is a docs pass, not a refactor. Flag duplication opportunities but don't implement
3. **Leave folder-store gap as a TODO** — needs product decision on whether folders are catalog entities
4. **Don't create shared UI components yet** — wait until 3+ features need the same change simultaneously (YAGNI)

## Open Questions

- Should `folder-store.ts` call `invalidateCatalog()`? (Depends on whether folders appear in the @ picker)
- Is there a `store-data.ts` → `store-store.ts` pattern for the eCommerce store page, or is `store-data.ts` just static mock data?
- Canvas shapes (`src/components/canvas/`) and deck canvas (`src/components/deck/`) — are these converging or separate forever?
