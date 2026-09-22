---
module: System
date: 2026-02-25
problem_type: build_error
component: tooling
symptoms:
  - "pnpm lint fails with 80+ errors in .worktrees/**/.next/ build artifacts"
  - "react-hooks/preserve-manual-memoization errors on useCallback/useMemo in production code"
  - "react-hooks/set-state-in-effect and react-hooks/refs errors flagging correct patterns"
  - "Playwright test fixtures trigger react-hooks/rules-of-hooks on `use` callback parameter"
root_cause: config_error
resolution_type: config_change
severity: high
tags: [eslint, worktrees, react-hooks-v7, react-compiler, playwright, false-positive, next-js]
---

# Troubleshooting: ESLint Fails Due to Worktree Build Artifacts and React Hooks v7 False Positives

## Problem

After adding a CI lint step (`pnpm lint`), the job failed with 80+ errors — but none were in source code. They came from `.worktrees/feat/*/...next/` build artifact chunks. Additionally, `eslint-plugin-react-hooks@7` (pulled in by `eslint-config-next/core-web-vitals`) introduced three new React Compiler rules that flagged correct, idiomatic code as errors because the React Compiler is not enabled in `next.config.ts`.

## Environment

- Module: System-wide (ESLint config)
- Affected Component: `eslint.config.mjs`, all `tests/**` files, `src/**` components
- Date: 2026-02-25

## Symptoms

- `pnpm lint` exits with `✖ 90 problems (21 errors)` pointing to `.worktrees/**/.next/**/*.js`
- `react-hooks/preserve-manual-memoization` errors on `useCallback`/`useMemo` in components
- `react-hooks/set-state-in-effect` errors on legitimate state updates inside `useEffect`
- `react-hooks/refs` errors on ref access patterns that work correctly at runtime
- `tests/fixtures/index.ts` flagged: `React Hook "use" is called in function "context" that is neither a React function component nor a custom React Hook function` — this is Playwright's `use` callback, NOT React's `use()`

## What Didn't Work

**Attempt 1:** Checked `.gitignore` and `.next` exclusions.
- **Why it failed:** `.next/**` was already in `globalIgnores`, but ESLint's flat config `globalIgnores` only ignores `.next/` at the project root — not inside `.worktrees/feat/name/.next/`

## Solution

Three changes to `eslint.config.mjs`:

```js
// eslint.config.mjs
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // FIX 1: Ignore all worktree directories (git worktrees live here)
    ".worktrees/**",
  ]),
  {
    rules: {
      // FIX 2: React Compiler rules from eslint-plugin-react-hooks@7 produce
      // false positives when React Compiler is NOT enabled in next.config.ts.
      // Disable until the project opts into the compiler.
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
    },
  },
  {
    files: ["tests/**"],
    rules: {
      // FIX 3: Playwright's fixture API uses a `use` callback parameter which
      // ESLint mistakes for React's `use()` hook. Not React code — disable.
      "react-hooks/rules-of-hooks": "off",
    },
  },
]);
```

## Why This Works

**Worktree noise:** Git worktrees create sibling directories at `.worktrees/<branch-name>/`. When the checked-out branch has a built `.next/` folder inside its worktree, ESLint scans those compiled JS files (which contain `require()`, `@ts-ignore`, `module =` assignments, etc.) unless explicitly excluded. The root-level `.next/**` ignore pattern does not recursively apply to nested worktree paths.

**React Hooks v7 React Compiler rules:** `eslint-config-next/core-web-vitals` pulls in `eslint-plugin-react-hooks@7`, which added three new rules designed to enforce React Compiler constraints:
- `react-hooks/preserve-manual-memoization` — warns when `useCallback`/`useMemo` wrapping cannot be preserved by the compiler
- `react-hooks/set-state-in-effect` — warns about setState calls inside effects that could cascade
- `react-hooks/refs` — warns about ref access patterns during render

These rules are only appropriate when the React Compiler (`experimental.reactCompiler: true` in `next.config.ts`) is active. Without the compiler, they flag idiomatic patterns as errors. Since this project doesn't use the React Compiler, all three should be disabled.

**Playwright `use` parameter:** Playwright's `base.extend<T>({ fixture: async ({ dep }, use) => { ... } })` uses a callback named `use` as a yield mechanism. ESLint sees a function named `use` and triggers `rules-of-hooks` thinking it's React's `use()` hook. It is not — test files need this rule disabled globally.

## Prevention

- **Whenever adding a CI lint step to a project with git worktrees**: immediately add `.worktrees/**` to `globalIgnores` in `eslint.config.mjs`.
- **Whenever upgrading `eslint-config-next` past v14 or `eslint-plugin-react-hooks` to v7+**: audit for new React Compiler rules. Check if `reactCompiler` is enabled in `next.config.ts` before allowing them.
- **Whenever writing Playwright test fixtures**: add `"react-hooks/rules-of-hooks": "off"` for `tests/**` in ESLint config.
- **Quick check**: Run `pnpm lint 2>&1 | grep "^/Users" | grep -v "node_modules"` to see which source files have issues, separate from generated files.

## Related Issues

No related issues documented yet.
