# Final Playbook System Audit Report

**Date:** April 9, 2026
**Scope:** All implemented features — creation wizard, inline run, thread conversion, changelog/review, cell detail, canvas
**Method:** 2 specialized agents (code quality + design consistency)
**Total findings:** 33 (Critical: 0, High: 5, Medium: 12, Low: 16)

---

## High Priority (Fix before demo)

| # | Source | Issue | Fix |
|---|--------|-------|-----|
| **1** | Code | **Promise-based param collection hangs forever** — inline `/run` creates a Promise awaiting wizard answers via custom events. If user navigates away, promise never resolves, event listener leaks. | Add 60s timeout that rejects + cleans up listener. Subscribe to dataset-switch to auto-cancel. |
| **2** | Code | **"Convert to playbook" false-positive** — regex `(convert|turn|make|save|transform).*\b(playbook|notebook)` matches "What factors make our playbook campaign successful?" | Tighten to require `into/to/as` between verb and noun: `(convert|turn).*\b(into|to|as)\b.*\b(playbook)` |
| **3** | Design | **Duplicate StatusDot components** — canvas uses SVG icons (checkmark/cross), detail panel uses plain dots. Status indicator changes shape when clicking a cell. | Extract shared `StatusDot` component. |
| **4** | Design | **Cell type icon inconsistency** — canvas uses hand-drawn SVG cylinder for SQL, panels use Lucide `Database`. Python has icon only on canvas, falls through to Sparkles elsewhere. | Extract shared `CellTypeIcon` component used in all 3 surfaces. |
| **5** | Design | **Owner avatar size mismatch** — group view uses `w-7 h-7`, everywhere else uses `w-5 h-5`. | Standardize to `w-5 h-5`. |

---

## Medium Priority (Next sprint)

| # | Source | Issue | Fix |
|---|--------|-------|-----|
| **6** | Code | **No DDL/DML guard in SQL extraction** — thread-to-playbook can capture `CREATE TABLE` or `DELETE` from markdown blocks. | Skip SQL starting with DDL/DML keywords. |
| **7** | Code | **Inline run SSE has no abort** — `handleStop` doesn't cancel inline playbook runs (no AbortController). | Create AbortController for inline run, wire to handleStop. |
| **8** | Code | **Tables Used regex misses JOIN tables** — info panel only checks `FROM`, not `JOIN`. Inconsistent with cell detail's `extractTables`. | Reuse `extractTables` from node-detail as a shared util. |
| **9** | Code | **"Cells have SQL" check too broad** — `handlePlanApproved` skips generation if ANY cell has SQL, even in normal wizard flow. | Gate on `isFromThread && hasExistingSql`. |
| **10** | Code | **Double-click Approve triggers concurrent generation** — no guard against rapid clicks. | Add `if (hasStartedGeneration.current) return;` before reset. |
| **11** | Code | **Playbook chip overflows at narrow widths** — `shrink-0` + no `max-w` means long names overflow container. | Add `max-w-[70%] truncate` to chip span. |
| **12** | Code | **Run confirmation timeout not cleared on unmount** — setTimeout calls setState on unmounted component. | Clear timeout in useEffect cleanup. |
| **13** | Code | **`pending!` non-null assertion unsound** — ChangelogTab uses `const p = pending!` but `pending` can be undefined. | Use optional chaining or guard block. |
| **14** | Design | **Hardcoded `bg-zinc-950`** — code blocks use Tailwind colors instead of design tokens. Won't adapt to theme changes. | Use `bg-card` / `bg-muted` tokens. |
| **15** | Design | **`bg-yellow-500/8` invalid Tailwind opacity** — should be `bg-yellow-500/[0.08]` or `/10`. | Fix to valid opacity value. |
| **16** | Design | **Missing loading progress in "generating" card** — static "Generating SQL queries..." with no cell count. | Show "Generating 3/8 cells..." from streaming data. |
| **17** | Design | **`computeLevels` duplicated 3 times** — same DAG algorithm in info-panel, canvas, and plan-review-card. | Extract to `playbook-utils.ts`. |

---

## Low Priority (Backlog)

| # | Source | Issue |
|---|--------|-------|
| 18 | Code | `inferLabelFromSql` produces generic "Query" for edge-case SQL (SELECT 1+1) |
| 19 | Code | `inferVarType` `\bid$` matches `grid`, `timid` incorrectly |
| 20 | Code | Wizard chip click + setTimeout can double-submit answers |
| 21 | Code | changeSummary in plan review card has no overflow handling |
| 22 | Code | `extractSqlColumns` shows expression fragments for complex un-aliased columns |
| 23 | Design | Wizard progress dots don't differentiate current vs completed step |
| 24 | Design | Annotation tooltip can overflow right edge of canvas |
| 25 | Design | Empty state patterns inconsistent (some text-only, some with icons) |
| 26 | Design | Section header font sizes vary: 10px, 11px, 12px across panels |
| 27 | Design | RunPickerDropdown and ContextPicker have different popup styles |
| 28 | Design | Tab notification dot spacing differs between info panel and detail panel |
| 29 | Design | New Playbook modal missing Escape key handler |
| 30 | Design | Wizard card "Continue" button has no "press Enter" keyboard hint |
| 31 | Design | Plan review TypeIcon doesn't distinguish Python from LLM |
| 32 | Design | Single-cell playbook DAG grouping edge case (works but could be cleaner) |
| 33 | Code | Stale reference spread pattern (consistently applied — no issue found) |

---

## What Works Well

- **Creation wizard flow** — guided QnA with LLM contextual follow-ups works end-to-end
- **Inline playbook run** — chip selection, param input cards, SSE streaming, table results all functional
- **Thread-to-playbook conversion** — detects intent, extracts SQL, skips to plan review
- **Plan review with modifications** — chat edits update canvas + inject new plan card with change summary
- **Changelog/diff flow** — diffs accumulate, yellow indicators on canvas, clickable diff rows
- **Run history with data tables** — actual row data captured and displayed with Show More
- **Close chat button** — hidden during wizard, visible elsewhere

## Recommended Fix Order

**Immediate (before demo):**
1. #2 — Tighten convert-to-playbook regex (1 line change)
2. #1 — Add timeout to param collection Promise (10 lines)
3. #9 — Gate "cells have SQL" on `isFromThread` (1 line)
4. #10 — Guard double-click Approve (2 lines)
5. #11 — Add truncate to playbook chip (1 class addition)

**Next session:**
6. #3/#4/#5 — Extract shared StatusDot + CellTypeIcon + avatar size
7. #6 — DDL/DML guard
8. #7 — Inline run abort controller
9. #8 — Shared extractTables util
