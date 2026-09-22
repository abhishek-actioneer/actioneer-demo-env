// src/lib/forecast-engine.ts
import type {
  ForecastModel, ForecastRow,
  ResolvedTable, ResolvedColumn, ResolvedCell,
} from "./forecast-types";

// --- Weekly column generation ---

const WEEK_LABEL_FMT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

/** Get Monday of the week containing `date`. */
function toMonday(d: Date): Date {
  const day = d.getUTCDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setUTCDate(mon.getUTCDate() + diff);
  mon.setUTCHours(0, 0, 0, 0);
  return mon;
}

function addWeeks(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + 7 * n);
  return r;
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

export function generateColumns(
  forecastStart: string,
  historyWeeks = 9,
  forecastWeeks = 12,
): ResolvedColumn[] {
  const start = toMonday(new Date(forecastStart + "T00:00:00Z"));
  const columns: ResolvedColumn[] = [];

  for (let i = -historyWeeks; i < forecastWeeks; i++) {
    const d = addWeeks(start, i);
    const key = dateKey(d);
    const label = WEEK_LABEL_FMT.format(d); // e.g. "7 Oct"
    columns.push({ key, label, isForecast: i >= 0 });
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

// --- Main resolve function (PURE — no store imports) ---

export function resolveTable(
  model: ForecastModel,
  seedData: Map<string, Record<string, number>>,
): ResolvedTable {
  const columns = generateColumns(
    model.forecastStart,
    model.historyWeeks,
    model.forecastWeeks,
  );
  const { order, circular } = resolveOrder(model.rows);
  const labelToId = new Map(model.rows.map((r) => [r.label, r.id]));

  const rowMap = new Map(model.rows.map((r) => [r.id, r]));
  const result: Record<string, Record<string, ResolvedCell>> = {};
  model.rows.forEach((r) => { result[r.id] = {}; });

  // Process ALL columns uniformly — for base rows, both historical and forecast
  // values come from seedData (historical from SQL, forecast from the LLM).
  // For derived rows, formulas are evaluated for every column.
  for (const col of columns) {
    for (const rowId of order) {
      const row = rowMap.get(rowId)!;
      if (circular.has(rowId)) { result[rowId][col.key] = { value: null, error: "#CIRC!" }; continue; }

      const overrideKey = `week:${col.key}`;
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

  return { columns, rows: result };
}
