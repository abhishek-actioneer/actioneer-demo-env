# Design Review: Decks / Living Deck Canvas
**Date:** 2026-03-12
**Reviewer:** Principal Designer (Pentagram perspective)
**Recording:** Screen Recording 2026-03-12 at 11.06.40 AM.mov (126s)
**Feature:** PDF upload → AI-analyzed canvas of chart + analysis card pairs

---

## The Concept

The "living deck" idea — upload a business review, get a spatial canvas of auto-analyzed charts paired with AI interpretation — is genuinely compelling. The tragedy is that the design doesn't yet honor the ambition of the concept. Every moment that should feel like magic instead feels like scaffolding someone forgot to remove.

---

## Issue 1: Loading State Is the First Impression. It's Nearly Nothing.

**Severity: Critical**

The first 30–40 seconds is a full-screen black void with a single spinner row: *"Extracting slides from PDF..."* then *"Processing slide 5: sql..."*

This is the product's most cinematic moment — a PDF is being dissolved and reborn as live data — and it's communicated with a loading text nobody reads.

**Problems:**
- No progress sense. "Processing slide 5" means nothing if you don't know there are 8 slides. Show `5 of 8`.
- No skeleton / anticipation. The canvas below should begin forming. Ghost cards, empty card outlines, even just the structural grid — anything that lets the user feel the shape of what's coming.
- The "Uploading..." button persists visibly in the top right during processing — confusing.
- The vast empty black canvas is oppressive. A subtle dot grid or texture would signal "this is a spatial canvas, not a loading error."

**Fix:** Treat the loading sequence as an onboarding animation. Cards appear one by one as slides are processed. Each one pops in. The user watches their deck come alive.

---

## Issue 2: The Topbar Has No Hierarchy

**Severity: High**

`← Decks   Weekly Business Review Nov 1–7, 2019   analyzed just now   ↻ Re-analyze   Challenge deck •`

Every element is the same weight, same size, same treatment.

**Problems:**
- The title ("Weekly Business Review Nov 1–7, 2019") is the most important thing on this page — it anchors the whole canvas — but reads identically to "analyzed just now."
- The trailing `•` on "Challenge deck" reads like a notification dot, but is decorative. Looks like a typography error.
- "analyzed just now" is a timestamp masquerading as metadata. Needs lighter weight and smaller size.
- "Re-analyze" with a refresh icon needs a hover tooltip explaining what it does — does it re-run against new data? Or re-process the same PDF?

**Fix:** Title (primary) → Status (secondary, smaller, muted) → Actions (right-aligned). Currently reads as a flat list.

---

## Issue 3: Default Canvas Zoom Is Unreadable

**Severity: High**

At full-overview zoom (~80%), every card is a thumbnail. No text is legible. The green charts look like noise. This is a fundamental product design question: **what is the entry view?**

**Problems:**
- Nothing at this scale is actionable.
- No minimap for spatial orientation.
- Cards are not designed to communicate at thumbnail scale — title and key number aren't readable at 80%.

**Fix options:**
- Start zoomed to slide 1. Navigate with left/right arrows. Canvas is for spatial navigation, not the default reading mode.
- Design cards to communicate at thumbnail scale (title + one key number readable even at 80%).
- Add a minimap in the bottom corner showing all slides and current viewport.

---

## Issue 4: The tldraw Toolbar Is Product Contamination

**Severity: High**

The full tldraw toolbar sits at the bottom: pointer, hand, pen, eraser, line, text, sticky note, embed, frame, collapse.

This communicates: *"this is built on an open source canvas library"* rather than *"this is a thoughtfully designed experience."*

**Problems:**
- Drawing tools (pen, eraser) feel out of place in a data deck viewer.
- No visual language connection to the card design system.
- Floats as a foreign element with its own aesthetic.

**Fix:**
- Hide or collapse the toolbar by default. Reveal only when user signals annotation intent (right-click, or "Annotate" button in topbar).
- Curate the tool set — remove `embed` and `frame` if not relevant.
- If visible, restyle to match the product's visual language.

---

## Issue 5: Card Design Has Unresolved Details

**Severity: Medium**

The chart + analysis card pairing is the right idea. Specifics:

### Charts
- The green accent is saturated enough to pull focus — good. But when multiple cards are visible at overview scale, all charts scream equally. No visual hierarchy — the most important slide doesn't get more visual weight.
- X-axis labels (dates, brand names) are illegible even at 120% zoom. Need to be hidden at smaller card sizes OR cards need to be larger.
- The stat row at the bottom (`Highest: 9.7M · Lowest: 6.2M · Average: 7.5M`) has no weight differentiation. Labels and values look the same.

### Analysis Cards
- Wall of text. No visual hierarchy within the analysis. The AI is generating insights — design should surface the single most important sentence first (pull quote / bold lede).
- **"• INFO"** before "Follow-ups" is unexplained. Looks like debug output. What does INFO mean here?
- **Follow-up questions** are buried at the bottom of a dense paragraph. These should be the most interactive element — design them as chips or clickable prompts, not prose.
- **"AI" badge** on analysis card is stylistically correct (subtle, small) but contrast is weak. Disappears against card background.

---

## Issue 6: The Selection State Clashes

**Severity: Medium**

When a card is selected, tldraw applies its default electric blue selection border. This clashes with the green chart accent and dark backgrounds.

**Fix:** Replace with a white or near-white glow/border that matches the product's visual language.

---

## Issue 7: The Core Product Question Is Unresolved in the UI

**Severity: Medium / Strategic**

When you upload a deck and get a canvas, **what happened to the original deck?** The canvas feels like a replacement, not an augmentation. The original deck had layout, narrative flow, a story the author intended. The current canvas discards all of that in favor of a uniform grid of card pairs.

**The design doesn't answer:**
- Is this replacing the deck for the *creator* or giving the *reader* a richer way to explore?
- Does slide order matter? Can you return to the original PDF view?
- What does "Challenge deck" mean? Interrogating the data? Running a counter-analysis?

This needs to be answered in the design before other polish work, as it shapes the navigation model fundamentally.

---

## Priority Fixes (Ordered by Impact)

| # | Issue | Impact |
|---|-------|--------|
| 1 | Loading state → skeleton cards, progress count, canvas pre-forms | First impression |
| 2 | Entry zoom level → start readable, add minimap | Core usability |
| 3 | Topbar hierarchy → title gets weight, actions right-aligned | Orientation |
| 4 | Follow-up questions → interactive chips, not buried prose | Engagement |
| 5 | Toolbar → hide by default, reveal on annotation intent | Polish |
| 6 | Selection state → replace tldraw blue with product-native | Coherence |
| 7 | Analysis text → lede sentence gets visual prominence | Readability |

---

## What's Working

- Dark theme is appropriate for data density work
- The chart + analysis pairing concept is smart — creates a clear relationship between data and interpretation
- The green accent on charts creates a strong focal point
- The canvas metaphor gives the right spatial freedom
- The topbar breadcrumb ("← Decks") is clear
- "analyzed just now" timestamp is a nice touch — needs better visual treatment but right instinct
