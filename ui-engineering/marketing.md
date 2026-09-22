# Marketing Pages

Guidelines for landing pages, blogs, docs, and changelogs.

## Animations

### No Scroll Animations [HIGH]

Don't add scroll-triggered animations: fade-ups, fade-ins, translate-Y on scroll. They feel disconnected from user movement and slow content discovery.

### No Disconnected Motion [HIGH]

Avoid:
- Scroll hijacking
- Parallax that doesn't map 1:1 to scroll
- Auto-advancing carousels

These feel disrespectful of user intent.

### Intro Animations — Skip if Seen [MEDIUM]

Disable intro animations if they've already played in the current session. Use `sessionStorage` (not `localStorage`) so they replay in new sessions:

```jsx
useEffect(() => {
  const hasSeenIntro = sessionStorage.getItem('hasSeenIntro');
  if (hasSeenIntro) {
    setSkipIntro(true);
  } else {
    sessionStorage.setItem('hasSeenIntro', 'true');
  }
}, []);
```

## Performance

### Font Preloading [HIGH]

Preload fonts to prevent layout shift and FOUT:

```html
<link
  rel="preload"
  href="/fonts/inter.woff2"
  as="font"
  type="font/woff2"
  crossorigin
/>
```

### Image Preloading [MEDIUM]

Preload above-the-fold hero images:

```html
<link rel="preload" as="image" href="/hero-image.webp" />
```

### Static Generation [HIGH]

Blog posts, changelog entries, and docs must be generated at build time with revalidation. Never fetch at request time:

```jsx
// Next.js App Router
export async function generateStaticParams() {
  const posts = await getPosts();
  return posts.map(post => ({ slug: post.slug }));
}

export const revalidate = 3600; // Hourly revalidation
```

## Header Navigation [MEDIUM]

Submenu content must exist in the DOM even when hidden — not dynamically loaded on hover. This ensures accessibility and SEO indexing:

```html
<nav>
  <button aria-expanded="false">Products</button>
  <!-- ✅ Always in DOM, visibility toggled via CSS -->
  <div class="submenu" aria-hidden="true">
    Full submenu content here
  </div>
</nav>
```

## CTAs — Auth-Aware [MEDIUM]

Show different calls-to-action based on authentication state:

```jsx
<Button href={isLoggedIn ? '/dashboard' : '/signup'}>
  {isLoggedIn ? 'Go to Dashboard' : 'Get Started'}
</Button>
```

| State | CTA |
|-------|-----|
| Logged out | "Get Started" / "Sign Up" |
| Logged in | "Go to Dashboard" / "Open App" |

## Documentation Sites

### Copy Button on Code Snippets [MEDIUM]

All code blocks must have a copy-to-clipboard button:

```jsx
<CodeBlock code={snippet} copyButton />
```

### Visual Examples [MEDIUM]

Docs pages need visual examples alongside code. Code alone is insufficient — show what it produces.

### Markdown Export [LOW]

Support copying docs pages as markdown:
- "Copy as Markdown" button
- `.md` URL suffix returns raw markdown (e.g., `/docs/guide.md`)

## Blog & Changelog

### RSS Feed [LOW]

Provide RSS feeds:
```
/blog/rss.xml
/changelog/rss.xml
```

### Text Wrapping [MEDIUM]

```css
article h1, article h2, article h3 {
  text-wrap: balance;
}
```

## Illustrations [LOW]

Code-based illustrations must have:
- `role="img"` and `aria-label`
- `pointer-events: none` (decorative)
- `user-select: none` (no accidental text selection)

```jsx
<div
  role="img"
  aria-label="Illustration showing data flow between services"
  style={{ pointerEvents: 'none', userSelect: 'none' }}
/>
```
