---
status: complete
priority: p2
issue_id: "115"
tags: [rename, llm, branding, datasets]
dependencies: ["114"]
---

# Rename Sentinel → Actioneer in dataset-specific systemContext strings

## Problem Statement

Each dataset config has a `systemContext` field that introduces the AI as "Sentinel". These are separate from the shared prompt templates and need individual updates.

## Scope

| File | What to change |
|------|---------------|
| `src/lib/datasets/alpha.ts` | `"You are Sentinel, a growth analytics AI for Alpha..."` |
| `src/lib/datasets/quickhelp.ts` | `"You are Sentinel, an AI-powered analytics assistant for an on-demand home help platform..."` |
| `src/lib/datasets/gameramp.ts` | `"You are Sentinel, a mobile growth analytics assistant for Presto..."` |

## Acceptance Criteria

- [ ] All three dataset systemContext strings say "Actioneer" instead of "Sentinel"
- [ ] No regression in dataset-specific prompt behavior
