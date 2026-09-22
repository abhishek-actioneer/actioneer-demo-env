# Tufte-Informed Analytical Slide Principles

## Purpose

Use this working file to evolve `business-deck` from a polished consulting-deck skill into a sharper analytical communication skill. The goal is not to make every slide look like a Tufte chart. The goal is to make every business slide more truthful, comparative, evidence-dense, and editable.

These notes synthesize:

- The local `tufte-viz` skill.
- Edward Tufte principles: graphical integrity, data-ink ratio, chartjunk removal, small multiples, data density, micro/macro reading, layering, and analytical evidence.
- Practical screen/chart rules from modern Tufte-style visualization skills: direct labels, no decorative chart chrome, finding-led titles, accessible formats, and human number formatting.
- Slide-by-slide review of the EFL 2.0 transformation proposal in `efl-slide-by-slide-principle-review.md`.

## North Star

A business slide should be an analytical claim plus nearby evidence.

Prefer slides that help an executive answer:

- What changed?
- Compared to what?
- Why did it happen?
- What should we do next?
- Can I trust the evidence?

Avoid slides that merely look polished. Decorative polish is useful only when it helps a viewer read, compare, trust, or reuse the argument.

## Analytical Slide Workflow

Before authoring or revising a content slide, resolve:

1. The decision or discussion the slide supports.
2. The full-sentence claim the slide should make.
3. The comparison context: prior period, target, baseline, peer, cohort, scenario, or benchmark.
4. The mechanism or causal explanation behind the pattern.
5. The best proof form: sentence, table, chart, small multiple, slopegraph, roadmap, process diagram, option space, or evidence matrix.
6. The evidence trail: source, date, scope, assumptions, caveats, and confidence level.
7. The editability need: which numbers, labels, rows, or diagram parts must remain native-editable.

If a slide has no claim, comparison, or proof object, do not style it yet. Fix the reasoning first.

## Deck Spine And Section Cadence

Analytical discipline applies to the whole deck, not only individual slides.

Strong business decks often use this rhythm:

1. Orient the audience to the full journey.
2. Spotlight the current chapter.
3. State the section summary with initiative, evidence, and value potential.
4. Deep-dive one lever per slide.
5. Use case vignettes or benchmarks to prove feasibility.
6. Return to the full journey before moving to the next chapter.

Do not treat every slide as a standalone poster. Repetition, recap, and progressive disclosure can be useful when they preserve orientation and make a long analytical journey navigable.

## Orientation Maps

For long strategy, transformation, diligence, or operating-review decks, use stable orientation maps.

Rules:

- Reuse the same journey map across chapters.
- Dim inactive areas and highlight the current chapter.
- Keep labels, positions, colors, and hierarchy stable across repeated map slides.
- Use agenda slides to show meeting time allocation and current location.
- Use section-summary slides to bridge from orientation into evidence.

This is parallelism at deck level: the viewer should see what changed because the highlight changed, not because the map was redesigned.

## Summary-To-Deep-Dive Pattern

When a section contains many levers, start with a summary table or matrix before the detailed evidence.

The summary should include:

- Initiative or lever.
- Key observation.
- Path forward.
- Estimated savings, revenue, profit, or impact.
- Confidence or dependency when relevant.

Then each deep-dive slide should isolate one lever and show:

- The current-state fact.
- The benchmark or comparison.
- The mechanism of improvement.
- The estimated potential.
- The next action or decision.

This prevents dense sections from feeling like a pile of charts. The audience knows where each proof slide fits.

## Claim Titles

Use assertion titles for analytical slides.

Good:

- `Gross margin fell 420 bps after discount expansion.`
- `Actioneer cuts cost per query by reusing prior SQL and metric definitions.`
- `Enterprise data teams lose speed at the handoff between metric intent and governed execution.`

Weak:

- `Gross Margin Trend`
- `Cost Savings`
- `Enterprise Data Challenges`

The title should state the finding. The subtitle, chart labels, or source note can carry scope and units.

## Comparison First

Every business metric needs context. A number without comparison is usually decorative.

Acceptable comparison anchors:

- Prior period.
- Baseline or status quo.
- Target or plan.
- Peer or competitor.
- Best-in-class benchmark.
- Cohort, segment, market, geography, or persona.
- Scenario: base, upside, downside.
- Before/after intervention.

Default slide repairs:

- Single KPI with no context -> KPI plus prior period, target, or sparkline.
- One bar with no baseline -> sentence or table row.
- Trend with no event context -> annotate launch, policy, pricing, campaign, or operating change.
- Ranking with no implication -> sort by value and add action/priority column.

## Evidence Near The Claim

Integrate words, numbers, and visuals. Do not segregate the chart on one side and the explanation somewhere else if proximity would make the relationship clearer.

Prefer:

- Direct labels at line endpoints.
- Driver labels beneath or beside the relevant bar, waterfall segment, or timeline phase.
- Short annotations next to peaks, troughs, inflections, outliers, or intervention points.
- Footnotes close enough to audit the claim without interrupting the main read.
- Source labels that name the actual system, dataset, benchmark, or document.

Avoid:

- Detached legends when direct labels work.
- A separate explanatory card row that repeats what the chart already says.
- Callout boxes that float far from the data point they explain.
- Vague source lines such as `Source: client data` when a concrete system or dataset is available.

## Data-Ink For Slides

Use the eraser test:

For every element on the slide, ask whether it can be removed without losing information, trust, editability, or reading speed. If yes, remove it.

Common removable slide ink:

- Decorative cards around every item.
- Heavy panel borders.
- Drop shadows.
- Gradients.
- Icon rows where icons do not encode meaning.
- Duplicate axis ticks and data labels.
- Legends that duplicate direct labels.
- Decorative numbering.
- Section-eyebrow chrome on very short decks.
- Full-width explanatory bands that repeat labels already placed near the data.

Keep non-data ink only when it reduces cognitive load: light hairlines in dense tables, subtle row grouping, footers, or separation between repeated small multiples.

## Collision Test

Before shipping, run a visual collision check.

For every text element, mentally draw its bounding box. Check whether it collides with:

- Another label.
- Dense markers.
- A line or bar.
- Axis ticks.
- Footnotes.
- Page numbers.
- Logos.
- The slide title area.

Standard fixes:

- Move explanatory prose into the speaker notes or figcaption-like source area.
- Place event labels in a dedicated strip above a chart.
- Push baseline/reference labels to the outside margin.
- Use short leader lines when an annotation must point to a specific mark.
- Reduce annotation count to the few items that change the conclusion.
- Convert crowded labels into a table when exact reading matters.

Business slides can be dense, but they must still pass a thumbnail scan.

## Chart Defaults For Business Slides

Use these as defaults unless the source material or user explicitly requires otherwise:

- No pie or donut charts. Prefer sorted horizontal bars, tables, or small multiples.
- No 3D charts, perspective, fake depth, or decorative shadows.
- No dual y-axes. Use stacked small multiples with shared x-axis instead.
- No top or right chart borders.
- No legends when direct labels work.
- No gridlines by default. If exact reading matters, use faint horizontal rules only.
- No vertical gridlines unless they are part of a timeline or event structure.
- No rainbow palettes for ordered data.
- Gray first; use one accent color to highlight the primary claim.
- Annotate notable events, peaks, troughs, outliers, and intervention points directly.
- Keep units stated once in title, subtitle, axis, or table header; do not repeat units on every value.
- Format numbers for humans: `$1.2M`, `23%`, `420 bps`, `12,450`, not excessive decimals.

## Chart Type Guidance

Use the form that best serves the reasoning:

| Need | Preferred Form |
|---|---|
| Show a change over time | Line chart, sparkline table, or small multiples |
| Compare categories | Sorted horizontal bar chart |
| Show before/after by category | Slopegraph |
| Show contribution to total change | Waterfall |
| Show many metrics by segment | Table with sparklines |
| Show distribution or outliers | Dot plot, histogram, or scatter |
| Show two related measures without false correlation | Small multiples, not dual axes |
| Show a simple 1-2 number fact | Sentence with context |
| Show a compact ranking of 3-5 items | Table |
| Show part-to-whole | Bar/table; pie only if explicitly requested and simple |
| Show causal system | Process diagram plus evidence chart |

Charts earn slide space by revealing patterns, relationships, variation, or comparisons that a sentence or table cannot.

## One Argument, Not One Visual

The useful unit is one argument, not mechanically one chart.

Some slides need paired or triptych proof objects:

- Current state vs benchmark vs implication.
- Market size vs profitability vs right-to-win.
- Trend vs driver waterfall.
- Scatterplot vs prescription zones.
- Qualitative quote vs quantitative diagnostic.
- Process diagram vs measured failure mode.

Allow multiple exhibits when they answer one claim together. Avoid multiple exhibits when they become unrelated mini-slides.

## Small Multiples And Parallelism

When comparison is the point, use repeated structure.

Rules:

- Keep scales consistent across panels unless explicitly labeled otherwise.
- Keep panel grammar identical; changes should be in data, not design.
- Tighten spacing so comparison is effortless.
- Label what varies: region, segment, period, scenario, persona, product, or channel.
- Use the same highlight rule in every panel.

Small multiples are especially useful for:

- Segment performance.
- Regional adoption.
- Before/after workflows.
- Scenario comparisons.
- Competitive benchmarks.
- Funnel conversion by cohort.

## Sparklines And Dense Tables

Do not make a full chart when a tiny trend embedded in a table will do.

Use sparkline tables for:

- Metric dashboards.
- Segment trends.
- Pipeline, usage, revenue, margin, SLA, or defect history.
- Operating-review slides where current value and direction both matter.

Rules:

- Keep sparklines small and quiet.
- Pair each sparkline with current value and delta.
- Avoid axes and gridlines.
- Use one accent dot or mark for current value, anomaly, or intervention.
- Right-align numeric columns.
- Use thin rules or whitespace, not zebra-striping by default.

## Micro/Macro Reading

Good analytical slides reward both a glance and a close read.

Macro layer:

- Assertion title.
- Dominant proof object.
- Highlighted key value or pattern.
- Clear section or row grouping.

Micro layer:

- Source, assumptions, units.
- Specific values.
- Segment labels.
- Method caveats.
- Secondary comparisons.

Do not choose between density and clarity. Use visual hierarchy so the big read appears first and the fine read is available on inspection.

## Causality And Mechanism

Move beyond describing the pattern. Show why it happened or how the recommendation works.

Techniques:

- Show intervention and response in the same frame.
- Annotate the mechanism directly on the chart.
- Pair a process diagram with evidence.
- Use a before/after sequence with stable layout.
- Use waterfall drivers to show contribution to change.
- Use option-space rows to show tradeoffs.

If a slide says `improved`, `reduced`, `accelerated`, or `unlocked`, it should usually show the mechanism.

## Case Vignettes As Evidence

Use case vignettes as transfer evidence, not decoration.

A strong case vignette has:

- Context: client, category, market, or operating situation.
- What was done: the intervention or method.
- Impact: quantified outcome or observable change.
- Transfer logic: why this case is relevant to the current client.
- Caveat: where the analogy may not fully hold, if material.

Avoid logo-only case slides. A case without mechanism and impact is credibility wallpaper.

## Qualitative Evidence

Quotes, interview themes, observed workflows, org charts, market visits, and field notes can be analytical evidence.

Use qualitative proof when it:

- Reveals a recurring operating pattern.
- Explains why the numbers look the way they do.
- Shows decision friction, cultural barriers, or process failure.
- Clarifies customer, employee, distributor, or partner behavior.

Rules:

- Pair qualitative evidence with the operating implication.
- Do not use quotes as atmospheric flavor.
- Group quotes by theme when several make the same point.
- Place the quote or observation near the diagnostic it explains.
- Preserve provenance enough to make the evidence credible without exposing sensitive details.

## Multi-Criteria Decision Displays

Strategic portfolio, channel, product, and operating-model choices often need more than one metric.

Good decision displays show:

- The decision options.
- The criteria: market size, growth, margin, ROCE, capability fit, right-to-win, risk, time, investment, or strategic relevance.
- The evidence behind each criterion.
- The recommended posture: invest, play selectively, exit, enter, prioritize, test, or monitor.
- The tradeoff or constraint.

Prefer matrices, score tables, option-space rows, and market-attractiveness/right-to-win maps over generic quadrant diagrams with unlabeled judgment.

## Evidence Integrity

Business slides must be auditable enough to survive a meeting.

Check:

- Are values proportional to visual marks?
- Are baselines and scales honest?
- Are money values normalized when comparing across time?
- Are time intervals consistent?
- Are cohorts and denominators clear?
- Are sources concrete?
- Are assumptions and directional estimates labeled as such?
- Are incompatible benchmarks separated or caveated?
- Are caveats quiet but findable?

Do not make visual certainty stronger than evidence certainty.

## Color And Layering

Use color as meaning, not decoration.

Defaults:

- Primary data: ink or dark gray.
- Secondary data: lighter gray or tan.
- Highlight: one Actioneer accent when the business claim needs emphasis.
- Backgrounds: warm-neutral white or cream.
- Rules and axes: hairline gray.

Layering rules:

- Primary data should dominate.
- Secondary comparison should recede.
- Grid, axes, and boundaries should whisper.
- Labels should be close and readable.
- Color should not be the only differentiator; use position, label, weight, or shape too.

## Transformation Program Evidence

For change-program and implementation slides, the evidence is often a mechanism rather than a chart.

Show:

- Governance model.
- Workstreams and waves.
- Owner roles.
- Cadence.
- Capability-building plan.
- Communication loops.
- Decision rights.
- Required client time commitment.
- Deliverables by phase.
- What must be true for the model to work.

Avoid generic change-management slogans. A transformation slide should make the operating system visible.

## Business Slide Anti-Patterns

Avoid defaulting to:

- Big KPI cards with no comparison.
- Decorative icon rows.
- Pie and donut charts for business mix.
- One-number slides with no baseline.
- Legends far from data.
- Dense prose beside a chart instead of direct annotation.
- Over-designed executive-summary grids where every tile has equal weight.
- Generic card grids where a table, matrix, or decision tree would show the reasoning better.
- Dashboard chrome imported into a presentation slide.
- Full-slide screenshots when the business-critical text should be editable.
- Case-study logo walls with no mechanism or impact.
- Chapter dividers that lose the audience's location in a long deck.
- Strategy option slides that list choices without criteria or recommendation.
- Change-program slides that name rituals but do not show cadence, ownership, or deliverables.

## Render And Review Gate

Before delivering a deck, verify:

- Every content slide has a claim title and proof object.
- Every section has a visible role in the deck spine.
- Every metric has comparison context or a deliberate reason not to.
- Long decks preserve orientation with agenda, journey, or chapter maps.
- Sources, units, and assumptions are present where needed.
- Charts use direct labels where practical.
- No pie, 3D, dual-axis, decorative chart chrome, or redundant legends slipped in by default.
- Dense slides pass the collision test.
- The main read is clear at thumbnail size.
- Case vignettes include context, intervention, impact, and transfer logic.
- Multi-criteria decisions show criteria and recommendation, not just option labels.
- Business-critical text, metrics, tables, and labels remain native-editable.
- The visual treatment does not imply more precision or certainty than the evidence supports.

## How To Fold Into The Main Skill Later

Likely edits to make:

- Add this file to the `Quick Start` reading sequence after `principles.md`.
- Promote `Comparison First`, `Data-Ink For Slides`, and `Collision Test` into `references/principles.md`.
- Add a `Phase 3A: Analytical QA` section to `references/workflow.md`.
- Add chart-specific rules to the `Performance Exhibit` archetype in `references/layout-library.md`.
- Add a deck-level verification checklist item for Tufte-style evidence integrity.
