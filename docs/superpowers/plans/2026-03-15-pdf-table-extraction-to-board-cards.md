# PDF Table Extraction → Board Table Cards

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a PDF slide contains a data table (not a chart), extract its structure, generate SQL to reproduce the data from DuckDB, and create a `"table"` board card with live, queryable data.

**Architecture:** Extend the existing PDF→board pipeline in three places: (1) teach Gemini extraction to recognize tables, (2) route `"table"` chart types through SQL generation like charts, (3) create `"table"` cards in `deckSlideToSection()` alongside the existing chart/text cards.

**Tech Stack:** Next.js API route, Google Gemini (`@google/genai`), DuckDB, existing board-store + board-types infrastructure.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/app/api/decks/process/route.ts` | Add `"table"` to `chartType` enum, adjust `processSlide` to keep table entries, tweak `buildChartSpec` to return `null` for tables |
| Modify | `src/lib/deck-to-board.ts` | Create `"table"` board cards from slides whose extracted chart type is `"table"` |
| Modify | `src/lib/deck-store.ts` | Add optional `tableEntries` field to `Slide` for table data + SQL |

**No new files.** All changes extend existing modules.

---

## Context for the Implementer

### How the current pipeline works

1. **Extraction** (`route.ts:73-91`): Gemini receives the PDF and returns structured JSON per slide. Each slide has a `charts[]` array where `chartType` is one of `"line" | "bar" | "pie" | "area" | "scatter" | "none"`.

2. **Processing** (`route.ts:224-304`): `processSlide()` filters out `chartType: "none"` entries (line 231), then runs SQL generation + execution for each remaining chart. Tables currently get `"none"` and are discarded.

3. **Conversion** (`deck-to-board.ts:49-113`): `deckSlideToSection()` creates a `"chart"` card if `chartSpecs.length > 0`, and a `"text"` card if commentary exists. There is no path for creating `"table"` cards.

### What the `"table"` card type already supports

`table-renderer.tsx` renders `BoardCard` where `type === "table"` and `data` is `Record<string, unknown>[]`. It auto-derives columns from `Object.keys(data[0])`, supports sorting and pagination. **No changes needed to the renderer.**

### Key constraint

The SQL prompt (`buildTextToSqlPrompt`) generates queries against the DuckDB parquet data. When a PDF table shows "Active Campaigns", the generated SQL must approximate the table's intent using whatever tables actually exist in the dataset. The data won't be an exact replica — it's a live approximation. This is the same trade-off charts already make.

---

## Chunk 1: Backend — Extraction + SQL Generation for Tables

### Task 1: Add `"table"` to the extraction schema

**Files:**
- Modify: `src/app/api/decks/process/route.ts:14-68` (schema + Zod validators)

- [ ] **Step 1: Update `SLIDE_SCHEMA` JSON schema**

In `route.ts`, add `"table"` to the `chartType` enum array at line 30:

```typescript
chartType: { type: "string", enum: ["line", "bar", "pie", "area", "scatter", "table", "none"] },
```

- [ ] **Step 2: Update `ExtractedChartSchema` Zod validator**

At line 50, add `"table"` to the Zod enum:

```typescript
chartType: z.enum(["line", "bar", "pie", "area", "scatter", "table", "none"]),
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/decks/process/route.ts
git commit -m "feat(deck): add 'table' to chartType extraction schema"
```

---

### Task 2: Update the extraction prompt to detect tables

**Files:**
- Modify: `src/app/api/decks/process/route.ts:73-91` (EXTRACTION_PROMPT)

- [ ] **Step 1: Add table detection guidance to EXTRACTION_PROMPT**

Replace the `EXTRACTION_PROMPT` constant with:

```typescript
const EXTRACTION_PROMPT = `You are analyzing a PDF business review deck.
For each slide, extract:
- index: slide number (0-based)
- title: the slide title
- commentaryText: any commentary or insight text on the slide (max 1000 chars)
- charts: an array of ALL distinct charts, tables, or metrics on this slide. A slide showing Revenue, Orders, and AOV separately should produce 3 chart entries.

For each chart entry:
- chartType: one of "line", "bar", "pie", "area", "scatter", "table", or "none"
  - Use "table" when the slide shows a data table (rows and columns of structured data, like a campaign performance table, leaderboard, or comparison grid). Tables typically have column headers and multiple data rows.
  - Use "none" only for text-only slides with no charts AND no data tables.
- metric: the key metric or data being shown (e.g. "Daily Active Users", "Revenue by Region", "Active Campaigns Performance Table")
- xAxisLabel: x-axis label if present (for charts) or primary key column name (for tables)
- yAxisLabel: y-axis label if present (for charts), omit for tables
- timeGranularity: "daily", "weekly", "monthly", "quarterly", "yearly" if time-series
- dateRangeText: any explicit date range mentioned on the slide (e.g. "Nov 1-7", "Q4 2019", "Oct 1 - Oct 31"), or omit if none

For text-only slides with no charts and no data tables, include a single chart entry with chartType "none".

Also extract deckTitle: the overall deck title.
Return valid JSON matching the schema.`;
```

Key change: Gemini is now instructed to use `"table"` for structured tabular data and only use `"none"` for pure text slides.

- [ ] **Step 2: Commit**

```bash
git add src/app/api/decks/process/route.ts
git commit -m "feat(deck): teach extraction prompt to detect tables vs charts"
```

---

### Task 3: Route table entries through SQL generation

**Files:**
- Modify: `src/app/api/decks/process/route.ts:224-304` (`processSlide` function)

The current code at line 231 filters out `"none"`:
```typescript
const chartsToProcess = extracted.charts.filter((c) => c.chartType !== "none");
```

This already lets `"table"` entries through (they aren't `"none"`). But `buildChartSpec` (line 216) returns `null` for unknown types, and tables should NOT produce a `ChartSpec` — they should only produce data rows.

- [ ] **Step 1: Update `buildChartSpec` to explicitly return `null` for tables**

At line 133, update the early-return condition to also exclude `"table"`:

```typescript
if (chartType === "none" || chartType === "table" || data.length === 0) return null;
```

Without this, table entries with non-empty data would fall through to the `validTypes` check and default to `"bar"` — producing a spurious bar chart from table data.

- [ ] **Step 2: Update `generateSQL` prompt for table-type queries**

In the `generateSQL` function (line 161), add a hint when the chart type is `"table"` so Gemini generates a flat tabular SELECT instead of an aggregation:

```typescript
async function generateSQL(
  sqlPrompt: string,
  metricContext: string,
  chart: ExtractedChart,
  ai: GoogleGenAI,
  modelId: string,
  priorError?: string,
  dateRangeText?: string,
): Promise<string> {
  const errorHint = priorError
    ? `\n\nPrevious attempt failed with: ${priorError}\nFix the query accordingly.`
    : "";
  const dateHint = dateRangeText
    ? `\n\nIMPORTANT: Filter the data to the date range: "${dateRangeText}". Add an appropriate WHERE clause.`
    : "";
  const tableHint = chart.chartType === "table"
    ? `\n\nIMPORTANT: This is a DATA TABLE (not a chart). Return a flat SELECT with descriptive column aliases matching the table's column headers. Include all relevant columns. Do NOT aggregate into a single row — return multiple rows of data. Limit to 100 rows.`
    : "";
  const result = await ai.models.generateContent({
    model: modelId,
    contents: `${sqlPrompt}\n\nGenerate a single SQL SELECT query to retrieve data for: ${metricContext}\n\nChart type: ${chart.chartType}\nX-axis: ${chart.xAxisLabel ?? "auto"}\nY-axis: ${chart.yAxisLabel ?? "auto"}\nTime granularity: ${chart.timeGranularity ?? "auto"}\n\n${OUTPUT_SQL_ONLY}${tableHint}${dateHint}${errorHint}`,
  });
  return cleanGeneratedSQL(result.text ?? "");
}
```

- [ ] **Step 3: Preserve table data in processSlide**

Currently `processSlide` (line 292-303) stores `chartSpecs` and uses `firstResult.data.slice(0, 10)` for backward-compat `data` field. Table entries won't have chartSpecs but will have data. The existing logic already handles this correctly:

- `chartSpecs` will be empty (since `buildChartSpec` returns null for tables)
- `firstResult.data` will contain the table rows
- The commentary prompt already receives `dataSamples` from all chart results

Verify: no code change needed here. The data flows through naturally.

- [ ] **Step 4: Store table chart types on the slide for downstream use**

Add a `tableCharts` field to the `Slide` type in `deck-store.ts` so `deckSlideToSection` knows which extracted entries were tables:

In `src/lib/deck-store.ts`, add to the `Slide` interface:

```typescript
export interface Slide {
  // ... existing fields ...
  /** Extracted charts that were identified as tables (for board card creation). */
  tableEntries?: Array<{
    metric: string;
    data: Record<string, string | number>[];
    sql: string;
  }>;
}
```

Then in `processSlide` (route.ts), after chart processing, collect table results:

```typescript
// After the chartResults processing block, before the commentary generation:

// Collect table entries for downstream board card creation
const tableEntries = chartsToProcess
  .map((chart, i) => ({ chart, result: chartResults[i] }))
  .filter(({ chart }) => chart.chartType === "table")
  .map(({ chart, result }) => ({
    metric: chart.metric,
    data: result.data,
    sql: result.sql,
  }));
```

And include `tableEntries` in the return object (line 292):

```typescript
return {
  id: crypto.randomUUID(),
  index: extracted.index,
  title: sanitize(extracted.title, 200),
  status: "ok",
  chartSpecs,
  tableEntries: tableEntries.length > 0 ? tableEntries : undefined,
  sql,
  data: firstData.slice(0, 10),
  lastRefreshed: Date.now(),
  commentary,
  followUps,
};
```

- [ ] **Step 5: Run lint**

```bash
pnpm lint
```

Expected: No new errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/decks/process/route.ts src/lib/deck-store.ts
git commit -m "feat(deck): route table slides through SQL generation, preserve table entries"
```

---

## Chunk 2: Conversion — Create Table Board Cards

### Task 4: Create `"table"` cards in `deckSlideToSection`

**Files:**
- Modify: `src/lib/deck-to-board.ts:49-113` (`deckSlideToSection` function)

- [ ] **Step 1: Add table card creation logic**

After the chart card block (line 68-88) and before the text card block (line 91-110), add a block that creates `"table"` cards from `slide.tableEntries`:

```typescript
// Table cards
if (slide.tableEntries && slide.tableEntries.length > 0) {
  for (let i = 0; i < slide.tableEntries.length; i++) {
    const entry = slide.tableEntries[i];
    if (entry.data.length === 0) continue;
    const orderOffset = cards.length; // After any chart cards
    cards.push({
      id: `${boardId}-slide-${slide.index}-table-${i}`,
      boardId,
      type: "table",
      title: entry.metric || slide.title,
      position: { x: orderOffset * 460, y: slideIndex * 400 },
      size: { width: 520, height: 320 },
      author: "system",
      data: entry.data as Record<string, unknown>[],
      sql: entry.sql,
      refreshCadence: "manual",
      lastRefreshed: new Date(slide.lastRefreshed).toISOString(),
      pinnedAt: now,
      comments: [],
      sectionId,
      orderInSection: orderOffset,
    });
  }
}
```

- [ ] **Step 2: Update the function's type signature to accept `tableEntries`**

The function parameter type is `Omit<Slide, "commentaryThreadId" | "chatThreadId">`. Since `tableEntries` is an optional field on `Slide`, it's already included in this type. No signature change needed.

- [ ] **Step 3: Fix text card `orderInSection` to account for table cards**

The text card block currently hardcodes `orderInSection: 1`. Update it to use `cards.length` so it follows any chart + table cards:

```typescript
// Analysis text card
if (slide.commentary) {
  cards.push({
    // ... existing fields ...
    orderInSection: cards.length, // was: 1
  });
}
```

- [ ] **Step 4: Run lint**

```bash
pnpm lint
```

Expected: No new errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/deck-to-board.ts
git commit -m "feat(deck): create table board cards from PDF table slides"
```

---

### Task 5: Manual smoke test

- [ ] **Step 1: Start dev server**

```bash
pnpm dev
```

- [ ] **Step 2: Upload a PDF containing a table slide**

Use the PDF that contains the "Active Campaigns" table slide. Navigate to the boards area and upload it.

- [ ] **Step 3: Verify the table card appears**

On the resulting board in document view:
1. The "Active Campaigns" section should contain a `"table"` card (not just a text card)
2. The table card should show column headers derived from the SQL query
3. Data should be sortable by clicking headers
4. A text card with commentary should appear alongside it

- [ ] **Step 4: Verify chart slides still work**

Confirm that chart slides (line, bar, pie) in the same PDF still produce chart cards as before. No regression.

---

## Summary

| Task | What changes | Risk |
|------|-------------|------|
| 1 | Schema: add `"table"` enum value | None — additive |
| 2 | Prompt: teach Gemini to detect tables | Low — existing `"none"` slides may now get `"table"` if they contain tabular data |
| 3 | Processing: route tables through SQL, store `tableEntries` | Medium — new `tableEntries` field on `Slide`, SQL generation for tables may need prompt tuning |
| 4 | Conversion: create `"table"` board cards | Low — uses existing `"table"` card type + renderer |
| 5 | Smoke test | Validation only |

**Total: 4 implementation tasks, ~15 steps, touching 3 files.**

---

## Design Decisions & Known Limitations (v1)

1. **`done` event payload duplication**: Table-only slides will have overlapping data in both `slide.data` (first 10 rows, backward-compat) and `slide.tableEntries[0].data` (up to 500 rows). This is intentional — `slide.data` serves the legacy deck viewer while `tableEntries` serves board card creation. Do not "fix" by removing the backward-compat field.

2. **No follow-up questions on table cards**: Table cards are created without `followUpQuestions` or `silentContext`. Follow-up chips only appear on the companion text card. This is a deliberate v1 simplification — table cards are for data display, text cards are for interactive drill-down.

3. **Column hints not extracted**: The extraction prompt only captures `xAxisLabel` (primary key column) for tables, not the full set of column headers. SQL generation infers columns from the `metric` description. A future improvement could add a `columns` array to `ExtractedChart` for more precise SQL generation.

4. **Commentary prompt not table-aware**: The commentary LLM prompt asks for "chart titles" even on table-only slides. This works acceptably because the prompt receives data samples regardless of type, but a more tailored prompt could produce better results for table slides.
