/**
 * Core segment generation logic — shared between the generate-all API route
 * and the upload pipeline (auto-generation on first dataset load).
 */

import { generateJson } from "@/lib/llm";
import { executeSQLInternal, validateSQL } from "@/lib/sql-executor";
import { buildSegmentGenerationPrompt } from "@/lib/prompts/segments";
import { upsertSegment, listSegments, deleteSegment } from "@/lib/server/segment-repo";
import type { SchemaMap } from "@/lib/datasets/types";

export interface SegmentGenerationResult {
  generated: number;
  failed: number;
}

/**
 * Generate starter segments for a dataset using LLM + SQL validation.
 * Replaces any previously auto-generated segments (no sourceConversationId).
 *
 * userIdField is optional — when provided, counts use COUNT(DISTINCT userIdField),
 * otherwise falls back to COUNT(*).
 */
export async function generateSegmentsForDataset(
  userId: string,
  datasetId: string,
  schemaMap: SchemaMap,
  userIdField: string | undefined,
  label: string,
): Promise<SegmentGenerationResult> {
  if (userIdField && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(userIdField)) {
    throw new Error(`Invalid userIdField: "${userIdField}"`);
  }

  const prompt = buildSegmentGenerationPrompt(schemaMap, userIdField, label);

  let candidates: { name: string; description: string; sql: string }[];
  try {
    const parsed = await generateJson<unknown>(prompt, {
      label: "segment-generator",
      timeoutMs: 120_000,
      // jsonMode forces a top-level object; wide datasets need headroom past 4096
      maxOutputTokens: 16_384,
    });
    candidates = Array.isArray(parsed)
      ? parsed
      : ((parsed && typeof parsed === "object"
          ? (Object.values(parsed).find(Array.isArray) as typeof candidates | undefined)
          : undefined) ?? []);
  } catch {
    console.warn("[segment-generator] Failed to parse LLM response");
    return { generated: 0, failed: 0 };
  }

  if (candidates.length === 0) {
    return { generated: 0, failed: 0 };
  }

  let generated = 0;
  let failed = 0;
  const VALIDATION_DEADLINE = Date.now() + 60_000;

  const validated: { name: string; description: string; sql: string; userCount: number }[] = [];

  for (const candidate of candidates.slice(0, 12)) {
    if (Date.now() > VALIDATION_DEADLINE) {
      console.warn("[segment-generator] Validation deadline exceeded — stopping early");
      break;
    }

    if (!candidate.name || !candidate.sql) {
      failed++;
      continue;
    }

    const sql = candidate.sql
      .trim()
      .replace(/^```(?:sql)?\s*/i, "")
      .replace(/\s*```$/, "")
      .replace(/\s*LIMIT\s+\d+\s*;?\s*$/i, "")
      .trim();

    const validation = validateSQL(sql);
    if (!validation.valid) {
      console.warn(`[segment-generator] SQL invalid for "${candidate.name}": ${validation.error}`);
      failed++;
      continue;
    }

    // Count: use COUNT(DISTINCT userIdField) when available, COUNT(*) otherwise
    const countExpr = userIdField
      ? `COUNT(DISTINCT ${userIdField}) AS user_count`
      : `COUNT(*) AS user_count`;

    const countResult = await executeSQLInternal(
      `SELECT ${countExpr} FROM (${sql}) _sub`,
      datasetId,
    );
    if (countResult.error) {
      console.warn(`[segment-generator] SQL failed for "${candidate.name}": ${countResult.error}`);
      failed++;
      continue;
    }
    const userCount = Number(countResult.rows[0]?.user_count ?? 0);
    if (userCount === 0) {
      failed++;
      continue;
    }

    validated.push({ name: candidate.name, description: candidate.description?.trim() ?? "", sql, userCount });
  }

  if (validated.length === 0) {
    return { generated: 0, failed };
  }

  // Clear previously auto-generated segments
  const existingSegments = listSegments(userId, datasetId);
  for (const existing of existingSegments) {
    if (!existing.sourceConversationId) {
      deleteSegment(userId, existing.id);
    }
  }

  for (const seg of validated) {
    const id = crypto.randomUUID();
    try {
      upsertSegment(userId, {
        id,
        name: seg.name,
        sql: seg.sql,
        description: seg.description,
        userCount: seg.userCount,
        datasetId,
      });
      generated++;
    } catch (err) {
      console.warn(`[segment-generator] Insert failed for "${seg.name}":`, err);
      failed++;
    }
  }

  return { generated, failed };
}
