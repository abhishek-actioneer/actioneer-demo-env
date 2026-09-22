import { auth } from "@clerk/nextjs/server";
import { executeSQL } from "@/lib/sql-executor";
import { DEFAULT_DATASET, getDatasetForUser } from "@/lib/datasets";
import { z } from "zod/v4";
import { safeStringify } from "@/lib/safe-stringify";

const CardRefreshSchema = z.object({
  id: z.string().min(1),
  sql: z.string().min(1),
});

const CanvasRefreshSchema = z.object({
  cards: z.array(CardRefreshSchema).min(1).max(50),
  datasetId: z.string().optional(),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = CanvasRefreshSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }

  const { cards, datasetId: bodyDatasetId } = parsed.data;
  const headerDatasetId = req.headers.get("x-dataset-id");
  const datasetId = bodyDatasetId || headerDatasetId || DEFAULT_DATASET;
  if (!getDatasetForUser(datasetId, userId)) return Response.json({ error: "Not found" }, { status: 404 });

  // Execute all card queries in parallel
  const settled = await Promise.allSettled(
    cards.map(async (card) => {
      const result = await executeSQL(card.sql, datasetId);
      return {
        cardId: card.id,
        data: result.rows,
        executionTimeMs: result.executionTimeMs,
        error: result.error,
      };
    })
  );

  const results = settled.map((outcome, i) => {
    if (outcome.status === "fulfilled") {
      return outcome.value;
    }
    // Promise itself rejected (unexpected — executeSQL swallows errors into result.error)
    return {
      cardId: cards[i].id,
      data: [],
      executionTimeMs: 0,
      error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
    };
  });

  return new Response(safeStringify({ results }), {
    headers: { "Content-Type": "application/json" },
  });
}
