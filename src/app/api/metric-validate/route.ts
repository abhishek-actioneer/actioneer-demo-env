import { executeSQLInternal, validateSQL } from "@/lib/sql-executor";
import { DEFAULT_DATASET } from "@/lib/datasets";

export async function POST(req: Request) {
  const datasetId = req.headers.get("x-dataset-id") || DEFAULT_DATASET;

  let body: { timeSeriesSql: string; valueSql?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { timeSeriesSql, valueSql } = body;
  if (!timeSeriesSql) {
    return Response.json({ error: "timeSeriesSql is required" }, { status: 400 });
  }

  // Validate SQL safety (SELECT-only)
  const tsCheck = validateSQL(timeSeriesSql);
  if (!tsCheck.valid) {
    return Response.json({
      sqlValid: false,
      sqlErrors: { timeSeriesSql: tsCheck.error, valueSql: null },
      computedValue: null,
      timeSeries: [],
    });
  }

  if (valueSql) {
    const valCheck = validateSQL(valueSql);
    if (!valCheck.valid) {
      return Response.json({
        sqlValid: false,
        sqlErrors: { valueSql: valCheck.error, timeSeriesSql: null },
        computedValue: null,
        timeSeries: [],
      });
    }
  }

  // Execute time series SQL
  let computedValue: number | null = null;
  let timeSeries: { date: string; value: number }[] = [];
  let timeSeriesSqlError: string | null = null;
  let valueSqlError: string | null = null;

  const tsResult = await executeSQLInternal(timeSeriesSql, datasetId);
  if (tsResult.error) {
    timeSeriesSqlError = tsResult.error;
  } else {
    timeSeries = tsResult.rows.map((row) => ({
      date: String(row.date),
      value: typeof row.value === "number" ? row.value : Number(row.value) || 0,
    }));
    // Derive value from latest point if no valueSql provided
    if (!valueSql && timeSeries.length > 0) {
      computedValue = timeSeries[timeSeries.length - 1].value;
    }
  }

  // Execute valueSql if provided
  if (valueSql) {
    const valResult = await executeSQLInternal(valueSql, datasetId);
    if (valResult.error) {
      valueSqlError = valResult.error;
    } else if (valResult.rows.length > 0) {
      const raw = valResult.rows[0].value;
      computedValue = typeof raw === "number" ? raw : Number(raw) || 0;
    }
  }

  const sqlValid = !timeSeriesSqlError && !valueSqlError;

  return Response.json({
    sqlValid,
    sqlErrors: { valueSql: valueSqlError, timeSeriesSql: timeSeriesSqlError },
    computedValue,
    timeSeries,
  });
}
