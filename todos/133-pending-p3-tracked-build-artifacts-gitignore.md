---
status: pending
priority: p3
issue_id: "133"
tags: [code-review, cleanup, gitignore, pr-48]
dependencies: []
---

# AGENTS.md.bak and .gstack/ logs committed to git — should be gitignored

## Problem Statement

Two categories of build/tool artifacts are tracked in git in this PR:

1. **`AGENTS.md.bak`** — a backup file in the repo root. Previous content is already in git history. Backup files have no place in version control.

2. **`.gstack/browse-console.log`** and **`.gstack/browse-network.log`** — gstack browser tool session logs (1,188 lines + 109 lines). These are local tool artifacts. `.gitignore` has no entry for `.gstack/**` or `*.bak`.

## Findings

Source: Code Simplicity reviewer.

- `AGENTS.md.bak` — 89 lines, committed to root
- `.gstack/browse-console.log` — 109 lines
- `.gstack/browse-network.log` — 1,188 lines
- `.gitignore` — no entry for `.gstack/**` or `*.bak`

## Proposed Solutions

1. `git rm --cached AGENTS.md.bak .gstack/browse-console.log .gstack/browse-network.log`
2. Add to `.gitignore`:
   ```
   .gstack/**
   *.bak
   ```
3. Delete the files locally

## Technical Details

- **Affected files:** `.gitignore`, `AGENTS.md.bak`, `.gstack/*.log`

## Acceptance Criteria

- [ ] `AGENTS.md.bak` removed from git tracking and deleted
- [ ] `.gstack/` directory untracked and gitignored
- [ ] `*.bak` added to `.gitignore`

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-23 | Created during PR #48 review (code-simplicity-reviewer) | |

## Resources

- PR #48: Unified Chart System + Server Persistence
