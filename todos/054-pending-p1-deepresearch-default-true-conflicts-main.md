---
status: done
priority: p1
issue_id: "054"
tags: [code-review, merge-risk, use-analytics]
dependencies: []
---

# deepResearch defaults to true — conflicts with two recent main commits that fix this

## Problem Statement
`use-analytics.ts` line 75 initializes `deepResearch` state as `useState(true)`. The main branch has two consecutive commits (ee63109 and 3787bb8), both titled "fix: default deep-research to off on initial load", that change this value to `false`. This PR was branched before those fixes landed and will silently revert them when merged, re-introducing the UX regression where deep research (slow, expensive, 17-query mode) is active by default on every page load.

## Findings
- `src/hooks/use-analytics.ts` line 75: `const [deepResearch, setDeepResearch] = useState(true);`
- Main branch recent commits:
  - `ee63109 fix: default deep-research to off on initial load`
  - `3787bb8 fix: default deep-research to off on initial load` (second fix, likely corrected something in the first)
- This is a merge conflict that git will NOT detect automatically — both branches compile cleanly, but the semantic intent of main's fix is overwritten by this PR's older value.
- Also interacts with issue 053: if deep research is on by default AND the action mode filtering is inverted (053), every page load starts in a broken state.

## Proposed Solutions

### Option A: Change useState(true) to useState(false) before merging
**Description:** Update `use-analytics.ts` line 75 from `useState(true)` to `useState(false)` to match the fix on main. This is the required change regardless of merge strategy.
**Pros:** Simplest fix. One character change. Unblocks the merge.
**Cons:** None.
**Effort:** Small
**Risk:** Low

### Option B: Rebase the PR branch on main
**Description:** Run `git rebase main` on the PR branch so that both main commits (ee63109, 3787bb8) are incorporated. The rebase will either auto-resolve the conflict to `false` (if the commits touch that exact line) or surface a merge conflict that must be manually resolved to `false`.
**Pros:** Also picks up any other fixes on main that this PR may have missed. Cleaner history.
**Cons:** Requires force-push to the PR branch. More work if there are other conflicts.
**Effort:** Small
**Risk:** Low

## Recommended Action
<!-- Leave blank for triage -->

## Technical Details
- **Affected files:** `src/hooks/use-analytics.ts`
- **Components:** Analytics hook, deep research toggle initial state
- **Lines:** 75
- **Note:** This is a semantic conflict, not a syntactic one — git will not flag it as a merge conflict. Must be caught in review.

## Acceptance Criteria
- [ ] `useState(false)` at line 75 of `use-analytics.ts` at merge time
- [ ] On fresh page load, the deep research toggle shows as OFF
- [ ] Quick Answer mode is the default (single SQL query, fast response)
- [ ] The two main-branch commits (ee63109, 3787bb8) are not reverted by this PR

## Work Log

### 2026-03-10
Verified `src/hooks/use-analytics.ts` line 184 already has `useState(false)` in this worktree — the fix from main branch commits ee63109 and 3787bb8 was already present. No code change needed. Acceptance criteria confirmed: deep research toggle defaults to OFF on fresh page load.

## Resources
- PR #33
