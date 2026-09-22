# CSS Pseudo-Elements & View Transitions

## Pseudo-Elements

### content Required [HIGH]

`::before` and `::after` require `content: ''` to render. Without it the pseudo-element doesn't exist.

```css
/* ❌ Pseudo-element doesn't render */
.element::before {
  position: absolute;
  width: 44px;
  height: 44px;
}

/* ✅ */
.element::before {
  content: '';
  position: absolute;
  width: 44px;
  height: 44px;
}
```

### Position Relative on Parent [HIGH]

Absolutely positioned pseudo-elements need a positioned ancestor. Add `position: relative` to the parent:

```css
/* ❌ Pseudo-element escapes to nearest positioned ancestor */
.button { }
.button::before { content: ''; position: absolute; inset: -8px; }

/* ✅ */
.button { position: relative; }
.button::before { content: ''; position: absolute; inset: -8px; }
```

### Pseudo-Elements Over DOM Nodes [MEDIUM]

Use pseudo-elements instead of extra DOM nodes for decorative purposes — overlays, badges, hit areas, decorative shapes:

```jsx
/* ❌ Extra DOM node for decoration */
<button>
  <span className="hit-area-expander" />
  Save
</button>

/* ✅ Pseudo-element — no DOM bloat */
```
```css
.button { position: relative; }
.button::before {
  content: '';
  position: absolute;
  inset: -8px; /* expanded hit area */
}
```

### Hit Target Expansion [MEDIUM]

Expand hit areas with `::before` or `::after` without changing layout:

```css
.small-icon-button {
  position: relative;
  width: 16px;
  height: 16px;
}

.small-icon-button::before {
  content: '';
  position: absolute;
  inset: -14px; /* expands to 44px hit area */
}
```

### Z-Index Layering [MEDIUM]

Use pseudo-elements for z-index layering — separate the visual layer from the content layer:

```css
.card {
  position: relative;
  z-index: 0;
}

/* Hover overlay as pseudo-element — doesn't affect content stacking */
.card::before {
  content: '';
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.04);
  opacity: 0;
  transition: opacity 150ms ease;
  z-index: -1;
}

.card:hover::before { opacity: 1; }
```

### ::backdrop for Dialog Backgrounds [MEDIUM]

Use `::backdrop` to style the overlay behind `<dialog>` elements — it's the semantically correct approach:

```css
dialog::backdrop {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}
```

### ::placeholder for Input Styling [LOW]

Use `::placeholder` instead of adding fake placeholder text as a DOM element:

```css
input::placeholder {
  color: var(--gray-8);
  font-style: italic;
}
```

### ::selection for Text Styling [LOW]

Brand the text selection color:

```css
::selection {
  background: var(--brand-100);
  color: var(--gray-12);
}
```

### ::marker for List Bullets [LOW]

Style list markers without extra DOM nodes:

```css
li::marker {
  color: var(--brand-500);
  font-size: 0.8em;
}
```

### ::first-line for Typographic Treatments [LOW]

Style the first line of text (e.g., drop caps, initial caps):

```css
.article-lead::first-line {
  font-size: 1.15em;
  font-weight: 600;
  letter-spacing: -0.01em;
}
```

## View Transitions API

### view-transition-name Required [HIGH]

Elements that should animate between page views need a unique `view-transition-name`:

```css
.hero-image {
  view-transition-name: hero-image;
}

.page-title {
  view-transition-name: page-title;
}
```

### Unique Names [HIGH]

`view-transition-name` must be unique across the entire page. Duplicate names cause the transition to fail silently:

```css
/* ❌ Duplicate — both elements will fail to transition */
.card-1 { view-transition-name: card; }
.card-2 { view-transition-name: card; }

/* ✅ Unique per element */
.card-1 { view-transition-name: card-1; }
.card-2 { view-transition-name: card-2; }
```

For dynamic lists, set names inline:

```jsx
<div style={{ viewTransitionName: `card-${item.id}` }}>
```

### Clean Up After Transitions [MEDIUM]

Remove `view-transition-name` after the animation completes to avoid conflicts on future transitions:

```js
element.addEventListener('transitionend', () => {
  element.style.viewTransitionName = '';
});
```

### Style View Transition Pseudo-Elements [MEDIUM]

Customize the transition animation via `::view-transition-old` and `::view-transition-new`:

```css
::view-transition-old(hero-image) {
  animation: fade-out 200ms ease-in;
}

::view-transition-new(hero-image) {
  animation: fade-in 200ms ease-out;
}

@keyframes fade-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes fade-in  { from { opacity: 0; } to { opacity: 1; } }
```

### View Transitions Over JS Libraries [MEDIUM]

Prefer native View Transitions API over JS-based page transition libraries for same-document navigations. It's GPU-accelerated and requires no JS overhead:

```js
// Trigger a view transition
document.startViewTransition(() => {
  // Make DOM changes here
  updatePage();
});
```
