import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { listOffers, parseOffersCsv, upsertOffers } from "@/lib/offer-store";
import { DEFAULT_DATASET } from "@/lib/datasets/constants";
import type { Offer } from "@/lib/offer-types";

function datasetIdFromRequest(req: Request): string {
  const raw = new URL(req.url).searchParams.get("datasetId") || req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  return /^[a-z0-9_-]+$/.test(raw) && raw.length <= 64 ? raw : DEFAULT_DATASET;
}

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ offers: listOffers(datasetIdFromRequest(req)) });
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const contentType = req.headers.get("content-type") ?? "";
  const datasetId = datasetIdFromRequest(req);

  if (contentType.includes("application/json")) {
    const OfferSchema = z.object({
      offerId: z.string().trim().min(1).max(120).optional(),
      sku: z.string().trim().min(1).max(120).optional(),
      name: z.string().trim().min(1).max(160),
      category: z.string().trim().min(1).max(120),
      tagline: z.string().trim().min(1).max(240),
      description: z.string().trim().min(1).max(1200),
      valueProp: z.string().trim().min(1).max(500),
      priceDisplay: z.string().trim().min(1).max(240),
      cta: z.string().trim().min(1).max(300),
    });
    const JsonSchema = z.object({
      offer: OfferSchema.optional(),
      offers: z.array(OfferSchema).min(1).max(100).optional(),
    }).refine((value) => value.offer || value.offers, {
      message: "offer or offers is required",
    });

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = JsonSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: parsed.error.message }, { status: 400 });
    }

    const rawOffers = parsed.data.offers ?? (parsed.data.offer ? [parsed.data.offer] : []);
    const offers: Offer[] = rawOffers.map((offer) => {
      const id = offer.offerId ||
        `CUSTOM_${offer.name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || Date.now()}`;
      return {
        offerId: id,
        sku: offer.sku || id,
        name: offer.name,
        category: offer.category,
        tagline: offer.tagline,
        description: offer.description,
        valueProp: offer.valueProp,
        priceDisplay: offer.priceDisplay,
        cta: offer.cta,
      };
    });

    upsertOffers(offers, datasetId);
    return Response.json({ imported: offers.length, offers });
  }

  let csvText: string;

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file") as File | null;
      if (!file) return Response.json({ error: "No file provided" }, { status: 400 });
      csvText = await file.text();
    } else {
      csvText = await req.text();
    }
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { offers, errors } = parseOffersCsv(csvText);
  if (offers.length === 0) {
    return Response.json({ error: "No valid offers parsed", details: errors }, { status: 400 });
  }

  upsertOffers(offers, datasetId);
  return Response.json({ imported: offers.length, errors });
}
