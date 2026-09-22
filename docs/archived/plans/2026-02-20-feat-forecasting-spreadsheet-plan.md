# Forecasting Spreadsheet Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Linear/Runway-inspired spreadsheet page at `/forecasting` with formula engine, time-series chart, and inspect panel — using the existing design system. Near-monochrome aesthetic with one green accent.

**Architecture:** Client-side only. In-memory store (Map + ensureInitialized pattern) with seed data. Formula engine evaluates derived metrics via topological sort. Recharts chart above the table. All data resets on refresh (prototype).

**Tech Stack:** Next.js App Router · React 19 · Tailwind CSS v4 · shadcn/ui (DropdownMenu, Sheet, Popover, Badge, Button, Tooltip) · Recharts · lucide-react

**Design doc:** `docs/plans/2026-02-20-forecasting-page-design.md`

---

## Enhancement Summary

**Deepened on:** 2026-02-20
**Research agents used:** 15 (frontend-design skill, Linear/Runway patterns, Recharts docs, TypeScript review, pattern recognition, performance oracle, architecture strategist, frontend races reviewer, code simplicity reviewer, learnings researcher, Recharts minimal styling, Linear/Runway visual design, frontend design system tokens, performance review, frontend races deep review)

### Key Design Direction: Linear/Runway Monochrome
Every pixel is gray except the forecast line and the active cell ring. Typography is small, mono for numbers, and weighted precisely. Borders are barely visible. Hover states are fast and subtle. The interface recedes so the data speaks.

### Critical Fixes (from research)
1. **Replace `Function()` eval** with recursive descent parser — CSP-safe, no eval
2. **Fix `useMemo` misuse** — use `useState` lazy initializer for initial resolve
3. **Fix blur-on-escape race** — `cancelledRef` pattern prevents saving cancelled edits
4. **Auto-resolve via `useMemo`** — eliminate Apply Changes ceremony and setTimeout races
5. **Use `useRef` for cell focus** — replace `autoFocus` with ref-based focus to prevent deduplication hazard (races review)
6. **Add `will-change: transform` to sticky elements** — hint GPU layer promotion for smooth horizontal scroll (performance review)
7. **Use `lining-nums` in addition to `tabular-nums`** — ensures baseline-aligned digits in all column contexts (design research)
8. **Parentheses for negative numbers** — `(1,234)` instead of `-1,234` per financial convention (Runway research)

### Simplifications Applied
1. **Month-only grain** — removed W/D support (no seed data exists)
2. **Removed `column-context-menu.tsx`** — 1 menu item not worth a file
3. **Removed `series-picker.tsx`** — row-level chart toggles are sufficient
4. **Removed CSV export** — premature for prototype
5. **Removed `playbook`/`manual` forecast methods** — only `trailing_avg` implemented
6. **Simplified dependency resolver** — recursive resolve instead of Kahn's algorithm
7. **Auto-resolve replaces Apply Changes** — `useMemo` instead of setTimeout pattern
8. **Deferred keyboard navigation** — click/double-click sufficient for prototype

### Architecture Improvements
1. **Pure engine** — `resolveTable(model, seedData)` with no store import
2. **Discriminated union** for `ForecastRow` (base vs derived)
3. **Plain `Record`** instead of `Map` for `ResolvedTable.rows`
4. **Renamed `TimeGrain` → `ForecastGrain`** to avoid collision with `metric-types.ts`
5. **Component dir: `forecast/`** (singular, matching `metric/`, `canvas/`, `scout/`)

---

## Design System: Linear/Runway Monochrome Aesthetic

### Research Insights

**Key Pattern:** Linear's design cuts back on color — monochrome with one bold accent. Every weight and size increment earns its place. The table is the hero — it must feel like a financial terminal, not a web app.

### Color Strategy (add to `globals.css`)

Near-total monochrome. One accent: forecast green. Everything else is grayscale.

```css
/* Forecasting page tokens — :root (light) */
:root {
  --fc-bg: oklch(0.98 0 0);
  --fc-surface: oklch(1 0 0);
  --fc-surface-raised: oklch(0.96 0 0);
  --fc-surface-sunken: oklch(0.95 0 0);
  --fc-border: oklch(0 0 0 / 6%);
  --fc-border-strong: oklch(0 0 0 / 12%);
  --fc-text-primary: oklch(0.15 0 0);
  --fc-text-secondary: oklch(0.50 0 0);
  --fc-text-tertiary: oklch(0.70 0 0);
  --fc-accent: oklch(0.45 0.15 155);
  --fc-accent-muted: oklch(0.45 0.15 155 / 12%);
  --fc-accent-subtle: oklch(0.45 0.15 155 / 5%);
}

.dark {
  --fc-bg: oklch(0.13 0 0);
  --fc-surface: oklch(0.17 0 0);
  --fc-surface-raised: oklch(0.20 0 0);
  --fc-surface-sunken: oklch(0.11 0 0);
  --fc-border: oklch(1 0 0 / 6%);
  --fc-border-strong: oklch(1 0 0 / 12%);
  --fc-text-primary: oklch(0.93 0 0);
  --fc-text-secondary: oklch(0.55 0 0);
  --fc-text-tertiary: oklch(0.40 0 0);
  --fc-accent: oklch(0.72 0.17 155);
  --fc-accent-muted: oklch(0.72 0.17 155 / 15%);
  --fc-accent-subtle: oklch(0.72 0.17 155 / 8%);
}
```

**Color rules:**
- **Chart lines:** Historical lines use `--fc-text-secondary` (gray). Forecast uses `--fc-accent`. Multiple series use opacity stepping of gray.
- **No colored badges.** Status dots: green (on track), gray (flat), warm-gray (declining). Dot is 6px.
- **Selection highlight:** `--fc-accent-subtle` (8% opacity), not blue.
- **Never use hardcoded hex** — all colors via `style={{}}` with CSS variables (per codebase convention).

### Typography

| Role | Size | Weight | Font | Letter-spacing |
|------|------|--------|------|---------------|
| Page title | 13px | 500 | Inter | 0.01em |
| Section label | 11px | 600 | Inter | 0.06em, uppercase |
| Column header | 11px | 500 | Geist Mono | 0.04em |
| Cell value (numbers) | 13px | 400 | Geist Mono | -0.01em |
| Cell value (labels) | 13px | 400/600 | Inter | 0em |
| Toolbar button | 12px | 500 | Inter | 0.02em |
| Badge | 10px | 600 | Inter | 0.05em |

**Critical:** All numbers use Geist Mono with `font-variant-numeric: tabular-nums lining-nums`. `tabular-nums` ensures equal-width digits for vertical alignment; `lining-nums` ensures digits sit on the baseline (not old-style descenders). This is what makes it feel like Runway.

### Table Cell Styling

- **Row height:** 32px (compact, Linear-density)
- **Cell padding:** 12px horizontal, centered vertically
- **No visible cell borders by default.** Only `border-bottom: 1px solid var(--fc-border)` for row separators.
- **Active cell:** `box-shadow: inset 0 0 0 1.5px var(--fc-accent)` — no border shift.
- **Row hover:** `background: var(--fc-surface-raised)`, transition 80ms ease.
- **Sticky header:** `backdrop-filter: blur(8px)` with subtle bottom border.
- **Sticky elements:** Add `will-change: transform` to all sticky cells (header, left column, right actions). This hints the browser to promote them to GPU layers upfront, avoiding costly layer promotion during horizontal scroll. (performance review)
- **Negative numbers:** Use parentheses `(1,234)` instead of minus `-1,234` — standard FP&A/financial convention. (Runway research)

### Focus Ring Strategy (design system research)

- **In table:** `box-shadow: inset 0 0 0 1.5px var(--fc-accent)` — no `outline` (extends outside and overlaps neighbors).
- **Outside table** (toolbar, inputs): `outline: 1.5px solid var(--fc-accent); outline-offset: -1.5px`.
- **Avoid `#4ade80`** (Tailwind emerald-400) — too saturated. Use `oklch(0.72 0.17 155)` which is perceptually similar but more controlled.

### Toolbar & Buttons

- **Ghost style:** 28px height, 5px border-radius, transparent bg, `--fc-text-secondary` text.
- **Hover:** bg `--fc-surface-raised`, text `--fc-text-primary`.
- **No bright colored buttons.** Primary action uses `--fc-accent-muted` bg with `--fc-accent` text.

### Micro-interactions

- **Universal transition:** 80ms ease on background, color, opacity, box-shadow.
- **Cell edit activation:** 0ms — instant focus ring (no fade).
- **Panel open:** 150ms ease-out translateX(8px) reveal.
- **No bounces, no springs, no overshooting easing curves.**
- **Formula recalculation loading:** Affected cells dim to `opacity: 0.4` for 200ms, then snap back with new value. No spinner, no skeleton. (design system research)
- **Keyboard navigation:** 0ms — focus ring jumps instantly. `scrollIntoView({ block: "nearest", behavior: "instant" })`. Instant is professional. (design system research)

### Animations (add to `globals.css`)

```css
@keyframes fc-panel-reveal {
  from { opacity: 0; transform: translateX(8px); }
  to { opacity: 1; transform: translateX(0); }
}
.animate-fc-panel-reveal { animation: fc-panel-reveal 150ms ease-out; }

@keyframes fc-skeleton-pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}
.animate-fc-skeleton { animation: fc-skeleton-pulse 1.5s ease-in-out infinite; }
```

### Scrollbar Styling

```css
.fc-scroll {
  scrollbar-width: thin;
  scrollbar-color: var(--fc-border-strong) transparent;
}
.fc-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
.fc-scroll::-webkit-scrollbar-thumb { background: var(--fc-border-strong); border-radius: 3px; }
.fc-scroll::-webkit-scrollbar-track { background: transparent; }
```

---

## Key Conventions (from repo research)

| Pattern | Convention | Reference |
|---------|-----------|-----------|
| Store | `Map<string, T>` + `ensureInitialized()` + separate `-data.ts` seed file | `src/lib/metric-store.ts` |
| Page shell | `"use client"` + `flex flex-col h-full min-w-0` outer + `max-w-6xl mx-auto px-6 py-8` content | `src/app/metrics/page.tsx` |
| Sidebar | HoverPanel union → getActivePage → pageToPanel → RailIcon → Panel component (7-point checklist) | `src/components/sidebar.tsx:55-316` |
| Reactivity | Version counter in sidebar-context (`forecastVersion` + `notifyForecastChanged`) | `src/components/sidebar-context.tsx` |
| Charts | Recharts with CSS variable colors, custom tooltip, `ResponsiveContainer` | `src/components/chart/report-chart.tsx` |
| Context menus | `DropdownMenu` (not ContextMenu — not installed). `stopPropagation()` pattern | `src/components/segments/segment-card.tsx:44-60` |
| Sheet | Controlled `open`/`onOpenChange`, `side="right"` | `src/components/store/transaction-detail-sheet.tsx` |
| Types | Union types first → interfaces → constants. Separate `-types.ts` file | `src/lib/metric-types.ts` |
| Styling | CSS variables via `style={{}}` for dynamic colors. Never `bg-[var(--x)]` in Tailwind. Use `--muted-foreground` not `--color-muted-foreground` | MEMORY.md |
| Animations | `.animate-slide-in` (translateX), `.animate-fade-in-up` (translateY) available | `src/app/globals.css:147-200` |
| Component dir | Singular/short form: `forecast/` not `forecasting/` | `metric/`, `canvas/`, `scout/` |

## Edge Case Decisions (from SpecFlow analysis)

| Edge case | Decision |
|-----------|----------|
| Persistence | In-memory only (prototype). Seed data reloads on refresh. |
| Circular formula deps | Detect during recursive resolve. Show `#CIRC!` in affected cells. |
| Division by zero | Show `—` (em dash) in cell. |
| Formula refs deleted row | Show `#REF!` in cell. Do not block deletion — warn in confirm dialog. |
| Duplicate row names | Enforce uniqueness on creation (append number if duplicate). |
| Overrides | Keyed by `month:{dateKey}` (month-only grain). |
| Empty state | Always seed with default model. "Add Metric" button always visible at table bottom. |
| First-visit discoverability | Subtle tooltip on first row's grip handle: "Right-click for options". |
| Max rows/columns | No hard limit. Table is small enough to not need virtualization (prototype). |
| Chart dual axis | Series picker only — user picks same-unit metrics to display together. No dual axis. |
| Undo/redo | Out of scope (per design doc). |

---

## Phase 1: Foundation (Types + Store + Seed Data + Design Tokens)

### Task 1: Add design tokens to globals.css

**Files:**
- Modify: `src/app/globals.css`

**Step 1:** Add the `--fc-*` CSS custom properties (listed above in Design System section) to both `:root` and `.dark` blocks.

**Step 2:** Add the forecast animations (`.animate-fc-panel-reveal`, `.animate-fc-skeleton`).

**Step 3:** Add the `.fc-scroll` scrollbar styles.

**Step 4: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(forecasting): add monochrome design tokens and animations"
```

---

### Task 2: Create forecast type definitions

**Files:**
- Create: `src/lib/forecast-types.ts`

### Research Insights

**TypeScript Review Finding:** Use a discriminated union for `ForecastRow` to make invalid states unrepresentable. When `type === "derived"`, `formula` is required (not optional). This eliminates every `row.type === "derived" && row.formula` guard in the engine.

**Pattern Recognition Finding:** Rename `TimeGrain` to `ForecastGrain` to avoid collision with the existing `TimeGrain` in `metric-types.ts`.

**Step 1: Create the types file**

```typescript
// src/lib/forecast-types.ts

export type ForecastGrain = "month"; // month-only for prototype
export type CellFormat = "currency" | "percent" | "number";

// Discriminated union — formula is required for derived, absent for base
interface ForecastRowCommon {
  id: string;
  label: string;
  indent: number;
  format: CellFormat;
  overrides?: Record<string, number>; // keyed by "month:{dateKey}" e.g. "month:2026-03"
  showOnChart?: boolean;
}

export interface ForecastRowBase extends ForecastRowCommon {
  type: "base";
}

export interface ForecastRowDerived extends ForecastRowCommon {
  type: "derived";
  formula: string; // required: "{Revenue} - {Cost}"
}

export type ForecastRow = ForecastRowBase | ForecastRowDerived;

export interface ForecastModel {
  id: string;
  name: string;
  forecastStart: string; // ISO date — historical/forecast divider
  rows: ForecastRow[];
}

/** Resolved data for rendering — computed by the engine */
export interface ResolvedColumn {
  key: string;        // e.g. "2025-11" for month grain
  label: string;      // e.g. "Nov 2025"
  isForecast: boolean;
}

export interface ResolvedCell {
  value: number | null;
  error?: "#REF!" | "#CIRC!" | "#DIV/0!";
  isOverride?: boolean;
}

export interface ResolvedTable {
  columns: ResolvedColumn[];
  /** rowId → columnKey → cell (plain object, not Map — serializable) */
  rows: Record<string, Record<string, ResolvedCell>>;
}
```

### Research Insights

**Performance Finding:** Use plain `Record` instead of `Map` for `ResolvedTable.rows`. `Map` does not serialize to JSON and requires non-null assertions (`result.get(rowId)!`) everywhere. Plain objects avoid both issues.

**Simplicity Finding:** Removed `ForecastMethod`, `forecastPlaybookId`, `FORECAST_COLORS` palette, and `FORECAST_GREEN` constant. The single forecast method (trailing average) doesn't need a type. Colors are defined via CSS variables.

**Step 2: Verify TypeScript compiles**

Run: `cd /Users/sashank/Documents/glitchcraft/repositories/baby-sentinel && npx tsc --noEmit src/lib/forecast-types.ts`

**Step 3: Commit**

```bash
git add src/lib/forecast-types.ts
git commit -m "feat(forecasting): add type definitions with discriminated union"
```

---

### Task 3: Create seed data

**Files:**
- Create: `src/lib/forecast-data.ts`

**Step 1: Create seed data file**

Seed a default model with 7 rows and 12 months (Aug 2025 – Jul 2026), forecast starting Feb 2026.

```typescript
// src/lib/forecast-data.ts
import type { ForecastModel } from "./forecast-types";

// Monthly seed values for base metrics (Aug 2025 – Jan 2026)
export const BASE_SEED_DATA: Record<string, Record<string, number>> = {
  "iap-revenue": {
    "2025-08": 85200, "2025-09": 86800, "2025-10": 88587,
    "2025-11": 89400, "2025-12": 91018, "2026-01": 94197,
  },
  "ad-revenue": {
    "2025-08": 165300, "2025-09": 167200, "2025-10": 168814,
    "2025-11": 169500, "2025-12": 170374, "2026-01": 166705,
  },
  "organic-revenue": {
    "2025-08": 58900, "2025-09": 60100, "2025-10": 61929,
    "2025-11": 62400, "2025-12": 64848, "2026-01": 72624,
  },
  "total-cost": {
    "2025-08": 117800, "2025-09": 118100, "2025-10": 119113,
    "2025-11": 119200, "2025-12": 119264, "2026-01": 118982,
  },
};

export const DEFAULT_MODEL: ForecastModel = {
  id: "default",
  name: "Revenue Forecast",
  forecastStart: "2026-02-01",
  rows: [
    { id: "total-revenue", label: "Total Revenue", type: "derived", indent: 0, format: "currency", formula: "{IAP Revenue} + {Ad Revenue} + {Organic Revenue}", showOnChart: true },
    { id: "iap-revenue", label: "IAP Revenue", type: "base", indent: 1, format: "currency" },
    { id: "ad-revenue", label: "Ad Revenue", type: "base", indent: 1, format: "currency" },
    { id: "organic-revenue", label: "Organic Revenue", type: "base", indent: 1, format: "currency" },
    { id: "total-cost", label: "Total Cost", type: "base", indent: 0, format: "currency" },
    { id: "gross-profit", label: "Gross Profit", type: "derived", indent: 0, format: "currency", formula: "{Total Revenue} - {Total Cost}", showOnChart: true },
    { id: "gross-margin", label: "Gross Margin %", type: "derived", indent: 0, format: "percent", formula: "{Gross Profit} / {Total Revenue} * 100", showOnChart: true },
  ],
};
```

**Step 2: Verify imports resolve**

Run: `npx tsc --noEmit src/lib/forecast-data.ts`

**Step 3: Commit**

```bash
git add src/lib/forecast-data.ts
git commit -m "feat(forecasting): add seed data with default revenue model"
```

---

### Task 4: Create forecast store

**Files:**
- Create: `src/lib/forecast-store.ts`

### Research Insights

**Architecture Finding:** Remove `addRow`, `removeRow`, `updateRow`, `moveRow` from the store. The page component manages model state immutably via `useState` — it creates new model objects via spread. The store only needs `getDefaultModel()`, `saveModel()`, and seed data access. The mutation functions create a trap: they mutate in-place, which conflicts with React's immutable state model.

**Step 1: Create the store** (simplified, following metric-store.ts pattern):

```typescript
// src/lib/forecast-store.ts
import type { ForecastModel } from "./forecast-types";
import { DEFAULT_MODEL, BASE_SEED_DATA } from "./forecast-data";

const modelMap = new Map<string, ForecastModel>();
const seedData = new Map<string, Record<string, number>>();
let initialized = false;

function ensureInitialized() {
  if (initialized) return;
  modelMap.set(DEFAULT_MODEL.id, structuredClone(DEFAULT_MODEL));
  for (const [rowId, data] of Object.entries(BASE_SEED_DATA)) {
    seedData.set(rowId, { ...data });
  }
  initialized = true;
}

export function getDefaultModel(): ForecastModel {
  ensureInitialized();
  const model = modelMap.get("default");
  if (!model) throw new Error("Default forecast model not found after initialization");
  return model;
}

export function saveModel(model: ForecastModel): void {
  ensureInitialized();
  modelMap.set(model.id, model);
}

export function getSeedData(rowId: string): Record<string, number> | undefined {
  ensureInitialized();
  return seedData.get(rowId);
}

export function getAllSeedData(): Map<string, Record<string, number>> {
  ensureInitialized();
  return seedData;
}

export function setSeedValue(rowId: string, timeKey: string, value: number): void {
  ensureInitialized();
  let row = seedData.get(rowId);
  if (!row) { row = {}; seedData.set(rowId, row); }
  row[timeKey] = value;
}
```

### Research Insights

**TypeScript Review Finding:** Added runtime guard on `getDefaultModel()` instead of non-null assertion (`!`). If someone refactors `ensureInitialized()` later, this produces a descriptive error instead of silent `undefined`.

**Step 2: Verify**

Run: `npx tsc --noEmit src/lib/forecast-store.ts`

**Step 3: Commit**

```bash
git add src/lib/forecast-store.ts
git commit -m "feat(forecasting): add forecast store with Map + ensureInitialized pattern"
```

---

### Task 5: Create formula engine

**Files:**
- Create: `src/lib/forecast-engine.ts`

This is the most complex piece. It needs to:
1. Generate monthly time columns for a given date range
2. Parse formula strings into metric references
3. Build dependency graph and resolve in order
4. Evaluate formulas per time column using a safe arithmetic parser (no `Function()` eval)
5. Generate forecasts (trailing average) for columns past forecastStart

### Research Insights

**CRITICAL (TypeScript Review):** Replace `Function()` eval with a recursive descent parser. `Function()` is banned by CSP policies, flagged by ESLint `no-new-func`, and creates a new function object per cell evaluation. A ~30-line stack-based evaluator handles `+`, `-`, `*`, `/`, parentheses with zero security surface.

**CRITICAL (Performance):** The trailing average implementation scans ALL prior columns per forecast cell — O(N²). Fix with a running window of last 3 values — O(N).

**Performance Finding:** Use `String.matchAll()` instead of stateful global regex with manual `lastIndex` reset.

**Performance Finding:** Cache `Intl.DateTimeFormat` formatter — creating it 360 times in `generateColumns` is expensive.

**Performance Finding:** Use `Set.has()` instead of `Array.includes()` for circular dependency detection.

**Architecture Finding:** Make `resolveTable` a pure function — pass `seedData` as parameter instead of importing from store.

**Step 1: Create the engine**

```typescript
// src/lib/forecast-engine.ts
import type {
  ForecastModel, ForecastRow, ForecastRowDerived,
  ResolvedTable, ResolvedColumn, ResolvedCell,
} from "./forecast-types";

// --- Time column generation (month-only) ---

const MONTH_FMT = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" });

export function generateColumns(
  forecastStart: string,
  historyMonths = 6,
  forecastMonths = 6,
): ResolvedColumn[] {
  const start = new Date(forecastStart);
  const columns: ResolvedColumn[] = [];

  for (let i = -historyMonths; i < forecastMonths; i++) {
    const d = new Date(start);
    d.setMonth(d.getMonth() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    columns.push({ key, label: MONTH_FMT.format(d), isForecast: i >= 0 });
  }
  return columns;
}

// --- Formula parsing ---

export function parseFormulaRefs(formula: string): string[] {
  return Array.from(formula.matchAll(/\{([^}]+)\}/g), (m) => m[1]);
}

// --- Safe arithmetic evaluator (no Function() / eval) ---

function evaluateArithmetic(expr: string): number {
  let pos = 0;

  function skipWhitespace() {
    while (pos < expr.length && expr[pos] === " ") pos++;
  }

  function parseExpression(): number {
    let result = parseTerm();
    while (pos < expr.length) {
      skipWhitespace();
      if (expr[pos] === "+") { pos++; result += parseTerm(); }
      else if (expr[pos] === "-") { pos++; result -= parseTerm(); }
      else break;
    }
    return result;
  }

  function parseTerm(): number {
    let result = parseFactor();
    while (pos < expr.length) {
      skipWhitespace();
      if (expr[pos] === "*") { pos++; result *= parseFactor(); }
      else if (expr[pos] === "/") { pos++; result /= parseFactor(); }
      else break;
    }
    return result;
  }

  function parseFactor(): number {
    skipWhitespace();
    if (expr[pos] === "(") {
      pos++;
      const result = parseExpression();
      skipWhitespace();
      if (expr[pos] === ")") pos++;
      return result;
    }
    const start = pos;
    if (expr[pos] === "-") pos++;
    while (pos < expr.length && (expr[pos] >= "0" && expr[pos] <= "9" || expr[pos] === ".")) pos++;
    return parseFloat(expr.substring(start, pos));
  }

  return parseExpression();
}

// --- Dependency resolution (simple recursive, not Kahn's) ---

function resolveOrder(rows: ForecastRow[]): { order: string[]; circular: Set<string> } {
  const labelToId = new Map(rows.map((r) => [r.label, r.id]));
  const resolved = new Set<string>();
  const order: string[] = [];
  const circular = new Set<string>();

  function resolve(row: ForecastRow, stack: Set<string>) {
    if (resolved.has(row.id)) return;
    if (stack.has(row.id)) { circular.add(row.id); return; }
    stack.add(row.id);
    if (row.type === "derived") {
      for (const ref of parseFormulaRefs(row.formula)) {
        const dep = rows.find((r) => r.label === ref);
        if (dep) resolve(dep, new Set(stack));
      }
    }
    resolved.add(row.id);
    order.push(row.id);
  }

  rows.forEach((r) => resolve(r, new Set()));
  return { order, circular };
}

// --- Formula evaluation ---

function evaluateFormula(
  formula: string,
  rowValues: Record<string, number | null>,
  labelToId: Map<string, string>,
): ResolvedCell {
  let expr = formula;
  const refs = parseFormulaRefs(formula);

  for (const label of refs) {
    const id = labelToId.get(label);
    if (!id) return { value: null, error: "#REF!" };
    const val = rowValues[id];
    if (val === null || val === undefined) return { value: null, error: "#REF!" };
    expr = expr.replace(`{${label}}`, String(val));
  }

  try {
    const result = evaluateArithmetic(expr);
    if (!isFinite(result)) return { value: null, error: "#DIV/0!" };
    return { value: result };
  } catch {
    return { value: null, error: "#REF!" };
  }
}

// --- Trailing average (with running window) ---

function trailingAverage(values: (number | null)[], periods = 3): number | null {
  const valid = values.filter((v): v is number => v !== null).slice(-periods);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

// --- Main resolve function (PURE — no store imports) ---

export function resolveTable(
  model: ForecastModel,
  seedData: Map<string, Record<string, number>>,
): ResolvedTable {
  const columns = generateColumns(model.forecastStart);
  const { order, circular } = resolveOrder(model.rows);
  const labelToId = new Map(model.rows.map((r) => [r.label, r.id]));

  const rowMap = new Map(model.rows.map((r) => [r.id, r]));
  const result: Record<string, Record<string, ResolvedCell>> = {};
  model.rows.forEach((r) => { result[r.id] = {}; });

  const historicalCols = columns.filter((c) => !c.isForecast);
  const forecastCols = columns.filter((c) => c.isForecast);

  // --- Historical columns ---
  for (const col of historicalCols) {
    for (const rowId of order) {
      const row = rowMap.get(rowId)!;
      if (circular.has(rowId)) { result[rowId][col.key] = { value: null, error: "#CIRC!" }; continue; }

      const overrideKey = `month:${col.key}`;
      if (row.overrides?.[overrideKey] !== undefined) {
        result[rowId][col.key] = { value: row.overrides[overrideKey], isOverride: true };
        continue;
      }

      if (row.type === "base") {
        const seed = seedData.get(rowId);
        result[rowId][col.key] = { value: seed?.[col.key] ?? null };
      } else {
        const colValues: Record<string, number | null> = {};
        for (const [id, cells] of Object.entries(result)) {
          colValues[id] = cells[col.key]?.value ?? null;
        }
        result[rowId][col.key] = evaluateFormula(row.formula, colValues, labelToId);
      }
    }
  }

  // --- Forecast columns (with running window for trailing avg) ---
  // Pre-compute running windows for base rows
  const recentWindows = new Map<string, (number | null)[]>();
  for (const rowId of order) {
    const row = rowMap.get(rowId)!;
    if (row.type === "base") {
      const recent = historicalCols.slice(-3).map((c) => result[rowId][c.key]?.value ?? null);
      recentWindows.set(rowId, recent);
    }
  }

  for (const col of forecastCols) {
    for (const rowId of order) {
      const row = rowMap.get(rowId)!;
      if (circular.has(rowId)) { result[rowId][col.key] = { value: null, error: "#CIRC!" }; continue; }

      const overrideKey = `month:${col.key}`;
      if (row.overrides?.[overrideKey] !== undefined) {
        result[rowId][col.key] = { value: row.overrides[overrideKey], isOverride: true };
        continue;
      }

      if (row.type === "base") {
        const window = recentWindows.get(rowId)!;
        const forecast = trailingAverage(window);
        result[rowId][col.key] = { value: forecast };
        window.push(forecast);
        if (window.length > 3) window.shift();
      } else {
        const colValues: Record<string, number | null> = {};
        for (const [id, cells] of Object.entries(result)) {
          colValues[id] = cells[col.key]?.value ?? null;
        }
        result[rowId][col.key] = evaluateFormula(row.formula, colValues, labelToId);
      }
    }
  }

  return { columns, rows: result };
}
```

**Step 2: Verify compilation**

Run: `npx tsc --noEmit src/lib/forecast-engine.ts`

**Step 3: Commit**

```bash
git add src/lib/forecast-engine.ts
git commit -m "feat(forecasting): add formula engine with safe parser, dependency graph, trailing avg"
```

---

## Phase 2: Page Shell + Sidebar Integration

### Task 6: Create the forecasting page shell

**Files:**
- Create: `src/app/forecasting/page.tsx`

### Research Insights

**CRITICAL (Races Review):** Do NOT use `useMemo` to call `setState`. Use `useState` with lazy initializer for both `model` and `resolved`. Auto-resolve via `useMemo` eliminates the Apply Changes ceremony and all associated race conditions (setTimeout, stale closure, unmount hazard).

**Architecture Finding:** `resolved` should be derived from `model` via `useMemo`, not independent `useState`. This guarantees resolved is always consistent with the model — no stale state, no synchronization problems.

**Step 1: Create a minimal page** following the exact page shell pattern:

```typescript
"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { useScrollRestore } from "@/lib/use-scroll-restore";
import { getDefaultModel, saveModel, getAllSeedData } from "@/lib/forecast-store";
import { resolveTable } from "@/lib/forecast-engine";
import type { ForecastModel } from "@/lib/forecast-types";

export default function ForecastingPage() {
  const scrollRef = useScrollRestore<HTMLElement>();
  const [model, setModel] = useState<ForecastModel>(() => getDefaultModel());

  // Auto-resolve: always consistent with model, no stale state
  const resolved = useMemo(() => resolveTable(model, getAllSeedData()), [model]);

  const [inspectRowId, setInspectRowId] = useState<string | null>(null);

  return (
    <div className="flex flex-col h-full min-w-0">
      <main ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-6 py-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1
                className="font-medium"
                style={{ fontSize: 13, letterSpacing: "0.01em", color: "var(--fc-text-primary)" }}
              >
                {model.name}
              </h1>
              <p
                className="mt-1"
                style={{ fontSize: 11, color: "var(--fc-text-secondary)" }}
              >
                {model.rows.length} metrics · Monthly
              </p>
            </div>
            {/* Toolbar placeholder — Task 8 */}
          </div>

          {/* Chart placeholder — Task 10 */}

          {/* Table placeholder — Task 7 */}
          <div
            className="rounded-lg overflow-hidden"
            style={{ border: "1px solid var(--fc-border)", background: "var(--fc-surface)" }}
          >
            <p
              className="p-8 text-center"
              style={{ fontSize: 13, color: "var(--fc-text-tertiary)" }}
            >
              Table component will render here
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
```

**Step 2: Verify the page renders**

Run: `pnpm dev` and navigate to `http://localhost:3000/forecasting`

**Step 3: Commit**

```bash
git add src/app/forecasting/page.tsx
git commit -m "feat(forecasting): add page shell with auto-resolve useMemo pattern"
```

---

### Task 7: Add forecasting to sidebar navigation

**Files:**
- Modify: `src/components/sidebar.tsx` (7 places)
- Modify: `src/components/sidebar-context.tsx` (add version counter)

### Research Insights

**Pattern Recognition Finding:** The plan MUST enumerate all 7 sidebar integration points explicitly. Missing any one causes type errors or silent rendering failures. Follow the checklist from `docs/solutions/best-practices/sidebar-panel-replacement-checklist-Sidebar-20260219.md`.

**Learnings Finding:** Sidebar panels use sync data only — no `useEffect`, no async fetches. Import store data directly.

**Step 1: Update sidebar-context.tsx**

Add to the `SidebarContextValue` interface:
```typescript
forecastVersion: number;
notifyForecastChanged: () => void;
```

Add state + callback in `SidebarProvider`:
```typescript
const [forecastVersion, setForecastVersion] = useState(0);
const notifyForecastChanged = useCallback(() => setForecastVersion((v) => v + 1), []);
```

Add both to the context value object.

**Step 2: Update sidebar.tsx** — all 7 integration points:

**A.** Add `"forecasting"` to the `HoverPanel` type union (line ~55)

**B.** Add case in `getActivePage()` (line ~57-70):
```typescript
if (pathname.startsWith("/forecasting")) return "forecasting";
```

**C.** Add case in `pageToPanel()` (line ~97-113):
```typescript
case "forecasting": return "forecasting";
```

**D.** Add import at top:
```typescript
import { TrendingUp } from "lucide-react";
```

**E.** Add `RailIcon` in the icon rail (lines ~161-238):
```typescript
<RailIcon
  icon={TrendingUp}
  label="Forecasting"
  active={activePage === "forecasting"}
  onHover={() => setHoveredItem("forecasting")}
  onClick={() => router.push("/forecasting")}
/>
```

**F.** Add panel title (lines ~267-279):
```typescript
{activePanel === "forecasting" && "Forecasting"}
```

**G.** Add panel body (lines ~298-316):
```typescript
{activePanel === "forecasting" && <ForecastingPanel />}
```

**Step 3: Create a minimal `ForecastingPanel` component** inside sidebar.tsx:

```typescript
function ForecastingPanel() {
  const router = useRouter();
  const { forecastVersion } = useSidebarContext();
  void forecastVersion;

  return (
    <>
      <div className="flex-1 overflow-y-auto px-1.5">
        <p className={SECTION_HEADER}>Models</p>
        <button onClick={() => router.push("/forecasting")} className={ITEM}>
          <span className={PRIMARY}>Revenue Forecast</span>
          <span className={SECONDARY}>7 metrics · Monthly</span>
        </button>
      </div>
      <button onClick={() => router.push("/forecasting")} className={FOOTER}>
        View All →
      </button>
    </>
  );
}
```

**Step 4: Verify sidebar shows** new icon and panel hover works

**Step 5: Commit**

```bash
git add src/components/sidebar.tsx src/components/sidebar-context.tsx
git commit -m "feat(forecasting): add sidebar navigation with 7-point integration"
```

---

## Phase 3: Core Table Component

### Task 8: Create the forecast table component

**Files:**
- Create: `src/components/forecast/forecast-table.tsx`

### Research Insights

**Design:** 32px row height, no cell borders, subtle row separators (`--fc-border`), mono font for numbers with `tabular-nums`, sticky first column with `--fc-surface` background and `backdrop-filter: blur(8px)`.

**Races Review CRITICAL:** Fix blur-on-escape race condition. Use a `cancelledRef` to prevent saving when user presses Escape. Without this, Escape triggers blur which calls `handleCellSave`, saving the value the user intended to discard.

**Races Review:** Guard table-level keyboard handler — do not process arrow navigation while a cell is being edited.

**Performance:** Active cell focus ring uses `box-shadow: inset 0 0 0 1.5px var(--fc-accent)` — no border shift.

**Step 1: Create the component** with inline cell editing (combining original Tasks 7 and 10):

```typescript
// src/components/forecast/forecast-table.tsx
"use client";

import { useState, useRef, useEffect, useCallback, Fragment } from "react";
import { Search, CircleDot, Circle, Plus } from "lucide-react";
import { RowContextMenu } from "./row-context-menu";
import type { ForecastModel, ResolvedTable, ResolvedCell, CellFormat } from "@/lib/forecast-types";

interface ForecastTableProps {
  model: ForecastModel;
  resolved: ResolvedTable;
  onModelChange: React.Dispatch<React.SetStateAction<ForecastModel>>;
  onInspectRow: (rowId: string) => void;
}

function formatCell(cell: ResolvedCell | undefined, format: CellFormat): string {
  if (!cell || cell.error) return cell?.error ?? "—";
  if (cell.value === null) return "—";
  const v = cell.value;
  // Negative numbers use parentheses per financial convention (Runway research)
  const neg = v < 0;
  const abs = Math.abs(v);
  switch (format) {
    case "currency": {
      const formatted = abs >= 1000 ? `$${(abs / 1000).toFixed(0)}k` : `$${abs.toLocaleString()}`;
      return neg ? `(${formatted})` : formatted;
    }
    case "percent":
      return neg ? `(${abs.toFixed(1)}%)` : `${v.toFixed(1)}%`;
    case "number":
      return neg ? `(${abs.toLocaleString()})` : v.toLocaleString();
  }
}

export function ForecastTable({ model, resolved, onModelChange, onInspectRow }: ForecastTableProps) {
  const [activeCell, setActiveCell] = useState<{ rowId: string; colKey: string } | null>(null);
  const [editingCell, setEditingCell] = useState<{ rowId: string; colKey: string; value: string } | null>(null);
  const cancelledRef = useRef(false); // Prevents save on blur after Escape
  const editInputRef = useRef<HTMLInputElement>(null); // Ref-based focus (races review: avoids autoFocus deduplication hazard)

  const handleCellDoubleClick = (rowId: string, colKey: string, currentValue: number | null) => {
    setEditingCell({ rowId, colKey, value: currentValue?.toString() ?? "" });
  };

  const handleCellSave = () => {
    if (cancelledRef.current) { cancelledRef.current = false; return; }
    if (!editingCell) return;
    const numValue = parseFloat(editingCell.value);
    if (!isNaN(numValue)) {
      const overrideKey = `month:${editingCell.colKey}`;
      onModelChange((prev) => ({
        ...prev,
        rows: prev.rows.map((r) =>
          r.id === editingCell.rowId
            ? { ...r, overrides: { ...r.overrides, [overrideKey]: numValue } }
            : r
        ),
      }));
    }
    setEditingCell(null);
  };

  const handleCellKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleCellSave();
    if (e.key === "Escape") { cancelledRef.current = true; setEditingCell(null); }
  };

  // Ref-based focus instead of autoFocus — avoids deduplication hazard (races review)
  useEffect(() => {
    editInputRef.current?.focus();
  }, [editingCell?.rowId, editingCell?.colKey]);

  const firstForecastKey = resolved.columns.find((c) => c.isForecast)?.key;

  if (!resolved) return null;

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--fc-border)", background: "var(--fc-surface)" }}>
      {/* Scrollable table wrapper */}
      <div className="overflow-x-auto fc-scroll">
        <table className="w-full border-collapse" tabIndex={0}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--fc-border)" }}>
              <th
                className="sticky left-0 z-10 px-3 text-left"
                style={{
                  background: "var(--fc-surface)", minWidth: 200, height: 28,
                  fontSize: 11, fontWeight: 500, letterSpacing: "0.04em",
                  color: "var(--fc-text-secondary)", fontFamily: "var(--font-geist-mono)",
                  willChange: "transform", // GPU layer hint for smooth scroll (performance review)
                }}
              >
                Metric
              </th>
              {resolved.columns.map((col) => (
                <th
                  key={col.key}
                  className="px-3 text-right whitespace-nowrap"
                  style={{
                    height: 28, fontSize: 11, fontWeight: 500,
                    letterSpacing: "0.04em", minWidth: 100,
                    color: col.isForecast ? "var(--fc-accent)" : "var(--fc-text-secondary)",
                    fontFamily: "var(--font-geist-mono)",
                    borderLeft: col.key === firstForecastKey ? "2px solid var(--fc-accent)" : undefined,
                  }}
                >
                  {col.label}
                </th>
              ))}
              <th className="sticky right-0 z-10 w-16" style={{ background: "var(--fc-surface)", willChange: "transform" }} />
            </tr>
          </thead>
          <tbody>
            {model.rows.map((row) => {
              const cells = resolved.rows[row.id];
              const isTopLevel = row.indent === 0;

              return (
                <tr
                  key={row.id}
                  className="group"
                  style={{ borderBottom: "1px solid var(--fc-border)", transition: "background 80ms ease" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--fc-surface-raised)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ""; }}
                >
                  {/* Sticky metric label */}
                  <td
                    className="sticky left-0 z-10 px-3"
                    style={{
                      background: "var(--fc-surface)", height: 32,
                      paddingLeft: `${12 + row.indent * 24}px`,
                      willChange: "transform", // GPU layer hint (performance review)
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <RowContextMenu row={row} onModelChange={onModelChange} modelRows={model.rows} />
                      <span
                        style={{
                          fontSize: 13, fontWeight: isTopLevel ? 600 : 400,
                          color: "var(--fc-text-primary)",
                        }}
                      >
                        {row.label}
                      </span>
                    </div>
                  </td>

                  {/* Data cells */}
                  {resolved.columns.map((col) => {
                    const cell = cells?.[col.key];
                    const isActive = activeCell?.rowId === row.id && activeCell?.colKey === col.key;
                    const isEditing = editingCell?.rowId === row.id && editingCell?.colKey === col.key;

                    return (
                      <td
                        key={col.key}
                        className="px-3 text-right cursor-pointer"
                        style={{
                          height: 32,
                          color: col.isForecast ? "var(--fc-accent)" : "var(--fc-text-primary)",
                          fontFamily: "var(--font-geist-mono)",
                          fontSize: 13, fontVariantNumeric: "tabular-nums lining-nums",
                          boxShadow: isActive ? "inset 0 0 0 1.5px var(--fc-accent)" : undefined,
                          borderLeft: col.key === firstForecastKey ? "2px solid var(--fc-accent)" : undefined,
                        }}
                        onClick={() => setActiveCell({ rowId: row.id, colKey: col.key })}
                      >
                        {isEditing ? (
                          <input
                            ref={editInputRef}
                            type="text"
                            value={editingCell.value}
                            onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
                            onBlur={handleCellSave}
                            onKeyDown={handleCellKeyDown}
                            className="w-full bg-transparent text-right outline-none"
                            style={{ fontSize: 13, fontFamily: "var(--font-geist-mono)" }}
                          />
                        ) : (
                          <span
                            className="relative"
                            onDoubleClick={() => handleCellDoubleClick(row.id, col.key, cell?.value ?? null)}
                          >
                            {cell?.error ? (
                              <span style={{ color: "var(--fc-text-tertiary)", fontSize: 11, fontFamily: "var(--font-geist-mono)" }}>{cell.error}</span>
                            ) : (
                              formatCell(cell, row.format)
                            )}
                            {cell?.isOverride && (
                              <span
                                className="absolute -top-0.5 -right-1.5 w-1.5 h-1.5 rounded-full"
                                style={{ background: "var(--fc-accent)" }}
                              />
                            )}
                          </span>
                        )}
                      </td>
                    );
                  })}

                  {/* Actions column */}
                  <td className="sticky right-0 z-10 px-2" style={{ background: "var(--fc-surface)", height: 32, willChange: "transform" }}>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100" style={{ transition: "opacity 80ms ease" }}>
                      <button
                        className="p-1 rounded"
                        style={{ transition: "background 80ms ease" }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--fc-surface-raised)"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ""; }}
                        onClick={() => {
                          onModelChange((prev) => ({
                            ...prev,
                            rows: prev.rows.map((r) =>
                              r.id === row.id ? { ...r, showOnChart: !r.showOnChart } : r
                            ),
                          }));
                        }}
                        title={row.showOnChart ? "Hide from chart" : "Show on chart"}
                      >
                        {row.showOnChart
                          ? <CircleDot className="w-3.5 h-3.5" style={{ color: "var(--fc-accent)" }} />
                          : <Circle className="w-3.5 h-3.5" style={{ color: "var(--fc-text-tertiary)" }} />
                        }
                      </button>
                      <button
                        className="p-1 rounded"
                        style={{ transition: "background 80ms ease" }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--fc-surface-raised)"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ""; }}
                        onClick={() => onInspectRow(row.id)}
                        title="Inspect metric"
                      >
                        <Search className="w-3.5 h-3.5" style={{ color: "var(--fc-text-tertiary)" }} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add Metric button */}
      <div className="px-4 py-3" style={{ borderTop: "1px solid var(--fc-border)" }}>
        <button
          onClick={() => {
            onModelChange((prev) => ({
              ...prev,
              rows: [...prev.rows, {
                id: crypto.randomUUID(),
                label: `New Metric ${prev.rows.length + 1}`,
                type: "base" as const,
                indent: 0,
                format: "number" as const,
              }],
            }));
          }}
          className="flex items-center gap-1.5"
          style={{ fontSize: 13, color: "var(--fc-text-tertiary)", transition: "color 80ms ease" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--fc-text-primary)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--fc-text-tertiary)"; }}
        >
          <Plus className="w-4 h-4" /> Add Metric
        </button>
      </div>
    </div>
  );
}
```

### Research Insights

**Races Review:** The `onModelChange` prop is typed as `React.Dispatch<React.SetStateAction<ForecastModel>>` to support functional updaters. This prevents the "last write wins" race when multiple operations fire in the same event loop tick — each reads from the latest state.

**Performance:** `will-change: transform` should be added to sticky elements for smoother horizontal scroll compositing.

**Step 2: Wire it into the page** — replace the table placeholder in `page.tsx`.

**Step 3: Verify the table renders** with seed data.

**Step 4: Commit**

```bash
git add src/components/forecast/forecast-table.tsx src/app/forecasting/page.tsx
git commit -m "feat(forecasting): add core spreadsheet table with monochrome styling"
```

---

### Task 9: Add row context menu

**Files:**
- Create: `src/components/forecast/row-context-menu.tsx`

Use the existing `DropdownMenu` component. Trigger via MoreVertical three-dot button on hover (not right-click — matching codebase convention).

**Step 1: Create the context menu component**

```typescript
// src/components/forecast/row-context-menu.tsx
"use client";

import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, Indent, Outdent, Copy, Trash2, MoreVertical } from "lucide-react";
import type { ForecastModel, ForecastRow } from "@/lib/forecast-types";

interface RowContextMenuProps {
  row: ForecastRow;
  modelRows: ForecastRow[];
  onModelChange: React.Dispatch<React.SetStateAction<ForecastModel>>;
}

export function RowContextMenu({ row, modelRows, onModelChange }: RowContextMenuProps) {
  const insertRow = (position: "above" | "below") => {
    onModelChange((prev) => {
      const idx = prev.rows.findIndex((r) => r.id === row.id);
      const newRow: ForecastRow = {
        id: crypto.randomUUID(), label: "New Metric", type: "base", indent: 0, format: "number",
      };
      const rows = [...prev.rows];
      rows.splice(position === "above" ? idx : idx + 1, 0, newRow);
      return { ...prev, rows };
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        onClick={(e) => e.stopPropagation()}
        className="p-0.5 rounded opacity-0 group-hover:opacity-100"
        style={{ transition: "opacity 80ms ease" }}
      >
        <MoreVertical className="w-3.5 h-3.5" style={{ color: "var(--fc-text-tertiary)" }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuItem onClick={() => insertRow("above")}>
          <Plus className="w-4 h-4 mr-2" /> Insert Above
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => insertRow("below")}>
          <Plus className="w-4 h-4 mr-2" /> Insert Below
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => onModelChange((prev) => ({
            ...prev, rows: prev.rows.map((r) => r.id === row.id ? { ...r, indent: Math.min(3, r.indent + 1) } : r),
          }))}
          disabled={row.indent >= 3}
        >
          <Indent className="w-4 h-4 mr-2" /> Indent
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onModelChange((prev) => ({
            ...prev, rows: prev.rows.map((r) => r.id === row.id ? { ...r, indent: Math.max(0, r.indent - 1) } : r),
          }))}
          disabled={row.indent === 0}
        >
          <Outdent className="w-4 h-4 mr-2" /> Outdent
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onModelChange((prev) => ({
          ...prev, rows: [...prev.rows.slice(0, prev.rows.findIndex((r) => r.id === row.id) + 1),
            { ...row, id: crypto.randomUUID(), label: `${row.label} (Copy)` },
            ...prev.rows.slice(prev.rows.findIndex((r) => r.id === row.id) + 1)],
        }))}>
          <Copy className="w-4 h-4 mr-2" /> Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onModelChange((prev) => ({ ...prev, rows: prev.rows.filter((r) => r.id !== row.id) }))}
          className="text-red-600"
        >
          <Trash2 className="w-4 h-4 mr-2" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

**Step 2: Verify** context menu operations work.

**Step 3: Commit**

```bash
git add src/components/forecast/row-context-menu.tsx
git commit -m "feat(forecasting): add row context menu with insert, indent, duplicate, delete"
```

---

## Phase 4: Chart

### Task 10: Create the forecast chart component

**Files:**
- Create: `src/components/forecast/forecast-chart.tsx`

### Research Insights

**Design:** Near-monochrome chart. No fills, no gradients, no dots by default. Thin lines (1.5px), muted grid (horizontal only, `--fc-border`), minimal axis labels in mono. Historical lines in gray, forecast in green dashed. Vertical reference line at forecast divider.

**Recharts Findings:** `ReferenceLine` accepts `x`, `stroke`, `strokeDasharray`, `strokeWidth` as SVG passthrough props. Custom tooltip uses `contentStyle` object. Recharts may not resolve CSS variables in SVG `stroke`/`fill` — use computed values via `getComputedStyle` if needed.

**Performance:** Wrap in `React.memo`. Memoize `splitData` with `useMemo`. Use `<Fragment key={}>` instead of `<>` for Line pairs. (performance review)

**Recharts Styling (from Recharts research agent):**
- `interval="preserveStartEnd"` on XAxis — prevents label crowding by only showing first/last ticks
- `allowDecimals={false}` on YAxis — cleaner K-formatted tick labels
- Tooltip cursor should be dashed vertical line (`strokeDasharray: "4 4"`), not solid
- `activeDot` should have `stroke: "var(--fc-surface)"` background ring for contrast
- Animation: 500ms `ease-out`, stagger multi-line entries with `animationBegin={i * 150}`
- Stay with raw Recharts 3.7.0 — Tremor wraps it but removes low-level access needed for forecast lines
- CSS var resolution: Recharts SVG elements may not resolve CSS vars in some cases — if colors break, use `getComputedStyle(document.documentElement).getPropertyValue('--fc-accent')` and cache in a ref

**Step 1: Create the chart component**

```typescript
// src/components/forecast/forecast-chart.tsx
"use client";

import { useMemo, Fragment } from "react";
import React from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";
import type { ForecastModel, ResolvedTable } from "@/lib/forecast-types";

interface ForecastChartProps {
  model: ForecastModel;
  resolved: ResolvedTable;
}

// Gray palette for multi-series (opacity stepping)
const GRAY_SHADES = ["oklch(0.55 0 0)", "oklch(0.40 0 0)", "oklch(0.30 0 0)"];

export const ForecastChart = React.memo(function ForecastChart({ model, resolved }: ForecastChartProps) {
  const visibleRows = model.rows.filter((r) => r.showOnChart);

  const dividerIdx = resolved.columns.findIndex((c) => c.isForecast);

  const splitData = useMemo(() => {
    return resolved.columns.map((col, i) => {
      const point: Record<string, string | number | null> = { label: col.label };
      visibleRows.forEach((row) => {
        const val = resolved.rows[row.id]?.[col.key]?.value ?? null;
        if (!col.isForecast) {
          point[`${row.id}_hist`] = val;
          point[`${row.id}_fc`] = null;
          // Bridge point at boundary
          if (i === dividerIdx - 1) {
            // Next iteration will set fc
          }
        } else {
          point[`${row.id}_fc`] = val;
          // Continuity: include last historical value at boundary
          if (i === dividerIdx) {
            const prevCol = resolved.columns[i - 1];
            point[`${row.id}_hist`] = resolved.rows[row.id]?.[prevCol?.key]?.value ?? null;
          } else {
            point[`${row.id}_hist`] = null;
          }
        }
      });
      return point;
    });
  }, [resolved, visibleRows, dividerIdx]);

  if (visibleRows.length === 0) {
    return (
      <div
        className="rounded-lg p-8 mb-6 text-center"
        style={{
          border: "1px solid var(--fc-border)", background: "var(--fc-surface-sunken)",
          fontSize: 13, color: "var(--fc-text-tertiary)",
        }}
      >
        No metrics selected for chart. Toggle the chart icon on a row to add it.
      </div>
    );
  }

  return (
    <div
      className="rounded-lg mb-6"
      style={{
        border: "1px solid var(--fc-border)", background: "var(--fc-surface-sunken)",
        padding: "16px 12px 8px 0",
      }}
    >
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={splitData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid
            stroke="var(--fc-border)"
            horizontal={true}
            vertical={false}
          />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: "var(--fc-text-tertiary)", fontFamily: "var(--font-geist-mono)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--fc-border-strong)" }}
            interval="preserveStartEnd" // only show first/last on crowded axes (Recharts research)
          />
          <YAxis
            tick={{ fontSize: 10, fill: "var(--fc-text-tertiary)", fontFamily: "var(--font-geist-mono)" }}
            tickLine={false}
            axisLine={false}
            width={48}
            allowDecimals={false} // cleaner tick labels (Recharts research)
            tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
          />
          <Tooltip
            contentStyle={{
              background: "var(--fc-surface)",
              border: "1px solid var(--fc-border-strong)",
              borderRadius: 6,
              padding: "8px 12px",
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
              fontSize: 12,
              fontFamily: "var(--font-geist-mono)",
            }}
            labelStyle={{ color: "var(--fc-text-secondary)", fontSize: 10, marginBottom: 4 }}
            cursor={{ stroke: "var(--fc-border-strong)", strokeWidth: 1, strokeDasharray: "4 4" }} // dashed vertical cursor (Recharts research)
          />
          {dividerIdx >= 0 && (
            <ReferenceLine
              x={resolved.columns[dividerIdx].label}
              stroke="var(--fc-accent)"
              strokeDasharray="4 4"
              strokeWidth={1}
            />
          )}
          {visibleRows.map((row, i) => {
            const grayColor = GRAY_SHADES[i % GRAY_SHADES.length];
            return (
              <Fragment key={row.id}>
                <Line
                  type="monotone"
                  dataKey={`${row.id}_hist`}
                  stroke={grayColor}
                  strokeWidth={1.5}
                  dot={false}
                  connectNulls={false}
                  name={row.label}
                  activeDot={{ r: 3, fill: grayColor, stroke: "var(--fc-surface)", strokeWidth: 2 }}
                  animationDuration={500}
                  animationEasing="ease-out"
                  animationBegin={i * 150} // staggered multi-line animation (Recharts research)
                />
                <Line
                  type="monotone"
                  dataKey={`${row.id}_fc`}
                  stroke="var(--fc-accent)"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  dot={false}
                  connectNulls={false}
                  name={`${row.label} (forecast)`}
                  legendType="none"
                  activeDot={{ r: 3, fill: "var(--fc-accent)", stroke: "var(--fc-surface)", strokeWidth: 2 }}
                  animationDuration={500}
                  animationEasing="ease-out"
                  animationBegin={i * 150 + 75} // offset from historical line
                />
              </Fragment>
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
});
```

**Step 2: Wire into page** — add above the table.

**Step 3: Verify** chart renders with solid gray historical / dashed green forecast.

**Step 4: Commit**

```bash
git add src/components/forecast/forecast-chart.tsx src/app/forecasting/page.tsx
git commit -m "feat(forecasting): add monochrome chart with gray/green historical-forecast split"
```

---

## Phase 5: Inspect Panel

### Task 11: Create the inspect panel

**Files:**
- Create: `src/components/forecast/inspect-panel.tsx`
- Modify: `src/app/forecasting/page.tsx`

### Research Insights

**Design:** Like Linear's issue detail sidebar. Dense, scannable, organized into labeled sections. No cards within cards — flat hierarchy with subtle dividers. 320px width, `--fc-surface` background, `--fc-border` left border, `animate-fc-panel-reveal` animation.

**Simplicity Finding:** Removed playbook section (not implemented). Removed manual/playbook method descriptions. Only show formula info for derived metrics, data source for base metrics.

**Step 1: Create the inspect panel**

```typescript
// src/components/forecast/inspect-panel.tsx
"use client";

import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Calculator, Database, ArrowRight } from "lucide-react";
import type { ForecastRow, ForecastModel } from "@/lib/forecast-types";
import { parseFormulaRefs } from "@/lib/forecast-engine";

interface InspectPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: ForecastRow | null;
  model: ForecastModel;
}

export function InspectPanel({ open, onOpenChange, row, model }: InspectPanelProps) {
  if (!row) return null;

  const formulaRefs = row.type === "derived" ? parseFormulaRefs(row.formula) : [];
  const referencedRows = formulaRefs
    .map((label) => model.rows.find((r) => r.label === label))
    .filter(Boolean);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[320px] sm:max-w-[320px] overflow-y-auto animate-fc-panel-reveal">
        {/* Header */}
        <div className="pb-4" style={{ borderBottom: "1px solid var(--fc-border)" }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--fc-text-primary)" }}>{row.label}</h3>
          <div className="flex items-center gap-2 mt-2">
            <span
              className="rounded px-1.5 py-0.5"
              style={{
                fontSize: 10, fontWeight: 600, letterSpacing: "0.05em",
                background: "var(--fc-surface-raised)", color: "var(--fc-text-secondary)",
              }}
            >
              {row.type === "base" ? "BASE" : "DERIVED"}
            </span>
            <span
              className="rounded px-1.5 py-0.5"
              style={{
                fontSize: 10, fontWeight: 600, letterSpacing: "0.05em",
                background: "var(--fc-surface-raised)", color: "var(--fc-text-secondary)",
              }}
            >
              {row.format.toUpperCase()}
            </span>
          </div>
        </div>

        {/* Formula section (derived only) */}
        {row.type === "derived" && (
          <div className="py-4" style={{ borderBottom: "1px solid var(--fc-border)" }}>
            <div className="flex items-center gap-2 mb-3" style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", color: "var(--fc-text-tertiary)", textTransform: "uppercase" as const }}>
              <Calculator className="w-4 h-4" /> Formula
            </div>
            <code
              className="block px-3 py-2 rounded-md"
              style={{
                background: "var(--fc-surface-sunken)", fontSize: 12,
                fontFamily: "var(--font-geist-mono)", color: "var(--fc-text-primary)",
              }}
            >
              {row.formula}
            </code>
            {referencedRows.length > 0 && (
              <div className="mt-3">
                <p style={{ fontSize: 11, color: "var(--fc-text-tertiary)", marginBottom: 8 }}>Dependencies:</p>
                <div className="flex flex-col gap-1.5">
                  {referencedRows.map((ref) => (
                    <div key={ref!.id} className="flex items-center gap-2" style={{ fontSize: 13 }}>
                      <ArrowRight className="w-3 h-3" style={{ color: "var(--fc-text-tertiary)" }} />
                      <span style={{ color: "var(--fc-text-primary)" }}>{ref!.label}</span>
                      <span
                        className="rounded px-1 py-0.5"
                        style={{ fontSize: 10, background: "var(--fc-surface-raised)", color: "var(--fc-text-secondary)" }}
                      >
                        {ref!.type}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Data source (base only) */}
        {row.type === "base" && (
          <div className="py-4" style={{ borderBottom: "1px solid var(--fc-border)" }}>
            <div className="flex items-center gap-2 mb-3" style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", color: "var(--fc-text-tertiary)", textTransform: "uppercase" as const }}>
              <Database className="w-4 h-4" /> Data Source
            </div>
            <p style={{ fontSize: 13, color: "var(--fc-text-secondary)" }}>
              Pre-seeded monthly values. Forecast uses trailing 3-period average.
            </p>
          </div>
        )}

        {/* Forecast method */}
        <div className="py-4">
          <div className="mb-3" style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", color: "var(--fc-text-tertiary)", textTransform: "uppercase" as const }}>
            Forecast Method
          </div>
          <p style={{ fontSize: 13, color: "var(--fc-text-secondary)" }}>
            Trailing 3-period average. Each forecasted period uses the average of the 3 most recent known values.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

**Step 2: Wire into page.**

**Step 3: Commit**

```bash
git add src/components/forecast/inspect-panel.tsx src/app/forecasting/page.tsx
git commit -m "feat(forecasting): add inspect panel with formula details and dependencies"
```

---

## Phase 6: Final Assembly + Polish

### Task 12: Wire everything together in the page

**Files:**
- Modify: `src/app/forecasting/page.tsx`

Ensure the full page has:
1. Header with title + subtitle
2. Chart above the table
3. Table with all interactions (inline editing, context menus, chart toggles)
4. Inspect panel
5. All imports correctly wired

**Step 1: Finalize the page** with all imports and state:

```typescript
import { ForecastTable } from "@/components/forecast/forecast-table";
import { ForecastChart } from "@/components/forecast/forecast-chart";
import { InspectPanel } from "@/components/forecast/inspect-panel";
```

**Step 2: Use `max-w-6xl`** for the content area.

**Step 3: Verify** full flow: page loads → seed data → chart + table → edit cells → inspect panel.

**Step 4: Commit**

```bash
git add src/app/forecasting/page.tsx
git commit -m "feat(forecasting): finalize page assembly with all components wired"
```

---

### Task 13: Run build verification

**Step 1: Run lint**

```bash
pnpm lint
```

Fix any issues.

**Step 2: Run build**

```bash
pnpm build
```

Fix any TypeScript or build errors.

**Step 3: Manual verification checklist**

- [ ] Page loads at `/forecasting` with seed data
- [ ] Chart shows default metrics in monochrome gray with green forecast
- [ ] Vertical green reference line at forecast divider
- [ ] Table shows 7 rows with correct indentation
- [ ] Historical columns in primary text, forecast columns in green accent
- [ ] Green vertical divider between historical and forecast columns
- [ ] 32px row height, mono font for numbers with tabular-nums alignment
- [ ] Double-click cell → inline edit → Enter saves override
- [ ] Escape discards edit (does NOT save — blur-on-escape bug fixed)
- [ ] Override cells show green dot indicator
- [ ] Row context menu: insert, indent/outdent, duplicate, delete
- [ ] Chart toggle (circle icon) shows/hides series
- [ ] Inspect panel opens with formula/data source info
- [ ] Sidebar shows Forecasting icon + hover panel
- [ ] Dark mode tokens work correctly (all `--fc-*` variables)
- [ ] No hardcoded hex colors in components
- [ ] Scrollbar styling matches design (`fc-scroll` class)
- [ ] All transitions are 80ms (fast, not sluggish)

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix(forecasting): build and lint fixes"
```

---

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `src/app/globals.css` | Modify | Add `--fc-*` design tokens, animations, scrollbar styles |
| `src/lib/forecast-types.ts` | Create | Discriminated union types, ResolvedTable with plain Record |
| `src/lib/forecast-data.ts` | Create | Seed data for default model |
| `src/lib/forecast-store.ts` | Create | In-memory Map store (read + save only, no mutation helpers) |
| `src/lib/forecast-engine.ts` | Create | Safe arithmetic parser, recursive resolver, trailing avg with running window |
| `src/app/forecasting/page.tsx` | Create | Page shell with auto-resolve `useMemo` pattern |
| `src/components/forecast/forecast-table.tsx` | Create | Core spreadsheet table with inline editing + blur-on-escape fix |
| `src/components/forecast/forecast-chart.tsx` | Create | Monochrome Recharts chart (gray hist, green forecast) |
| `src/components/forecast/inspect-panel.tsx` | Create | Sheet panel for metric provenance |
| `src/components/forecast/row-context-menu.tsx` | Create | DropdownMenu for row operations |
| `src/components/sidebar.tsx` | Modify | Add forecasting nav item + panel (7-point integration) |
| `src/components/sidebar-context.tsx` | Modify | Add forecastVersion counter |

### Files Removed vs Original Plan
- ~~`src/components/forecasting/forecast-toolbar.tsx`~~ — toolbar inlined into page (just a title + subtitle)
- ~~`src/components/forecasting/series-picker.tsx`~~ — row-level chart toggles are sufficient
- ~~`src/components/forecasting/column-context-menu.tsx`~~ — 1 menu item not worth a file

---

## Performance Notes

| Concern | Resolution | Source |
|---------|------------|--------|
| `Function()` eval per cell | Replaced with recursive descent parser (~30 lines, zero security surface) | TypeScript review |
| Trailing avg O(N²) | Running window O(N) — push/shift last 3 values | Performance review |
| `useMemo` side effect | `useState` lazy initializer for initial state; `useMemo` for derived resolved | Races review |
| Stale state race (setTimeout) | Eliminated — auto-resolve via `useMemo` | Races review |
| Blur-on-escape saving | `cancelledRef` pattern prevents save after Escape | Races review |
| `autoFocus` deduplication | Ref-based focus via `useEffect` + `editInputRef` | Races review |
| Chart re-render | `React.memo` + `useMemo` on splitData | Performance review |
| Stateful global regex | `String.matchAll()` — no shared mutable state | Performance review |
| `Intl.DateTimeFormat` in loop | Cached as module-level constant | Performance review |
| `Array.includes()` for cycles | `Set.has()` via recursive resolve with stack set | Performance review |
| Sticky scroll compositing | `will-change: transform` on all sticky cells (header, left, right) | Performance review |
| Recharts CSS var resolution | SVG `stroke`/`fill` may not resolve CSS vars — use `getComputedStyle()` if needed | Recharts research |
| Number alignment | `font-variant-numeric: tabular-nums lining-nums` — equal-width + baseline digits | Design research |

### Deferred Optimizations (not needed for prototype, but documented)

| Optimization | When to Apply | Effort | Source |
|-------------|---------------|--------|--------|
| Row-level `React.memo` | If table exceeds ~20 rows or daily grain is added | 20 min | Performance review |
| Row/column index lookup Maps | If keyboard navigation is added (currently deferred) | 10 min | Performance review |
| Separate `chartVisibility` from model | If chart toggle causes table re-render lag | 15 min | Performance review |
| `useTransition` for resolve | If resolve computation exceeds 16ms (daily grain) | 10 min | Performance review |
| Column virtualization | If daily grain is added (360+ columns) | 1-2 hrs | Performance review |
| Formula compilation (once per row) | If row count exceeds 15+ with daily grain | 30 min | Performance review |

## References

### Design & Visual Patterns
- [How we redesigned the Linear UI (part II)](https://linear.app/now/how-we-redesigned-the-linear-ui) — Linear's official design blog, LCH color system
- [Linear Design Trend (LogRocket)](https://blog.logrocket.com/ux-design/linear-design/) — Linear's monochrome aesthetic analysis
- [Linear Style (community index)](https://linear.style/) — Community-contributed color tokens
- [Budget vs. Actuals — Runway Docs](https://docs.runway.com/guides/modeling/bva) — Runway official financial modeling docs
- [Runway Collaborative Financial Modeling](https://runway.com/product/modeling) — Runway product page, layout patterns
- [Show HN: Causal 2.0](https://news.ycombinator.com/item?id=39755858) — Causal launch discussion, inspector patterns
- [Data Table UX Patterns (Pencil & Paper)](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables) — Enterprise table density specs
- [Web Typography: Tables (A List Apart)](https://alistapart.com/article/web-typography-tables/) — Table typography guide
- [font-variant-numeric (MDN)](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/font-variant-numeric) — `tabular-nums lining-nums`
- [Historical vs. Actual vs. Forecast (SumProduct)](https://sumproduct.com/thought/historical-vs-actual-vs-forecast/) — Financial model color/formatting conventions

### Recharts
- [Recharts API: Line](https://recharts.github.io/en-US/api/Line/) — animation, strokeDasharray props
- [Recharts API: ReferenceLine](https://recharts.github.io/en-US/api/ReferenceLine/) — vertical divider props
- [Recharts API: CartesianGrid](https://recharts.github.io/en-US/api/CartesianGrid/) — grid styling
- [Recharts Customization Guide](https://recharts.github.io/en-US/guide/customize/) — tooltip, axis configuration
- [shadcn/ui Recharts v3 PR](https://github.com/shadcn-ui/ui/pull/8486) — compatibility reference

### Codebase Solutions
- [Sidebar Panel Checklist](docs/solutions/best-practices/sidebar-panel-replacement-checklist-Sidebar-20260219.md) — 7-point integration
- [Hydration Mismatch Fix](docs/solutions/ui-bugs/hydration-mismatch-localstorage-usestate-Sidebar-20260218.md) — SSR safety
- [Tailwind v4 @source glob](docs/solutions/build-errors/tailwind-v4-source-not-glob-pattern-20260219.md) — exclusion syntax
- [Dark Mode CSS Variables](docs/solutions/best-practices/canvas-dark-mode-centralized-theming-bypass-20260219.md) — theming pattern
