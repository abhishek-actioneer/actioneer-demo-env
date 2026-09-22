# Actioneer Business Deck Layout Library

## References

Use these as the primary local references:

- `generated/Actioneer-BCG.pptx`, `generated/Actioneer-BCG.html`, and `generated/build_bcg_editable.py`: primary Actioneer BCG/EY visual style reference for native PPTX behavior.
- `generated/Actioneer-EY.pptx`, `generated/Actioneer-EY.html`, and `generated/build_ey_editable.py`: second Actioneer editable-deck reference.
- `/Users/sashank/Downloads/20180220 EFL 2.0 Transformation_Proposal for support_To present.pdf`: consulting-deck structure reference. Use it for archetype grammar, not brand styling.

Do not clone the EFL green theme. Borrow its structure: claim titles, agenda logic, diagnostic exhibits, performance charts, roadmap pages, choice maps, and summary matrices.

## Shared Canvas

Default canvas:

- Size: `297mm x 180mm` landscape.
- Margin: `16mm` left/right, `11-16mm` top, `12-16mm` bottom depending on footer.
- Background: white.
- Footer: mono uppercase confidentiality/source text left, page number right.
- Brandmark: small Actioneer mark top-right on content slides unless the slide has a deliberate cover/section layout.
- Typography: display/body in Switzer or Google-safe `Roboto`; labels in Chivo Mono or `Roboto Mono`.
- Corners: sharp.
- Stroke: light hairline `#DBDBDB`.

## Archetype 1: Cover Lockup

Use when opening a proposal, strategy deck, operating review, or client-specific presentation.

References:

- Actioneer-BCG slide 1.
- Actioneer-EY slide 1.
- EFL page 1 for minimal title/date/client framing, but not for visual style.

Structure:

- Center-left Actioneer wordmark.
- Partner/client logo or deck subject beside it.
- Three-field metadata row: prepared for, prepared by, date.
- Minimal or no subtitle.
- Footer present if confidentiality matters.

Native requirements:

- Logos as separate image objects.
- Metadata as editable text.
- Date editable.

## Archetype 2: Team / Credentials

Use when establishing credibility, advisors, operator experience, or investor/backer proof.

References:

- Actioneer-BCG slide 2.
- Actioneer-EY slide 2.
- EFL page 2 for dense team roster grammar.

Structure:

- Claim/title at top: e.g. "Technology meets commercial pragmatism."
- Logo wall or credential rows.
- Founder/advisor cards with headshot, role, short proof bullets, and contact details if needed.
- Avoid decorative cards; use quiet rectangles, hairlines, and simple image/text layout.

Native requirements:

- Names, roles, bios, and contact rows editable.
- Logos/headshots separate image objects.
- Credential labels native mono text.

## Archetype 3: Objectives / Agenda

Use when setting a meeting flow, workshop agenda, or executive discussion structure.

References:

- EFL pages 3-4.
- Actioneer BCG/EY footers and typography for styling.

Structure:

- Claim/title at top.
- For objectives: 3-5 bullet outcomes.
- For agenda: timed rows or chapter rows, one row per discussion block.
- Use simple row bands and a single active/dark row only if needed.

Native requirements:

- Times, row labels, and bullets editable.
- No full-slide agenda screenshots.

## Archetype 4: Diagnostic Logic

Use when explaining how the team moved from symptoms to root causes, or when reframing the problem.

References:

- EFL page 7 iceberg / diagnostic progression.
- Actioneer-BCG / EY case-study and architecture pages for native object treatment.

Structure:

- Claim title.
- Left proof metaphor or diagnostic frame.
- Right numbered steps or layers: metrics, root causes, execution gaps, culture/enablers.
- Use 3-5 steps. Keep each step short.

Native requirements:

- Step labels, numbers, and explanation text editable.
- Icons or metaphors may be rasterized if complex.

## Archetype 5: Performance Exhibit

Use when showing business performance, benchmark gaps, trend changes, or economic upside.

References:

- EFL page 9 for chart-panel grammar.
- Actioneer-BCG case-study metric tables for brand styling.

Structure:

- Claim title with the conclusion.
- 2-3 small charts or one main chart plus metric callouts.
- Explicit deltas above or beside charts.
- Benchmark notes below chart.
- Source line at bottom.

Native requirements:

- Metrics, deltas, axis labels, benchmark labels, and source notes editable.
- Charts should be native when values may be updated.
- If a chart is rasterized for polish, overlay editable metric callouts and labels.

## Archetype 6: Context Map

Use when explaining market forces, stakeholder pressures, competitor shifts, or operating context.

References:

- EFL page 10 for center-context plus surrounding forces.
- Actioneer brand rules for color restraint.

Structure:

- Claim title.
- Center object: client, market, product, platform, or transformation theme.
- 3-4 surrounding forces with short bullets.
- Optional overlap/Venn treatment when forces interact.

Native requirements:

- Force labels and bullets editable.
- Center label editable.
- Icons may be rasterized or native, but must not dominate the reasoning.

## Archetype 7: Building Blocks / Pillars

Use when summarizing strategic pillars, transformation themes, or workstreams.

References:

- EFL page 11.
- Actioneer-BCG/EY "Built for Enterprise" and architecture pages.

Structure:

- Claim title.
- 3-5 pillars across the slide.
- Each pillar has a short noun-phrase label and one proof line or implication.
- Icons are optional and restrained.

Native requirements:

- Pillar labels and proof lines editable.
- Avoid four-line paragraphs under icons.

## Archetype 8: Transformation Roadmap

Use when showing workstreams, phases, enablers, sequencing, or program architecture.

References:

- EFL page 12.
- Actioneer-BCG architecture slide.

Structure:

- Claim title.
- Top aspiration or strategic direction band.
- Middle workstream bands across phases.
- Bottom enabler row: analytics, leadership alignment, capability, change management, etc.
- Keep row labels tight and editable.

Native requirements:

- Every workstream, phase, enabler, and milestone label editable.
- Use native bands, lines, and connectors.
- Do not rasterize the roadmap as one image.

## Archetype 9: Strategic Choices / Option Space

Use when framing operating choices, tradeoffs, or strategic decision ranges.

References:

- EFL page 21.
- Actioneer BCG/EY typography and line treatment.

Structure:

- Claim title.
- 4-7 choice rows.
- Each row has two endpoint options and, optionally, a current/recommended marker.
- Use a quiet horizontal scale, not a decorative slider UI.

Native requirements:

- Choice labels, endpoint labels, and markers editable.
- Marker positions should be movable native shapes.

## Archetype 10: Case Study

Use when proving value through a client/problem/how/results story.

References:

- Actioneer-BCG slides 7-8.
- Actioneer-EY case slide.

Structure:

- Claim title.
- Client/context box.
- Problem box.
- Metrics table with before / after / delta.
- How box.
- Quiet confidentiality/source note.

Native requirements:

- Client, problem, metrics, before/after/delta, and how text editable.
- Metrics must be native text/table cells.
- Do not use fake placeholders when real numbers are absent; state directionality or ask for inputs.

## Archetype 11: Summary Matrix

Use when summarizing findings, recommendations, risks, or action plans.

References:

- EFL summary pages such as page 51 and page 81.
- Actioneer BCG/EY table styling.

Structure:

- Claim title.
- 3-5 rows, one per issue/theme.
- Columns usually: topic, evidence, implication, recommended action.
- Use subdued row separators and short bullets.

Native requirements:

- All cells editable.
- Avoid shrinking text below readable business-deck size; split into appendix if needed.

## Archetype Selection Rule

Every slide must map to one archetype before authoring. If a slide does not fit, define a new archetype with:

- Purpose.
- Reference slide/page.
- Proof object.
- Native requirements.
- Raster allowances.

Add the new archetype to this library if it recurs.
