---
module: tailwind-css
date: 2026-02-19
problem_type: build_configuration
component: tailwind-v4-source-directive
symptoms:
  - "Parsing CSS source code failed during dev server startup"
  - "Invalid CSS: background-color: var(...) with literal dots in selector"
  - "Unexpected token Delim('.') error in generated CSS"
  - "Markdown files in docs/ directory causing JIT scanner to process invalid patterns"
root_cause: "@source not directive requires glob pattern syntax; bare directory path doesn't recursively exclude subdirectories"
resolution_type: configuration_fix
severity: high
tags:
  - tailwind-v4
  - jit-scanning
  - next-js
  - css-parsing
  - glob-patterns
  - documentation-files
---

# Tailwind CSS v4 `@source not` Requires Glob Pattern for Recursive Exclusion

## Problem

Tailwind CSS v4's JIT compiler was scanning the `docs/` directory and picking up markdown code examples containing Tailwind utility syntax like `bg-[var(...)]`. When Tailwind attempted to generate CSS classes for these example strings, it produced invalid CSS:

```css
.bg-\[var\(\.\.\.\)\] { background-color: var(...); }
```

The literal `...` in the generated selector caused a CSS parse error: `Unexpected token Delim('.')`, crashing the dev server.

**Error output:**
```
./src/app/globals.css:1675:27
Parsing CSS source code failed
  1674 |   .bg-\[var\(\.\.\.\)\] {
> 1675 |     background-color: var(...);
       |                           ^
Unexpected token Delim('.')
```

## What Didn't Work

Commit `31d16b1` attempted to fix this by adding a `@source not` directive:

```css
/* In src/app/globals.css (line 5) */
@source not "../../docs";
```

This failed because **Tailwind CSS v4's `@source not "path"` matches only the directory entry itself, not files recursively nested within it**. The JIT scanner continued processing all `.md` files inside `docs/` and its subdirectories.

## Solution

Update `src/app/globals.css` line 5 to use a recursive glob pattern:

```css
/* Before (doesn't work) */
@source not "../../docs";

/* After (works) */
@source not "../../docs/**";
```

The `**` glob pattern tells Tailwind to recursively exclude all files within the docs directory and its subdirectories from content scanning.

## Why This Works

In Tailwind CSS v4:
- `@source not "path"` matches only the specified path entry
- To exclude files *within* that path recursively, you must append `/**` to create a glob pattern
- This is a change from Tailwind v3's `content` array, where directory paths implicitly matched all descendants
- With `@source not "../../docs/**"`, the JIT scanner skips all files in `docs/` and nested subdirectories, preventing markdown example text from being parsed as utility class candidates

## Environment

- Next.js 16.1.6 (Turbopack)
- Tailwind CSS v4.1.18
- File: `src/app/globals.css`
- Fix commit: `2ebd6fb`

## Prevention

### Always use `/**` glob with `@source not` directory exclusions

```css
/* Correct */
@source not "../../docs/**";
@source not "../../examples/**";

/* Incorrect -- won't exclude nested files */
@source not "../../docs";
```

**Checklist before committing `@source` changes:**
- [ ] Directory exclusions end with `/**`
- [ ] Run `pnpm build` to verify no CSS parse errors
- [ ] Check that markdown/documentation files containing Tailwind class examples are not being scanned

### Be aware of documentation files containing Tailwind class references

Any directory with markdown, examples, or tutorials risks being scanned. Common culprits:
- `docs/` -- architecture docs, plans, solution docs with code examples
- `README.md` -- top-level readmes with usage examples
- `examples/` -- intentional code examples

### Tailwind v3 to v4 migration note

Tailwind v3 `content` array paths were implicitly recursive:
```javascript
// v3: "!./docs" excluded all subdirs
content: ["./src/**", "!./docs"]
```

Tailwind v4 `@source` requires explicit `/**`:
```css
/* v4: Must be explicit */
@source not "../../docs/**";
```

## Related Issues

- [canvas-dark-mode-centralized-theming-bypass-20260219.md](../best-practices/canvas-dark-mode-centralized-theming-bypass-20260219.md) -- Documents the broader dark mode migration that introduced the `@source not` directive
- [three-zone-pointer-events-canvas-card-system-20260218.md](../best-practices/three-zone-pointer-events-canvas-card-system-20260218.md) -- Documents the JIT scanner limitation with `bg-[var(...)]` arbitrary values
