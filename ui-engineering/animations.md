# Animations

## Easing Blueprint

### Decision: Which Easing?

```
Is the element entering or exiting the screen?
├── Entering → ease-out
├── Exiting  → ease-in
└── Already on screen?
    ├── Moving to new position → ease-in-out
    └── Hover / color change  → ease
```

### ease-out [CRITICAL] — Most Common

For **entering** elements: dropdowns, modals, tooltips, drawers.

Fast start creates an instant, responsive feeling — the element jumps toward its destination then settles.

```css
/* Sorted weak → strong */
--ease-out-quad:  cubic-bezier(0.25, 0.46, 0.45, 0.94);
--ease-out-cubic: cubic-bezier(0.215, 0.61, 0.355, 1);
--ease-out-quart: cubic-bezier(0.165, 0.84, 0.44, 1);
--ease-out-quint: cubic-bezier(0.23, 1, 0.32, 1);
--ease-out-expo:  cubic-bezier(0.19, 1, 0.22, 1);
--ease-out-circ:  cubic-bezier(0.075, 0.82, 0.165, 1);
```

### ease-in [HIGH] — Exits Only

For **exiting** elements. Builds momentum before departure — element accelerates as it leaves.

```css
--ease-in-quad:  cubic-bezier(0.55, 0.085, 0.68, 0.53);
--ease-in-cubic: cubic-bezier(0.55, 0.055, 0.675, 0.19);
--ease-in-quart: cubic-bezier(0.895, 0.03, 0.685, 0.22);
```

**Avoid for UI entrances** — slow start delays visual feedback, makes UI feel sluggish.

### ease-in-out [MEDIUM] — On-Screen Movement

For elements **already on screen** that need to move or morph. Mimics natural motion (car accelerating then braking). Also correct for View Transitions.

```css
--ease-in-out-cubic: cubic-bezier(0.645, 0.045, 0.355, 1);
--ease-in-out-quart: cubic-bezier(0.77, 0, 0.175, 1);
--ease-in-out-expo:  cubic-bezier(1, 0, 0, 1);
```

### ease [MEDIUM] — Hover / Color

For hover states and color transitions. Asymmetric curve feels elegant for gentle state changes.

```css
transition: background-color 150ms ease;
```

### linear — Avoid in UI

Only use for constant-speed animations: marquees, tickers, hold-to-delete progress bars.

## Duration Guidelines [CRITICAL]

| Element Type | Duration |
|---|---|
| Micro-interactions (hover, color) | 100–150ms |
| Standard UI (tooltips, dropdowns) | 150–250ms |
| Modals, drawers | 200–300ms |
| Page / view transitions | 300–400ms |
| Complex / orchestrated | 400–600ms |

**Rules:**
- User-initiated actions: **never exceed 300ms**
- Larger elements animate slower than smaller ones
- Exit animations can be faster than entrances
- Longer travel distance = longer duration
- Shorten duration before adjusting the curve — duration has more impact

## Frequency Principle [CRITICAL]

```
Will users see this 100+ times per day?
├── Yes → Don't animate (or drastically reduce)
└── No  → Standard animation
```

Example: Raycast never animates its menu toggle — users open it hundreds of times daily.

## Paired Elements Rule [HIGH]

Elements that animate together must share the same easing and duration.

```css
/* ❌ Inconsistent — feels disconnected */
.modal   { transition: transform 200ms ease-out; }
.overlay { transition: opacity 300ms ease-in-out; }

/* ✅ Unified */
.modal   { transition: transform 200ms ease-out; }
.overlay { transition: opacity   200ms ease-out; }
```

## When to Animate

**Do animate:**
- Enter/exit transitions for spatial consistency
- State changes that benefit from visual continuity
- Responses to user actions (feedback loops)
- Rarely-used interactions where delight adds value

**Don't animate:**
- Keyboard-initiated actions [HIGH]
- Hover effects on frequently-used elements
- Anything users interact with 100+ times daily
- When speed matters more than smoothness

## Spring Animations [HIGH]

Springs feel more natural because they simulate physics rather than having fixed durations. Ideal for:
- Drag interactions with momentum
- Elements that should feel "alive"
- Gestures that can be interrupted mid-animation

```js
// Apple's approach — duration + bounce (easier to reason about)
{ type: "spring", duration: 0.5, bounce: 0.2 }

// Traditional physics
{ type: "spring", mass: 1, stiffness: 100, damping: 10 }
```

**Bounce guidelines:**
- Avoid bounce in most product UI contexts
- Use for drag-to-dismiss, playful or organic interactions
- Keep bounce subtle (0.1–0.3) when used

**Interruptibility:** Springs maintain velocity when interrupted — CSS animations restart from zero. This makes springs ideal for gestures users might change mid-motion.

## Stagger [MEDIUM]

Keep stagger under **50ms per item**. Excessive stagger makes list animations feel slow and theatrical.

## Active State [HIGH]

Add `transform: scale(0.97–0.98)` on `:active` to make buttons feel physically responsive:

```css
.button:active {
  transform: scale(0.97);
}
```

## Squash & Stretch [MEDIUM]

Use subtle deformation for physical realism. Keep deformation small — overly dramatic squash/stretch looks cartoonish in product UI.

## Staging [MEDIUM]

- **Single focal point** — don't animate multiple competing elements simultaneously
- **Dim background** — use reduced opacity on non-focal elements during animations
- **Z-index hierarchy** — animated elements should be visually above static content

## Performance [CRITICAL]

Only animate `transform` and `opacity`. These run on the GPU and skip layout and paint.

**Avoid animating:**
- `padding`, `margin`, `height`, `width` (trigger layout recalculation)
- `blur` filters above 20px (expensive, especially Safari)
- CSS variables in deep component trees

```css
/* Force GPU acceleration */
.animated-element {
  will-change: transform;
}
```

**React:** Animate outside React's render cycle when possible — re-renders on every frame drop frames. Use refs to update styles directly.

**Framer Motion:**
```jsx
// ✅ Hardware accelerated (transform as string)
<motion.div animate={{ transform: "translateX(100px)" }} />

// ⚠️ More readable but NOT hardware accelerated
<motion.div animate={{ x: 100 }} />
```

**Looping animations:** Pause when off-screen to save resources (use `IntersectionObserver`).

## prefers-reduced-motion [CRITICAL]

Every animation needs its own reduced motion query. No exceptions — not even opacity or color.

```css
.modal {
  animation: fadeIn 200ms ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .modal {
    animation: none;
  }
}
```

**Framer Motion:**
```jsx
import { useReducedMotion } from "framer-motion";

function Component() {
  const shouldReduceMotion = useReducedMotion();
  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    />
  );
}
```

## Theme Transitions [MEDIUM]

Switching themes must NOT trigger transitions on existing elements. Disable during theme change:

```js
function setTheme(theme) {
  document.documentElement.classList.add('no-transitions');
  document.documentElement.setAttribute('data-theme', theme);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.documentElement.classList.remove('no-transitions');
    });
  });
}
```

```css
.no-transitions,
.no-transitions * {
  transition: none !important;
}
```

## Practical Tips

| Scenario | Solution |
|---|---|
| Element appears from nowhere | Start from `scale(0.95)`, not `scale(0)` |
| Shaky/jittery animation | Add `will-change: transform` |
| Hover causes flicker | Animate child element, not parent |
| Popover scales from wrong point | Set `transform-origin` to trigger location |
| Sequential tooltips feel slow | Skip delay/animation after first tooltip opens |
| Hover triggers on mobile | `@media (hover: hover) and (pointer: fine)` |
| Drag-to-dismiss | Velocity > 0.10 (swipeAmount / timeTaken) sufficient to trigger |
