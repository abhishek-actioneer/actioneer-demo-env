import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { DEFAULT_DATASET } from "@/lib/datasets/constants";
import { getDataset } from "@/lib/datasets";
import {
  isSampleTestCustomerError,
  sampleTestCustomer,
} from "@/lib/server/voice-customer-context-repo";

const Schema = z.object({
  datasetId: z.string().min(1).max(64).optional(),
  segmentSql: z.string().max(8000).optional(),
});

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = Schema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
  }

  const datasetId = parsed.data.datasetId ?? DEFAULT_DATASET;
  const segmentSql = parsed.data.segmentSql;

  let userIdField: string | undefined;
  let entityTable: string | undefined;
  try {
    const dataset = getDataset(datasetId);
    userIdField = dataset.userIdField;
    entityTable = dataset.entityTable ?? dataset.primaryTable;
  } catch {
    return Response.json({ error: `Unknown dataset: ${datasetId}` }, { status: 400 });
  }

  try {
    const sampled = await sampleTestCustomer(datasetId, segmentSql, userIdField, entityTable);
    if (!sampled) {
      return Response.json(
        { error: "No customers found in this segment", code: "segment_empty" },
        { status: 404 },
      );
    }
    return Response.json(sampled, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (isSampleTestCustomerError(err)) {
      console.warn("[sample-customer] sampling failed", {
        datasetId,
        reason: err.reason,
        error: err.message,
      });
      return Response.json(
        { error: err.message, code: err.reason },
        { status: err.status },
      );
    }
    console.warn("[sample-customer] Failed to sample customer", { datasetId, error: (err as Error).message });
    return Response.json({ error: "Could not sample customer from dataset" }, { status: 500 });
  }
}
