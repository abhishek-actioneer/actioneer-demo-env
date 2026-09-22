import { createHash } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { getDatasetForUser } from "@/lib/datasets";
import type { KnowledgeEntry } from "@/lib/knowledge-types";
import {
  deletePersistedKnowledge,
  upsertPersistedKnowledge,
} from "@/lib/server/knowledge-repo";

const EntrySchema = z.object({
  id: z.string().min(1).max(160),
  title: z.string().max(1_000).optional(),
  content: z.string().min(1),
  level: z.enum(["global", "user"]),
  category: z.enum([
    "Data validation",
    "External benchmark",
    "Insight",
    "Reporting",
    "Segment",
    "Visualisation",
    "Metric",
    "Metric range",
  ]),
  priority: z.enum(["Critical", "High", "Good to have"]),
  source: z.enum(["thread", "manual", "paste-import", "website", "auto-generated"]),
  dateAdded: z.string().min(1),
  addedBy: z.string().min(1).max(500),
  referenceThread: z.string().max(2_000).optional(),
  sourceConversationId: z.string().max(300).optional(),
  sourceUrl: z.string().url().max(4_000).optional(),
});

const UpsertSchema = z.object({ entries: z.array(EntrySchema).min(1).max(100) });
const DeleteSchema = z.object({ id: z.string().min(1).max(160) });

function pageId(userId: string, datasetId: string, entry: KnowledgeEntry): string {
  if (entry.source !== "website" || !entry.sourceUrl) return entry.id;
  const digest = createHash("sha256")
    .update(`${userId}\n${datasetId}\n${entry.sourceUrl}`)
    .digest("hex")
    .slice(0, 32);
  return `kb-page-${digest}`;
}

async function authorize(req: Request) {
  const { userId } = await auth();
  if (!userId) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  const datasetId = req.headers.get("x-dataset-id") || "";
  if (!datasetId) {
    return { error: Response.json({ error: "x-dataset-id header required" }, { status: 400 }) };
  }
  if (!getDatasetForUser(datasetId, userId)) {
    return { error: Response.json({ error: "Not found" }, { status: 404 }) };
  }
  return { userId, datasetId };
}

export async function POST(req: Request) {
  const access = await authorize(req);
  if ("error" in access) return access.error;

  const parsed = UpsertSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid knowledge entries" }, { status: 400 });
  }

  const entries = parsed.data.entries.map((entry) => ({
    ...entry,
    id: pageId(access.userId, access.datasetId, entry as KnowledgeEntry),
  })) as KnowledgeEntry[];
  upsertPersistedKnowledge(access.userId, access.datasetId, entries);
  return Response.json({ entries });
}

export async function DELETE(req: Request) {
  const access = await authorize(req);
  if ("error" in access) return access.error;

  const parsed = DeleteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "id is required" }, { status: 400 });
  deletePersistedKnowledge(access.userId, access.datasetId, parsed.data.id);
  return Response.json({ deleted: true });
}
