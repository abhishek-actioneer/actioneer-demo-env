---
title: Build Failure from Missing File in Collaborator's Commits
problem_type: build-error
component: src/components/board/document-view.tsx
symptoms:
  - "Module not found: Can't resolve './add-section-input'"
  - Build passes locally for the committing developer but fails everywhere else
  - Error appears in a file the collaborator committed, not code you wrote
root_cause: |
  Collaborator committed `document-view.tsx` which imports `./add-section-input`,
  but never staged/committed `add-section-input.tsx` itself. The file exists on
  their local machine so their build passes. After merge, the import is broken
  for everyone else.
tags:
  - build-error
  - missing-file
  - module-not-found
  - collaborator-workflow
  - next-js
related_files:
  - src/components/board/document-view.tsx
  - src/components/board/add-section-input.tsx
date: 2026-03-13
---

## Problem

After merging `origin/react-flow-migration` (Vimarsh's 4 commits), `pnpm build` failed:

```
Module not found: Can't resolve './add-section-input'
./Documents/.../src/components/board/document-view.tsx:20:1
```

`document-view.tsx` line 20:
```typescript
import { AddSectionInput } from "./add-section-input";
```

And used at line 264:
```tsx
<AddSectionInput
  onSubmit={(query) => {
    // TODO: Phase 8 — NL → section generation via canvas stream
    console.log("[document-view] Add section:", query);
  }}
/>
```

The file `src/components/board/add-section-input.tsx` was never committed. Vimarsh
had it locally, ran the build, it passed, and he pushed without noticing the file
was untracked.

## Solution

### Step 1: Identify the required interface

Read the usage site to understand exactly what props the missing component needs:

```bash
grep -n "AddSectionInput" src/components/board/document-view.tsx
```

The `onSubmit` prop takes a `(query: string) => void`. That's the entire interface.

### Step 2: Create a minimal implementation

When the handler at the usage site is a TODO stub anyway, keep the component minimal.
Don't over-engineer something that will be replaced.

```typescript
// src/components/board/add-section-input.tsx
"use client";

import React, { useState } from "react";
import { Plus } from "lucide-react";

interface AddSectionInputProps {
  onSubmit: (query: string) => void;
}

export function AddSectionInput({ onSubmit }: AddSectionInputProps) {
  const [value, setValue] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue("");
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Add a section…"
        className="flex-1 text-[13px] bg-transparent border-none outline-none text-muted-foreground placeholder:text-muted-foreground/50"
      />
      <button
        type="submit"
        disabled={!value.trim()}
        className="flex items-center gap-1 px-2 py-1 rounded-md text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Plus className="w-3.5 h-3.5" />
        Add
      </button>
    </form>
  );
}
```

### Step 3: Verify build passes

```bash
pnpm build
```

## Prevention

### For the committing developer: review `git status` before every commit

After writing new files and importing them, read the full `git status` output — not
just the staged section. Untracked files appear at the bottom in a separate block.
If there is a new `.tsx`/`.ts` file listed there and your staged changes reference
it, it must be staged.

Also run `git diff --staged` before committing. If you see an `import` to a local
relative path that doesn't appear in the staged diff, that file is missing.

### CI check: type-check on every push

`tsc --noEmit` will fail immediately if an imported module cannot be resolved.
It runs in seconds and is much faster than a full `next build`:

```yaml
# .github/workflows/ci.yml
- name: Type check
  run: pnpm tsc --noEmit
- name: Build
  run: pnpm build
```

Enabling this on branch pushes (not just PRs to main) catches missing files
during development, not at merge time.

### ESLint import resolution

Add `eslint-plugin-import` with `import/no-unresolved` to catch this at lint time:

```js
// requires eslint-import-resolver-typescript for @/* aliases
"import/no-unresolved": "error"
```

### Communication

When Vimarsh (or any collaborator) finishes a feature that introduces new files,
a quick "pushed — includes new files X and Y" message avoids the silent breakage.
