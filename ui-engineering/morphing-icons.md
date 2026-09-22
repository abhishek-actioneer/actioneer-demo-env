# Morphing Icons

SVG icons that animate between states (e.g., hamburger → close, play → pause).

## Consistent ViewBox Size [HIGH]

All icon states must share the same `viewBox` dimensions. Mismatched viewBoxes cause jumps during morphing:

```jsx
// ❌ Different viewBoxes — morphing will jump
const MenuIcon = () => <svg viewBox="0 0 24 24" />;
const CloseIcon = () => <svg viewBox="0 0 20 20" />;

// ✅ Same viewBox for all states
const MorphingIcon = ({ open }) => (
  <svg viewBox="0 0 24 24">
    {/* Lines animate between positions */}
  </svg>
);
```

## Three Lines Structure [HIGH]

Morphing menu icons (hamburger → X) must use exactly three lines. This gives you enough elements to animate the transformation symmetrically:

```jsx
function MorphingMenuIcon({ open }) {
  return (
    <svg viewBox="0 0 24 24" width={24} height={24}>
      <motion.line
        x1="4" y1="6" x2="20" y2="6"
        variants={{
          closed: { y1: 6, y2: 6, rotate: 0 },
          open:   { y1: 12, y2: 12, rotate: 45 },
        }}
        animate={open ? "open" : "closed"}
      />
      <motion.line
        x1="4" y1="12" x2="20" y2="12"
        variants={{
          closed: { opacity: 1 },
          open:   { opacity: 0 },
        }}
        animate={open ? "open" : "closed"}
      />
      <motion.line
        x1="4" y1="18" x2="20" y2="18"
        variants={{
          closed: { y1: 18, y2: 18, rotate: 0 },
          open:   { y1: 12, y2: 12, rotate: -45 },
        }}
        animate={open ? "open" : "closed"}
      />
    </svg>
  );
}
```

## Use Collapsed Constant for Unused Lines [HIGH]

When a line should disappear during morphing, animate it to a collapsed state (zero length or opacity 0) rather than hiding it — this preserves transform origin for smooth animation:

```jsx
const COLLAPSED = { x1: 12, y1: 12, x2: 12, y2: 12 };

// Use COLLAPSED instead of display:none or opacity:0
variants={{
  open: COLLAPSED,
  closed: { x1: 4, y1: 12, x2: 20, y2: 12 },
}}
```

## Shared Group for Rotational Variants [HIGH]

Wrap lines in a `<motion.g>` with a shared `transformOrigin` for clean rotation around the icon center:

```jsx
<motion.g
  style={{ transformOrigin: '12px 12px' }}
  variants={{
    open:   { rotate: 0 },
    closed: { rotate: 90 },
  }}
  animate={isOpen ? "open" : "closed"}
>
  {/* lines here */}
</motion.g>
```

## Spring Physics for Rotation [MEDIUM]

Use spring physics for icon rotation — it feels alive and responsive:

```jsx
<motion.g
  animate={{ rotate: open ? 45 : 0 }}
  transition={{ type: "spring", stiffness: 300, damping: 25 }}
/>
```

## Instant Jump for Non-Grouped Icons [MEDIUM]

When icons can't share a group (e.g., two completely different SVG shapes), don't try to morph — just swap instantly or use a crossfade:

```jsx
<AnimatePresence mode="wait">
  {open
    ? <motion.div key="close" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <CloseIcon />
      </motion.div>
    : <motion.div key="menu" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <MenuIcon />
      </motion.div>
  }
</AnimatePresence>
```

## Round Stroke Line Caps [LOW]

Use `strokeLinecap="round"` for a polished, modern look:

```jsx
<line strokeLinecap="round" strokeLinejoin="round" />
```

## aria-hidden on Icon SVGs [LOW]

Icon SVGs should be `aria-hidden="true"` — the containing button's `aria-label` carries the semantic meaning:

```jsx
<button aria-label="Toggle menu">
  <svg aria-hidden="true" focusable="false">
    {/* lines */}
  </svg>
</button>
```

## Reduced Motion Support [MEDIUM]

Snap to final state for users who prefer reduced motion:

```jsx
import { useReducedMotion } from "framer-motion";

function MorphingIcon({ open }) {
  const reduced = useReducedMotion();

  return (
    <svg viewBox="0 0 24 24">
      <motion.line
        animate={open ? "open" : "closed"}
        transition={reduced ? { duration: 0 } : { type: "spring" }}
        variants={/* ... */}
      />
    </svg>
  );
}
```
