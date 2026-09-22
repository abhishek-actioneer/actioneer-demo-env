# Category Revenue Breakdown — Implementation Plan

## Goal

Replace flat default metrics with hierarchical category revenue breakdown (Revenue → Electronics/Appliances/Clothing/Furniture/Others) + AI-powered metric generation in inspect panel.

## Architecture

Revenue stays as a base row (SQL total from `daily_metrics`). Top 4 categories become base rows with indent 1, each using SQL against `events` table. "Others" is a derived row capturing the remainder. Purchases, Unique Users, Paying Users move below category block. The inspect panel gets a new "AI SQL" section for generating sourceQuery from natural language.

## Changes

### 1. Update DEFAULT_MODEL rows + BASE_SEED_DATA

**File:** `src/lib/forecast-data.ts`

New row order:
```
Revenue        (base, indent 0, daily_metrics, showOnChart: true)
  Electronics  (base, indent 1, events WHERE top_cat='electronics')
  Appliances   (base, indent 1, events WHERE top_cat='appliances')
  Clothing     (base, indent 1, events WHERE top_cat='apparel')
  Furniture    (base, indent 1, events WHERE top_cat='furniture')
  Others       (derived, indent 1, formula: {Revenue} - {Electronics} - {Appliances} - {Clothing} - {Furniture})
Purchases      (base, indent 0)
Unique Users   (base, indent 0)
Paying Users   (base, indent 0)
AOV            (derived, indent 0, {Revenue} / {Purchases})
Conversion Rate(derived, indent 0, {Purchases} / {Page Views} * 100) — REMOVE (no Page Views row)
ARPU           (derived, indent 0, {Revenue} / {Unique Users})
```

Wait — Page Views is being removed. So Conversion Rate formula breaks. Options:
- Remove Conversion Rate derived row entirely
- Replace with `{Paying Users} / {Unique Users} * 100` (paying conversion)

Decision: Replace with **Paying Conversion** = `{Paying Users} / {Unique Users} * 100` (more relevant for revenue focus).

Category SQL pattern (using events table):
```sql
SELECT DATE_TRUNC('week', event_time::TIMESTAMP) AS week,
       SUM(price) AS value
FROM events
WHERE event_type = 'purchase'
  AND SPLIT_PART(category_code, '.', 1) = 'electronics'
GROUP BY 1 ORDER BY 1
```

Note: Category names in the data use `category_code` with dot hierarchy. The top-level categories are: `electronics`, `appliances`, `apparel` (not "clothing"), `furniture`, `computers`, `auto`, `sport`, `kids`, `medicine`, `construction`, `stationery`, `country_yard`.

BASE_SEED_DATA: Generate realistic weekly values for each category. Electronics ~62% of revenue, Appliances ~12%, Apparel ~4%, Furniture ~3%, Others ~19%.

- [x] Rewrite `DEFAULT_MODEL.rows` with category hierarchy
- [x] Update `BASE_SEED_DATA` with category-level weekly values
- [x] Remove `views` row from both model and seed data
- [x] Rename "Conversion Rate" to "Paying Conversion" with new formula

### 2. New API route: `POST /api/forecast/generate-sql`

**File:** `src/app/api/forecast/generate-sql/route.ts` (new)

Takes a natural-language metric description, generates SQL using Gemini + schema context.

```
Request:  { description: string }
Response: { sql: string, label: string, format: "currency" | "percent" | "number", error?: string }
```

Prompt: Provide schema context (from `getSchemaContext()`), instruct Gemini to generate a `SELECT DATE_TRUNC('week', ...) AS week, SUM/AVG(...) AS value FROM ... GROUP BY 1 ORDER BY 1` query. Also have it infer a short label and format.

- [x] Create route file
- [x] Use `getSchemaContext()` from `src/lib/schema.ts` for prompt context
- [x] Return structured response with sql, label, format

### 3. Add AI SQL generation to inspect panel

**File:** `src/components/forecast/inspect-panel.tsx`

Add a new section for base rows (below the existing "Data Source" section):

```
── AI Metric Builder ──────────────────
[textarea: "Describe your metric in plain English..."]
[Generate SQL button]

When generating:
  → Show loading spinner
  → Display generated SQL for review
  → Show inferred label + format
  → [Confirm] / [Regenerate] buttons

On confirm:
  → Update row sourceQuery, sourceTable, label, format via onModelChange
  → Trigger data fetch for this row (need new callback prop)
```

New props needed:
- `onLoadRow?: (rowId: string) => void` — triggers seed+forecast fetch for the row after SQL is confirmed

- [x] Add `aiPrompt` local state + `generatedSql` state
- [x] Add "AI Metric Builder" section with textarea + button
- [x] Call `POST /api/forecast/generate-sql` on button click
- [x] Show generated SQL with confirm/regenerate buttons
- [x] On confirm: update row via `onModelChange` + call `onLoadRow`
- [x] Add `onLoadRow` prop to `InspectPanelProps`

### 4. Wire `onLoadRow` in page

**File:** `src/app/forecasting/page.tsx`

Pass a callback to `InspectPanel` that fetches seed data + forecast for a single row:

```typescript
const handleLoadRow = useCallback(async (rowId: string) => {
  const row = model.rows.find(r => r.id === rowId);
  if (!row || row.type !== 'base' || !row.sourceQuery) return;
  await loadRows([{ id: row.id, label: row.label, format: row.format, sourceQuery: row.sourceQuery }],
                  model.forecastWeeks ?? 12, false);
}, [model, loadRows]);
```

- [x] Create `handleLoadRow` callback
- [x] Pass to `InspectPanel` as `onLoadRow`

### 5. Update category seed data values

Generate realistic weekly seed data for the 4 categories. Based on a $505M total over ~9 weeks (~$56M/week avg):

| Category     | % of Revenue | Weekly Avg |
|-------------|-------------|------------|
| Electronics | ~62%        | ~$34.7M    |
| Appliances  | ~12%        | ~$6.7M     |
| Apparel     | ~4%         | ~$2.2M     |
| Furniture   | ~3%         | ~$1.7M     |

- [x] Add seed data entries for `electronics`, `appliances`, `apparel`, `furniture`

## Files Modified

1. `src/lib/forecast-data.ts` — New DEFAULT_MODEL rows + BASE_SEED_DATA with category values
2. `src/app/api/forecast/generate-sql/route.ts` — **new** AI SQL generation endpoint
3. `src/components/forecast/inspect-panel.tsx` — AI Metric Builder section + `onLoadRow` prop
4. `src/app/forecasting/page.tsx` — `handleLoadRow` callback, pass to InspectPanel

## Verification

1. Page loads → Revenue at indent 0, four categories at indent 1, Others derived
2. Category values + Others sum to Revenue for each week
3. Forecast columns fill via Gemini for all base rows (including categories)
4. Click "Add Metric" → new row → Inspect → type "Weekly smartphone revenue" → Generate SQL → SQL appears → Confirm → cells populate
5. Derived rows (AOV, Paying Conversion, ARPU) compute correctly
6. `pnpm build` passes
