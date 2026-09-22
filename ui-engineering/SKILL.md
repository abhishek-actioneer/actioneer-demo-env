---
name: ui-engineering
description: Use when building UI components, reviewing frontend code, implementing animations, forms, accessibility, typography, touch interactions, or marketing pages. Covers animations, exit animations, container animation, forms, touch/a11y, component design, laws of UX, prefetching, CSS pseudo-elements, audio feedback, morphing icons, typography, visual design, and performance.
---

# UI Engineering

Superset of Emil Kowalski's design engineering practices and the User Interface Wiki (raphaelsalaja/userinterface-wiki). 152+ rules across 16 categories.

## Quick Reference

| Priority | Category | File | Impact |
|----------|----------|------|--------|
| 1 | [Animations](animations.md) | animations.md | CRITICAL |
| 2 | [Exit Animations](exit-animations.md) | exit-animations.md | HIGH |
| 3 | [Container Animation](container-animation.md) | container-animation.md | MEDIUM |
| 4 | [Laws of UX](laws-of-ux.md) | laws-of-ux.md | HIGH |
| 5 | [Forms & Controls](forms-controls.md) | forms-controls.md | HIGH |
| 6 | [Touch & Accessibility](touch-accessibility.md) | touch-accessibility.md | HIGH |
| 7 | [Typography](typography.md) | typography.md | MEDIUM |
| 8 | [UI Polish & Visual Design](ui-polish.md) | ui-polish.md | HIGH |
| 9 | [CSS Pseudo-Elements](css-pseudo.md) | css-pseudo.md | MEDIUM |
| 10 | [Component Design](component-design.md) | component-design.md | MEDIUM |
| 11 | [Performance](performance.md) | performance.md | HIGH |
| 12 | [Predictive Prefetching](prefetching.md) | prefetching.md | MEDIUM |
| 13 | [Morphing Icons](morphing-icons.md) | morphing-icons.md | LOW |
| 14 | [Audio Feedback](audio-feedback.md) | audio-feedback.md | MEDIUM |
| 15 | [Marketing Pages](marketing.md) | marketing.md | MEDIUM |

## Core Principles

1. **No layout shift** — hardcoded dimensions, tabular nums, no font-weight changes on hover
2. **Touch-first, hover-enhanced** — `@media (hover: hover)`, 44px tap targets, never rely on hover for functionality
3. **Keyboard navigation** — tab only visible elements, `scrollIntoView()`, focus management on open/close
4. **Accessibility by default** — every animation needs `prefers-reduced-motion`, every icon button needs aria-label
5. **Speed over delight** — product UI: fast and purposeful; marketing: more elaborate is allowed
6. **Only animate `transform` and `opacity`** — never height/width/padding/margin

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| `transition: all` | Specify exact properties |
| Hover effects on touch | `@media (hover: hover) and (pointer: fine)` |
| Font weight change on hover | Use consistent weight, change color instead |
| Animating `height`/`width` | Use `transform` and `opacity` only |
| No reduced motion support | Add `prefers-reduced-motion` query |
| `z-index: 9999` | Use fixed scale or `isolation: isolate` |
| Custom page scrollbars | Only customize in small contained elements |
| `ease-in` for entrances | Use `ease-out` — fast start feels responsive |
| Missing `exit` prop in AnimatePresence | Exit prop required on every animated child |
| Decorative sound | Sound must be informative, never decorative |

## Review Checklist

- [ ] Animations under 300ms for user-initiated actions
- [ ] `ease-out` for entrances, `ease-in` for exits
- [ ] `prefers-reduced-motion` on every animation
- [ ] Touch targets 44px minimum
- [ ] Hover effects gated with `@media (hover: hover)`
- [ ] No layout shift on dynamic content
- [ ] Keyboard navigation works and scrolls into view
- [ ] Icon buttons have `aria-label`
- [ ] Forms submit on Enter / Cmd+Enter
- [ ] Inputs 16px+ font size (iOS zoom prevention)
- [ ] No `transition: all`
- [ ] z-index uses fixed scale
- [ ] `exit` prop on AnimatePresence children
- [ ] Unique keys in AnimatePresence lists
- [ ] Hit areas ≥ 44px (expand with pseudo-elements if needed)
