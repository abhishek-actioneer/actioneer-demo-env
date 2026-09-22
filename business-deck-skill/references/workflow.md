# Editable Deck Workflow

## Phase 1: Resolve Intent

Identify:

- Audience: executive, board, client, investor, internal operating team, workshop.
- Use mode: live presentation, reusable template, leave-behind, proposal, working session.
- Destination: PPTX only, PPTX plus Google Slides, PDF leave-behind, or all three.
- Editability target: hybrid by default; titles, tables, metrics, and business-critical text must remain native.
- Brand system: Actioneer BCG/EY style by default; client or custom only by explicit request.

Default: native PPTX only. Google Slides import is opt-in.

## Phase 2: Read Source Material

Source material can include:

- Existing PDF or PPTX.
- HTML pitch deck.
- Notes or prompt brief.
- Spreadsheet or metrics.
- Product screenshots and brand assets.

For existing decks, extract:

- Slide count and dimensions.
- Title style.
- Layout archetypes.
- Proof objects.
- Source notes.
- Reusable patterns.

Do not clone a reference deck blindly. Extract its grammar, then apply the Actioneer BCG/EY style family unless the user explicitly asks for another brand.

## Phase 3: Build Claim Spine

Create a page-by-page spine:

| # | Slide | Claim | Proof Object | Editability Notes |
|---|---|---|---|---|
| 1 | Cover | Identity / purpose | Logo lockup | Native text + logos |
| 2 | Context | What is changing | Market/context map | Native diagram |
| 3 | Diagnostic | What is broken | Chart/table/flow | Native chart/table |

Every content slide must have a claim and a proof object before production begins.

## Phase 4: Select Archetypes

Read [layout-library.md](layout-library.md), then map each slide to a canonical archetype.

Map each slide to a known archetype:

- Cover.
- Agenda.
- Team / credentials.
- Objectives.
- Diagnostic.
- Performance exhibit.
- Transformation roadmap.
- Strategic choices.
- Operating model.
- Case study.
- Summary matrix.
- Next steps.

If no archetype fits, define why the slide is necessary.

## Phase 5: Build Native PPTX

Primary authoring path: Codex-native Presentations plugin.

Use native PowerPoint objects:

- Text boxes for all editable text.
- Tables or shape grids for matrices.
- Charts for data expected to change.
- Shapes and connectors for diagrams.
- Separate images for logos, headshots, screenshots, and icons.

Hybrid rule: rasterized exhibits are acceptable for product screenshots, complex UI stills, animation captures, or intricate visuals. Titles, tables, metrics, source notes, and core business labels remain native-editable.

Use Python builders only when the Presentations plugin is unavailable, when migrating an existing deterministic builder, or when a narrow scripted layout generator is explicitly easier to verify. In those cases, keep the builder repo-relative and make the output contract explicit.

For Actioneer decks, use the existing `generated/build_bcg_editable.py` and `generated/build_ey_editable.py` as pattern references only:

- Reuse helper ideas such as `text`, `rich_text`, `rect`, `img`, `label`, `footer`.
- Replace hardcoded absolute paths with repo-relative paths.
- Extract shared helpers if building more than one deck.
- Prefer Google-safe fonts when the user prioritizes Google Slides editability.

## Phase 6: Verify PPTX

Open or render the PPTX and check:

- All slides are present and in order.
- Titles do not wrap unintentionally.
- Text does not overflow.
- Native objects are selectable/editable.
- Titles, tables, metrics, and business-critical text are native-editable even on hybrid slides.
- Source notes and page numbers are present where needed.
- Logos and headshots are not distorted.
- Charts/tables preserve data labels and units.
- No large full-slide screenshots were used where native objects were expected.

## Phase 7: Google Slides Import

When Google Slides is requested:

1. Create the local `.pptx`.
2. Use the Google Slides / Google Drive connector import workflow with native Google Slides conversion.
3. Verify with connector readback or thumbnails.
4. Confirm that key text and shapes remain editable.

Do not return a Google Slides URL until import/readback has completed.

If the user did not request Google Slides, do not import the deck to Drive.

## Phase 8: PDF Export

Export PDF only after the native deck is approved. PDF is the read-only leave-behind.

Check:

- Visual fidelity.
- Page count.
- No missing images.
- No clipped text.
- Source notes still legible.

## Delivery

Return:

- PPTX path.
- Google Slides URL if imported and verified.
- PDF path if exported.
- A short note on which parts are native-editable and which parts were intentionally rasterized.
