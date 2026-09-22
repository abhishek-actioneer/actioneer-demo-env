import { auth } from "@clerk/nextjs/server";
import { isRoleplayEnabled } from "@/features/roleplay/roleplay-datasets";
import { deleteDraft, getDraft, saveDraft } from "@/features/roleplay/roleplay-draft-store";
import { normalizeGroundTruthForReview } from "@/features/roleplay/roleplay-ground-truth-normalizer";

export const runtime = "nodejs";
export const maxDuration = 180;

const REVIEW_FORMAT_VERSION = 5;

/** GET /api/roleplay/drafts/[id] — load a captured-source draft for review. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const datasetId = req.headers.get("x-dataset-id") || "";
  if (!isRoleplayEnabled(datasetId)) {
    return Response.json({ error: "Roleplay training is not available for this dataset" }, { status: 403 });
  }

  const { id } = await params;
  let draft = getDraft(datasetId, id);
  if (!draft) return Response.json({ error: "Draft not found" }, { status: 404 });

  if (draft.reviewFormatVersion !== REVIEW_FORMAT_VERSION) {
    try {
      const normalizedText = await normalizeGroundTruthForReview(draft.text, {
        datasetId,
        productLabel: draft.productLabel,
        source: draft.source,
      });
      draft = {
        ...draft,
        text: normalizedText,
        reviewNormalized: normalizedText !== draft.text,
        reviewFormatVersion: REVIEW_FORMAT_VERSION,
      };
      saveDraft(datasetId, draft);
    } catch (err) {
      console.error("[roleplay/drafts] draft LLM normalization failed:", err);
      draft = {
        ...draft,
        reviewNormalized: false,
        reviewFormatVersion: REVIEW_FORMAT_VERSION,
      };
      saveDraft(datasetId, draft);
    }
  }

  return Response.json(draft);
}

/** DELETE /api/roleplay/drafts/[id] — discard a draft (e.g. after generating). */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const datasetId = req.headers.get("x-dataset-id") || "";
  if (!isRoleplayEnabled(datasetId)) {
    return Response.json({ error: "Roleplay training is not available for this dataset" }, { status: 403 });
  }

  const { id } = await params;
  deleteDraft(datasetId, id);
  return Response.json({ ok: true });
}
