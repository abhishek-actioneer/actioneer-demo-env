import { auth } from "@clerk/nextjs/server";
import { getSegment, updatePushStatus } from "@/lib/server/segment-repo";
import { getDatasetForUser, DEFAULT_DATASET } from "@/lib/datasets";
import { executeSQLInternal } from "@/lib/sql-executor";
import { createFileSegment, segmentAttributeKey } from "@/lib/integrations/clevertap";
import { getCleverTapConnection } from "@/lib/integrations/connections";
import { ensureSyncedToCleverTap } from "@/lib/server/clevertap-sync";
import { recordActivity } from "@/lib/server/segment-activity-repo";
import { z } from "zod/v4";

const PushSchema = z.object({ integrationId: z.string().min(1) });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const parsed = PushSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "integrationId is required" }, { status: 400 });
  }
  const { integrationId } = parsed.data;

  const segment = getSegment(userId, id);
  if (!segment) {
    return Response.json({ error: "Segment not found" }, { status: 404 });
  }

  if (integrationId === "clevertap") {
    const conn = await getCleverTapConnection(userId);
    if (!conn) {
      return Response.json(
        { error: "CleverTap not connected", code: "not_connected" },
        { status: 400 },
      );
    }

    // Force-refresh on explicit push, so re-syncing always runs the upload.
    const syncResult = await ensureSyncedToCleverTap(userId, segment, conn, req.headers.get("x-dataset-id"), {
      forceRefresh: true,
    });
    if (!syncResult.synced) {
      recordActivity(userId, id, {
        type: "push",
        status: "error",
        destination: "clevertap",
        userCount: syncResult.identityCount,
        error: syncResult.error,
      });
      return Response.json(
        { error: syncResult.error ?? "Sync failed" },
        { status: 400 },
      );
    }
    recordActivity(userId, id, {
      type: "push",
      status: "success",
      destination: "clevertap",
      userCount: syncResult.identityCount,
    });

    // Re-read segment to pull in identities for file-segment attempt (plan-gated on Trial).
    const datasetId = req.headers.get("x-dataset-id") || DEFAULT_DATASET;
    const dataset = getDatasetForUser(datasetId, userId);
    const idField = dataset?.userIdField;
    let fileSegResult: { segmentId: number | null; status: string; error?: string } = {
      segmentId: null,
      status: "skipped",
    };
    if (idField) {
      const result = await executeSQLInternal(segment.sql, datasetId);
      if (!result.error) {
        const identities: string[] = [];
        for (const row of result.rows) {
          const v = row[idField];
          if (v !== null && v !== undefined) identities.push(String(v));
        }
        if (identities.length > 0) {
          fileSegResult = await createFileSegment(conn, segment.name, identities, "Actioneer");
        }
      }
    }

    return Response.json({
      status: "synced",
      integrationId,
      totalSent: syncResult.identityCount,
      processed: syncResult.identityCount,
      unprocessed: 0,
      batches: 0,
      errors: [],
      segment: {
        created: fileSegResult.segmentId !== null && !fileSegResult.error,
        id: fileSegResult.segmentId,
        status: fileSegResult.status,
        error: fileSegResult.error,
        attributeKey: segmentAttributeKey(segment.name),
      },
    });
  }

  // Fallback mock for other integrations (firebase, bigquery).
  await new Promise((resolve) => setTimeout(resolve, 1500));
  updatePushStatus(userId, id, { ...segment.pushStatus, [integrationId]: "synced" });
  if (integrationId === "firebase" || integrationId === "bigquery") {
    recordActivity(userId, id, {
      type: "push",
      status: "success",
      destination: integrationId,
      userCount: segment.userCount,
    });
  }
  return Response.json({ status: "synced", integrationId });
}
