---
title: Merging a Diverged Branch with Uncommitted Changes
problem_type: git-workflow
component: git
symptoms:
  - Local branch and origin have diverged (e.g. 5 local commits, 4 remote commits from collaborator)
  - Uncommitted working tree changes present before merge
  - Conflict in a shared file (e.g. both sides added different imports to the same import block)
root_cause: |
  Two developers pushing independently to the same long-running branch accumulate
  divergent histories. Uncommitted changes on the local side mean a plain
  `git merge` would fail or produce confusing conflict state. The correct pattern
  is stash → merge → resolve → commit → pop stash.
tags:
  - git
  - merge
  - stash
  - diverged-branch
  - collaborator-workflow
related_files:
  - src/components/sidebar.tsx
date: 2026-03-13
---

## Problem

Working on `react-flow-migration` branch, both you and Vimarsh committed independently
since the common ancestor `0561c7d`. Local had 5 commits + 26 uncommitted modified files.
Origin had 4 commits (board document view, board delete, compact cards, board route params).

Running `git pull` would fail because the working tree was dirty.

The only committed conflict was `src/components/sidebar.tsx` — your side added `Upload` icon
and `DatasetUploadModal`; Vimarsh's side added `Layers` icon and the Boards nav section.
Git couldn't auto-merge the lucide-react import block because both sides modified the same
closing lines of the import statement.

Three files had uncommitted local changes that overlapped with Vimarsh's committed changes
(`use-analytics.ts`, `board-types.ts`, `canvas/[id]/page.tsx`) — but these were independent
additions to different parts of each file, so they auto-merged cleanly on stash pop.

## Solution

### Step 1: Stash uncommitted changes

```bash
git stash push -m "wip: silentContext, canvas params, deck renderer changes"
```

Use a descriptive message so you remember what's in the stash.

### Step 2: Merge (without auto-commit to inspect conflicts)

```bash
git merge origin/react-flow-migration --no-commit
```

Expected output: `CONFLICT (content): Merge conflict in src/components/sidebar.tsx`

### Step 3: Resolve the conflict

Open the conflicted file. Find the conflict markers:

```
<<<<<<< HEAD
  Upload,
=======
  Layers,
>>>>>>> origin/react-flow-migration
```

When both sides are additive (different imports, different features), keep both:

```typescript
  Upload,
  Layers,
```

General rule: if both sides added something to the same region, keep everything.
Only discard one side if they are semantically incompatible (e.g. two different
implementations of the same function).

### Step 4: Commit the merge

```bash
git add src/components/sidebar.tsx
git commit -m "merge: integrate Vimarsh's board nav with local upload, cmd+click, and deck features

Brief description of what each side contributed and how the conflict was resolved."
```

Write a descriptive merge commit message — future-you will thank present-you.

### Step 5: Pop the stash

```bash
git stash pop
```

Git will auto-merge the stashed changes on top of the merge result. Files where
both the stash and the merge touched different parts of the file will auto-merge
cleanly. You only need to intervene if there are new conflicts at this stage.

Verify the final state:

```bash
git status
git log --oneline -6
```

## Prevention

### Detect divergence early

At the start of every session, check ahead/behind before writing any code:

```bash
git fetch origin
git status -sb
# ## react-flow-migration...origin/react-flow-migration [ahead 2, behind 4]
```

If `behind` is non-zero and you have uncommitted changes, stash + rebase before starting work.

### Rebase frequently, not at merge time

```bash
git stash push -m "wip: in-progress"
git pull --rebase
git stash pop
```

Small daily rebases are much cheaper than one large merge after days of divergence.

### Use a branch ownership protocol

On a shared feature branch, agree: one person owns the branch and others submit PRs to it.
Mixing direct pushes from both developers is what creates divergence. For this project:
Vimarsh submits PRs to `react-flow-migration`; you review and merge.

### Keep working tree clean before pulling

Never start a long editing session without a clean tree. Run `git status` first.
If you have uncommitted WIP, either commit it as `wip: description` or stash it
before doing any fetch/merge/rebase operations.
