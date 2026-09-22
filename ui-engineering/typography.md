# Typography

## Font Rendering

### Antialiasing [MEDIUM]

Always apply antialiased font smoothing — default rendering looks slightly blurry on macOS:

```css
body {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

### Font Subsetting [MEDIUM]

Subset fonts to include only the characters you use. A full variable font can be 300KB+; a subset is often under 40KB.

### Font Display [MEDIUM]

Use `font-display: swap` to prevent invisible text during font load:

```css
@font-face {
  font-family: 'Inter';
  src: url('/fonts/inter.woff2') format('woff2');
  font-display: swap;
}
```

### Disable Font Synthesis [LOW]

Prevent browsers from generating fake bold/italic when font files are missing — fake synthesis looks noticeably wrong:

```css
body {
  font-synthesis: none;
}
```

## Layout Shift Prevention

### No Font Weight on Hover [HIGH]

Never change font weight on hover or selected states. It shifts surrounding text.

```css
/* ❌ Causes layout shift */
.tab:hover { font-weight: 600; }
.tab.selected { font-weight: 600; }

/* ✅ Use color or opacity instead */
.tab { font-weight: 500; }
.tab.selected { color: var(--color-primary); }
```

### Tabular Numbers [HIGH]

Use `font-variant-numeric: tabular-nums` for numbers that change (counters, prices, timers). Prevents layout shift as digits change width.

```css
.counter, .price, .timer {
  font-variant-numeric: tabular-nums;
}
```

## Text Wrapping

### Headings [MEDIUM]

Use `text-wrap: balance` on headings for better line breaks — avoids orphaned single words:

```css
h1, h2, h3 {
  text-wrap: balance;
}
```

### Body Text [MEDIUM]

Use `text-wrap: pretty` for body text — prevents orphaned last words without the reflow cost of `balance`:

```css
p, article {
  text-wrap: pretty;
}
```

## Letter Spacing

### By Font Size [MEDIUM]

Larger text needs tighter letter spacing; smaller text needs looser. Pair sizes with their optimal tracking in a Text component.

### Uppercase [MEDIUM]

Uppercase text always needs letter spacing — all-caps without tracking feels cramped:

```css
.label-uppercase {
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
```

## OpenType Features

### Contextual Alternates [MEDIUM]

Enable contextual alternates for more natural letter connections in fonts that support them:

```css
body {
  font-feature-settings: "calt" 1;
}
```

Or in `font-variant`:
```css
body {
  font-variant-ligatures: contextual;
}
```

### Stylistic Set for UI Disambiguation [MEDIUM]

Enable disambiguation stylistic sets for UI fonts (Inter, etc.) to distinguish similar characters (l, 1, I, 0, O):

```css
/* Inter's stylistic set for disambiguation */
.code, .monospace, .id {
  font-feature-settings: "ss01" 1, "ss02" 1;
}
```

### Slashed Zero [MEDIUM]

Enable slashed zero for any context showing IDs, codes, or numeric data to distinguish 0 from O:

```css
.id-display {
  font-feature-settings: "zero" 1;
}
```

### Oldstyle Numbers for Prose [MEDIUM]

Oldstyle (text) figures integrate better in body prose — they have descenders and match the lowercase x-height:

```css
article p {
  font-variant-numeric: oldstyle-nums;
}
```

Use tabular lining figures for data tables (see above).

### Tabular Fractions [LOW]

Use typographic fractions instead of slash notation:

```css
.fraction {
  font-variant-numeric: diagonal-fractions;
}
/* Renders 1/2 as proper fraction glyph */
```

### Optical Sizing [MEDIUM]

Keep optical sizing on `auto` (the default). Browsers use it to optimize letterforms at different sizes. Don't override it:

```css
/* ❌ Disables helpful automatic adjustment */
font-optical-sizing: none;

/* ✅ Default — leave it */
font-optical-sizing: auto;
```

### Variable Font Weights [LOW]

Variable fonts support continuous weight values — use them for fine-tuned hierarchy:

```css
.heading { font-weight: 650; }  /* Between semibold and bold */
.body    { font-weight: 420; }  /* Slightly heavier than regular */
```

## Underlines [MEDIUM]

Offset underlines from descenders to avoid collisions with letters like g, p, y:

```css
a {
  text-decoration: underline;
  text-underline-offset: 3px;
}
```

## Typography Characters

Use proper typographic characters, not ASCII substitutes:

| Instead of | Use | Name |
|---|---|---|
| `...` | `…` | Ellipsis |
| `'` | `'` / `'` | Curly apostrophe/quotes |
| `"` | `"` / `"` | Curly double quotes |

## Font Weight Variables

Define weights as CSS variables for global control:

```css
:root {
  --font-weight-normal:   400;
  --font-weight-medium:   500;
  --font-weight-semibold: 600;
  --font-weight-bold:     700;
}
```
