# UI Polish & Visual Design

## Shadows

### Shadows Over Borders [HIGH]

Use `box-shadow` instead of `border` for subtle separators — shadows blend better with varying backgrounds:

```css
/* ❌ Hard border that clashes with non-white backgrounds */
.card { border: 1px solid rgba(0, 0, 0, 0.08); }

/* ✅ Shadow blends with any background */
.card { box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.08); }
```

### Layered Shadows [HIGH]

Layer 2–3 shadows for realistic depth. Real objects cast multiple shadows at different distances:

```css
.card {
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.04),
    0 4px 8px rgba(0, 0, 0, 0.06),
    0 12px 24px rgba(0, 0, 0, 0.08);
}
```

### Shadow Direction [HIGH]

Light source must be consistent across the entire UI. All shadows should point in the same direction (typically downward, as if lit from above):

```css
/* ✅ Consistent light from top */
.button  { box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
.modal   { box-shadow: 0 8px 32px rgba(0,0,0,0.15); }
.tooltip { box-shadow: 0 4px 12px rgba(0,0,0,0.12); }
```

### Shadow Indicates Elevation [MEDIUM]

Larger shadow = higher elevation. Use shadow size to communicate z-order:

```css
:root {
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
  --shadow-md: 0 4px 8px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04);
  --shadow-lg: 0 12px 24px rgba(0,0,0,0.12), 0 4px 8px rgba(0,0,0,0.06);
  --shadow-xl: 0 24px 48px rgba(0,0,0,0.16), 0 8px 16px rgba(0,0,0,0.08);
}
```

### No Pure Black Shadows [MEDIUM]

Pure black shadows look flat and artificial. Use dark neutral or slightly warm-tinted colors:

```css
/* ❌ */
box-shadow: 0 4px 8px rgba(0, 0, 0, 0.5);

/* ✅ Neutral dark */
box-shadow: 0 4px 8px rgba(15, 15, 25, 0.12);
```

### Animate Shadows via Pseudo-Element [MEDIUM]

Shadow transitions are expensive (triggers repaint). Use a pseudo-element opacity trick for GPU-accelerated shadow hover effects:

```css
.card {
  position: relative;
}

.card::after {
  content: '';
  position: absolute;
  inset: 0;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  opacity: 0;
  transition: opacity 200ms ease;
  border-radius: inherit;
}

.card:hover::after {
  opacity: 1;
}
```

### Button Shadow Anatomy [HIGH]

Polished buttons use a full shadow anatomy: outer shadow for lift, inset shadow for inner bevel/glow:

```css
.button-primary {
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.12),      /* lift */
    0 1px 2px rgba(0, 0, 0, 0.08),      /* ground */
    inset 0 1px 0 rgba(255, 255, 255, 0.15); /* inner highlight */
}
```

## Borders

### Hairline Borders on Retina [MEDIUM]

Use 0.5px borders on retina displays for crisp, fine dividers:

```css
:root {
  --border-hairline: 1px;
}

@media only screen and (-webkit-min-device-pixel-ratio: 2),
       only screen and (min-resolution: 192dpi) {
  :root {
    --border-hairline: 0.5px;
  }
}

.divider {
  border-bottom: var(--border-hairline) solid var(--gray-6);
}
```

### Semi-Transparent Borders [MEDIUM]

Use alpha-channel border colors that work on any background:

```css
/* ❌ Fixed color breaks on non-white backgrounds */
.card { border: 1px solid #e5e7eb; }

/* ✅ Semi-transparent works anywhere */
.card { border: 1px solid rgba(0, 0, 0, 0.08); }
```

## Border Radius

### Concentric Radius [HIGH]

Nested elements need concentric border radii. Inner radius = outer radius - gap:

```css
.card {
  border-radius: 12px;
  padding: 8px;
}

/* Inner content radius = 12px - 8px = 4px */
.card-inner {
  border-radius: 4px;
}
```

Do not use the same border radius on parent and child — it looks wrong.

## Gradients

### Eased Gradients [MEDIUM]

Linear gradients have visible color banding in the middle. Use eased (ease-in-out) gradients for smoother transitions. Tool: https://larsenwork.com/easing-gradients/

```css
/* ❌ Linear — visible banding */
background: linear-gradient(to bottom, #000, transparent);

/* ✅ Eased — smooth transition */
background: linear-gradient(
  to bottom,
  hsl(0 0% 0% / 1) 0%,
  hsl(0 0% 0% / 0.738) 19%,
  hsl(0 0% 0% / 0.541) 34%,
  hsl(0 0% 0% / 0.382) 47%,
  hsl(0 0% 0% / 0.278) 56.5%,
  hsl(0 0% 0% / 0.194) 65%,
  hsl(0 0% 0% / 0.126) 73%,
  hsl(0 0% 0% / 0.075) 80.2%,
  hsl(0 0% 0% / 0.042) 86.1%,
  hsl(0 0% 0% / 0.021) 91%,
  hsl(0 0% 0% / 0.008) 95.2%,
  hsl(0 0% 0% / 0.002) 98.2%,
  hsl(0 0% 0% / 0) 100%
);
```

### mask-image Over Gradient Fades [MEDIUM]

Use `mask-image` to fade content edges — masks work better than gradients when content has varying colors:

```css
.fade-bottom {
  mask-image: linear-gradient(to bottom, black 80%, transparent);
  -webkit-mask-image: linear-gradient(to bottom, black 80%, transparent);
}
```

**Don't** apply fade on scrollable lists — it restricts the viewable area and clips content.

## Scrollbars [MEDIUM]

Never customize page-level scrollbars. Only style scrollbars inside small, contained elements:

```css
/* ✅ Only inside a code block */
.code-block::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.code-block::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 3px;
}
```

## Z-Index [HIGH]

Use a fixed z-index scale. Never use arbitrary values like 9999:

```css
:root {
  --z-base:     0;
  --z-raised:   10;
  --z-dropdown: 100;
  --z-sticky:   200;
  --z-overlay:  300;
  --z-modal:    400;
  --z-tooltip:  500;
  --z-toast:    600;
}
```

Prefer avoiding z-index altogether with `isolation: isolate`:

```css
.card { isolation: isolate; }
```

## Dark Mode

### CSS Variable Flipping [HIGH]

Use numerical CSS variable scales that flip between light and dark. Never use Tailwind's `dark:` modifier:

```css
/* ✅ Variables flip — one source of truth */
:root {
  --gray-1: #fafafa;
  --gray-12: #171717;
}

[data-theme="dark"] {
  --gray-1: #171717;
  --gray-12: #fafafa;
}

.button {
  background: var(--gray-12);
  color: var(--gray-1);
}
```

```css
/* ❌ Manual overrides everywhere — hard to maintain */
.button {
  @apply bg-gray-900 dark:bg-gray-100;
}
```

## Layout

### Decorative Elements [MEDIUM]

Decorative elements must have `pointer-events: none` so they don't block clicks:

```css
.decorative-bg {
  pointer-events: none;
}
```

Illustrations should also have `user-select: none`:

```css
.illustration {
  pointer-events: none;
  user-select: none;
}
```

### Safe Areas [MEDIUM]

Account for device safe areas (notches, home indicators):

```css
.footer  { padding-bottom: env(safe-area-inset-bottom); }
.sidebar { padding-left: env(safe-area-inset-left); }
```

### Scroll Margins [MEDIUM]

Set `scroll-margin-top` on anchor targets to account for sticky headers:

```css
[id] {
  scroll-margin-top: 80px; /* match sticky header height */
}
```

### Grid Text Truncation [MEDIUM]

Truncate overflowing text in grid cells:

```css
.grid-cell {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
```

### Consistent Spacing Scale [HIGH]

Use a consistent spacing scale throughout the UI. Never use arbitrary values:

```css
:root {
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;
  --space-16: 64px;
}
```

## Refresh Behavior [MEDIUM]

Page refresh should cause no flash of incorrect state in interactive components. Persist state in `localStorage`/`sessionStorage` or use SSR hydration to set initial state before render.
