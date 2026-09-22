import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getDataset, getDatasetForUser } from "@/lib/datasets";
import { executeSQLInternal, validateSQL } from "@/lib/sql-executor";
import { safeStringify } from "@/lib/safe-stringify";
import { compileSegmentTimeSeriesSQL } from "@/lib/segment-compiler";
import type { SegmentBuilderConfig, SegmentRule } from "@/lib/segment-builder-types";

const DATE_RANGE_PRESET_DAYS = {
  "7d": 7,
  "30d": 30,
  "60d": 60,
  "90d": 90,
  "1y": 365,
} as const;

type OverviewDateRange = { start: string; end: string } | { preset: "all" | keyof typeof DATE_RANGE_PRESET_DAYS };
type ResolvedDateRange = { start: string; end: string };

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await params;
    const datasetId = req.headers.get("x-dataset-id") || undefined;
    if (!datasetId) {
      return NextResponse.json({ error: "Missing x-dataset-id" }, { status: 400 });
    }
    if (!getDatasetForUser(datasetId, userId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const dataset = getDataset(datasetId);
    const body = await req.json();
    const segmentSQL: string = (body.sql as string)?.trim().replace(/;+\s*$/, "");
    const breakdown = typeof body.breakdown === "string" && body.breakdown.trim()
      ? body.breakdown.trim()
      : undefined;
    const dateRange = resolveOverviewDateRange(body.dateRange, dataset);
    const visualConfig = parseSegmentBuilderConfig(body.config);
    const bucketedTrend = visualConfig ? usesBucketedPresetTrend(visualConfig.dateRange) : false;

    if (!segmentSQL) {
      return NextResponse.json({ error: "Segment SQL required" }, { status: 400 });
    }

    const validation = validateSQL(segmentSQL);
    if (!validation.valid) {
      return NextResponse.json({ error: `Invalid segment SQL: ${validation.error}` }, { status: 400 });
    }

    const source = inferSegmentOverviewSource(dataset, {
      primaryTable: dataset.primaryTable,
      userIdField: dataset.userIdField,
      dateField: dataset.dateField,
    }, segmentSQL);
    const segmentShape = await executeSQLInternal(
      `SELECT * FROM (${segmentSQL}) __segment_shape LIMIT 0`,
      datasetId,
    );
    const segmentUserIdField = inferSegmentUserIdField(segmentShape.columns, source.userIdField);
    const segmentDateField = inferSegmentDateField(segmentShape.columns, source.dateField);
    const sourceDateWindow = source.dateField ? dateWindowSQL(source.dateField, dateRange) : "";
    const segmentDateWindow = segmentDateField ? dateWindowSQL(segmentDateField, dateRange) : "";

    // 1. Current user/entity count. Segment SQL can return extra columns for
    // explainability, so project the entity id when it is present.
    const countResult = await executeSQLInternal(
      segmentUserIdField
        ? `SELECT COUNT(DISTINCT ${q(segmentUserIdField)}) AS cnt
           FROM (${segmentSQL}) __segment
           WHERE ${q(segmentUserIdField)} IS NOT NULL`
        : `SELECT COUNT(*) AS cnt FROM (${segmentSQL}) __segment`,
      datasetId,
    );

    // 2. Size over time. Prefer dates returned by the segment query itself;
    // fall back to the inferred source table when the segment is only an id set.
    let sizeOverTimeResult: { rows: Record<string, unknown>[]; error?: string } = { rows: [] };
    const ruleTimeSeries = visualConfig
      ? compileSegmentTimeSeriesSQL(visualConfig, dataset, breakdown)
      : null;
    if (ruleTimeSeries) {
      sizeOverTimeResult = await executeSQLInternal(ruleTimeSeries.sql, datasetId);
    } else if (breakdown && source.userIdField && source.dateField) {
      sizeOverTimeResult = await executeSQLInternal(
        `SELECT DATE_TRUNC('week', TRY_CAST(${q(source.dateField)} AS TIMESTAMP))::DATE AS period,
                COALESCE(CAST(${q(breakdown)} AS VARCHAR), '(empty)') AS breakdown,
                COUNT(DISTINCT ${q(source.userIdField)}) AS count
         FROM ${q(source.table)}
         WHERE ${q(source.userIdField)} IN (
             SELECT DISTINCT ${q(segmentUserIdField ?? "user_id")}
             FROM (${segmentSQL}) __segment_members
             WHERE ${q(segmentUserIdField ?? "user_id")} IS NOT NULL
           )
           AND TRY_CAST(${q(source.dateField)} AS TIMESTAMP) IS NOT NULL
           ${sourceDateWindow}
         GROUP BY 1, 2
         ORDER BY 1, 3 DESC`,
        datasetId,
      );
    } else if (segmentUserIdField && segmentDateField) {
      sizeOverTimeResult = await executeSQLInternal(
        `SELECT DATE_TRUNC('week', TRY_CAST(${q(segmentDateField)} AS TIMESTAMP))::DATE AS period,
                COUNT(DISTINCT ${q(segmentUserIdField)}) AS count
         FROM (${segmentSQL}) __segment
         WHERE ${q(segmentUserIdField)} IS NOT NULL
           AND TRY_CAST(${q(segmentDateField)} AS TIMESTAMP) IS NOT NULL
           ${segmentDateWindow}
         GROUP BY 1
         ORDER BY 1`,
        datasetId,
      );
    } else if (source.userIdField && source.dateField && segmentUserIdField) {
      sizeOverTimeResult = await executeSQLInternal(
        `SELECT DATE_TRUNC('week', TRY_CAST(${q(source.dateField)} AS TIMESTAMP))::DATE AS period,
                COUNT(DISTINCT ${q(source.userIdField)}) AS count
         FROM ${q(source.table)}
         WHERE ${q(source.userIdField)} IN (
             SELECT DISTINCT ${q(segmentUserIdField)}
             FROM (${segmentSQL}) __segment_members
             WHERE ${q(segmentUserIdField)} IS NOT NULL
           )
           AND TRY_CAST(${q(source.dateField)} AS TIMESTAMP) IS NOT NULL
           ${sourceDateWindow}
         GROUP BY 1
         ORDER BY 1`,
        datasetId,
      );
    }

    // 3. Total users/entities — use userIdField if available, else total row count
    const allUsersCountResult = await executeSQLInternal(
      source.userIdField
        ? `SELECT COUNT(DISTINCT ${q(source.userIdField)}) AS cnt FROM ${q(source.table)}`
        : `SELECT COUNT(*) AS cnt FROM ${q(source.table)}`,
      datasetId,
    );

    const userCount = Number(countResult.rows[0]?.cnt) || 0;
    const allUsersCount = Number(allUsersCountResult.rows[0]?.cnt) || 0;


    // Size over time
    const sizeOverTime = (sizeOverTimeResult.rows ?? []).map((r) => ({
      period: String(r.period),
      count: Number(r.count) || 0,
      ...(r.breakdown !== undefined ? { breakdown: String(r.breakdown) } : {}),
    }));

    // Growth: compare first half vs second half of size data
    let growthPct = 0;
    if (sizeOverTime.length >= 4) {
      const mid = Math.floor(sizeOverTime.length / 2);
      const firstHalf = sizeOverTime.slice(0, mid).reduce((s, r) => s + r.count, 0) / mid;
      const secondHalf = sizeOverTime.slice(mid).reduce((s, r) => s + r.count, 0) / (sizeOverTime.length - mid);
      growthPct = firstHalf > 0 ? Math.round(((secondHalf - firstHalf) / firstHalf) * 100) : 0;
    }

    // vs All Users comparison
    const vsAllUsers = [
      {
        metric: "Users",
        segment: userCount,
        allUsers: allUsersCount,
        diff: allUsersCount > 0 ? `${Math.round((userCount / allUsersCount) * 100)}% of total` : "—",
      },
    ];

    // vs Previous periods (use size over time data)
    const vsPreviousPeriod: { metric: string; now: number; d30: number; d60: number; d90: number }[] = [];
    if (sizeOverTime.length > 0) {
      const latest = sizeOverTime[sizeOverTime.length - 1]?.count ?? 0;
      const d30 = sizeOverTime[Math.max(0, sizeOverTime.length - 5)]?.count ?? 0;
      const d60 = sizeOverTime[Math.max(0, sizeOverTime.length - 9)]?.count ?? 0;
      const d90 = sizeOverTime[0]?.count ?? 0;
      vsPreviousPeriod.push({
        metric: bucketedTrend ? "Weekly Users" : "Segment Size",
        now: latest,
        d30,
        d60,
        d90,
      });
    }

    const result = {
      userCount,
      growthPct,
      sizeOverTime,
      vsAllUsers,
      vsPreviousPeriod,
    };

    return new Response(safeStringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[segments/overview] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

function q(col: string): string {
  return `"${col.replace(/"/g, '""')}"`;
}

function resolveOverviewDateRange(
  raw: unknown,
  dataset: ReturnType<typeof getDataset>,
): ResolvedDateRange | null {
  if (!raw || typeof raw !== "object") return null;

  const range = raw as Partial<OverviewDateRange>;
  if ("start" in range && "end" in range) {
    if (isIsoDate(range.start) && isIsoDate(range.end)) return { start: range.start, end: range.end };
    return null;
  }

  if (!("preset" in range) || !range.preset || range.preset === "all") return null;
  if (!(range.preset in DATE_RANGE_PRESET_DAYS)) return null;

  const endDate = dataset.dateRange ? new Date(`${dataset.dateRange.end}T00:00:00Z`) : new Date();
  if (Number.isNaN(endDate.getTime())) return null;

  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - DATE_RANGE_PRESET_DAYS[range.preset]);
  return {
    start: startDate.toISOString().slice(0, 10),
    end: endDate.toISOString().slice(0, 10),
  };
}

function dateWindowSQL(column: string, dateRange: ResolvedDateRange | null): string {
  if (!dateRange) return "";
  return `AND TRY_CAST(${q(column)} AS TIMESTAMP) >= '${dateRange.start}'::TIMESTAMP
           AND TRY_CAST(${q(column)} AS TIMESTAMP) <= '${dateRange.end} 23:59:59'::TIMESTAMP`;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function usesBucketedPresetTrend(range: SegmentBuilderConfig["dateRange"]): boolean {
  return "preset" in range && range.preset !== "all";
}

function parseSegmentBuilderConfig(raw: unknown): SegmentBuilderConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<SegmentBuilderConfig>;
  if (!Array.isArray(candidate.rules)) return null;
  if (candidate.combinator !== "AND" && candidate.combinator !== "OR") return null;
  if (!candidate.dateRange || typeof candidate.dateRange !== "object") return null;

  const rules = candidate.rules.filter(isSegmentRule);
  if (rules.length !== candidate.rules.length) return null;

  return {
    rules,
    combinator: candidate.combinator,
    dateRange: candidate.dateRange as SegmentBuilderConfig["dateRange"],
  };
}

function isSegmentRule(raw: unknown): raw is SegmentRule {
  if (!raw || typeof raw !== "object") return false;
  const rule = raw as Record<string, unknown>;
  if (typeof rule.id !== "string") return false;
  if (rule.kind === "attribute") {
    return Boolean(rule.filter && typeof rule.filter === "object");
  }
  if (rule.kind === "event") {
    return typeof rule.eventId === "string" && (rule.action === "did" || rule.action === "did_not");
  }
  return false;
}

function inferSegmentOverviewSource(
  dataset: ReturnType<typeof getDataset>,
  fallback: { primaryTable: string; userIdField?: string; dateField?: string },
  segmentSQL: string,
): { table: string; userIdField?: string; dateField?: string } {
  const sql = segmentSQL.toLowerCase();
  const events = dataset.events ?? [];
  const tableDateCandidates = new Map<string, string>();
  for (const event of events) {
    if (event.dateColumn && !tableDateCandidates.has(event.table.toLowerCase())) {
      tableDateCandidates.set(event.table.toLowerCase(), event.dateColumn);
    }
  }

  const tableRefs = Array.from(sql.matchAll(/\b(?:from|join)\s+["`]?([a-zA-Z_][\w.]*)["`]?/g))
    .map((match) => match[1])
    .filter((table): table is string => Boolean(table));

  for (const table of tableRefs) {
    const dateField = tableDateCandidates.get(table.toLowerCase());
    if (dateField) {
      return { table, userIdField: fallback.userIdField, dateField };
    }
  }

  return {
    table: fallback.primaryTable,
    userIdField: fallback.userIdField,
    dateField: fallback.dateField,
  };
}

function inferSegmentUserIdField(columns: string[], preferred?: string): string | undefined {
  if (preferred) {
    const exact = findColumn(columns, preferred);
    if (exact) return exact;
  }
  if (columns.length === 1) return columns[0];
  return columns.find((column) => /(^|_)(user|customer|investor|member|account|borrower)_?id$/i.test(column));
}

function inferSegmentDateField(columns: string[], preferred?: string): string | undefined {
  if (preferred) {
    const exact = findColumn(columns, preferred);
    if (exact) return exact;
  }
  const dateLike = columns.filter((column) => /(^|_)(date|at|time|timestamp)$/i.test(column));
  return dateLike.find((column) => /^created(_date|_at)?$/i.test(column))
    ?? dateLike.find((column) => /created/i.test(column))
    ?? dateLike[0];
}

function findColumn(columns: string[], target: string): string | undefined {
  return columns.find((column) => column.toLowerCase() === target.toLowerCase());
}
