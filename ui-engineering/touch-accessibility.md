# Touch & Accessibility

## Touch Devices

### Hover Effects [HIGH]

Disable hover effects on touch devices. Touch triggers hover on tap, causing sticky false positives.

```css
/* ❌ Applies to all devices */
.element:hover {
  transform: scale(1.05);
}

/* ✅ Only on devices that truly support hover */
@media (hover: hover) and (pointer: fine) {
  .element:hover {
    transform: scale(1.05);
  }
}
```

**Rule:** Never rely on hover for core functionality. Hover should enhance, not enable.

### Touch Action [MEDIUM]

Prevent double-tap zoom on interactive controls:

```css
button, a, input {
  touch-action: manipulation;
}
```

Disable touch-action entirely for custom canvas/gesture components to prevent interference:

```css
.custom-canvas {
  touch-action: none;
}
```

### Tap Targets — 44px Minimum [HIGH]

Visual size can be smaller; hit area must be at least 44×44px. Use pseudo-elements to expand without changing layout:

```css
.icon-button {
  width: 20px;
  height: 20px;
  position: relative;
}

/* Expand hit area to 44px without affecting layout */
.icon-button::before {
  content: '';
  position: absolute;
  inset: -12px;
}
```

Or use padding:

```css
.small-button {
  min-width: 44px;
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

### Video Autoplay on iOS [MEDIUM]

Add `muted` and `playsinline` to autoplay on iOS without triggering fullscreen popup:

```html
<video autoplay muted playsinline loop>
  <source src="video.mp4" type="video/mp4" />
</video>
```

### OS-Specific Shortcuts [MEDIUM]

Show Cmd on Mac, Ctrl on Windows:

```js
const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
const modKey = isMac ? '⌘' : 'Ctrl';
// Display: "Save (⌘S)" on Mac, "Save (Ctrl+S)" on Windows
```

## Keyboard Navigation

### Tab Order [HIGH]

Only visible elements should be in the tab order. Use `inert` or `visibility: hidden` to remove hidden panels:

```html
<!-- Preferred: inert removes from a11y tree and tab order -->
<div inert={!isVisible}>
  Hidden panel content
</div>
```

```css
/* Also effective for CSS-only approaches */
.hidden-panel {
  visibility: hidden; /* removes from tab order unlike display:none wait... */
}
```

### Scroll Into View [MEDIUM]

Keyboard navigation must scroll focused elements into view:

```jsx
function handleFocus(e: FocusEvent) {
  e.target.scrollIntoView({
    behavior: 'smooth',
    block: 'nearest',
  });
}
```

### Focus Management [HIGH]

- **On modal open:** Move focus to first interactive element or the modal container
- **On modal close:** Return focus to the element that triggered the modal

```jsx
function Modal({ triggerRef, ...props }) {
  const firstFocusableRef = useRef(null);

  useEffect(() => {
    if (props.open) {
      firstFocusableRef.current?.focus();
    } else {
      triggerRef.current?.focus();
    }
  }, [props.open]);
}
```

## Accessibility

### ARIA Labels on Icon Buttons [HIGH]

Every button that contains only an icon must have `aria-label`:

```html
<!-- ❌ Screen reader says "button" -->
<button><CloseIcon /></button>

<!-- ✅ Screen reader says "Close dialog" -->
<button aria-label="Close dialog"><CloseIcon /></button>
```

### Focus Outlines [MEDIUM]

Don't remove focus outlines. If customizing, use grey, black, or white — custom colors often clash:

```css
.button:focus-visible {
  outline: 2px solid var(--gray-12);
  outline-offset: 2px;
}
```

### Reduced Motion — Videos [MEDIUM]

For users who prefer reduced motion, show play button instead of autoplaying:

```jsx
const prefersReducedMotion = window.matchMedia(
  '(prefers-reduced-motion: reduce)'
).matches;

<video
  autoPlay={!prefersReducedMotion}
  controls={prefersReducedMotion}
  muted
  playsInline
/>
```

### Time-Limited Actions [MEDIUM]

Pause timers when the user switches tabs:

```js
let timeoutId;
let remainingTime = TOTAL_TIME;
let startTime;

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearTimeout(timeoutId);
    remainingTime -= Date.now() - startTime;
  } else {
    startTime = Date.now();
    timeoutId = setTimeout(callback, remainingTime);
  }
});
```

### Illustrations [LOW]

Code illustrations should have `aria-label`, disabled pointer events, and disabled text selection:

```jsx
<div
  role="img"
  aria-label="Abstract geometric pattern"
  style={{ userSelect: 'none', pointerEvents: 'none' }}
/>
```

## Tooltips

### Show Delay [MEDIUM]

Tooltips need a delay before appearing to prevent accidental activation:

```css
.tooltip {
  transition-delay: 200ms;
}
```

### Warm State — Sequential Tooltips [MEDIUM]

Once one tooltip opens, subsequent tooltips should appear instantly with no delay or animation. Track "warm" state and clear it 300ms after the last tooltip closes.

```jsx
const [isWarm, setIsWarm] = useState(false);
// On any tooltip open: setIsWarm(true)
// On all tooltips closed: setTimeout(() => setIsWarm(false), 300)

<Tooltip delay={isWarm ? 0 : 200} skipAnimation={isWarm}>
```

### Submenus — Safe Area [MEDIUM]

Users need to move diagonally from a trigger to a submenu without it closing. Create a triangular safe zone:

```css
/* Invisible area covering the diagonal path from trigger to submenu */
.submenu-safe-area {
  position: absolute;
  clip-path: polygon(0 0, 100% 0, 100% 100%);
}
```

## Feedback Visibility [MEDIUM]

Feedback components (toasts, alerts, validation states) must be visible on the page. Never hide feedback behind hover states or inside collapsed sections users haven't opened.
