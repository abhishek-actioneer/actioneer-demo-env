---
module: Canvas
date: 2026-02-19
problem_type: best_practice
component: frontend_stimulus
symptoms:
  - "Dark mode toggle has no effect on canvas page — cards, toolbar, dot grid stay white"
  - "~30 hardcoded hex colors in canvas components bypass shadcn/Tailwind CSS v4 token system"
  - "Severity background tints (--severity-*-bg) have no .dark overrides in globals.css"
root_cause: config_error
resolution_type: code_fix
severity: medium
tags: [dark-mode, theming, css-variables, shadcn, tailwind-v4, canvas, design-tokens]
---

# Canvas Dark Mode: Centralized Theming System Exists But Canvas Bypasses It

## Problem

The repository has a fully centralized theming system via shadcn/ui + Tailwind CSS v4 + next-themes. The dark mode toggle in the UserPanel already works — sidebar, page shells, and all shadcn components respond correctly. However, canvas components (tldraw shapes, floating toolbar, dot grid background, SmartStack) use ~30 hardcoded hex colors in inline styles, completely bypassing the token system. Toggling dark mode has zero visible effect on the canvas page.

## Environment
- Module: Canvas (tldraw v4.3.x shape system)
- Framework: Next.js 16, React 19, Tailwind CSS v4, shadcn/ui (new-york), next-themes
- Affected Components: `chart-shape.tsx`, `canvas-page.tsx`, `smart-stack.tsx`, `canvas-config-panel.tsx`
- Date: 2026-02-19

## Symptoms
- Toggling Light/Dark/System in UserPanel has no effect on any canvas surface
- Chart, report, and insight cards remain white (`#ffffff`) in dark mode
- Dot grid background stays `#fafafa` with `#d0d0d0` dots
- Floating toolbar remains white with hardcoded active/inactive colors
- SmartStack insight cards stay white; severity badge backgrounds stay light-mode pastels
- CanvasConfigPanel severity badges use fixed Tailwind palette classes (`bg-red-100`) that don't adapt

## What Didn't Work

**Direct solution:** The problem was identified during dark mode planning. No incorrect attempts were made — the root cause was immediately clear from code inspection.

## Solution

The existing centralized theme system already provides everything needed. No new infrastructure required.

### What Already Exists (the centralized system)

**1. Theme Provider** (`src/components/theme-provider.tsx`):
```typescript
// next-themes wraps everything, writes class="dark" on <html>
<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
```

**2. Complete CSS Variable Tokens** (`src/app/globals.css`):
```css
/* Light mode */
:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --border: oklch(0.922 0 0);
  /* ... 30+ tokens ... */
}

/* Dark mode — complete palette */
.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --border: oklch(1 0 0 / 10%);
  /* ... all tokens have dark overrides ... */
}
```

**3. Tailwind Token Bridge** (`@theme inline` in `globals.css`):
```css
@theme inline {
  --color-background: var(--background);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-muted-foreground: var(--muted-foreground);
  --color-border: var(--border);
  /* Maps CSS vars → Tailwind color tokens */
}
```

**4. Dark Variant** (`@custom-variant dark (&:is(.dark *))` enables `dark:` prefix)

**5. Toggle UI** (UserPanel in sidebar — Light/Dark/System buttons using `useTheme()`)

### What Needs To Change (replacing hardcoded hex with existing tokens)

**`chart-shape.tsx` — CARD_STYLE and text colors:**
```typescript
// ❌ BEFORE — hardcoded, ignores theme system
const CARD_STYLE = {
  background: "#ffffff",
  borderRadius: 10,
  boxShadow: "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)",
};
// color: "#111"       (titles)
// color: "#6b7280"    (body text)
// color: "#9ca3af"    (meta/dates)

// ✅ AFTER — uses centralized tokens
const CARD_STYLE = {
  background: "var(--card)",
  borderRadius: 10,
  boxShadow: "var(--canvas-card-shadow)",
};
// color: "var(--card-foreground)"       (titles)
// color: "var(--muted-foreground)"      (body text)
// color: "var(--muted-foreground)"      (meta/dates — adjust opacity if needed)
```

**`canvas-page.tsx` — DotGridBackground and FloatingToolbar:**
```typescript
// ❌ BEFORE
background: "#fafafa"     // dot grid bg
fill="#d0d0d0"            // dot fill
background: "#ffffff"     // toolbar pill
color: "#5B5BD6"          // active tool
color: "#6b7280"          // inactive tool

// ✅ AFTER
background: "var(--background)"
fill="var(--border)"
background: "var(--card)"
color: "var(--primary)"              // active (or keep accent color)
color: "var(--muted-foreground)"     // inactive
```

**`smart-stack.tsx` — insight card background:**
```typescript
// ❌ BEFORE
style={{ background: "#ffffff", ... }}

// ✅ AFTER
style={{ background: "var(--card)", ... }}
```

**`canvas-config-panel.tsx` — fixed Tailwind palette classes:**
```typescript
// ❌ BEFORE — fixed palette, doesn't adapt
className="bg-red-100 text-red-700"

// ✅ AFTER — add dark variants
className="bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
```

**`globals.css` — add missing dark severity overrides:**
```css
/* ❌ BEFORE — only light values defined */
:root {
  --severity-critical-bg: #fee2e2;
  --severity-warning-bg: #fef3c7;
  --severity-info-bg: #dbeafe;
}

/* ✅ AFTER — add dark overrides */
.dark {
  --severity-critical-bg: oklch(0.22 0.08 15);
  --severity-warning-bg: oklch(0.22 0.07 50);
  --severity-info-bg: oklch(0.22 0.08 250);
}
```

### Token Mapping Cheat Sheet

| Hardcoded Hex | Semantic Token | Where Used |
|---|---|---|
| `#ffffff` (background) | `var(--card)` | Card bg, toolbar bg, SmartStack cards |
| `#fafafa` (canvas bg) | `var(--background)` | DotGridBackground |
| `#d0d0d0` (dots) | `var(--border)` | DotGridBackground SVG fill |
| `#111` (titles) | `var(--card-foreground)` | Shape titles |
| `#6b7280` (body) | `var(--muted-foreground)` | Body text, inactive buttons |
| `#9ca3af` (meta) | `var(--muted-foreground)` | Date/meta text |
| `#eef2ff` (active bg) | `var(--accent)` | Toolbar active button |
| `bg-red-100` | `bg-red-100 dark:bg-red-950` | Config panel badges |

## Why This Works

1. **The token system is already centralized in `globals.css`.** Every shadcn token has both `:root` and `.dark` values defined. When canvas components reference `var(--card)` instead of `#ffffff`, they automatically get the correct color for the current theme.

2. **`next-themes` handles the toggle.** Writing `class="dark"` on `<html>` propagates through the entire DOM, including tldraw's `HTMLContainer`. CSS custom properties (unlike Tailwind classes) resolve correctly inside any DOM context — no special handling needed for tldraw.

3. **No new infrastructure needed.** The fix is purely replacing ~30 hardcoded hex values with references to existing tokens. This also means any future theme customization (tweakcn, custom brand palettes) will automatically propagate to the canvas.

4. **For tldraw shapes specifically:** Inline `style={{ color: "var(--card-foreground)" }}` is the correct pattern because Tailwind's `dark:` prefix doesn't reliably work inside `HTMLContainer` (see related doc). CSS custom properties work in any DOM context.

## Prevention

- **Always use CSS variable tokens for colors in canvas components** — `var(--card)`, `var(--foreground)`, `var(--muted-foreground)`, etc. Never introduce new hardcoded hex values.
- **When adding new CSS custom properties**, always define both `:root` and `.dark` values in `globals.css`.
- **For canvas/tldraw shapes**: Use inline `style={{}}` with `var()` references. Never use Tailwind arbitrary values with CSS variables (`bg-[var(...)]` fails at build time).
- **For standard components**: Use Tailwind semantic classes (`bg-card`, `text-muted-foreground`) — they automatically adapt via the `@theme inline` bridge.
- **For Recharts/SVG**: SVG `fill` and `stroke` props may not resolve CSS variables — test and fall back to computed values via `useTheme()` if needed.
- **Check the token mapping table above** before introducing any new color. The existing shadcn token set covers ~95% of use cases.

## Related Issues

- See also: [three-zone-pointer-events-canvas-card-system-20260218.md](./three-zone-pointer-events-canvas-card-system-20260218.md) — Documents the canvas card visual system including CARD_STYLE constants and the CSS custom properties pattern for severity colors. The hardcoded hex values in that doc's design tokens are the ones that need migrating.
