import { auth } from "@clerk/nextjs/server";
import { DEFAULT_DATASET } from "@/lib/datasets";
import { getRetention, upsertRetention, deleteRetention } from "@/lib/server/retention-repo";
import { compileRetentionSQL } from "@/lib/retention-sql";
import { executeSQLInternal } from "@/lib/sql-executor";
import { getDataset } from "@/lib/datasets";
import { DAY_BUCKETS, DEFAULT_BRACKETS } from "@/lib/retention-types";
import type { RetentionConfig } from "@/lib/retention-types";

function extractD7Retention(
  rows: Record<string, unknown>[],
  config: RetentionConfig,
): number | null {
  const bucketValues = config.mode === "custom"
    ? (config.customBrackets ?? DEFAULT_BRACKETS).map((_, i) => i)
    : [...DAY_BUCKETS];

  if (!bucketValues.includes(7)) return null;

  let totalRetained = 0;
  let totalSize = 0;
  const cohortMap = new Map<string, { size: number; retained: number }>();

  for (const row of rows) {
    const date = String(row.cohort_date);
    const size = Number(row.cohort_size) || 0;
    const bucket = Number(row.day_bucket);
    const retained = Number(row.retained_users) || 0;

    if (!cohortMap.has(date)) {
      cohortMap.set(date, { size, retained: 0 });
    }
    if (bucket === 7) {
      cohortMap.get(date)!.retained = retained;
    }
  }

  for (const { size, retained } of cohortMap.values()) {
    totalRetained += retained;
    totalSize += size;
  }

  return totalSize > 0 ? Math.round((totalRetained / totalSize) * 10000) / 100 : 0;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const retention = getRetention(userId, id);
  if (!retention) {
    return Response.json({ error: "Retention not found" }, { status: 404 });
  }

  // Re-execute for fresh D7 rate
  const datasetId = retention.datasetId || req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  let d7Retention = retention.d7Retention;
  try {
    const dataset = getDataset(datasetId);
    const sql = compileRetentionSQL(retention.config, dataset);
    if (sql) {
      const result = await executeSQLInternal(sql, datasetId);
      if (!result.error && result.rows.length > 0) {
        d7Retention = extractD7Retention(
          result.rows as Record<string, unknown>[],
          retention.config,
        );

        // Update cached D7 if changed
        if (d7Retention !== retention.d7Retention) {
          upsertRetention(userId, { ...retention, d7Retention, datasetId });
        }
      }
    }
  } catch {
    // Keep cached value on error
  }

  return Response.json({ ...retention, d7Retention });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const datasetId = req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  const body = await req.json();
  const { name, description, config } = body as {
    name?: string;
    description?: string;
    config?: RetentionConfig;
  };

  const existing = getRetention(userId, id);

  // Re-execute if config changed
  let d7Retention = existing?.d7Retention ?? null;
  const finalConfig = config ?? existing?.config;
  if (config && finalConfig) {
    try {
      const dataset = getDataset(datasetId);
      const sql = compileRetentionSQL(finalConfig, dataset);
      if (sql) {
        const result = await executeSQLInternal(sql, datasetId);
        if (!result.error && result.rows.length > 0) {
          d7Retention = extractD7Retention(
            result.rows as Record<string, unknown>[],
            finalConfig,
          );
        }
      }
    } catch {
      // Keep existing D7 on error
    }
  }

  const merged = {
    id,
    name: name ?? existing?.name ?? "Untitled Retention",
    description: description ?? existing?.description,
    config: finalConfig ?? {
      startEventId: "",
      returnEventIds: [] as string[],
      mode: "on_or_after" as const,
      granularity: "daily" as const,
      dateRange: { preset: "30d" as const },
    },
    source: existing?.source ?? ("manual" as const),
    d7Retention,
    datasetId,
  };

  upsertRetention(userId, merged);
  return Response.json({ success: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  deleteRetention(userId, id);
  return Response.json({ success: true });
}
