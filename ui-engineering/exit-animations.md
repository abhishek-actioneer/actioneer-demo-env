# Exit Animations (AnimatePresence)

Patterns for animating elements as they leave the DOM. Framer Motion / Motion for React.

## AnimatePresence Wrapper Required [HIGH]

`exit` props only work when the component is wrapped in `AnimatePresence`. Without it, exit animations are silently ignored.

```jsx
// ❌ Exit animation silently ignored
function Tooltip({ show, children }) {
  return show ? <motion.div exit={{ opacity: 0 }}>{children}</motion.div> : null;
}

// ✅ Correct
function Tooltip({ show, children }) {
  return (
    <AnimatePresence>
      {show && <motion.div exit={{ opacity: 0 }}>{children}</motion.div>}
    </AnimatePresence>
  );
}
```

## Exit Prop Required [HIGH]

Every animated child inside `AnimatePresence` must have an `exit` prop. Without it, the component disappears instantly.

```jsx
// ❌ No exit — snaps out
<AnimatePresence>
  {show && (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      Content
    </motion.div>
  )}
</AnimatePresence>

// ✅ Correct
<AnimatePresence>
  {show && (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      Content
    </motion.div>
  )}
</AnimatePresence>
```

## Exit Mirrors Initial [MEDIUM]

Exit animation should mirror the initial animation for perceptual symmetry. Asymmetric enter/exit feels broken.

```jsx
// ❌ Asymmetric — enter slides up, exit fades
<motion.div
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
  exit={{ opacity: 0 }}
/>

// ✅ Symmetric
<motion.div
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
  exit={{ opacity: 0, y: 20 }}
/>
```

## Unique Keys in AnimatePresence Lists [HIGH]

Without unique `key` props, React can't distinguish which item exited, so exit animations don't fire.

```jsx
// ❌ No keys
<AnimatePresence>
  {items.map(item => (
    <motion.li exit={{ opacity: 0 }}>{item.name}</motion.li>
  ))}
</AnimatePresence>

// ✅ Unique keys
<AnimatePresence>
  {items.map(item => (
    <motion.li key={item.id} exit={{ opacity: 0 }}>{item.name}</motion.li>
  ))}
</AnimatePresence>
```

## Mode: popLayout for List Reordering [MEDIUM]

When an item exits from a list and remaining items should move into place, use `mode="popLayout"`. It removes the exiting element from layout immediately so siblings can animate into position.

```jsx
// ❌ Default mode — remaining items jump after exit completes
<AnimatePresence>
  {items.map(item => <motion.li key={item.id} exit={{ opacity: 0 }} />)}
</AnimatePresence>

// ✅ popLayout — siblings animate into place during exit
<AnimatePresence mode="popLayout">
  {items.map(item => <motion.li key={item.id} exit={{ opacity: 0 }} />)}
</AnimatePresence>
```

## Mode: "wait" Doubles Duration [MEDIUM]

`mode="wait"` makes AnimatePresence wait for the exit animation to complete before animating the new element in. The total transition duration becomes exit + enter. Use intentionally.

```jsx
// ⚠️ Total perceived duration = exitDuration + enterDuration
<AnimatePresence mode="wait">
  <motion.div key={page} exit={{ opacity: 0 }} animate={{ opacity: 1 }} />
</AnimatePresence>
```

## Mode: "sync" Layout Conflicts [MEDIUM]

`mode="sync"` runs enter and exit simultaneously. Can cause layout conflicts if both elements occupy the same space. Default mode is usually better.

## Disable Interactions on Exiting Elements [MEDIUM]

Exiting elements may still be interactive during their animation. Disable pointer events to prevent clicks on disappearing UI.

```jsx
<motion.div
  exit={{ opacity: 0, pointerEvents: "none" }}
>
  Content
</motion.div>
```

Or via CSS:
```css
/* Target the exiting element */
[data-state="closed"] {
  pointer-events: none;
}
```

## Nested AnimatePresence — propagate Required [HIGH]

In nested AnimatePresence trees, the inner `AnimatePresence` needs `propagate` so it knows when the parent is exiting.

```jsx
// ❌ Inner AnimatePresence unaware of parent exit
<AnimatePresence>
  {show && (
    <motion.div exit={{ opacity: 0 }}>
      <AnimatePresence>
        {showChild && <motion.span key="child" exit={{ x: -10 }} />}
      </AnimatePresence>
    </motion.div>
  )}
</AnimatePresence>

// ✅ propagate connects inner to outer
<AnimatePresence>
  {show && (
    <motion.div exit={{ opacity: 0 }}>
      <AnimatePresence propagate>
        {showChild && <motion.span key="child" exit={{ x: -10 }} />}
      </AnimatePresence>
    </motion.div>
  )}
</AnimatePresence>
```

## Coordinated Parent-Child Exit Timing [MEDIUM]

When parent and child both animate on exit, coordinate timing so they feel intentional.

```jsx
// ✅ Child exits first, then parent fades
<motion.div exit={{ opacity: 0, transition: { delay: 0.15 } }}>
  <motion.span exit={{ x: -10, transition: { duration: 0.15 } }} />
</motion.div>
```

## Async Exit with useIsPresent / safeToRemove [HIGH]

For exits that need to perform async work (e.g., save data before unmounting), use `useIsPresent` and `safeToRemove`. Call `safeToRemove()` when async work completes.

```jsx
import { useIsPresent } from "framer-motion";

function AsyncItem() {
  const isPresent = useIsPresent();
  const safeToRemove = useIsPresent(); // from usePresence hook

  useEffect(() => {
    if (!isPresent) {
      // Do async cleanup
      saveData().then(() => safeToRemove());
    }
  }, [isPresent]);

  return <motion.div animate={isPresent ? "visible" : "exit"} />;
}
```

```jsx
// Full pattern
import { usePresence } from "framer-motion";

function Item() {
  const [isPresent, safeToRemove] = usePresence();

  useEffect(() => {
    if (!isPresent) {
      // Animate manually or do async work
      setTimeout(safeToRemove, 300);
    }
  }, [isPresent]);

  return <div style={{ opacity: isPresent ? 1 : 0 }} />;
}
```
