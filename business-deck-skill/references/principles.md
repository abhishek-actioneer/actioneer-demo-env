# Business Deck Principles

## North Star

A business deck is an editable reasoning artifact in the Actioneer brand. It should help executives, operators, sales teams, or clients discuss the business, change the wording, update numbers, and reuse slides without returning to a designer.

The reference style is Actioneer-BCG / Actioneer-EY: consulting-deck discipline, warm-neutral Actioneer styling, a claim-led slide, one clear proof object, quiet sources, and layouts that survive a live meeting.

## Brand Default

Use the Actioneer BCG/EY editable-deck style family by default:

- Landscape page size `297mm x 180mm` unless the user requests another format.
- Warm-neutral white and cream surfaces.
- Mono ink, greys, and sparse highlight color.
- Sharp corners.
- Quiet page numbers and confidentiality/source footers.
- Native logos, headshots, text, tables, diagrams, and charts.
- Consulting-grade spacing and grid discipline.

Core token anchors:

- Ink: `#101010` / `#1A1A1A`.
- Secondary grey: `#4A4A4A`.
- Tertiary grey: `#7A7A7A`.
- Hairline: `#DBDBDB`.
- Cream: `#F4ECDE`.
- Grey background: `#F5F5F5`.
- White: `#FFFFFF`.
- Highlight cream, mostly for dark surfaces: `#FFE8B5`.

Typography:

- Prefer Actioneer brand fonts when supported: Switzer for display/body and Chivo Mono for labels.
- For Google Slides editability, use practical Google-safe substitutes when needed: `Roboto` and `Roboto Mono`.
- Labels, metadata, table headers, page numbers, and footers should be mono uppercase.
- Headings should feel medium-weight, not heavy/bold.

Do not switch to a client or generic consulting visual theme unless the user explicitly asks for that.

## Claim And Proof

- Use a full-sentence title that states the takeaway.
- Put one dominant proof object under the title.
- Make the proof object do the work: chart, table, roadmap, matrix, process flow, option space, operating model, team grid, or case evidence.
- Use subtitles sparingly. If the title cannot carry the claim, rewrite the title.
- Keep source notes, assumptions, and footnotes quiet but present when claims depend on data.

## Client-Specific Proposal Sharpness

When editing client proposal decks, treat client edits as evidence of the
language that will survive the meeting:

- Prefer the client's actual system names over generic product or data-layer
  language. If the client has a named core system or deployed data source, use
  that name instead of a generic category label.
- In very short decks, remove section-eyebrow chrome when it competes with the
  claim. Let the title and proof object carry the page.
- Make source footers concrete. Reference the actual source system, dataset, or
  deployed data path; avoid vague source lines such as `from your data`.
- Replace abstract mechanism claims with operational commitments when the user
  has supplied them: implementation windows, target outcomes, and exactly where
  the component will run.
- If a note is only needed to decode an acronym, keep it short. Do not turn
  source caveats into analyst defensiveness on the slide.

## Benchmark Proof Slides

For Actioneer benchmark proof slides, especially DABstep / KramaBench comparisons, use the final `master-deck` benchmark slide as the pattern:

- Pair benchmark panels only when they prove the same buying argument. The preferred structure is `DABstep = complex reasoning over financial / enterprise datasets` beside `KramaBench = data-lake-to-insight transfer`.
- Lead with the Actioneer score as the dominant metric in each panel. Use concise labels such as `Actioneer benchmark score`, not scorer-method exposition in the hero area.
- Use direct competitive claims in panel copy: `Higher than NVIDIA, Microsoft, and Google` or `Higher than OpenAI, Anthropic, and Google`, keeping deeper scorer caveats in speaker notes or source notes.
- Keep comparison charts native and aligned to one shared grammar: right-aligned system label, fixed gutter, horizontal bar track, fixed gutter, right-aligned value.
- Use consistent row starts, track widths, value columns, and bar heights across paired benchmark panels, even if the score scales differ.
- Use color semantically: Actioneer gets the highlight / orange treatment; competitors stay quiet tan or grey. Do not add extra legend chrome.
- Keep source notes short and concrete, e.g. `Sources: DABstep benchmark, Adyen + Hugging Face; KramaBench, MIT`.
- Favor the strongest approved reported Actioneer comparison point when the user explicitly asks for the strongest sales proof, but do not mix incompatible scoring regimes without a quiet source or speaker-note caveat.

## Cost Waterfall Slides

For Actioneer cost, token, effort, or efficiency waterfalls, use the final `master-deck` cost-per-query slide as the pattern:

- Make the headline numeric and outcome-led: `Cost / query falls from ~$1.50 using models directly to ~$0.60 with Actioneer`.
- Use a single native waterfall as the proof object. Do not add a separate explanatory card row that competes with the chart.
- Put each driver label and mechanism directly under the waterfall element it explains. Proximity should make the relationship cognitively obvious.
- Write driver copy as cost-causal mechanism language, not generic product capability language: e.g. `Fewer schema and metric-discovery tokens`, `Reuse prior SQL, results, and metric definitions`, `Less planning, retry, and prompt scaffolding`.
- Keep caveats in a quiet footnote. Directional estimates, low-end repeat-query cases, and high-end cold-start cases should not interrupt the main waterfall.
- Avoid generic savings green. For Actioneer cost-reduction bars, prefer muted tan `#D8BD83`; keep the dollar reduction labels in Actioneer orange `#F88A22`. Use grey for the baseline and ink/black for the final Actioneer bar.
- Remove decorative numbering, legends, callouts, axis ticks, or duplicate labels unless they reduce cognitive load. If a label is adjacent to the bar value, do not repeat it as an axis tick.
- Preserve user-edited PPTX artifacts carefully. When a business user has manually tuned a slide, make direct targeted edits rather than regenerating from a builder unless explicitly requested.

## Consulting Grammar

Prefer these slide archetypes:

- Cover: minimal identity, date, client / owner, confidentiality if needed.
- Team / credentials: native headshots, roles, short proof bullets.
- Objectives: short bullet list tied to meeting outcomes.
- Agenda: timed or chaptered meeting flow.
- Diagnostic: current state, root causes, implication.
- Performance exhibit: chart(s) with explicit deltas and benchmarks.
- Context map: external forces arranged around a center concept.
- Building blocks: 3-5 strategic pillars with icons or proof labels.
- Roadmap: workstreams, phases, enablers, milestones.
- Option space: two-endpoint tradeoffs, strategic choices, or decision axes.
- Summary matrix: issue, evidence, implication, recommended action.
- Case study: client/problem/metrics/how, with real before/after/delta where possible.

## Editability

Hybrid slides are allowed. Visual polish and business-user editability are both important, but editability wins for the parts business users are likely to change.

Always keep these native:

- Titles, subtitles, body copy, captions, and footnotes.
- Tables, matrices, and summary pages.
- Metrics, deltas, units, benchmark labels, and callout numbers.
- Charts when values are expected to change.
- Connectors, arrows, swimlanes, roadmaps, and operating-model diagrams.
- Logos and headshots as separate images, not baked into full-slide screenshots.

Rasterize these only when appropriate:

- Product screenshots.
- Photos.
- Animation stills.
- Complex HTML infographics where editing is less important than visual fidelity.
- Highly rendered illustration or decorative images.

Never rasterize a full slide just because it is faster. If a slide contains a rasterized exhibit, keep the title, source note, page number, and any business-critical metrics native unless there is a concrete reason not to.

For high-fidelity product mockup slides, a hybrid approach is often best:
render the product surface from HTML/CSS when it needs real app polish, but keep
the slide title, source line, page number, and any meeting-critical claims as
native editable PPTX text.

## Visual Discipline

- Use consistent margins, page numbers, and source lines.
- Do not overcrowd the title area.
- Align all proof objects to a visible grid.
- Prefer tables and matrices over generic cards when the slide is analytical.
- Avoid decorative gradients, ornamental backgrounds, and fake UI controls unless the slide is specifically about product UI.
- Use color as meaning, not decoration.
- Prefer direct annotation over separate legends. Put explanatory text,
  mechanism labels, and caveats near the exact visual element they explain, so
  proximity carries the relationship.
- Remove ornamental structure when it only organizes the page visually but does
  not reduce cognitive load: decorative numbering, detached legends, redundant
  callout boxes, duplicate axis ticks, and extra framing should be deleted.
- If a label can live directly under, beside, or inside the relevant chart
  element, do that instead of creating a second explanatory band elsewhere on
  the slide.
- Business slides can be dense, but they must remain scannable at thumbnail size.

## Business-User Reuse

The deck should open cleanly in PowerPoint and Google Slides. A business user should be able to:

- Edit titles and bullets.
- Change numbers and labels.
- Move columns, boxes, and arrows.
- Swap logos and headshots.
- Reuse one slide in another deck without bringing hidden HTML/CSS dependencies.

If a slide looks beautiful but cannot be edited in the environment where the business user works, it has failed this skill.
