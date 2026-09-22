/**
 * Dataset-derived purpose catalogs for voice campaigns.
 *
 * Datasets without a hand-curated catalog in purpose-store get their
 * purposes generated once from their own config (systemContext, domainHints,
 * entityName, ...) and persisted, so every dataset's campaign chips are
 * grounded in that dataset's actual domain instead of a cross-dataset
 * fallback. Curated catalogs and user-uploaded purposes take precedence.
 */
import { z } from "zod/v4";
import { generateText, parseJsonResponse, type ModelId } from "@/lib/llm";
import { getDatasetForUser } from "@/lib/datasets";
import {
  hasCuratedPurposes,
  getGeneratedPurposes,
  saveGeneratedPurposes,
  listPurposes,
} from "@/lib/purpose-store";
import type { Purpose } from "@/lib/purpose-types";

const GeneratedPurposeSchema = z.object({
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

const GeneratedCatalogSchema = z.object({
  purposes: z.array(GeneratedPurposeSchema).min(1).max(4),
});

const PURPOSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    purposes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          purposeId: { type: "string" },
          sku: { type: "string" },
          name: { type: "string" },
          category: { type: "string" },
          tagline: { type: "string" },
          description: { type: "string" },
          valueProp: { type: "string" },
          priceDisplay: { type: "string" },
          cta: { type: "string" },
        },
        required: ["purposeId", "sku", "name", "category", "tagline", "description", "valueProp", "priceDisplay", "cta"],
        additionalProperties: false,
      },
    },
  },
  required: ["purposes"],
  additionalProperties: false,
};

function compact(value: string | undefined, max = 1400): string {
  const text = value?.replace(/\s+/g, " ").trim() ?? "";
  return text.length <= max ? text : `${text.slice(0, max - 3).trim()}...`;
}

async function generateCatalog(datasetId: string, userId: string): Promise<Purpose[]> {
  const dataset = getDatasetForUser(datasetId, userId);
  if (!dataset) return [];

  const systemPrompt = `You define the campaign purpose catalog for outbound AI voice campaigns.

Return JSON only: {"purposes": [...]} with 3 to 4 purposes.

A purpose is a reason to call a customer that a phone agent can act on in one call (a cross-sell offer, a servicing follow-up, a re-engagement conversation, a completion nudge).

Rules:
- Ground every purpose in the company's actual domain and lifecycle described below. Do not import products or concepts from other industries.
- Cover a mix: at least one commercial purpose (offer/cross-sell) and at least one servicing or support purpose.
- purposeId must be SCREAMING_SNAKE_CASE and unique; sku must be kebab-case.
- Do not invent guaranteed rates, returns, approvals, or eligibility. priceDisplay must stay conditional where pricing depends on review.
- Every field must be safe for a phone agent to say out loud to a customer.`;

  const userPrompt = JSON.stringify({
    company: {
      label: dataset.label,
      companyName: dataset.companyName,
      entityName: dataset.entityName,
      currency: dataset.currency,
      context: compact(dataset.systemContext),
      hints: compact(dataset.domainHints, 1000),
    },
  });

  const raw = await generateText({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    jsonSchema: { name: "voice_purpose_catalog", schema: PURPOSE_JSON_SCHEMA, strict: true },
    model: (process.env.SUGGEST_MODEL || "gpt-4o-mini") as ModelId,
    datasetId,
    feature: "voice-campaigns.generate-purpose-catalog",
    timeoutMs: 45_000,
    maxOutputTokens: 2000,
  });

  const parsed = GeneratedCatalogSchema.safeParse(parseJsonResponse(raw));
  if (!parsed.success) {
    throw new Error(`Generated purpose catalog failed validation: ${parsed.error.message}`);
  }
  return parsed.data.purposes;
}

const inFlight = new Map<string, Promise<void>>();

/**
 * Returns the dataset's purposes, generating and persisting a catalog from
 * dataset config on first use when no curated catalog exists. Falls back to
 * listPurposes' generic default if generation fails (never throws).
 */
export async function ensureDatasetPurposes(datasetId: string, userId: string): Promise<Purpose[]> {
  if (!hasCuratedPurposes(datasetId) && getGeneratedPurposes(datasetId).length === 0) {
    let pending = inFlight.get(datasetId);
    if (!pending) {
      pending = generateCatalog(datasetId, userId)
        .then((purposes) => {
          if (purposes.length > 0) saveGeneratedPurposes(datasetId, purposes);
        })
        .finally(() => inFlight.delete(datasetId));
      inFlight.set(datasetId, pending);
    }
    try {
      await pending;
    } catch (err) {
      console.error(`[purpose-generation] catalog generation failed for ${datasetId}:`, err);
    }
  }
  return listPurposes(datasetId, userId);
}
