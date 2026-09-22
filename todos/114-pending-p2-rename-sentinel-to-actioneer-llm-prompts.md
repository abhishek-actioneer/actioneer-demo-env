---
status: complete
priority: p2
issue_id: "114"
tags: [rename, llm, branding]
dependencies: []
---

# Rename Sentinel → Actioneer in LLM system prompts

## Problem Statement

The AI identifies itself as "Sentinel" in all system prompts. This needs to say "Actioneer" so the LLM responds with the correct product name.

## Scope

| File | Occurrences |
|------|-------------|
| `src/lib/prompts/schema-generic.ts` | `"You are Sentinel, an AI-powered analytics assistant..."` and `"You are Sentinel, an AI-powered ${sm.domainPersona}..."` |
| `src/lib/prompts/analyze.ts` | `"...platform called Sentinel"` in agent prompt, critique prompt, and report prompt (3 occurrences) |
| `src/lib/prompts/actions.ts` | `"Action Recommendation Engine for Sentinel"` |

## Acceptance Criteria

- [ ] All system prompts identify the AI as "Actioneer"
- [ ] No prompt string contains the word "Sentinel"
- [ ] LLM responses in quick and deep mode refer to themselves as Actioneer (manual verification)
