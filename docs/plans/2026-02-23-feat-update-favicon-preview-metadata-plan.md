---
title: "feat: Update Favicon and Site Preview Metadata"
type: feat
date: 2026-02-23
---

# feat: Update Favicon and Site Preview Metadata

Update the site favicon to use the Glitchcraft logo SVG and refresh the Open Graph / browser preview description to "Growth engine for apps".

## Context

- Current favicon: `src/app/favicon.ico` (triangle icon, 25 KB ICO)
- Current description: `"AI-powered eCommerce analytics"`
- Desired favicon: `public/grlogo.svg` (existing Glitchcraft logo)
- Desired description: `"Growth engine for apps"`
- Title stays: `"Sentinel"`

The metadata export lives entirely in `src/app/layout.tsx` (server component). The layout.tsx → LayoutShell split means metadata stays in the server layer — no structural changes needed.

## Changes

### 1. `src/app/icon.svg` (new file)

Copy `public/grlogo.svg` to `src/app/icon.svg`.

Next.js App Router's [file-based metadata convention](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons) automatically picks up `app/icon.svg` and injects it as the favicon `<link>` for all modern browsers. No explicit metadata wiring needed.

> The existing `src/app/favicon.ico` can be removed — modern browsers will use `icon.svg`. Keeping both is harmless (ICO serves as legacy fallback), but removing reduces ambiguity.

### 2. `src/app/layout.tsx`

Update the `metadata` export (lines 19–22) to:

```ts
export const metadata: Metadata = {
  title: "Sentinel",
  description: "Growth engine for apps",
  openGraph: {
    title: "Sentinel",
    description: "Growth engine for apps",
    type: "website",
  },
};
```

The `openGraph` block makes the description appear correctly in Slack, iMessage, and social link previews (which read `og:description` rather than `<meta name="description">`).

## Acceptance Criteria

- [ ] Browser tab favicon shows the Glitchcraft logo (not the triangle)
- [ ] `<meta name="description">` reads `"Growth engine for apps"`
- [ ] `og:title` is `"Sentinel"` and `og:description` is `"Growth engine for apps"` in page source
- [ ] Slack / iMessage link preview shows the updated description
- [ ] No build errors (`pnpm build` passes)

## References

- Next.js App Router icon convention: `src/app/icon.svg` auto-detected
- Existing SVG asset: `public/grlogo.svg`
- Metadata export: `src/app/layout.tsx:19-22`
