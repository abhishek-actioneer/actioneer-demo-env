# Predictive Prefetching

Prefetching reduces perceived navigation latency by loading resources before the user explicitly requests them.

## Trajectory Prediction Over Hover [HIGH]

Don't just prefetch on hover — predict where the cursor is heading based on velocity and direction. This triggers earlier and more accurately.

Libraries like `@jamiebuilds/tinykeys` or custom pointer tracking can implement this. The key insight: if a cursor is moving toward a link at speed, it will likely click it.

```js
// Simplified trajectory approach
let lastX = 0, lastY = 0;

document.addEventListener('mousemove', e => {
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  const speed = Math.sqrt(dx * dx + dy * dy);

  // If moving fast toward a target, prefetch it
  if (speed > 5) {
    const target = document.elementFromPoint(
      e.clientX + dx * 3,  // project forward
      e.clientY + dy * 3
    );
    if (target?.dataset.prefetch) prefetch(target.dataset.prefetch);
  }

  lastX = e.clientX;
  lastY = e.clientY;
});
```

## Prefetch by Intent, Not Viewport [HIGH]

Don't prefetch everything in the viewport. Only prefetch elements the user is likely to interact with:

```jsx
// ❌ Prefetches everything visible — wastes bandwidth
{links.map(link => <Link prefetch={true} href={link.href} />)}

// ✅ Prefetch on hover intent
<Link prefetch="intent" href={href}>
```

## Use hitSlop to Trigger Earlier [MEDIUM]

Expand the hover detection area beyond the visual element to trigger prefetching earlier:

```jsx
function PrefetchLink({ href, children }) {
  const prefetchArea = {
    top: -20,
    right: -20,
    bottom: -20,
    left: -20,
  };

  return (
    <div
      onMouseEnter={() => prefetch(href)}
      style={{ margin: `${prefetchArea.top}px ${prefetchArea.right}px` }}
    >
      <a href={href}>{children}</a>
    </div>
  );
}
```

## Prefetch on Keyboard Navigation [MEDIUM]

When a user tabs to a link, they're likely to follow it. Prefetch on focus:

```jsx
<a
  href={href}
  onFocus={() => prefetch(href)}
>
  {children}
</a>
```

## Fall Back Gracefully on Touch [MEDIUM]

Touch devices have no hover/trajectory events. Fall back to prefetching on `touchstart`:

```jsx
function SmartLink({ href, children }) {
  const isTouchDevice = 'ontouchstart' in window;

  return (
    <a
      href={href}
      onMouseEnter={!isTouchDevice ? () => prefetch(href) : undefined}
      onTouchStart={isTouchDevice ? () => prefetch(href) : undefined}
    >
      {children}
    </a>
  );
}
```

## Use Selectively [MEDIUM]

Prefetching consumes bandwidth. Only apply to:
- Primary navigation links
- High-probability next steps in a flow
- Links the user has hovered or focused

Don't apply to:
- Every link on the page
- External links
- Low-priority or infrequently visited pages
- Users on slow connections (check `navigator.connection`)

```js
function shouldPrefetch(): boolean {
  const connection = (navigator as any).connection;
  if (!connection) return true;
  // Skip on slow connections or data saver mode
  return connection.effectiveType !== '2g' && !connection.saveData;
}
```
