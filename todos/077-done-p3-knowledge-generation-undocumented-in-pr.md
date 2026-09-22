---
status: done
priority: p3
issue_id: "077"
tags: [code-review, documentation, pr-41]
dependencies: []
---

# Knowledge generation shipped but not mentioned in PR title/summary

## Problem Statement

PR #41 title is "feat: generate metric tree relationships + bulk starter segments" but the PR also ships:

- New `POST /api/knowledge/generate` route
- New `buildKnowledgeGenerationPrompt` in `src/lib/prompts/knowledge.ts`
- Generate button + empty state on knowledge page
- New plan doc `docs/plans/2026-03-16-feat-generate-starter-knowledge-plan.md`

This is a full feature addition not reflected in the PR description. Reviewers may miss it.

## Proposed Solutions

**Option A: Update PR description to mention knowledge generation**
- Add a "Knowledge generation" section to the PR body
- Effort: Trivial | Risk: None

**Option B: Split into separate PR**
- Extract knowledge generation into its own PR
- Effort: Medium | Risk: Low (but may be over-engineering the PR process for a demo app)

## Recommended Action

Option A — update PR description.

## Technical Details

- **Affected files:** `src/app/api/knowledge/generate/route.ts`, `src/lib/prompts/knowledge.ts`, `src/app/knowledge/page.tsx`

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-16 | Created during PR #41 review | Feature scope drift in PR |

## Resources

- PR #41: feat: generate metric tree relationships + bulk starter segments
