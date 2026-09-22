# Liquid Metal Shader Logo

## Summary

Replace the static SVG logo in the chat panel empty state and chat welcome screen with an animated liquid metal shader effect. The shader renders a full metallic coin/disc, with the Sentinel logo overlaid as dark paths — like an embossed coin.

Uses `@paper-design/shaders-react` (the `<LiquidMetal>` component) for WebGL2-based rendering with React lifecycle management.

## Visual Effect

- Full circular disc filled with animated liquid metal shader
- Sentinel arrow-grid logo SVG positioned absolute-centered on top with dark fill
- Subtle chromatic dispersion (blue/red shift) creates the chrome-catching-light look
- Slow animation speed (0.4) — ambient shimmer, not attention-grabbing
- Monochrome metallic palette matching the project's strictly-monochrome UI convention

## New Component

### `src/components/ui/shader-logo.tsx` (`"use client"`)

```tsx
<ShaderLogo size={72} logoSize={40} className="mb-4" />
```

**Props:**
- `size: number` (default 72) — outer disc diameter in px
- `logoSize: number` (default 40) — inner SVG logo size in px
- `className?: string` — passed to outer wrapper

**Rendering:**
```
<div relative rounded-full overflow-hidden [size x size]>
  <LiquidMetal />        // WebGL canvas, fills container
  <div absolute inset-0>  // centering layer
    <LogoSvg />           // dark-filled SVG paths
  </div>
</div>
```

**Shader uniforms:**

| Uniform | Value | Reason |
|---------|-------|--------|
| `shape` | `"circle"` | Circular disc mask |
| `speed` | `0.4` | Slow ambient (frequency principle) |
| `repetition` | `1.5` | Smooth metallic band density |
| `softness` | `0.5` | Soft edges on metal bands |
| `shiftRed` | `0.3` | Chromatic red channel offset |
| `shiftBlue` | `0.3` | Chromatic blue channel offset |
| `distortion` | `0` | Clean surface, no warping |
| `contour` | `0` | No edge contour lines |
| `angle` | `100` | Stripe rotation |
| `scale` | `1.5` | Zoom level |
| `colorBack` | theme-dependent | `#1a1a1a` dark / `#d4d4d4` light |

**Theme handling:** Uses `resolvedTheme` from `useTheme()` (not `theme`, which is `undefined` during SSR/hydration for system theme). When `resolvedTheme` is `undefined` (initial hydration frame), render the static `SentinelLogo variant="contained"` fallback until the theme resolves.

**Logo fill color:** The logo SVG uses a theme-dependent hardcoded fill — `#111` in light mode (dark logo on light metal), `#ddd` in dark mode (light logo on dark metal). This overrides `currentColor` by wrapping the SVG in a div with explicit `color` style. The chromatic metallic highlights provide additional contrast in both themes.

## Integration Points

### `chat-panel.tsx` — Empty state (line 266)

Before:
```tsx
<SentinelLogo size={40} className="mb-4" />
```

After:
```tsx
<ShaderLogo size={72} logoSize={40} className="mb-4" />
```

### `chat-welcome.tsx` — Welcome screen (line 68)

Before:
```tsx
<SentinelLogo size={48} />
```

After:
```tsx
<ShaderLogo size={84} logoSize={48} />
```

## Performance

- **Canvas size:** 72-84px diameter — negligible GPU cost
- **Lifecycle:** `EmptyState` and `ChatWelcome` only render when the panel is open and no messages exist. When the panel closes or messages appear, the component unmounts and `LiquidMetal` auto-disposes WebGL resources.
- **Tab visibility:** `ShaderMount` (underlying vanilla class) pauses `requestAnimationFrame` when the document tab is hidden — built into the library.
- **DPR scaling:** The `ShaderMount` class handles `devicePixelRatio` automatically (calculates canvas resolution based on DPR, browser zoom, and visual viewport scale). No manual DPR handling needed.
- **React 19 strict mode:** Effects run twice in dev. `LiquidMetal`/`ShaderMount` must cleanly dispose in cleanup and recreate on remount — verify during implementation.

## Fallbacks

- **`prefers-reduced-motion: reduce`:** Detect via `window.matchMedia('(prefers-reduced-motion: reduce)')` in a `useEffect` + state pattern (avoids SSR mismatch). Listen for runtime changes via `matchMedia.addEventListener('change', ...)`. When active, render static `<SentinelLogo variant="contained" />` — no WebGL mounted.
- **WebGL2 not supported:** Wrap `<LiquidMetal>` in a React error boundary within `ShaderLogo`. On error, render the static `SentinelLogo variant="contained"` fallback. This handles GPU blocklist, enterprise policy, and old browsers.
- **Forced colors / High Contrast mode:** When `forced-colors: active`, use the static fallback (same as reduced-motion) to avoid jarring mismatch with the system high-contrast UI.

## Accessibility

- **`aria-hidden="true"`** on the outer wrapper div — entire shader + logo is decorative, conveys no information.
- **`role="presentation"`** on the outer wrapper.

## Package

- Install: `pnpm add @paper-design/shaders-react`
- Pin exact version in `package.json` (library uses 0.0.x semver, breaking changes possible)
- The React package depends on `@paper-design/shaders` (vanilla) as a transitive dep

## Files Changed

| File | Change |
|------|--------|
| `src/components/ui/shader-logo.tsx` | New component |
| `src/components/chat/chat-panel.tsx` | Swap `SentinelLogo` for `ShaderLogo` in `EmptyState` |
| `src/components/chat/chat-welcome.tsx` | Swap `SentinelLogo` for `ShaderLogo` |
| `package.json` | Add `@paper-design/shaders-react` |

## Out of Scope

- Chat FAB button — too small (16px) for WebGL, already has CSS metallic border
- Chat thread avatar — appears frequently (per-message), frequency principle says don't animate
- Left sidebar logo — not part of this change
