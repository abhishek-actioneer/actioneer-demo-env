---
title: "UI and motion design skill coverage for Decks canvas feature"
problem_type: "knowledge-gap"
component: "decks-canvas"
symptoms:
  - "No dedicated motion design or loading animation skill exists in superpowers"
  - "No skeleton screen or canvas transition skill available"
  - "frontend-slides STYLE_PRESETS.md contains usable animation patterns but is not purpose-built for canvas/tldraw"
tags:
  - "motion-design"
  - "animation"
  - "tldraw"
  - "decks"
  - "canvas"
  - "skills-inventory"
  - "frontend-slides"
  - "compound-engineering"
  - "framer-motion"
related_files:
  - "/Users/sashank/.claude/skills/frontend-slides/STYLE_PRESETS.md"
  - "docs/design-reviews/2026-03-12-decks-canvas-design-review.md"
  - "docs/solutions/best-practices/three-zone-pointer-events-canvas-card-system-20260218.md"
  - "docs/solutions/design-patterns/tldraw-custom-shapes-canvas-rendering.md"
severity: "low"
status: "resolved"
date: "2026-03-12"
---

# UI & Motion Design: Skills Audit and Animation Workflow

Captured after a design review of the Decks canvas feature (PDF → AI-analyzed chart+analysis card pairs on tldraw). The investigation asked: *what skills exist for stellar UI and motion design?*

---

## Skill Mapping

### `compound-engineering:frontend-design` — Implementation
Use for implementing production-grade UI components and pages. Avoids generic AI aesthetics, generates polished code.
- **Invoke**: `skill: "compound-engineering:frontend-design"`
- **Best for**: Component architecture, visual hierarchy, spacing systems, overall page quality
- **NOT for**: Animation timing, easing curves, loading choreography — it has no motion reference

### `frontend-slides` STYLE_PRESETS.md — Animation Reference
Primarily an HTML presentation builder, but its `STYLE_PRESETS.md` is the richest motion/animation reference in the skill system.
- **Do NOT invoke the skill** — it will attempt to build a slideshow
- **Instead**: Read `STYLE_PRESETS.md` directly, specifically lines 890–1034
- **File**: `/Users/sashank/.claude/skills/frontend-slides/STYLE_PRESETS.md`
- **Best for**: Easing curves, reveal patterns, stagger choreography, background treatments, style presets

### `remotion-best-practices` — React video animations only
Niche. Not relevant for canvas/UI work.

### `rams` — Accessibility audits only
Not relevant for motion design.

---

## Animation Cheatsheet (from STYLE_PRESETS.md)

These patterns are directly portable to React/framer-motion/CSS work.

### Easing Curve (use this everywhere)
```css
--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
```

### Reveal Patterns
```css
/* Fade + Slide Up (entry animation — cards, panels) */
opacity: 0; transform: translateY(30px);
transition: opacity 0.6s var(--ease-out-expo), transform 0.6s var(--ease-out-expo);
/* Active: */ opacity: 1; transform: translateY(0);

/* Scale In (modal, popover) */
opacity: 0; transform: scale(0.9);
transition: opacity 0.6s, transform 0.6s var(--ease-out-expo);

/* Blur In (background content reveal) */
opacity: 0; filter: blur(10px);
transition: opacity 0.8s, filter 0.8s var(--ease-out-expo);
```

### Stagger Children
```css
.reveal:nth-child(1) { transition-delay: 0.1s; }
.reveal:nth-child(2) { transition-delay: 0.2s; }
.reveal:nth-child(3) { transition-delay: 0.3s; }
.reveal:nth-child(4) { transition-delay: 0.4s; }
```

### Background Treatments for Dark Data UIs
```css
/* Gradient Mesh */
background:
  radial-gradient(ellipse at 20% 80%, rgba(120, 0, 255, 0.3) 0%, transparent 50%),
  radial-gradient(ellipse at 80% 20%, rgba(0, 255, 200, 0.2) 0%, transparent 50%),
  var(--bg-primary);

/* Dot / Grid Pattern (canvas backgrounds) */
background-image:
  linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
  linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px);
background-size: 50px 50px;
```

### Style Presets for Dark Canvas UIs
| Preset | Vibe | Relevant for |
|--------|------|--------------|
| **Dark Botanical** | Elegant, sophisticated | Canvas cards, analysis panels |
| **Neon Cyber** | Futuristic, techy | Data-heavy charts, metrics |
| **Bold Signal** | Confident, high-impact | KPI callouts, hero stats |
| **Terminal Green** | Developer-focused | SQL output, debug panels |

---

## Recommended Workflow for Canvas/Decks Motion Work

1. Invoke `compound-engineering:frontend-design` for overall UI implementation quality
2. Reference `STYLE_PRESETS.md` lines 890–1034 for animation primitives
3. Use `--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1)` as the default easing curve
4. For card pop-in (loading state): Fade + Slide Up with staggered delay per card
5. For canvas background: Grid Pattern CSS from cheatsheet above
6. For dark card design: Dark Botanical or Neon Cyber preset as reference aesthetic

---

## framer-motion Notes (It Is Installed)

`framer-motion` is installed in this project. No need to check `package.json`.

```ts
import { motion, AnimatePresence, useReducedMotion } from "framer-motion"
```

**Critical rules:**

- `motion.*` components are client-only — file must have `"use client"` or be behind a client boundary
- framer-motion works inside tldraw's `HTMLContainer` (standard React DOM) — use it freely for card-layer animations
- framer-motion **cannot animate tldraw's canvas transforms** (pan/zoom). For viewport-level transitions use tldraw's camera API:
  ```ts
  editor.setCamera({ x, y, z }, { animation: { duration: 400, easing: ... } })
  ```
- Conditionally rendered elements (toolbar hide/reveal, panel slide-in) **must use `AnimatePresence`** — without it, exit animations are skipped
- Define `variants` objects at module scope, not inside the render function — tldraw shape components re-render frequently during canvas interaction
- Always check `useReducedMotion()` and skip/simplify animations when true

---

## Gap: What Does Not Exist

No dedicated skill covers:
- Skeleton screens and loading choreography
- Canvas entry/exit animations (cards appearing as deck processes)
- State transition design (empty → loading → populated → error)
- Micro-interaction patterns (hover lift, press feedback, focus rings)

For the Decks loading state (Issue #1 in design review), these must be hand-authored. The cheatsheet above provides the primitives; the choreography must be designed per feature.

**When to create a new skill:**
- A motion pattern recurs across 3+ features with tldraw-specific constraints
- Non-obvious framer-motion + tldraw integration (e.g., animating shapes in tldraw's world coordinate space)
- First time a shared `SkeletonCard` component is built — document it so subsequent implementors don't reinvent it

---

## Motion Design Checklist

Before shipping any animated UI in this codebase:

- [ ] framer-motion used (not GSAP, anime.js, or raw `@keyframes` for new work)
- [ ] All skeletons use the same shimmer implementation (define once, share)
- [ ] Stagger constants defined at module scope, not repeated inline
- [ ] Canvas entry zoom set in `onInit` / `editor.setCamera()`, not animated from bird's-eye
- [ ] tldraw selection state overridden via `indicator()` returning custom element or `null`, not CSS hacks
- [ ] Hover/click on chips uses `whileHover` + `whileTap`
- [ ] Conditional mounts use `AnimatePresence`
- [ ] `useReducedMotion()` respected — animations skipped or simplified when true
- [ ] No animation blocks pointer events during stagger sequence

---

## Cross-References

- **Design review that triggered this audit**: `docs/design-reviews/2026-03-12-decks-canvas-design-review.md`
- **tldraw shape pointer events model**: `docs/solutions/best-practices/three-zone-pointer-events-canvas-card-system-20260218.md`
- **tldraw custom shape integration**: `docs/solutions/design-patterns/tldraw-custom-shapes-canvas-rendering.md`
- **Canvas CSS variable pattern** (never Tailwind arbitrary with CSS vars): `docs/solutions/best-practices/canvas-dark-mode-centralized-theming-bypass-20260219.md`
- **Living deck brainstorm** (hub+satellite layout, horizontal scroll): `docs/brainstorms/2026-03-11-living-deck-brainstorm.md`
- **Chart visual parity plan**: `docs/plans/2026-03-11-refactor-chart-visual-parity-plan.md`
