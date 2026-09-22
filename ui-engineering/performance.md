# Performance

## Animation Performance

Only animate `transform` and `opacity` — they run on the GPU and skip layout/paint:

```css
/* ✅ GPU layer */
.element { transition: transform 200ms ease-out, opacity 200ms ease-out; }

/* ❌ Triggers layout */
.element { transition: height 200ms, margin 200ms; }
```

See [animations.md](animations.md) for full animation performance details.

## Lists & Virtualization [HIGH]

Don't render hundreds of DOM nodes when only a few are visible. Virtualize large lists:

```jsx
import { useVirtualizer } from '@tanstack/react-virtual';

function VirtualList({ items }) {
  const parentRef = useRef(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 50,
  });

  return (
    <div ref={parentRef} style={{ height: '400px', overflow: 'auto' }}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map(virtualItem => (
          <div
            key={virtualItem.key}
            style={{
              position: 'absolute',
              top: virtualItem.start,
              height: virtualItem.size,
              width: '100%',
            }}
          >
            {items[virtualItem.index]}
          </div>
        ))}
      </div>
    </div>
  );
}
```

## No `transition: all` [HIGH]

Never use `transition: all` — it accidentally animates properties you didn't intend and creates performance issues:

```css
/* ❌ Transitions everything including layout properties */
.button { transition: all 200ms ease; }

/* ✅ Specify exact properties */
.button { transition: background-color 200ms ease, transform 150ms ease; }
```

## Theme Switching Without Transitions [HIGH]

Theme changes must not trigger existing element transitions. Use a double `requestAnimationFrame` to re-enable after paint:

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

## React Render Performance

### Animate Outside React [MEDIUM]

Don't drive animations via React state — every `setState` triggers a render cycle:

```jsx
// ❌ Re-renders on every animation frame
const [position, setPosition] = useState(0);

// ✅ Direct DOM manipulation via ref
const elementRef = useRef(null);
useEffect(() => {
  let frame;
  function animate() {
    elementRef.current.style.transform = `translateX(${getPosition()}px)`;
    frame = requestAnimationFrame(animate);
  }
  frame = requestAnimationFrame(animate);
  return () => cancelAnimationFrame(frame);
}, []);
```

### Dynamic Imports [MEDIUM]

Lazy-load heavy components:

```tsx
import dynamic from 'next/dynamic';

const HeavyChart = dynamic(
  () => import('./heavy-chart').then(m => m.HeavyChart),
  { ssr: false, loading: () => <ChartSkeleton /> }
);
```

## CSS Performance

### CSS Variable Animation Cost [MEDIUM]

Avoid animating CSS variables in deep component trees — each change triggers style recalculation for all descendants.

### Blur Filter Limit [MEDIUM]

`blur()` filters above 20px are expensive, especially in Safari. Keep values subtle:

```css
/* ⚠️ Very expensive above 20px */
backdrop-filter: blur(8px); /* ✅ Fine */
backdrop-filter: blur(40px); /* ❌ Expensive */
```

## Preloading

### Critical Images [MEDIUM]

Preload above-the-fold images to prevent layout shift:

```html
<link rel="preload" as="image" href="/hero.webp" />
```

### Fonts [HIGH]

Preload fonts to prevent FOUT (Flash of Unstyled Text):

```html
<link
  rel="preload"
  href="/fonts/inter.woff2"
  as="font"
  type="font/woff2"
  crossorigin
/>
```

Or via React:

```jsx
import { preload } from 'react-dom';
preload('/fonts/inter-var.woff2', { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
```

## Off-Screen Resource Management [MEDIUM]

Pause or stop resource-intensive operations when off-screen:

```js
const observer = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (entry.isIntersecting) {
      startAnimation();
    } else {
      pauseAnimation();
    }
  }
});

observer.observe(element);
```

## Static Generation [MEDIUM]

Generate blog posts, changelog entries, docs, and other frequently-read but infrequently-changing content at build time. Don't fetch at request time:

```jsx
// Next.js App Router
export async function generateStaticParams() {
  const posts = await getPosts();
  return posts.map(post => ({ slug: post.slug }));
}

export const revalidate = 3600; // Revalidate hourly
```

## Layout Shift Prevention [HIGH]

- Use hardcoded dimensions for images and videos
- Reserve space for async content with skeletons
- `font-variant-numeric: tabular-nums` for changing numbers
- Never change font weight on hover
- Preload fonts to prevent FOUT
