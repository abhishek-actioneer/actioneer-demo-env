import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { DEFAULT_DATASET, getDataset, getDatasetForUser } from "@/lib/datasets";
import { executeSQLInternal } from "@/lib/sql-executor";
import { compileSegmentSQL } from "@/lib/segment-compiler";
import type { SegmentBuilderConfig } from "@/lib/segment-builder-types";
import { safeStringify } from "@/lib/safe-stringify";

type RulePreviewCount = { ruleId: string; count: number | null; error?: string };

const PropertyFilterSchema = z.object({
  property: z.string(),
  operator: z.enum(["eq", "neq", "gt", "lt", "gte", "lte", "contains", "in", "not_in"]),
  value: z.union([z.string(), z.number(), z.array(z.string())]),
});

const OccurrenceSchema = z.object({
  op: z.enum(["gte", "gt", "eq", "lte", "lt"]),
  value: z.number(),
});

const EventRuleSchema = z.object({
  id: z.string(),
  kind: z.literal("event"),
  eventId: z.string(),
  action: z.enum(["did", "did_not"]),
  occurrence: OccurrenceSchema.optional(),
  filters: z.array(PropertyFilterSchema).optional(),
});

const AttributeRuleSchema = z.object({
  id: z.string(),
  kind: z.literal("attribute"),
  filter: PropertyFilterSchema,
});

const ConfigSchema = z.object({
  rules: z.array(z.union([EventRuleSchema, AttributeRuleSchema])),
  combinator: z.enum(["AND", "OR"]),
  dateRange: z.union([
    z.object({ preset: z.enum(["7d", "30d", "60d", "90d", "1y"]) }),
    z.object({ start: z.string(), end: z.string() }),
    z.object({ preset: z.literal("all") }),
  ]),
});

const BodySchema = z.object({
  config: ConfigSchema,
});

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const json = await req.json();
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid config", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const config = parsed.data.config as SegmentBuilderConfig;

  const datasetId = req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  if (!getDatasetForUser(datasetId, userId)) {
    return Response.json({ error: "Dataset not found" }, { status: 404 });
  }
  const dataset = getDataset(datasetId);

  const compiled = compileSegmentSQL(config, dataset);
  if (!compiled) {
    return new Response(
      safeStringify({ sql: null, count: null, ruleCounts: [], warnings: ["Add a rule to see matching users."] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  const { sql, warnings } = compiled;

  const countResult = await executeSQLInternal(
    `SELECT COUNT(*) AS cnt FROM (${sql}) __preview`,
    datasetId,
  );

  const ruleCounts: RulePreviewCount[] = await Promise.all(
    config.rules.map(async (rule) => {
      const singleRule =
        rule.kind === "event" && rule.action === "did_not"
          ? { ...rule, action: "did" as const }
          : rule;
      const singleCompiled = compileSegmentSQL(
        { ...config, combinator: "AND", rules: [singleRule] },
        dataset,
      );
      if (!singleCompiled) return { ruleId: rule.id, count: null };

      const result = await executeSQLInternal(
        `SELECT COUNT(*) AS cnt FROM (${singleCompiled.sql}) __rule_preview`,
        datasetId,
      );
      if (result.error) return { ruleId: rule.id, count: null, error: result.error };
      return { ruleId: rule.id, count: Number(result.rows[0]?.cnt ?? 0) };
    }),
  );

  if (countResult.error) {
    return Response.json(
      { sql, count: null, ruleCounts, warnings, error: countResult.error },
      { status: 400 },
    );
  }

  const count = Number(countResult.rows[0]?.cnt ?? 0);

  return new Response(
    safeStringify({ sql, count, ruleCounts, warnings }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}
