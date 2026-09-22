import { randomUUID } from "crypto";
import { auth } from "@clerk/nextjs/server";
import { isRoleplayEnabled } from "@/features/roleplay/roleplay-datasets";
import { getAllDrafts, saveDraft, type ScenarioDraft } from "@/features/roleplay/roleplay-draft-store";
import { normalizeGroundTruthForReview } from "@/features/roleplay/roleplay-ground-truth-normalizer";

export const runtime = "nodejs";
export const maxDuration = 180;

const REVIEW_FORMAT_VERSION = 5;

/**
 * POST /api/roleplay/drafts — stash a freshly captured source document and hand
 * back an id the client can navigate to (`/training/draft/[id]`).
 */
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const datasetId = req.headers.get("x-dataset-id") || "";
  if (!isRoleplayEnabled(datasetId)) {
    return Response.json({ error: "Roleplay training is not available for this dataset" }, { status: 403 });
  }

  return Response.json({ drafts: getAllDrafts(datasetId) });
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const datasetId = req.headers.get("x-dataset-id") || "";
  if (!isRoleplayEnabled(datasetId)) {
    return Response.json({ error: "Roleplay training is not available for this dataset" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const text = String(body.text ?? "").trim();
  if (text.length < 40) {
    return Response.json({ error: "Captured text is too short to build a scenario from." }, { status: 400 });
  }

  const productLabel = String(body.productLabel ?? "").slice(0, 120);
  const source = String(body.source ?? "").slice(0, 500);
  let reviewText = text;
  let reviewFormatVersion: number | undefined;
  try {
    reviewText = await normalizeGroundTruthForReview(text, {
      datasetId,
      productLabel,
      source,
    });
    reviewFormatVersion = REVIEW_FORMAT_VERSION;
  } catch (err) {
    console.error("[roleplay/drafts] ground-truth normalization failed:", err);
  }

  const draft: ScenarioDraft = {
    id: `draft-${randomUUID().slice(0, 8)}`,
    datasetId,
    productLabel,
    source,
    sourceMode: body.sourceMode === "file" ? "file" : "url",
    text: reviewText,
    reviewNormalized: reviewText !== text,
    reviewFormatVersion,
    truncated: Boolean(body.truncated),
    createdAt: Date.now(),
  };

  saveDraft(datasetId, draft);
  return Response.json(draft);
}
