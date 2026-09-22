import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { upsertPurposes } from "@/lib/purpose-store";
import { ensureDatasetPurposes } from "@/lib/server/purpose-generation";
import { DEFAULT_DATASET } from "@/lib/datasets/constants";
import type { Purpose } from "@/lib/purpose-types";

const PurposeSchema = z.object({
  purposeId: z.string().trim().min(1).max(120),
  sku: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(160),
  category: z.string().trim().min(1).max(120),
  tagline: z.string().trim().min(1).max(240),
  description: z.string().trim().min(1).max(1200),
  valueProp: z.string().trim().min(1).max(500),
  priceDisplay: z.string().trim().min(1).max(240),
  cta: z.string().trim().min(1).max(300),
});

function datasetIdFromRequest(req: Request): string {
  const raw = new URL(req.url).searchParams.get("datasetId") || req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  return /^[a-z0-9_-]+$/.test(raw) && raw.length <= 64 ? raw : DEFAULT_DATASET;
}

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const datasetId = datasetIdFromRequest(req);
  const purposes = await ensureDatasetPurposes(datasetId, userId);
  return Response.json({ purposes }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const datasetId = datasetIdFromRequest(req);
  const body = await req.json();
  const parsed = PurposeSchema.safeParse((body as { purpose?: unknown })?.purpose);
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });

  const purpose: Purpose = parsed.data;
  upsertPurposes([purpose], datasetId, userId);
  return Response.json({ purposes: [purpose] });
}
