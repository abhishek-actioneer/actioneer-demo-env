# Playbook UX Audit Report

**Date:** April 8, 2026
**Scope:** Creation, Running, and Audit/Review flows
**Method:** 4 specialized code review agents + live browser testing via Chrome plugin
**Total findings:** 48 (Critical: 5, High: 12, Medium: 20, Low: 11)

---

## Executive Summary

The three flows are functionally complete. The creation wizard with LLM-generated contextual questions works well in live testing. The main structural concern: **the review/approval gate is cosmetic** — changes apply to cells immediately, "Approve" just clears a flag, and "Request Changes" doesn't revert. Several UI elements break at the narrow panel width (~400px), and there are last-mile gaps (no edit-back on wizard answers, no confirm before run, no navigation from diffs to cells).

---

## A. Creation Flow (13 findings)

| # | Sev | Finding | Fix |
|---|-----|---------|-----|
| A1 | **Crit** | Modal is redundant — shows mode previews, then "Start creating", then same mode choice in chat. Double-gate. | Make modal cards clickable (each launches wizard directly), or remove modal. |
| A2 | **High** | Chat panel doesn't auto-open on wizard start. User must click "Ask Actioneer". Confirmed in browser test. | Add `setIsOpen(true)` alongside `setRightPanelMode("chat")` in wizard start effect. |
| A3 | **High** | No way to edit previous wizard answers. Answered cards are read-only. Typo = restart. | Add "Edit" link on `AnsweredCard`. |
| A4 | **High** | Plan review card has only "Approve & Generate" — no Reject/Regenerate. The "chat to modify" guidance is 11px footnote. | Add secondary "Regenerate plan" button. |
| A5 | **High** | LLM follow-up questions appear without warning. User thinks step 4 was the last, then more appear. Progress dots lie ("4 of 5" → "5 of 6"). | Show transition message "A couple more clarifications..." before LLM questions. |
| A6 | **Med** | "Checking if I need any clarifications..." message flashes with no timeout or cancel. | Add 5s timeout + persistent spinner. |
| A7 | **Med** | No navigation guard — browser Back loses all wizard state silently. | Add `beforeunload` guard. |
| A8 | **Med** | Custom event dispatch (`window.dispatchEvent`) between chat-thread and page is brittle — no type safety, race-prone. | Replace with context callback or shared store. |
| A9 | **Med** | Plan review card truncates descriptions to 80 chars. In narrow panels, becomes dense wall of small text. | Show cell labels only in card; descriptions are on the canvas. |
| A10 | **Low** | Mode choice card has no descriptions of what Guided/Detailed mean (user saw them in modal, which is now dismissed). | Add brief descriptions under each option button. |
| A11 | **Low** | Skipped answers show "(skipped)" in a styled answer box. Looks odd in conversation flow. | Use muted italic "Skipped" text instead. |
| A12 | **Low** | `createId()` uses `Math.random()` — weak uniqueness for playbook IDs. | Fine for demo. Note for prod. |
| A13 | **Low** | Chip auto-submit uses unnecessary `setDraft` + `setTimeout` hack. | Just call `submit(chip)` directly. |

---

## B. Execution / Run Flow (15 findings)

| # | Sev | Finding | Fix |
|---|-----|---------|-----|
| B1 | **High** | No confirmation before run. Clicking "Run Playbook" executes immediately. No param summary. | Add lightweight confirmation showing resolved param values. |
| B2 | **High** | Dry Run is a 10px link in stats row, disconnected from Run button. Validation failures don't prevent running. | Move Dry Run results next to Run button. Disable Run on validation failure. |
| B3 | **High** | Error state leaves RunStatusPane stuck indefinitely. "New run" button is ambiguous (retry? go back?). | Rename to "Back to playbook" + separate "Retry". Auto-dismiss after 30s. |
| B4 | **Med** | AnimatedStatusMessage shows generic text ("Querying database..."), not actual cell progress. SSE events have the real data. | Show current cell name from `cell_start` events. |
| B5 | **Med** | Error messages truncated to 120 chars in RunStatusPane with no expand. RunHistoryCard has expand but StatusPane doesn't. | Add `<details>` expand like RunHistoryCard. |
| B6 | **Med** | Auto-fix only for SQL cells. LLM cell failures have no recovery (no "Edit prompt" or "Retry cell"). | Add "Edit prompt" shortcut for failed LLM cells. |
| B7 | **Med** | Auto-fix diff card uses vertical layout with horizontal arrow — misleading spatial metaphor. Shows full SQL, not just changed lines. | Use down arrow + highlight actual changes. |
| B8 | **Med** | Run history doesn't capture parameter values. Multiple runs look identical except timestamp. Can't reproduce past runs. | Store `paramOverrides` in `PlaybookRunHistory`. |
| B9 | **Med** | Output tables in run history show schema from `produces`, not actual results. Static for every run. | Link to cell results or note this is schema-only. |
| B10 | **Med** | Completion resets `execState` immediately, losing cell results/streaming text. Only compressed summaries remain in history. | Keep results accessible for 30s before clearing, or snapshot preview data into run history. |
| B11 | **Med** | Dry Run doesn't pass user's current param overrides — validates against defaults, not entered values. | Pass `paramValues` to the validate API. |
| B12 | **Low** | "blocked" status says "Skipped — dependency failed" without identifying which dependency. | Show failing upstream cell name from `dependsOn`. |
| B13 | **Low** | "Via: playbook" label in run history is meaningless when there's only one source. Adds visual clutter. | Only show when mixed `runVia` values exist. |
| B14 | **Low** | Dead code: `changelogOpen` state + Dialog from lines 506-555 in info panel. Never opened. | Remove. |
| B15 | **Low** | No loading state between clicking "Run" and first SSE event. Cells show idle status with no server acknowledgment. | Add "Connecting..." header state. |

---

## C. Changelog / Review Flow (15 findings)

| # | Sev | Finding | Fix |
|---|-----|---------|-----|
| C1 | **Crit** | **Review gate is cosmetic.** Changes apply to cells immediately. "Submit for Review" / "Approve" just clear `pendingChanges`. User can run unapproved SQL anytime. | Store modified cells in `stagedCells`. Only promote to main `cells` on approval. Run from originals until then. |
| C2 | **Crit** | **No rollback on "Request Changes."** Resets `reviewStatus` to "none" but cells remain modified. No snapshot of previous state. | Store previous cell snapshots in the diff. Restore on reject. |
| C3 | **High** | Incomplete state machine: only `"none" | "pending_review"`. No `"approved"` / `"rejected"`. Approval deletes `pendingChanges`, losing audit trail. | Expand to 4 states. Move approved diffs into changelog entry with reviewer info. |
| C4 | **High** | Multiple edit rounds silently overwrite pending diffs. Second LLM edit replaces first diff set. If already submitted for review, submission is lost. | Block edits while `pending_review`, or accumulate diffs per-cell. |
| C5 | **High** | No confirmation dialog for "Approve" or "Submit for Review". Per project convention, destructive actions need `AlertDialog`. | Wrap both in `AlertDialog` with version bump summary. |
| C6 | **Med** | `pendingDiffCellIds` creates new `Set` every render, defeating React.memo on canvas. | Wrap in `useMemo`. |
| C7 | **Med** | LCS diff has O(m*n) space with no guard. Large SQL could spike memory. | Add guard: if m*n > 50K, fall back to simpler diff. |
| C8 | **Med** | Plan-review vs changelog mode split is implicit. No visual indicator of which mode the user is in. | Add "Draft" / "Published" badge in header. |
| C9 | **Med** | Audit "running" state can get stuck if component unmounts during API call. No timeout or AbortController. | Tie to component lifecycle + add 30s timeout. |
| C10 | **Med** | Yellow dot on canvas cells is 2px — too small on zoomed-out DAGs. | Enlarge to 3px + add yellow border on node card. Add "N cells changed" toolbar badge. |
| C11 | **Med** | No navigation from Changelog diff rows to the actual cell on canvas. | Make diff rows clickable → `onNodeClick(cellId)`. |
| C12 | **Med** | Audit errors show cell label + message but no "fix" action or link to cell. | Make errors clickable. Add "Re-run Audit" + "Fix with AI" buttons. |
| C13 | **Low** | Version parsing regex breaks on non-standard strings (e.g., "1.0.0-beta"). Silently resets to v1.1. | Use dedicated version parser. |
| C14 | **Low** | `CellDiff` doesn't track `dependsOn` or `outputs` changes. Structural rewiring is invisible in diffs. | Add `dependsOnDiff` and `outputsDiff` fields. |
| C15 | **Low** | No concurrent editor protection. Last write wins silently. | Acceptable for demo. Add optimistic concurrency for prod. |

---

## D. Cell Detail Panel (16 findings)

| # | Sev | Finding | Fix |
|---|-----|---------|-----|
| D1 | **Crit** | `extractSqlColumns` breaks on `SELECT DISTINCT`, `CASE...END` without alias, subquery-in-FROM. | Strip DISTINCT/ALL, handle CASE depth, use paren-depth for outermost SELECT...FROM. |
| D2 | **High** | Side-by-side diff unreadable at ~400px. Each column gets ~170px. SQL lines truncated by `truncate` class with no scroll/expand. | Switch to unified diff below 500px. Add horizontal scroll. |
| D3 | **High** | `descriptionDiff` and `labelDiff` from `CellDiff` are never rendered. User sees "Modified" badge but can't see what changed. | Render inline diff for label/description changes. |
| D4 | **High** | `inferVarType` has no word boundaries. "user_summary" matches `sum` → "number". "amount_description" → "number". False positives. | Add `\b` boundaries. Consider making type badge optional when confidence is low. |
| D5 | **High** | Duplicated `InlineInput` (node-detail) and `EditableText` (info-panel). Same pattern, separate maintenance. | Extract shared component to `src/components/ui/`. |
| D6 | **Med** | Owner shown before Inputs on Description tab. Low-priority metadata interrupts the "what does this need?" flow. | Move owner below inputs/reads or into header. |
| D7 | **Med** | `extractTables` doesn't skip CTE aliases. `WITH base AS (...)` → "base" appears as a table read. | Parse CTE names from `WITH ... AS` and exclude them. |
| D8 | **Med** | Code editor not discoverable. Editable code block looks identical to read-only. No pencil icon or "click to edit" hint. | Add edit affordance on hover. |
| D9 | **Med** | Tab indicator dot is 6px at 40% opacity — nearly invisible. No distinction between results/errors. | Use colored dot (emerald = results, red = error) or count badge. |
| D10 | **Med** | LCS diff O(m*n) space with no upper bound. | Guard at 100K cells, fall back to simpler strategy. |
| D11 | **Med** | Empty state for Outputs tab doesn't distinguish "never run" from "run but no output". | Check `cellStatus` for contextual message. |
| D12 | **Med** | Inconsistent owner avatar sizes: 28px in node-detail vs 20px in info-panel. | Standardize on 20px for side panels. |
| D13 | **Med** | Python cell badge is dead code — `NewCellType` has no `"python"`. Cast `as string` hides this from TypeScript. | Add to `NewCellType` or remove branch. |
| D14 | **Low** | `ResultsTable` has no "showing X of Y" footer when preview is truncated. No sticky first column. | Add footer + sticky column for wide tables. |
| D15 | **Low** | `buildProducesLine` function is defined but never called. Dead code. | Remove. |
| D16 | **Low** | `CodeEditor` Tab key uses `setTimeout` for cursor positioning. Fragile timing. | Use `requestAnimationFrame` or ref + `useEffect`. |

---

## Browser Test Results

| Flow | Test | Result |
|------|------|--------|
| **Run** | WoW Acquisition Trends with Lookback Days = 90 | Completed in 5.9s. All 8 steps shown. Outputs tab auto-activated. |
| **Run** | Cell detail click → Inputs/Outputs tabs | Inputs show `start_date` (DATE), `end_date` (DATE). Reads show `installs` (TABLE). Output columns parsed from SQL correctly. |
| **Run** | Output type inference accuracy | `country` → NUMBER (wrong, should be STRING). `installs/cost/revenue` → STRING (wrong, should be NUMBER). |
| **Create** | New Playbook → modal → Start creating | Modal renders correctly. Navigates to wizard page. |
| **Create** | Chat panel auto-open | **FAILED** — panel didn't open. User had to click "Ask Actioneer". |
| **Create** | Wizard mode choice → Guided QnA | Mode choice card rendered. "Guided QnA" selected. First question appeared. |
| **Create** | 4 guided questions + LLM follow-ups | All 4 steps worked. LLM generated 2 contextual questions: "threshold for revenue drop?" and "compare to previous period?" — both relevant. |
| **Create** | Plan generation (planOnly) | 8 cells streamed onto canvas with descriptions visible. Plan review card rendered with structured DAG-level sections. |
| **Create** | Plan review card | Shows steps 1-8 with role labels, cell types, descriptions. "Approve & Generate" button visible. |

---

## Priority Implementation Order

### Before demo (immediate)
1. **A2** — Fix chat auto-open on wizard start (`setIsOpen(true)`)
2. **A1** — Simplify modal (make cards directly launch wizard with mode param)
3. **D1** — Fix `extractSqlColumns` for DISTINCT/CASE edge cases
4. **D4** — Fix `inferVarType` word boundaries

### Next sprint
5. **C1/C2** — Implement staged cells for proper review gate
6. **A3** — Add "Edit" on answered wizard cards
7. **B2** — Connect Dry Run validation to Run button
8. **D2** — Unified diff for narrow panels
9. **C3** — Expand ReviewStatus state machine
10. **B1** — Add run confirmation dialog

### Backlog
11. **A4/A5** — Plan review Reject button + LLM question transition
12. **B8** — Capture param values in run history
13. **C11** — Clickable diff rows → canvas navigation
14. **D5** — Extract shared InlineInput component
15. **C6** — Memoize `pendingDiffCellIds` Set
