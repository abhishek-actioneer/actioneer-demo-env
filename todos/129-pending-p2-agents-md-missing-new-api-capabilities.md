---
status: pending
priority: p2
issue_id: "129"
tags: [code-review, agent-native, documentation, pr-48]
dependencies: []
---

# 0 of 9 new capabilities documented in AGENTS.md — all features are UI-only to agents

## Problem Statement

PR #48 adds 9 significant user-facing capabilities with server-callable API endpoints, but ships zero corresponding agent documentation. AGENTS.md currently contains developer conventions (copy of CLAUDE.md) rather than an agent capability manifest.

Undocumented endpoints added in this PR:
- `POST /api/chart-requery` — grain/date SQL transformation
- `POST /api/segments/[id]/composition` — segment property attribution
- `POST /api/segments/[id]/movement` — segment entry/exit analysis
- `POST /api/segments/[id]/overlap` — segment intersection
- `POST /api/segments/[id]/overview` — segment growth trend
- `POST /api/explorer` — event analysis
- `POST /api/explorer/funnel` — funnel analysis with segment comparison
- `POST /api/explorer/retention` — retention cohort analysis
- `POST /api/boards`, `PATCH /api/boards/[id]` — board persistence

An agent answering "analyze the high-value users segment" or "change this chart to weekly" cannot call any of these endpoints because their existence, request schema, and response shape are nowhere documented.

## Findings

Source: Agent-Native reviewer.

- AGENTS.md: 361 lines of developer conventions, zero API endpoint documentation
- 8 of 9 capabilities have reachable API endpoints (chart type/legend/export are client-only)
- `ExplorerConfig`, `FunnelConfig`, `RetentionConfig` type shapes are complex — agents cannot construct valid payloads without docs
- Board list not injected into chat system prompt — agents can't reference boards by name

## Proposed Solutions

**Option A (Recommended): Add "API Reference for Agents" section to AGENTS.md**
Document each endpoint with:
- Method + path
- Required headers (`x-dataset-id`)
- Request body schema (with type shapes for complex configs)
- Response shape

Also:
- Inject `GET /api/boards` results into chat system prompt
- Add capability hints to `getSystemContext` output for explorer/segment/retention features

**Option B: Separate AGENTS-API.md file**
- Keep AGENTS.md for operational context, add AGENTS-API.md for endpoint docs
- Easier to maintain separately
- Effort: Same

## Recommended Action

Option A — add API Reference section to existing AGENTS.md.

## Technical Details

- **Affected files:** `AGENTS.md`, `src/app/api/chat/route.ts` (system prompt injection)
- Complex type shapes to document: `FunnelConfig.steps[].eventId`, `RetentionConfig.returnEventIds[]`, `ExplorerConfig.events[]`

## Acceptance Criteria

- [ ] Every new API endpoint documented with method, headers, request, response
- [ ] `FunnelConfig`, `RetentionConfig`, `ExplorerConfig` type shapes documented
- [ ] Board list injected into chat system prompt for agent board-awareness
- [ ] Agent can construct a valid `POST /api/chart-requery` call from AGENTS.md alone

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-23 | Created during PR #48 review (agent-native-reviewer) | Agent parity requires documentation, not just endpoints — this should be part of every PR |

## Resources

- PR #48: Unified Chart System + Server Persistence
