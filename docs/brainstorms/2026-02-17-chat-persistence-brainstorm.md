# Chat Conversation Persistence

**Date:** 2026-02-17
**Status:** Decided
**Branch:** v1-sv
**Related:** US-1 in TODO.md, `docs/brainstorms/2026-02-17-cross-feature-consistency-brainstorm.md`

## What We're Building

Server-side persistence for chat conversations so they survive page navigation and browser refresh, matching the persistence level of knowledge and playbooks (in-memory server Map + API routes).

## Why This Approach

### Context

Chat conversations are currently the least persistent data in the app — stored entirely in React `useState`/`useRef` in `page.tsx`. Navigating to `/segments` and back loses everything. Meanwhile, segments persist in DuckDB, and knowledge/playbooks persist in server-side in-memory Maps.

### Decision: In-Memory Map + API Routes

We explored three options:

| Option | Survives nav | Survives refresh | Survives restart | Effort |
|--------|-------------|-----------------|-----------------|--------|
| React context only | Yes | No | No | Low |
| **In-memory Map + API** | **Yes** | **Yes** | **No** | **Medium** |
| DuckDB table | Yes | Yes | Yes | Medium-High |

**Chosen: In-memory Map + API** because:
1. Matches existing patterns exactly (`knowledge-store.ts`, `playbook-store.ts`, `metric-store.ts`)
2. Sufficient for a demo/prototype — server restart losing data is acceptable
3. Simpler than DuckDB — no schema changes, no JSON serialization of complex nested types
4. Can migrate to DuckDB later if full persistence becomes important

**Why not DuckDB:** While DuckDB would give restart persistence and enable natural joins for US-4 (segment → conversation linking), it's heavier than needed. Storing `ChatMessage[]` (with deeply nested `AgentInfo`, `SubagentInfo`, queries, etc.) as a JSON blob in DuckDB is awkward. DuckDB is an analytics engine, not an app database.

**Why not React context only:** Doesn't survive page refresh. Every other server-backed feature (knowledge, playbooks, segments) survives refresh — chat should too.

## Key Decisions

1. **Storage:** Server-side `Map<string, Conversation>` in `conversations-store.ts`
2. **API shape:** Standard REST — `GET/POST /api/conversations`, `GET/PATCH/DELETE /api/conversations/[id]`
3. **Sync timing:** Save at natural points only (response finishes, conversation switch, navigation away) — not real-time during streaming
4. **Seed data:** `PRELOADED` conversations become `PRESEEDED_CONVERSATIONS` in the store, matching the pattern of other stores
5. **Client state:** Chat page still owns streaming state locally for real-time updates, then syncs to server at save points
6. **SidebarContext role:** Holds `chatList` and `activeId` for sidebar display. Does NOT hold messages — those come from the API.

## Open Questions

1. Should `PRELOADED` conversations be editable (appendable) or read-only fixtures?
2. Max conversation count before pruning old ones? (Probably not needed for demo)

## Implementation Sketch

```
New files:
  src/lib/conversations-store.ts          — Map + CRUD + PRESEEDED data
  src/app/api/conversations/route.ts      — GET (list all), POST (create)
  src/app/api/conversations/[id]/route.ts — GET (single + messages), PATCH (update), DELETE

Modified files:
  src/components/sidebar-context.tsx — chatList initialized from API, not INITIAL_CHATS
  src/app/page.tsx — fetch conversation on mount, sync at save points
  src/lib/chat-data.ts — may move PRELOADED here or to conversations-store
```
