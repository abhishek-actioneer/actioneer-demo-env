# Container Animation

Patterns for animating elements whose dimensions are determined by dynamic content (e.g., accordions, expandable cards, auto-height elements).

## Two-Div Pattern [HIGH]

The core pattern: outer div handles animated bounds, inner div holds content. This separates measurement from animation.

```jsx
// ❌ Animating height directly — causes layout thrash
<motion.div animate={{ height: contentHeight }}>
  {content}
</motion.div>

// ✅ Two-div pattern
function AnimatedContainer({ children }) {
  const [height, setHeight] = useState(0);
  const innerRef = useCallback(node => {
    if (node) setHeight(node.getBoundingClientRect().height);
  }, []);

  return (
    <motion.div
      animate={{ height }}
      style={{ overflow: "hidden" }}
    >
      <div ref={innerRef}>{children}</div>
    </motion.div>
  );
}
```

## Use ResizeObserver for Measurement [MEDIUM]

Use `ResizeObserver` to track content size changes, not one-time measurement. Content may change after initial render.

```jsx
function AnimatedContainer({ children }) {
  const [height, setHeight] = useState(0);
  const innerRef = useRef(null);

  useEffect(() => {
    if (!innerRef.current) return;

    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setHeight(entry.contentRect.height);
      }
    });

    observer.observe(innerRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div animate={{ height }} style={{ overflow: "hidden" }}>
      <div ref={innerRef}>{children}</div>
    </motion.div>
  );
}
```

## Use Callback Ref for Measurement [MEDIUM]

When using a callback ref (not `useRef`), you get the measurement immediately when the element mounts — no effect needed.

```jsx
function AnimatedContainer({ children }) {
  const [height, setHeight] = useState(0);

  const innerRef = useCallback(node => {
    if (!node) return;
    const observer = new ResizeObserver(entries => {
      setHeight(entries[0].contentRect.height);
    });
    observer.observe(node);
    // Note: no cleanup here — use useRef + useEffect if cleanup is needed
  }, []);

  return (
    <motion.div animate={{ height }} style={{ overflow: "hidden" }}>
      <div ref={innerRef}>{children}</div>
    </motion.div>
  );
}
```

## Guard Against Zero on Initial Render [HIGH]

On first render, measured height is often 0 before the browser paints. Animating from 0 → actual height causes a jarring flash. Guard against it.

```jsx
// ❌ Animates from 0 on first render
const [height, setHeight] = useState(0);

// ✅ Start with undefined — skip animation until measured
const [height, setHeight] = useState<number | undefined>(undefined);

<motion.div
  animate={{ height: height ?? "auto" }}
  // OR: disable animation until height is known
  initial={false}
>
```

## Overflow Hidden on Animated Container [MEDIUM]

The outer animated container must have `overflow: hidden` — otherwise content is visible outside the animated bounds during the transition.

```jsx
// ❌ Content bleeds out during animation
<motion.div animate={{ height }}>

// ✅
<motion.div animate={{ height }} style={{ overflow: "hidden" }}>
```

## Add Delay for Natural Container Transitions [LOW]

A very small delay (30–60ms) before the container animates makes it feel like the content is "settling in" rather than mechanically resizing.

```jsx
<motion.div
  animate={{ height }}
  transition={{ delay: 0.04, duration: 0.25, ease: "easeOut" }}
  style={{ overflow: "hidden" }}
>
```

## Use Animated Bounds Sparingly [MEDIUM]

Animating container width/height is expensive — it triggers layout. Only use for elements where the animation meaningfully improves comprehension (accordions, expandable panels). Don't use it for every list item or card.
