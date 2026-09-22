---
name: business-deck
description: Build Actioneer-branded editable business, consulting, strategy, proposal, and operating-review decks with native PPTX as the canonical artifact and Google Slides as the optional imported version. Use when the user asks for PPTX, PowerPoint, Google Slides, BCG/EY-style Actioneer slides, reusable business-user-friendly slides, board decks, transformation proposals, strategy decks, or slide artifacts that must remain editable.
---

# Business Deck Skill

## Output Contract

The final business deck is a native editable `.pptx`.

Google Slides is produced only when requested, by importing the `.pptx` as native Google Slides. PDF is a read-only export for sharing, not the canonical artifact.

Actioneer brand is enforced by default. New decks should look aligned with the `Actioneer-BCG` and `Actioneer-EY` editable decks: warm-neutral, sharp, sparse-color, consulting-grade, and built from native objects.

Do not treat HTML or PDF as the final source of truth for business decks. HTML can be used for animated previews or product mockups, but the production deck must be constructed from native slide objects wherever practical.

## Quick Start

1. Read [references/principles.md](references/principles.md).
2. Read [references/tufte-analytical-slides.md](references/tufte-analytical-slides.md) when the deck includes business metrics, evidence charts, operating reviews, benchmarks, or strategy claims.
3. Read [references/workflow.md](references/workflow.md).
4. Read [references/layout-library.md](references/layout-library.md) and map each slide to one of the canonical archetypes before authoring.
5. In Codex, use the native Presentations plugin as the first-choice authoring path for new PPTX decks.
6. Read `../design-system/SKILL.md` and `../pitch-skill/rules/brand.md`; Actioneer brand is the default visual system.
7. If adapting an existing Actioneer pitch deck, use this skill as the editable-output layer after the pitch structure is approved.

## Decision Defaults

- Canonical artifact: `.pptx`.
- Shareable collaborative artifact: imported native Google Slides, opt-in only.
- Read-only leave-behind: PDF exported from the native deck.
- Authoring path: Codex-native Presentations plugin first; Python builders only as fallback, migration aids, or deterministic examples.
- Brand default: Actioneer BCG/EY editable-deck style family.
- Slide basis: consulting-style claim plus proof object, not decorative page layout.
- Editability model: hybrid slides are allowed, but titles, tables, metrics, core labels, and business-critical text must stay native-editable.
- Raster priority: screenshots, product UI, photos, complex animation stills, intricate infographics, and highly rendered illustrations may be images.
- Font priority for Google Slides: use Google-safe fonts when editability matters more than exact local brand typography. Prefer `Roboto` / `Roboto Mono` as practical substitutes for Switzer / Chivo Mono unless the user explicitly wants brand-font fidelity.

## Required Questions

Ask only for decisions that cannot be resolved from repo context or the user's source material:

1. Audience and use: board, executive review, sales proposal, workshop, investor, operating review, or internal planning?
2. Editability level: fully editable native objects, hybrid with rasterized exhibits, or pixel-perfect read-only?
3. Destination: local PPTX only, or local PPTX plus Google Slides import?
4. Source material: existing deck/PDF, notes, data workbook, HTML pitch deck, or blank brief?

## Native Object Rules

- Every slide gets a full-sentence claim title unless the slide is a cover, agenda, divider, or appendix inventory.
- Every content slide has one dominant proof object: chart, table, matrix, roadmap, flow, option space, diagnostic, credential grid, or quantified case.
- Avoid generic card grids when a table, matrix, value chain, decision tree, or timeline would express the reasoning better.
- Keep titles, tables, metrics, core labels, and business-critical text as editable native objects. Do not bake them into screenshots.
- Use native PowerPoint connectors and shapes for arrows, roadmaps, operating models, swimlanes, and process diagrams.
- Flatten only what cannot be usefully edited by a business user, or what would be materially worse as native objects.

## Relationship To Other Skills

- `pitch-skill`: owns Actioneer sales narrative, vertical content, and client-specific proposal structure.
- `business-deck`: owns editable PPTX / Google Slides production, consulting slide grammar, and business-user reuse.
- `design-system`: owns brand tokens, assets, typography, and visual identity.

When generating an Actioneer pitch deck that needs PPTX or Google Slides, first use `pitch-skill` to resolve narrative and page structure, then use `business-deck` to build the native editable deck.

## Existing Local References

- `generated/build_bcg_editable.py`: proof that native editable PPTX can mirror an Actioneer BCG-style deck.
- `generated/build_ey_editable.py`: second editable PPTX example with the same helper pattern.
- `/Users/sashank/Downloads/20180220 EFL 2.0 Transformation_Proposal for support_To present.pdf`: reference for dense consulting-deck grammar and claim/proof structure.

Do not copy those one-off scripts blindly. Use them to understand the target native-object behavior, then build with the Codex-native Presentations workflow unless there is a concrete reason to use Python.
