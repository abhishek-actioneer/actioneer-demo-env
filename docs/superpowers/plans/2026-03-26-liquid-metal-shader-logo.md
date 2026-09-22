# Liquid Metal Shader Logo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an animated liquid metal WebGL shader behind the Sentinel logo in the chat panel empty state and welcome screen.

**Architecture:** New `<ShaderLogo>` component wraps `@paper-design/shaders-react`'s `<LiquidMetal>` with the existing `LogoSvg` overlaid. Includes error boundary fallback, reduced-motion detection, and theme-aware colors. Integrates at two points in the existing chat panel.

**Tech Stack:** `@paper-design/shaders-react`, React 19, Next.js 16, `next-themes`, WebGL2

**Spec:** `docs/superpowers/specs/2026-03-26-liquid-metal-shader-logo-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/components/ui/shader-logo.tsx` | Create | `ShaderLogo` component — shader + logo overlay + error boundary + reduced-motion |
| `src/components/chat/chat-panel.tsx` | Modify (line 266) | Swap `SentinelLogo` for `ShaderLogo` in `EmptyState` |
| `src/components/chat/chat-welcome.tsx` | Modify (line 68) | Swap `SentinelLogo` for `ShaderLogo` in welcome screen |
| `package.json` / `pnpm-lock.yaml` | Modify | Add `@paper-design/shaders-react` dependency |

---

### Task 1: Install `@paper-design/shaders-react`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the package**

Run:
```bash
pnpm add @paper-design/shaders-react
```

- [ ] **Step 2: Verify installation**

Run:
```bash
node -e "require('@paper-design/shaders-react')" 2>&1 || echo "CJS failed, trying ESM..." && node --input-type=module -e "import '@paper-design/shaders-react'" 2>&1
```

Check that `@paper-design/shaders-react` and its transitive dep `@paper-design/shaders` both appear in `node_modules/`.

- [ ] **Step 3: Verify the build still works**

Run:
```bash
pnpm build
```

Expected: Build succeeds. If there are SSR issues with the shader package (it references `window`/`document`), note them — they'll be handled by `"use client"` in the component.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add @paper-design/shaders-react dependency"
```

---

### Task 2: Create `ShaderLogo` component

**Files:**
- Create: `src/components/ui/shader-logo.tsx`
- Reference: `src/components/ui/sentinel-logo.tsx` (for `LOGO_PATHS` and `LogoSvg` pattern)

- [ ] **Step 1: Create the component file**

Create `src/components/ui/shader-logo.tsx`:

```tsx
"use client";

import { useState, useEffect, Component, type ReactNode, type ErrorInfo } from "react";
import { useTheme } from "next-themes";
import { SentinelLogo } from "@/components/ui/sentinel-logo";

// ── Logo SVG (fixed fill, not currentColor) ──

const LOGO_PATHS = [
  "M213.502 185.999H240.024V240H168.022L213.502 185.999Z",
  "M135.492 185.999H156.013V240H84.0112L135.492 185.999Z",
  "M57.4807 185.999H72.0017V240H0L57.4807 185.999Z",
  "M209.141 93.0703H239.319V169.758H166.892L209.141 93.0703Z",
  "M131.744 93.0703H158.372V169.758H85.9443L131.744 93.0703Z",
  "M48.3068 93.0703H73.1593V169.758H0.731934L48.3068 93.0703Z",
  "M203.412 0H239.319V76.6878H166.892L203.412 0Z",
  "M119.172 0H158.372V76.6878H85.9443L119.172 0Z",
  "M32.6958 0H73.1593V76.6878H0.731934L32.6958 0Z",
];

function FixedFillLogoSvg({ size, fill }: { size: number; fill: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 241 240" fill="none" aria-hidden="true">
      {LOGO_PATHS.map((d) => (
        <path key={d.slice(0, 12)} d={d} fill={fill} />
      ))}
    </svg>
  );
}

// ── Error boundary for WebGL failures ──

interface ErrorBoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class ShaderErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn("[ShaderLogo] WebGL error, falling back to static logo:", error.message, info.componentStack);
  }

  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

// ── Reduced motion + forced colors detection ──

function useShouldReduceMotion(): boolean {
  const [reduce, setReduce] = useState(true); // default true to avoid flash of shader on SSR

  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const forcedColors = window.matchMedia("(forced-colors: active)");

    const update = () => setReduce(mql.matches || forcedColors.matches);
    update();

    mql.addEventListener("change", update);
    forcedColors.addEventListener("change", update);
    return () => {
      mql.removeEventListener("change", update);
      forcedColors.removeEventListener("change", update);
    };
  }, []);

  return reduce;
}

// ── Lazy import for LiquidMetal (avoid SSR issues) ──

import dynamic from "next/dynamic";

const LiquidMetal = dynamic(
  () => import("@paper-design/shaders-react").then((mod) => mod.LiquidMetal),
  { ssr: false }
);

// ── Main component ──

interface ShaderLogoProps {
  /** Outer disc diameter in px (default 72) */
  size?: number;
  /** Inner SVG logo size in px (default 40) */
  logoSize?: number;
  className?: string;
}

export function ShaderLogo({ size = 72, logoSize = 40, className }: ShaderLogoProps) {
  const { resolvedTheme } = useTheme();
  const reduceMotion = useShouldReduceMotion();

  // During hydration or when theme hasn't resolved, show static fallback
  const isDark = resolvedTheme === "dark";
  const themeResolved = resolvedTheme != null;

  if (!themeResolved || reduceMotion) {
    return (
      <div className={className} aria-hidden="true" role="presentation">
        <SentinelLogo size={logoSize} variant="contained" />
      </div>
    );
  }

  const colorBack = isDark ? "#1a1a1a" : "#d4d4d4";
  const logoFill = isDark ? "#ddd" : "#111";
  const fallback = <SentinelLogo size={logoSize} variant="contained" />;

  return (
    <div
      className={`relative rounded-full overflow-hidden shrink-0 ${className ?? ""}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
      role="presentation"
    >
      <ShaderErrorBoundary fallback={fallback}>
        <LiquidMetal
          style={{ width: "100%", height: "100%" }}
          shape="circle"
          speed={0.4}
          repetition={1.5}
          softness={0.5}
          shiftRed={0.3}
          shiftBlue={0.3}
          distortion={0}
          contour={0}
          angle={100}
          scale={1.5}
          colorBack={colorBack}
        />
      </ShaderErrorBoundary>
      {/* Logo overlay — centered on top of the shader */}
      <div className="absolute inset-0 flex items-center justify-center">
        <FixedFillLogoSvg size={logoSize} fill={logoFill} />
      </div>
    </div>
  );
}
```

**Key decisions in this code:**
- `useShouldReduceMotion` defaults to `true` so SSR renders the static fallback (no flash of shader)
- `LiquidMetal` is dynamically imported with `ssr: false` to prevent WebGL code from running on the server
- `ShaderErrorBoundary` catches WebGL context failures and shows the static logo
- Logo paths are duplicated from `sentinel-logo.tsx` to allow a fixed `fill` prop (not `currentColor`)
- `resolvedTheme` (not `theme`) avoids the hydration `undefined` issue

- [ ] **Step 2: Verify the dev server renders the component**

Run:
```bash
pnpm dev
```

Temporarily add `<ShaderLogo />` to a page to confirm it renders without errors. Check browser console for WebGL warnings. Verify it works in both light and dark mode.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/shader-logo.tsx
git commit -m "feat: add ShaderLogo component with liquid metal WebGL shader"
```

---

### Task 3: Integrate into chat panel empty state

**Files:**
- Modify: `src/components/chat/chat-panel.tsx` (line 6 import, line 266 usage)

- [ ] **Step 1: Add import**

At the top of `chat-panel.tsx`, add:

```tsx
import { ShaderLogo } from "@/components/ui/shader-logo";
```

- [ ] **Step 2: Replace SentinelLogo in EmptyState**

In the `EmptyState` function (around line 266), replace:

```tsx
<SentinelLogo size={40} className="mb-4" />
```

With:

```tsx
<ShaderLogo size={72} logoSize={40} className="mb-4" />
```

- [ ] **Step 3: Remove unused SentinelLogo import if no longer needed**

Check if `SentinelLogo` is still used elsewhere in `chat-panel.tsx`. If the `EmptyState` was the only usage, remove the import:

```tsx
import { SentinelLogo } from "@/components/ui/sentinel-logo";
```

If it's used elsewhere in the file, keep the import.

- [ ] **Step 4: Verify in browser**

Run `pnpm dev`, open the app, navigate to any page with the right chat panel. With no messages, the empty state should show:
- A circular metallic disc with slow chromatic shimmer
- The Sentinel arrow-grid logo overlaid in the center
- "Actioneer" text and suggested actions below

Toggle dark/light mode — the metallic surface and logo fill should both adapt.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/chat-panel.tsx
git commit -m "feat: use ShaderLogo in chat panel empty state"
```

---

### Task 4: Integrate into chat welcome screen

**Files:**
- Modify: `src/components/chat/chat-welcome.tsx` (line 1 import, line 67-69 usage)

- [ ] **Step 1: Add import**

At the top of `chat-welcome.tsx`, add:

```tsx
import { ShaderLogo } from "@/components/ui/shader-logo";
```

- [ ] **Step 2: Replace SentinelLogo in welcome screen**

Replace the logo block (lines 66-69):

```tsx
{/* Logo */}
<div className="mb-4">
  <SentinelLogo size={48} />
</div>
```

With:

```tsx
{/* Logo */}
<div className="mb-4">
  <ShaderLogo size={84} logoSize={48} />
</div>
```

- [ ] **Step 3: Remove unused SentinelLogo import if no longer needed**

If `SentinelLogo` is no longer used in `chat-welcome.tsx`, remove the import on line 1:

```tsx
import { SentinelLogo } from "@/components/ui/sentinel-logo";
```

- [ ] **Step 4: Verify in browser**

Open the app at `/` (home page) with no active conversation. The welcome screen should show the same metallic shader coin with logo overlay, larger (84px disc, 48px logo). Test both themes.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/chat-welcome.tsx
git commit -m "feat: use ShaderLogo in chat welcome screen"
```

---

### Task 5: Verify fallbacks and build

**Files:**
- No new files — verification only

- [ ] **Step 1: Test reduced motion fallback**

In browser DevTools, toggle reduced motion:
- Chrome: DevTools → Rendering → Emulate CSS media feature `prefers-reduced-motion: reduce`
- Verify the shader disappears and the static `SentinelLogo variant="contained"` renders instead
- Toggle back to `no-preference` — shader should reappear

- [ ] **Step 2: Test theme switching**

Toggle between light and dark mode using the app's theme switcher.
- Light mode: lighter metallic disc, dark `#111` logo
- Dark mode: darker metallic disc, light `#ddd` logo
- No flash of wrong colors on switch

- [ ] **Step 3: Run production build**

```bash
pnpm build
```

Expected: Build succeeds with no errors. The dynamic import with `ssr: false` should prevent any server-side WebGL issues.

- [ ] **Step 4: Run lint**

```bash
pnpm lint
```

Expected: No new lint errors.

- [ ] **Step 5: Visual spot check**

Open the built app (`pnpm start`) and verify:
- Chat panel empty state shows the shader logo
- Welcome screen shows the shader logo
- Animation is subtle and slow
- No console errors or WebGL warnings
- Tab switching pauses/resumes the animation (check CPU usage in DevTools)

- [ ] **Step 6: Commit any fixes**

If any adjustments were needed during verification, commit them:

```bash
git add -A
git commit -m "fix: shader logo adjustments from verification"
```
