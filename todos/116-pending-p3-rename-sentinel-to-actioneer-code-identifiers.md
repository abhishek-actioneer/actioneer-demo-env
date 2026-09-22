---
status: complete
priority: p3
issue_id: "116"
tags: [rename, refactor, branding]
dependencies: ["113"]
---

# Rename Sentinel → Actioneer in internal code identifiers

## Problem Statement

Internal function names and component names still reference "Sentinel". These aren't user-visible but should be consistent with the rebrand.

## Scope

| File | What to change |
|------|---------------|
| `src/components/chat/chat-thread.tsx` | Rename `SentinelMessage` → `ActioneerMessage`, `SentinelAvatar` → `ActioneerAvatar` (function declarations + all call sites within the file) |
| `src/hooks/use-analytics.ts` | String comparison `pageContextLabel !== "Sentinel"` → `pageContextLabel !== "Actioneer"` |
| `src/hooks/use-action-handlers.ts` | Comment text "sentinel message after agent" |
| `src/lib/knowledge-generator.ts` | `addedBy: "Sentinel AI"` → `addedBy: "Actioneer AI"` |

## Acceptance Criteria

- [ ] No function/component named `Sentinel*` in source (excluding DB/storage identifiers)
- [ ] `addedBy` field uses "Actioneer AI"
- [ ] `pageContextLabel` comparison uses "Actioneer"
