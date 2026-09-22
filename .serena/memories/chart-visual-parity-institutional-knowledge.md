# Chart Visual Parity & Deck Processing: Institutional Knowledge Summary

**Research Date:** 2026-03-13  
**Status:** 3 related learnings + 1 critical brainstorm  

## Critical Brainstorms (Decision Docs)

### 1. Chart Visual Parity (2026-03-11) — APPROVED DECISION
**Location:** `docs/brainstorms/2026-03-11-chart-visual-parity-brainstorm.md`

**Decision:** Make canvas/deck chart cards adopt the full visual language of the chat variant.

**Key Changes:**
- Add `showShell?: boolean` prop to `ReportChart` (default `true` for backward compat)
- When `showShell=false` (canvas mode), render identical internals minus outer card wrapper:
  - Monochrome + green-accent color scheme (remove `CANVAS_COLORS` 8-color palette)
  - Hero stat above chart (e.g., "Total: $1.2M")
  - Stats footer below (High/Low/Avg row)
  - Donut pie (innerRadius=55) instead of solid pie
  - SVG gradient on area fills instead of flat 15% opacity
  - Hidden Y-axis (not visible)
- `ChartRenderer` must pass `height={availableHeight}` and set minimum card height ~420px to accommodate hero stat (~80px) + stats footer (~48px)

**Files to change:**
- `src/components/chart/report-chart.tsx` (~30-50 line change)
- `src/components/canvas/card-renderers/chart-renderer.tsx` (~10-15 line change)

**Effort:** 1-2 hours. No data model changes, no new components.

---

### 2. Chart Interactivity (2026-03-12) — STRATEGIC CONTEXT
**Location:** `docs/brainstorms/2026-03-12-chart-interactivity-deck-canvas-brainstorm.md`

**Forward-looking feature:** Adds hover + click behavior to deck/canvas charts.
- Deck chart cards must pass `interactive={true}` + `onDataPointClick` to `ChartRenderer`
- Pointer event fix: Apply `nodrag nopan nowheel` CSS classes to chart wrapper (same as canvas)
- New `ChartAttachment` type for chat context injection (future work)

**Relevance to current visual parity fix:** The visual parity work should anticipate that charts will soon need `interactive` mode. Ensure `ChartRenderer` is designed to accept both `interactive={true}` and `interactive={false}` without breaking the visual appearance.

---

## Solution Docs: Data & Processing Bugs

### 3. Deck Processing: Wrong SQL Context Function (2026-03-11)
**Location:** `docs/solutions/logic-errors/deck-processing-wrong-sql-context-function.md`  
**Severity:** Critical  
**Problem Type:** logic_error (hallucinated table names)

**The Bug:**
Deck processing route called `getSystemContext()` (LLM persona prompt) instead of `buildTextToSqlPrompt()` (DuckDB schema + SQL rules) when generating SQL. Gemini had no knowledge of actual table names and hallucinated plausible ones (e.g., `purchases`, `orders`, `user_behavior`).

**Key Insight — Three Functions, Different Purposes:**
```
getSystemContext(datasetId)      → "You are Sentinel, an AI analytics assistant..."
                                    (no table names, only LLM tone)
                                    USE FOR: chat responses, analysis synthesis

buildTextToSqlPrompt(datasetId)  → "TABLE: events (event_time TIMESTAMP, ...)"
                                    + "PRE-MATERIALIZED: daily_metrics, brand_metrics..."
                                    + "RULES: Output ONLY valid DuckDB SQL. LIMIT 500."
                                    USE FOR: any Gemini SQL generation
```

**Prevention Pattern:**
- When writing any route that **generates SQL**, import from `src/lib/prompts/sql.ts`
- **Code review signal:** If a route imports `getSystemContext` and also calls `executeSQL`, that's a red flag — likely using the wrong context for SQL generation

**Already Fixed:** `src/app/api/decks/process/route.ts` and `reanalyze/route.ts`

---

### 4. Deck Slides: "Chart data not found" for Conversion/Funnel Metrics (2026-03-11)
**Location:** `docs/solutions/runtime-errors/chart-data-not-found-conversion-funnel-missing-charttype.md`  
**Severity:** High  
**Problem Type:** runtime_error + logic_error (3 compounding bugs)

**Three Root Causes:**

**Bug 1: SQL generated for conversion metrics was single-column**
- Gemini generated `SELECT conversion_rate FROM ...` (one column, one row)
- `buildChartSpec()` requires ≥2 columns and returned `null`
- Slide stored `chartSpec: null` even though SQL executed successfully

**Bug 2: Reanalyze route never rebuilt chartSpec**
- `/api/decks/[id]/reanalyze` updated `data`, `commentary`, `followUps`
- Never called `buildChartSpec()` after fresh query results
- `chartSpec` remained `null` from original broken upload

**Bug 3: Reanalyze ignored SQL errors and missed datasetId**
- Called `executeSQL(slide.sql)` without `datasetId` parameter
- Ignored `result.error` before using `result.rows`
- If SQL failed, `newData` silently became `[]`

**The Fix — Three Changes:**

1. **Extract `buildChartSpec` to `src/lib/deck-chart-utils.ts`**
   - Reusable by both `process/route.ts` and `reanalyze/route.ts`
   - Correctly rejects single-column data (returns `null`)

2. **Add `chartType: string` to `Slide` interface**
   - Reanalyze route can access original chart type without re-running Gemini extraction

3. **Strengthen SQL generation prompt**
   - Explicit instruction: "Always return at least 2 columns"
   - For funnel metrics: "Use UNION ALL to return one row per funnel stage"
   - Forces Gemini to return multi-row chartable data instead of scalar ratios

4. **Fix reanalyze route:**
   ```typescript
   const result = await executeSQL(slide.sql, datasetId || DEFAULT_DATASET);  // ← datasetId
   if (result.error) {
     console.error(`[deck-reanalyze] SQL error: ${result.error}`);  // ← error check
   } else {
     newData = (result.rows ?? []).slice(0, 10) as Record<string, string | number>[];
   }
   const newChartSpec = newData.length > 0
     ? buildChartSpec(slide.chartType, newData, slide.title)  // ← rebuild
     : null;
   ```

**Key Insight — UNION ALL for Funnels:**
Single-column scalar results (e.g., `0.42` conversion rate) are valid SQL but **not chart-renderable**. The fix is upstream in the prompt, not in `buildChartSpec`. The utility correctly rejects single-column data; the prompt must produce multi-row results:

```sql
-- ❌ Scalar (not chartable):
SELECT purchase_count * 1.0 / view_count AS conversion_rate FROM ...

-- ✅ Funnel (chartable as bar):
SELECT 'view' AS stage, COUNT(*) AS users FROM events WHERE event_type='view_item'
UNION ALL SELECT 'cart' AS stage, COUNT(*) AS users FROM events WHERE event_type='add_to_cart'
UNION ALL SELECT 'purchase' AS stage, COUNT(*) AS users FROM events WHERE event_type='purchase'
```

**Already Fixed:** Both bugs implemented. Deck processing now builds charts correctly.

---

## Best Practice: Recharts Consistency (2026-02-20)
**Location:** `docs/solutions/best-practices/recharts-consistency-custom-tooltip-Forecasting-20260220.md`  
**Severity:** Medium  
**Problem Type:** best_practice (design system consistency)

**The Pattern:**
When creating a new Recharts chart, follow `src/components/chart/report-chart.tsx` conventions:

1. **Wrapper:** `border border-border rounded-lg p-4 bg-card`
2. **Grid:** `strokeDasharray="3 3"` + `vertical={false}` + `className="opacity-30"`
3. **Tooltip:** `content={<CustomTooltip />}` (never `contentStyle` prop)
4. **Colors:** `#10b981` accent, `var(--color-muted-foreground)` neutrals
5. **Axes:** fontSize 11, `tickLine={false}`, YAxis `width={60}`
6. **Value formatting:** Always round with `Math.round(val * 100) / 100` before displaying

**Why This Matters:**
The Recharts `<Tooltip>` prop `contentStyle` only styles the container—it doesn't control value formatting. A custom `content` prop with a React component gives full control over both layout and rounding, preventing 14+ decimal place artifacts.

---

## Key Files & Data Structures

**ChartSpec Interface** (from `src/lib/chart-types.ts`):
```typescript
interface ChartSpec {
  chartType: string;        // "line", "bar", "pie", "area", "scatter"
  xKey: string;            // column to plot on x-axis
  yKeys: string[];         // columns to plot on y-axes
  nameKey?: string;        // optional label/category column
  valueKey?: string;       // optional for pie charts
  title: string;
  description?: string;
}
```

**Deck Slide Interface** (updated 2026-03-11):
```typescript
interface Slide {
  id: string;
  title: string;
  description?: string;
  sql: string;
  chartType: string;       // ← NEW: for reanalyze route
  chartSpec: ChartSpec | null;
  data: Record<string, string | number>[];
  commentary: string;
  followUps: string[];
  status?: "ok" | "error";
  // ...other fields
}
```

---

## Current Status & Next Steps

**Chart Visual Parity Refactor:**
- ✅ Decision doc approved (2026-03-11)
- ⏳ Implementation ready — ~1-2 hours estimated
- ⏳ Files identified: `report-chart.tsx`, `chart-renderer.tsx`

**Deck Processing:**
- ✅ All 3 bugs fixed (logic_error + runtime_error solved)
- ✅ `deck-chart-utils.ts` created (shared utility)
- ✅ Reanalyze route strengthened (error handling + chartSpec rebuild)

**Chart Interactivity (Future):**
- 📋 Brainstorm complete (2026-03-12)
- ⏳ Blocked on visual parity completion
- ⏳ Will require: pointer event fixes in deck cards, `ChartAttachment` type, chat input integration
