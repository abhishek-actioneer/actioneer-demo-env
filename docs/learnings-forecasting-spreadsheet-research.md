# Forecasting Spreadsheet Page — Institutional Learnings & Patterns

> **RESEARCH ARCHIVE** — Pre-implementation research document (2026-02-20). The forecasting feature is now live at `src/app/forecasting/`. This document is preserved as a pattern reference but the actual implementation may differ from proposals here.

**Date:** 2026-02-20
**Research Scope:** Relevant patterns, gotchas, and best practices from existing codebase for building a spreadsheet page with inline editing, formulas, charts, and export
**Files Reviewed:** Canvas, Sidebar, Segment detail panel, tldraw, theming, and store pattern documentation

---

## Critical Patterns (MUST APPLY)

### 1. In-Memory `Map`-Based Store Pattern
**Source:** `src/lib/canvas-store.ts`, Memory.md
**Key Insight:** The codebase uses a simple but effective pattern for state management:

```typescript
const dataMap = new Map<string, T>();
let initialized = false;

export function ensureInitialized() {
  if (initialized) return;

  // Version check BEFORE initialized guard
  const stored = localStorage.getItem("KEY");
  const version = JSON.parse(stored || '{}').version;
  if (version !== CURRENT_VERSION) {
    // Reset/migrate
  }

  // Seed from demo data
  DEMO_ITEMS.forEach(item => dataMap.set(item.id, item));
  initialized = true;
}

export function get(id: string): T | undefined { return dataMap.get(id); }
export function getAll(): T[] { return Array.from(dataMap.values()); }
export function save(item: T) { dataMap.set(item.id, item); }
export function remove(id: string) { dataMap.delete(id); }
```

**For Spreadsheet:** Create a `spreadsheet-store.ts` with:
- `SheetRow` type containing cell data + metadata
- `Sheet` type wrapping rows + metadata (name, created, modified)
- `Map<rowId, SheetRow>` for rows
- `ensureInitialized()` with STORAGE_VERSION check before initialized guard
- Export functions: `getSheet()`, `getAllRows()`, `saveRow()`, `updateCell()`

---

### 2. Version Counter Pattern for Reactivity (Without External State Library)
**Source:** `smartstack-insight-inbox-canvas-overlay.md`, Memory.md
**Key Insight:** Use a simple `useState(0)` version counter to trigger re-renders when data changes:

```typescript
const [sheetVersion, setSheetVersion] = useState(0);

// On any mutation:
const handleCellChange = (rowId: string, colId: string, value: any) => {
  updateCell(rowId, colId, value);
  setSheetVersion(v => v + 1);  // Bump version
};

// Child components re-read store when version changes
useEffect(() => {
  const rows = getAllRows();  // Re-fetches from store
  // ... process rows
}, [sheetVersion]);  // Dependency on version
```

**For Spreadsheet:**
- Parent component manages `spreadsheetVersion` state
- All mutations bump the version via `setVersion(v => v + 1)`
- Panels (inspector, chart, export) read from store on version change
- No need for Zustand, Redux, or Jotai — the version counter is the signal

---

### 3. Three-Zone Pointer Events Model (For Interactive Content)
**Source:** `three-zone-pointer-events-canvas-card-system-20260218.md`
**Key Insight:** When embedding interactive content (cells, context menus, etc.), separate pointer event zones:

```typescript
// Zone 1: Container (pass-through)
<div pointerEvents="none">

  // Zone 2: Interactive area (toolbar, buttons)
  <div pointerEvents={isEditing ? "all" : "none"}>
    {/* toolbar, buttons, context menu triggers */}
  </div>

  // Zone 3: Content (pass-through when not editing)
  <div pointerEvents="none">
    {/* chart, data grid content */}
  </div>
</div>
```

**For Spreadsheet:**
- Table container: `pointerEvents: "none"`
- Cell input fields & context menu triggers: `pointerEvents: "all"` (when editing)
- Cell content area: `pointerEvents: "none"` (allows selection/scrolling through)

---

### 4. Theming: Use CSS Variables, NEVER Hardcoded Hex in Canvas/Interactive Areas
**Source:** `canvas-dark-mode-centralized-theming-bypass-20260219.md`
**Key Insight:** The codebase has a complete centralized theming system via shadcn/Tailwind/next-themes. Always reference CSS variables:

```css
/* In globals.css — light + dark variants exist */
:root {
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --border: oklch(0.922 0 0);
}

.dark {
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --border: oklch(1 0 0 / 10%);
}
```

**For Spreadsheet:**
- NEVER use hardcoded `#ffffff`, `#111`, `#6b7280` in inline styles
- Always: `style={{ background: "var(--card)", color: "var(--card-foreground)" }}`
- Header rows: `background: "var(--muted)"`, borders: `borderColor: "var(--border)"`
- For Recharts multi-line chart: Use Tailwind classes or computed token values (SVG may not resolve CSS vars)

---

### 5. Avoid Tailwind Arbitrary Values with CSS Variables
**Source:** `three-zone-pointer-events-canvas-card-system-20260218.md`
**Problem:** Tailwind's JIT scanner cannot evaluate CSS custom properties at build time.

```typescript
// ❌ WRONG — silently fails in production
className="bg-[var(--severity-critical)]"

// ✅ CORRECT — inline style with CSS var
style={{ background: "var(--severity-critical)" }}
```

**For Spreadsheet:**
- Severity/status colors: `style={{ background: "var(--status-error-bg)" }}`
- Don't try to use `className="bg-[var(...)]"` — it won't work in production

---

## Patterns for Table/Form Interactions

### 6. React State Hook Pattern for Prop Synchronization
**Source:** `segment-detail-panel-ux-patterns.md`
**Key Insight:** Use "adjust state during render" pattern instead of `useEffect(() => setState(...))`:

```typescript
// ❌ ESLint error + cascading renders
useEffect(() => {
  setRowData(selectedRowId);
  setEditMode(false);
}, [selectedRowId]);

// ✅ Clean — runs during render, batched re-render
const [prevRowId, setPrevRowId] = useState(selectedRowId);

if (selectedRowId !== prevRowId) {
  setPrevRowId(selectedRowId);
  setRowData(selectedRowId);
  setEditMode(false);
}
```

**For Spreadsheet Inline Editing:**
- When user selects a cell, track `prevCellId` in state
- During render, check if `cellId !== prevCellId` — if so, reset editing state, fetch cell value, set focus
- This avoids ESLint warnings + cascading renders

---

### 7. Dual-Query Pattern for Preview + Count
**Source:** `segment-detail-panel-ux-patterns.md`
**Key Insight:** For any UI showing total count + data sample, run two queries in parallel:

```typescript
const [countResult, previewResult] = await Promise.all([
  executeSQL(`SELECT COUNT(*) as cnt FROM (${sql})`),
  executeSQL(`SELECT * FROM (${sql}) LIMIT 10`),
]);
```

**For Spreadsheet:**
- If sheet includes a summary row (totals/averages):
  - Query 1: Dependency graph evaluation + formula caching
  - Query 2: Data row display (preview LIMIT if dataset is large)
- Both evaluate in parallel, summary doesn't block row display

---

### 8. Keyboard Navigation in List-Detail Layouts
**Source:** `segment-detail-panel-ux-patterns.md`
**Key Insight:** Plan keyboard nav from the start:

```typescript
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (document.activeElement instanceof HTMLInputElement) return; // Ignore if in input

    const items = document.querySelectorAll("[data-row-id]");
    const currentIndex = Array.from(items).findIndex(
      (el) => el.getAttribute("data-row-id") === selectedRowId
    );

    if (e.key === "ArrowDown") {
      const nextIndex = (currentIndex + 1) % items.length;
      const nextId = (items[nextIndex] as HTMLElement).getAttribute("data-row-id");
      selectRow(nextId);
      items[nextIndex].scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  };

  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, [selectedRowId]);
```

**For Spreadsheet:**
- Arrow up/down to navigate rows
- Arrow left/right to navigate columns
- Enter to edit cell, Escape to cancel
- Tab to next cell
- Use `data-row-id` and `data-col-id` attributes for targeting

---

## Patterns for CSV Export

### 9. Leverage Existing Export Infrastructure (If Available)
**Research Finding:** The codebase doesn't document a CSV export pattern yet, so design from first principles:

**Key Considerations:**
1. **Formula vs. Values:** Decide whether to export formula expressions or computed values
2. **Headers & Metadata:** Include column headers, sheet metadata (created, modified)
3. **Formatting:** CSV can't represent colors/styling — decide what metadata to include (e.g., severity as enum)
4. **Large Datasets:** Stream to file for >50k rows, not all in memory
5. **Browser Download:** Use `<a href="data:text/csv...">` or `fetch(blob)` pattern

**Pattern for Spreadsheet:**
```typescript
export function generateCSV(rows: SheetRow[], columns: ColumnDef[]): string {
  const headers = columns.map(c => c.label).join(",");
  const rows_csv = rows.map(row =>
    columns.map(c => {
      const value = row.cells[c.id];
      // Escape quotes, handle null
      return typeof value === "string" && value.includes(",")
        ? `"${value.replace(/"/g, '""')}"`
        : String(value ?? "");
    }).join(",")
  ).join("\n");
  return headers + "\n" + rows_csv;
}

// Download
const csv = generateCSV(rows, columns);
const blob = new Blob([csv], { type: "text/csv" });
const url = URL.createObjectURL(blob);
const a = document.createElement("a");
a.href = url;
a.download = `sheet-${Date.now()}.csv`;
a.click();
```

---

## Patterns for Context Menus & Row/Column Operations

### 10. Event Stop Propagation for Context Menu Triggers
**Source:** `tldraw-custom-shapes-canvas-rendering.md`
**Key Insight:** Context menu triggers must stop event propagation:

```typescript
<button
  onContextMenu={(e) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY);
  }}
>
  Right-click me
</button>
```

**For Spreadsheet Row/Column Context Menus:**
- Row context menu trigger: right-click on row header → stop propagation
- Column context menu trigger: right-click on column header → stop propagation
- Menu itself: `position: absolute`, rendered at page level or via portal to avoid clipping

---

### 11. Shadcn/ui Primitives for Menus
**Source:** General codebase pattern
**Key Insight:** The codebase uses shadcn/ui for all UI primitives. For context menus, likely use DropdownMenu or custom Popover:

```typescript
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";

<DropdownMenu open={open} onOpenChange={setOpen}>
  <DropdownMenuTrigger asChild>
    <button onContextMenu={(e) => { e.preventDefault(); setOpen(true); }}>...</button>
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    <DropdownMenuItem onClick={() => deleteRow(rowId)}>Delete Row</DropdownMenuItem>
    <DropdownMenuItem onClick={() => insertRowBelow(rowId)}>Insert Below</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

---

## Patterns for Inspector/Side Panel

### 12. Sidebar Split-Panel Pattern — Now Unified to 3-Tier
**Source:** `split-panel-to-sidebar-three-tier-consolidation.md`, `segment-detail-panel-ux-patterns.md`
**Key Insight:** The codebase standardized on a 3-tier pattern:
1. Sidebar hover panel (compact list, 220px)
2. Landing page (full-width table with search)
3. Detail route (full-width detail view)

**For Spreadsheet, Consider:**
- **Option A (Sidebar + Page):** Sidebar shows sheet list, clicking opens `/sheets/{id}` — detail page includes inline table + inspector panel on right
- **Option B (Canvas-Like):** Spreadsheet is main view, inspector is `position: fixed` right panel (like `CanvasConfigPanel`)
- **Option C (Embedded):** Table + inspector side-by-side in same page (no sidebar)

**Recommendation:** Start with **Option B** (embedded inspector) to keep the feature self-contained. If it grows, migrate to **Option A** later.

---

## Patterns for Recharts Multi-Line Chart

### 13. ReportChart Canvas Variant Pattern
**Source:** `tldraw-custom-shapes-canvas-rendering.md`
**Key Insight:** The codebase has a Recharts wrapper (`ReportChart`) with variants:

```typescript
<ReportChart
  spec={chartSpec}
  variant="canvas"  // ← "canvas" strips wrapper, title, margin
/>
```

**For Spreadsheet:**
- Create `FormulaChart` or `SpreadsheetChart` with two modes:
  - `variant="inline"` — embedded in spreadsheet page, fixed height (300px)
  - `variant="full"` — full-screen preview in inspector panel
- Chart data comes from formula evaluation results (not SQL like ReportChart)
- Support chart type selection: line, bar, area, pie

**Key Pattern:**
```typescript
interface ChartSpec {
  type: "line" | "bar" | "area" | "pie";
  title: string;
  data: Record<string, any>[];
  xKey: string;
  yKeys: string[];
  yLabels?: string[];
}

export function FormulaChart({ spec, variant = "inline" }: Props) {
  const height = variant === "full" ? "500px" : "300px";

  if (spec.type === "line") return <ResponsiveLineChart {...} />;
  if (spec.type === "bar") return <ResponsiveBarChart {...} />;
  // ...
}
```

---

## Gotchas & Prevention Strategies

### Gotcha 1: Dark Mode Bypass
**Problem:** Hardcoded hex colors in spreadsheet cells/headers won't respect dark mode toggle.
**Prevention:** All colors → CSS variables from the start. See pattern #4.

### Gotcha 2: Cascading Renders from useEffect + setState
**Problem:** Resetting cell editing state on selection causes 2-3 extra renders.
**Prevention:** Use "adjust state during render" pattern (see pattern #6).

### Gotcha 3: Formula Dependencies Creating Cycles
**Problem:** If formula A depends on B and B depends on A, evaluation hangs.
**Prevention:** Validate dependency graph before evaluation, reject cycles with error feedback.

### Gotcha 4: CSV Export Without Proper Escaping
**Problem:** Cells with commas or quotes corrupt CSV structure.
**Prevention:** Always escape quoted fields: `"value"` → `"""value"""` (see pattern #9).

### Gotcha 5: Large Datasets Block UI
**Problem:** Rendering 10k rows in table causes janky scrolling.
**Prevention:** Implement virtual scrolling via `tanstack/react-virtual` or similar. Consider pagination (show 50 rows/page).

### Gotcha 6: tldraw Integration (If Pinning to Canvas)
**Problem:** Spreadsheet shape won't render correctly without proper pointer events.
**Prevention:** If building a spreadsheet card for canvas, follow three-zone pointer events (pattern #3). Better: keep spreadsheet as a separate page, not a canvas shape.

---

## Recommended Architecture (High-Level)

### File Structure
```
src/
├── lib/
│   ├── spreadsheet-types.ts          # SheetRow, Sheet, Column types
│   ├── spreadsheet-store.ts          # Map-based store with ensureInitialized()
│   ├── formula-engine.ts             # Dependency graph + evaluation
│   ├── formula-parser.ts             # Parse "=A1+B2" syntax
│   └── csv-export.ts                 # generateCSV(), download()
├── components/
│   ├── spreadsheet/
│   │   ├── spreadsheet-table.tsx      # Main table component
│   │   ├── spreadsheet-cell.tsx       # Inline editable cell
│   │   ├── row-context-menu.tsx       # Delete/insert row menu
│   │   ├── column-context-menu.tsx    # Delete/insert column menu
│   │   └── cell-inspector.tsx         # Side panel showing cell details
│   └── charts/
│       └── formula-chart.tsx          # Recharts wrapper (line/bar/area/pie)
└── app/
    └── spreadsheet/
        └── page.tsx                   # Main spreadsheet page
```

### Data Flow
1. **Store** → `getAllRows()` returns rows from Map
2. **Formula Engine** → Parses formulas, builds dependency graph, evaluates in topological order
3. **Table Component** → Displays rows, cells editable inline
4. **Inspector Panel** → Shows selected cell formula, data type, dependents, chart preview
5. **Chart** → Renders multi-line chart from formula results
6. **Export** → Generates CSV with values (or formulas, configurable)

---

## Summary of Key Principles

| Principle | Why It Matters |
|-----------|----------------|
| Store pattern (Map + version counter) | Simple, performant, requires no external state library |
| CSS variables for colors | Dark mode toggles work automatically, future theme customization propagates |
| Pointer events zones | Interactive cells don't fight with table scrolling |
| Avoid useEffect for state sync | Prevents cascading renders, stays ESLint-clean |
| Keyboard navigation from the start | Power users expect arrow keys + Tab to work |
| Dependency graph before formula eval | Prevents infinite loops, enables smart caching |
| CSV escaping + format handling | Exported files are valid, importable elsewhere |

---

## Related Files in Codebase

- `src/lib/canvas-store.ts` — Reference implementation of store pattern
- `src/lib/canvas-types.ts` — Type definitions with STORAGE_VERSION pattern
- `src/app/globals.css` — Theme tokens (:root + .dark blocks)
- `src/components/canvas/chart-shape.tsx` — Recharts integration example
- `src/components/canvas/canvas-page.tsx` — Version counter + event bridge pattern
- `src/components/segment-detail-panel.tsx` — List-detail layout with keyboard nav
- `docs/solutions/best-practices/three-zone-pointer-events-canvas-card-system-20260218.md` — Full pointer events deep-dive

---

## Next Steps

1. **Design Phase:**
   - Finalize whether spreadsheet lives as a sidebar page (/sheets/[id]) or standalone canvas-like view
   - Sketch formula syntax (A1 references, operators, functions)
   - Define column types (number, text, formula, date)
   - Decide formula vs. value export in CSV

2. **Data Layer:**
   - Implement `spreadsheet-store.ts` following canvas-store pattern
   - Build `formula-parser.ts` for "=A1+B2" → AST
   - Build `formula-engine.ts` with dependency graph + topological sort

3. **UI Layer:**
   - `spreadsheet-table.tsx` with virtual scrolling (if >500 rows)
   - `spreadsheet-cell.tsx` with inline editing + keyboard nav
   - Context menus for row/column operations
   - Side inspector panel with cell details + chart preview

4. **Polish:**
   - Dark mode token integration
   - CSV export with proper escaping
   - Recharts multi-line chart from formula results
   - Keyboard shortcuts (Ctrl+S save, Ctrl+E export, etc.)
