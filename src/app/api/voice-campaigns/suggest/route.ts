import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { DEFAULT_DATASET } from "@/lib/datasets/constants";
import { getDatasetForUser } from "@/lib/datasets";
import { generateText, parseJsonResponse, type ModelId } from "@/lib/llm";
import { ensureDatasetPurposes } from "@/lib/server/purpose-generation";
import type { Purpose } from "@/lib/purpose-types";
import type { Segment } from "@/lib/types";
import { listSegments } from "@/lib/server/segment-repo";
import { VOICE_CAMPAIGN_TEMPLATES } from "@/lib/voice-campaign-flow";
import { VoiceCampaignExperimentSplitSchema } from "@/lib/server/voice-campaign-experiment-schema";
import { VoiceCampaignSuccessDefinitionSchema } from "@/lib/server/voice-campaign-success-schema";
import {
  normalizeVoiceCampaignExperimentSplit,
  successDefinitionWithExperimentBaseline,
} from "@/lib/voice-campaign-experiment";

function datasetIdFromRequest(req: Request, bodyDatasetId?: string): string {
  const raw = bodyDatasetId || new URL(req.url).searchParams.get("datasetId") || req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  return /^[a-z0-9_-]+$/.test(raw) && raw.length <= 64 ? raw : DEFAULT_DATASET;
}

const SuggestSchema = z.object({
  datasetId: z.string().min(1).max(64).optional(),
  segmentId: z.string().min(1),
  kind: z.enum(["purposes", "scripts"]),
  purposeId: z.string().min(1).optional(),
  purpose: z.object({
    purposeId: z.string().trim().min(1).max(120),
    sku: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1).max(160),
    category: z.string().trim().min(1).max(120),
    tagline: z.string().trim().min(1).max(240),
    description: z.string().trim().min(1).max(1200),
    valueProp: z.string().trim().min(1).max(500),
    priceDisplay: z.string().trim().min(1).max(240),
    cta: z.string().trim().min(1).max(300),
  }).optional(),
  scriptNeed: z.string().max(1200).optional(),
  successDefinition: VoiceCampaignSuccessDefinitionSchema.optional(),
  experimentSplit: VoiceCampaignExperimentSplitSchema.optional(),
});

const PurposeSuggestionSchema = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["existing", "custom"] },
          purposeId: { type: ["string", "null"] },
          title: { type: "string" },
          reason: { type: "string" },
          campaignBrief: { type: "string" },
          purpose: {
            type: ["object", "null"],
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
        required: ["type", "purposeId", "title", "reason", "campaignBrief", "purpose"],
        additionalProperties: false,
      },
    },
  },
  required: ["suggestions"],
  additionalProperties: false,
};

const ScriptSuggestionSchema = {
  type: "object",
  properties: {
    options: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          campaignBrief: { type: "string" },
          templateId: { type: ["string", "null"] },
        },
        required: ["title", "description", "campaignBrief", "templateId"],
        additionalProperties: false,
      },
    },
  },
  required: ["options"],
  additionalProperties: false,
};

function compact(value: string | undefined, max = 1000): string {
  const text = value?.replace(/\s+/g, " ").trim() ?? "";
  return text.length <= max ? text : `${text.slice(0, max - 3).trim()}...`;
}

function experimentPromptContext(input: {
  experimentSplit?: z.infer<typeof VoiceCampaignExperimentSplitSchema>;
  successDefinition?: z.infer<typeof VoiceCampaignSuccessDefinitionSchema>;
}) {
  const split = normalizeVoiceCampaignExperimentSplit(input.experimentSplit, { defaultEnabled: true });
  const success = successDefinitionWithExperimentBaseline(input.successDefinition, split);
  return {
    testControl: split.enabled
      ? `${split.testPercent}% ${split.testLabel} receives calls; ${split.controlPercent}% ${split.controlLabel} is held out from calls.`
      : "No control holdout; full selected audience receives calls.",
    randomizationUnit: split.randomizationUnit,
    success: {
      primary: success.primary.label,
      type: success.primary.type,
      outcome: success.primary.outcome,
      eventName: success.primary.eventName,
      attributionWindowDays: success.attributionWindowDays,
      baseline: success.baseline.label ?? success.baseline.source,
    },
  };
}

type VoicePurposeSuggestion = {
  type: "existing" | "custom";
  purposeId: string | null;
  title: string;
  reason: string;
  campaignBrief: string;
  purpose: Purpose | null;
};

function segmentSearchText(segment: Pick<Segment, "name" | "description" | "sql">): string {
  return `${segment.name} ${segment.description ?? ""} ${segment.sql}`.toLowerCase();
}

function blockerPurposeSuggestions(segment: Pick<Segment, "name" | "description" | "sql">): VoicePurposeSuggestion[] | null {
  const text = segmentSearchText(segment);
  if (/\bkyc\b|know your customer|on[_\s-]?hold|verification hold/.test(text)) {
    return [
      {
        type: "custom",
        purposeId: null,
        title: "KYC Resolution Assistance Callback",
        reason: "Best fit when the audience is blocked at KYC: the call resolves the activation issue instead of pitching an investment product they cannot use yet.",
        campaignBrief: `Call ${segment.name} investors to identify why KYC is on hold, explain the next document or verification step, and route them to a support callback. Keep the call focused on KYC resolution.`,
        purpose: {
          purposeId: "CUSTOM_KYC_RESOLUTION_ASSISTANCE",
          sku: "custom-kyc-resolution-assistance",
          name: "KYC Resolution Assistance Callback",
          category: "support",
          tagline: "Help investors clear KYC activation blockers",
          description: "A support-led callback to understand why KYC is on hold and route the investor to the right resolution path.",
          valueProp: "Resolve the immediate activation blocker",
          priceDisplay: "No product pricing",
          cta: "Say yes and the support team will help resolve your KYC issue",
        },
      },
      {
        type: "custom",
        purposeId: null,
        title: "KYC Document Completion Help",
        reason: "Works well if these investors need specific document or verification guidance before their account can be activated.",
        campaignBrief: `Call ${segment.name} investors to check whether a document, PAN detail, address proof, or verification step is missing. Explain the next action clearly and route them to document completion support.`,
        purpose: {
          purposeId: "CUSTOM_KYC_DOCUMENT_COMPLETION",
          sku: "custom-kyc-document-completion",
          name: "KYC Document Completion Help",
          category: "support",
          tagline: "Help investors complete missing KYC documentation",
          description: "A guided callback for investors whose KYC is delayed because a document or verification detail needs correction.",
          valueProp: "Give the investor a clear next step to complete KYC",
          priceDisplay: "No product pricing",
          cta: "Say yes and the support team will guide you through the missing KYC step",
        },
      },
      {
        type: "custom",
        purposeId: null,
        title: "Account Activation Support Triage",
        reason: "Useful when KYC on hold may be one of multiple activation blockers and the call needs to classify the issue quickly.",
        campaignBrief: `Call ${segment.name} investors to confirm whether KYC, bank verification, or account activation is blocking them. Capture the blocker type and schedule the right support follow-up.`,
        purpose: {
          purposeId: "CUSTOM_ACCOUNT_ACTIVATION_TRIAGE",
          sku: "custom-account-activation-triage",
          name: "Account Activation Support Triage",
          category: "support",
          tagline: "Identify and route activation blockers",
          description: "A short triage callback that identifies the exact activation issue and routes the investor to the correct support path.",
          valueProp: "Reduce confusion by routing each investor to the right resolution path",
          priceDisplay: "No product pricing",
          cta: "Say yes and the team will help identify the blocker and next step",
        },
      },
    ];
  }

  if (/blocked|pending|incomplete|failed|failure|issue|ticket|complaint|mandate|verification|activation/.test(text)) {
    return [
      {
        type: "custom",
        purposeId: null,
        title: "Resolution Assistance Callback",
        reason: "Best fit when the segment has an operational blocker: the call should remove the immediate friction before any commercial discussion.",
        campaignBrief: `Call ${segment.name} to understand the blocker, confirm the next step needed to resolve it, and route the customer to the right support callback.`,
        purpose: {
          purposeId: "CUSTOM_RESOLUTION_ASSISTANCE",
          sku: "custom-resolution-assistance",
          name: "Resolution Assistance Callback",
          category: "support",
          tagline: "Help customers complete the blocked next step",
          description: "A support-led callback for customers who cannot proceed because an account, verification, or payment step is incomplete.",
          valueProp: "Remove the immediate friction preventing the customer from moving forward",
          priceDisplay: "No product pricing",
          cta: "Say yes and the team will help resolve the issue",
        },
      },
      {
        type: "custom",
        purposeId: null,
        title: "Verification Completion Help",
        reason: "Works when the next best action is getting the customer through an unfinished verification or setup step.",
        campaignBrief: `Call ${segment.name} to identify the unfinished verification or setup step, explain the next action, and route the customer to completion support.`,
        purpose: {
          purposeId: "CUSTOM_VERIFICATION_COMPLETION",
          sku: "custom-verification-completion",
          name: "Verification Completion Help",
          category: "support",
          tagline: "Guide customers through unfinished verification",
          description: "A guided support callback for customers stuck at an incomplete verification or setup step.",
          valueProp: "Make the next required action clear and easy to complete",
          priceDisplay: "No product pricing",
          cta: "Say yes and the team will guide you through the pending step",
        },
      },
      {
        type: "custom",
        purposeId: null,
        title: "Support Triage Callback",
        reason: "Works when the blocker could have several causes and the campaign should classify the issue before assigning follow-up.",
        campaignBrief: `Call ${segment.name} to ask one triage question, identify the blocker category, and schedule the right support follow-up.`,
        purpose: {
          purposeId: "CUSTOM_SUPPORT_TRIAGE",
          sku: "custom-support-triage",
          name: "Support Triage Callback",
          category: "support",
          tagline: "Identify the issue and route the right follow-up",
          description: "A short triage callback for customers whose next action depends on the exact blocker.",
          valueProp: "Route each customer to the most relevant resolution path",
          priceDisplay: "No product pricing",
          cta: "Say yes and the team will identify the issue and next step",
        },
      },
    ];
  }

  return null;
}

function isBlockerResolutionSuggestion(suggestion: VoicePurposeSuggestion): boolean {
  const text = `${suggestion.title} ${suggestion.reason} ${suggestion.campaignBrief} ${suggestion.purpose?.name ?? ""} ${suggestion.purpose?.description ?? ""}`.toLowerCase();
  const title = suggestion.title.toLowerCase();
  const talksAboutResolution = /kyc|verification|activation|blocked|pending|on hold|resolve|resolution|support|assist|document|mandate/.test(text);
  const productLedTitle = /\bsip\b|elss|tax saver|portfolio|investment product|loan|top[-\s]?up/.test(title);
  const existingProductPurpose = suggestion.type === "existing" && /\bsip\b|elss|tax saver|portfolio|investment product|loan|top[-\s]?up/.test(text);
  return talksAboutResolution && !productLedTitle && !existingProductPurpose;
}

function uniqueSuggestions(suggestions: VoicePurposeSuggestion[]): VoicePurposeSuggestion[] {
  const seen = new Set<string>();
  return suggestions.filter((suggestion) => {
    const key = suggestion.title.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizePurposeSuggestions(
  segment: Pick<Segment, "name" | "description" | "sql">,
  suggestions: VoicePurposeSuggestion[] | undefined,
  purposes: Purpose[],
): VoicePurposeSuggestion[] {
  const blockerSuggestions = blockerPurposeSuggestions(segment);
  if (blockerSuggestions) {
    const relevant = (suggestions ?? []).filter(isBlockerResolutionSuggestion);
    return uniqueSuggestions([...relevant, ...blockerSuggestions]).slice(0, 5);
  }
  return suggestions?.length ? suggestions : fallbackPurposeSuggestions(purposes, segment);
}

function fallbackPurposeSuggestions(purposes: Purpose[], segment: Pick<Segment, "name" | "description" | "sql">) {
  const blockerSuggestions = blockerPurposeSuggestions(segment);
  if (blockerSuggestions) return blockerSuggestions;

  const existing = purposes.slice(0, 3).map((purpose) => ({
    type: "existing" as const,
    purposeId: purpose.purposeId,
    title: purpose.name,
    reason: purpose.valueProp || purpose.tagline,
    campaignBrief: `Call ${segment.name} to understand their need, explain ${purpose.name} only if it is immediately relevant, and route interested customers to the next step.`,
    purpose: null,
  }));

  const padding: VoicePurposeSuggestion[] = [
    {
      type: "custom",
      purposeId: null,
      title: "Needs Discovery Callback",
      reason: "Use this when the segment intent is unclear and the best first step is to understand the customer's current need before choosing a product.",
      campaignBrief: `Call ${segment.name} to ask a concise discovery question, understand the customer's current need, and route interested customers to the right advisor follow-up.`,
      purpose: {
        purposeId: "CUSTOM_NEEDS_DISCOVERY_CALLBACK",
        sku: "custom-needs-discovery-callback",
        name: "Needs Discovery Callback",
        category: "advisory",
        tagline: "Understand the customer's need before recommending",
        description: "A short advisory callback to identify what the customer actually needs next.",
        valueProp: "Improve relevance by matching the follow-up to the customer's stated need",
        priceDisplay: "No product pricing",
        cta: "Say yes and an advisor will help identify the right next step",
      },
    },
    {
      type: "custom",
      purposeId: null,
      title: "Advisor Follow-up Callback",
      reason: "Use this when the segment may need human guidance before committing to a specific purpose.",
      campaignBrief: `Call ${segment.name} to confirm interest, capture the topic they need help with, and schedule an advisor follow-up.`,
      purpose: {
        purposeId: "CUSTOM_ADVISOR_FOLLOW_UP",
        sku: "custom-advisor-follow-up",
        name: "Advisor Follow-up Callback",
        category: "advisory",
        tagline: "Route interested customers to advisor help",
        description: "An advisor-led follow-up for customers who show interest but need more guidance.",
        valueProp: "Move interested customers to the right human follow-up",
        priceDisplay: "No product pricing",
        cta: "Say yes and an advisor will call back",
      },
    },
  ];

  return uniqueSuggestions([...existing, ...padding]).slice(0, 3);
}

function fallbackScriptOptions(segment: Pick<Segment, "name" | "description" | "sql">, purposeName: string) {
  if (blockerPurposeSuggestions(segment)) {
    return [
      {
        title: "Resolution-first support call",
        description: "Lead with the blocker, collect what is missing, and route to the right support path.",
        campaignBrief: `Call ${segment.name}, explain that the call is to help resolve the current blocker, ask what issue they are facing, and offer a support callback. Do not pitch ${purposeName} unless the blocker is already resolved or the customer asks.`,
        templateId: "service-follow-up",
      },
      {
        title: "Reassuring activation help",
        description: "Use a softer script for customers who may be frustrated or confused by the blocker.",
        campaignBrief: `Call ${segment.name} with a calm support-led opening, confirm the pending activation step, explain the next action in plain language, and close by routing them to the support team.`,
        templateId: "service-follow-up",
      },
      {
        title: "Fast triage and callback",
        description: "Keep the call short, identify the blocker category, and hand off qualified cases.",
        campaignBrief: `Call ${segment.name}, ask one triage question about the unresolved step, avoid product discussion, and schedule a callback with the team that can resolve the issue.`,
        templateId: "reactivation",
      },
    ];
  }

  return [
    {
      title: "Helpful discovery",
      description: "Start by understanding the customer's need before mentioning the campaign purpose.",
      campaignBrief: `Call ${segment.name}, ask one discovery question, explain ${purposeName} only if it fits, and offer a callback after being useful.`,
      templateId: "high-intent-conversion",
    },
    {
      title: "Low-pressure check-in",
      description: "Use a softer conversation for uncertain or inactive customers.",
      campaignBrief: `Call ${segment.name} with a low-pressure check-in, understand what is blocking them, and mention ${purposeName} only if they show interest.`,
      templateId: "reactivation",
    },
    {
      title: "Support-led follow-up",
      description: "Lead with help and route concerns before pitching.",
      campaignBrief: `Call ${segment.name} to see if they need help, answer basic questions, and use ${purposeName} as the next step only when relevant.`,
      templateId: "service-follow-up",
    },
  ];
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = SuggestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });

  const datasetId = datasetIdFromRequest(req, parsed.data.datasetId);
  const dataset = getDatasetForUser(datasetId, userId);
  if (!dataset) return Response.json({ error: "Dataset not found" }, { status: 404 });

  const segment = listSegments(userId, datasetId).find((item) => item.id === parsed.data.segmentId);
  if (!segment) return Response.json({ error: "Segment not found" }, { status: 404 });

  const purposes = await ensureDatasetPurposes(datasetId, userId);

  if (parsed.data.kind === "purposes") {
    const systemPrompt = `You recommend campaign purposes for outbound voice campaigns.

Return JSON only. Recommend at least 3 and at most 5 purposes. Quality is more important than filling with generic options.

IMPORTANT: The dataset context and hints describe the data schema for analytics queries — not the campaign intent. Do NOT use the schema documentation to infer the purpose of the campaign. Use only the segment name, description, user count, and SQL to understand who the audience is and what they need.

Rules:
- Ground recommendations in the segment audience (name + description + SQL), not in the dataset schema documentation.
- The selected purpose must be something this exact segment can act on during this call.
- ACTIVE INVESTORS: If the segment clearly describes investors who already hold active products (e.g. have SIPs, have mutual funds, hold a portfolio, multi-fund holders, existing investors), recommend portfolio growth, SIP step-up, cross-sell, advisory review, or rebalancing purposes. Do NOT suggest KYC, account activation, or document submission for segments that are already active.
- BLOCKED INVESTORS: If the segment describes a blocker or prerequisite (KYC/on hold, verification pending, bank or mandate incomplete, payment failure, complaint, account blocked, activation incomplete), every recommendation must resolve that blocker. Do not recommend downstream product or investment purposes until the blocker is resolved.
- For KYC/on-hold segments, return three distinct KYC/account activation support recommendations. Do not recommend SIP Starter, ELSS, or tax-planning discussions.
- Existing purposes are allowed only when they are immediately usable for this segment. If the catalog has no immediate fit, return relevant custom purposes.
- Do not invent guaranteed rates, approval, returns, or eligibility.
- Custom purpose details must be safe for a phone agent to say.
- Recommendations should be testable against the experiment control holdout. Prefer purposes whose success can be observed within the attribution window.
- campaignBrief should be directly usable as the voice campaign brief.`;
    const userPrompt = JSON.stringify({
      dataset: {
        label: dataset.label,
        companyName: dataset.companyName,
        entityName: dataset.entityName,
        context: compact(dataset.systemContext, 1400),
        hints: compact(dataset.domainHints, 1000),
      },
      segment: {
        name: segment.name,
        description: segment.description,
        userCount: segment.userCount,
      },
      purposes,
      experiment: experimentPromptContext(parsed.data),
    });

    try {
      const raw = await generateText({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        jsonSchema: { name: "voice_purpose_suggestions", schema: PurposeSuggestionSchema, strict: true },
        model: (process.env.SUGGEST_MODEL || "gpt-4o-mini") as ModelId,
        datasetId,
        feature: "voice-campaigns.suggest-purposes",
        timeoutMs: 60_000,
        maxOutputTokens: 2500,
      });
      const result = parseJsonResponse(raw) as { suggestions?: VoicePurposeSuggestion[] };
      return Response.json({ suggestions: normalizePurposeSuggestions(segment, result.suggestions, purposes) });
    } catch {
      return Response.json({ suggestions: fallbackPurposeSuggestions(purposes, segment) });
    }
  }

  const inlinePurpose = parsed.data.purpose && parsed.data.purpose.purposeId === parsed.data.purposeId
    ? parsed.data.purpose as Purpose
    : undefined;
  const purpose = purposes.find((item) => item.purposeId === parsed.data.purposeId) ?? inlinePurpose;
  if (!purpose) {
    return Response.json(
      { error: "Select a campaign purpose before requesting script options" },
      { status: 400 },
    );
  }

  const systemPrompt = `You propose campaign plan options for outbound AI voice campaigns.

Return JSON only. Each option should be a distinct call plan the user can choose before generating the full script.

Rules:
- Use the user's requested campaign direction as the main direction.
- The plan must be relevant to both the selected segment and selected campaign purpose.
- If the segment or purpose is about resolving a blocker, lead with help and resolution. Do not pitch downstream products before the customer can actually act on them.
- If the selected purpose is a product but the segment has an unresolved prerequisite, frame the call around resolving the prerequisite and only mention the product as a later path if the customer asks or is already eligible.
- Keep options operational, not generic.
- The selected plan is for the test arm of an experiment. It must be measurable against the control holdout and should not require contacting the control group.
- campaignBrief must be detailed enough for another LLM call to generate the full system prompt and workflow.
- templateId must be one of the provided template IDs, or null.`;
  const userPrompt = JSON.stringify({
    scriptNeed: parsed.data.scriptNeed || "Suggest practical campaign plan options for this voice campaign.",
    dataset: {
      label: dataset.label,
      companyName: dataset.companyName,
      entityName: dataset.entityName,
      context: compact(dataset.systemContext, 1200),
    },
    segment: {
      name: segment.name,
      description: segment.description,
      userCount: segment.userCount,
      sql: compact(segment.sql, 1400),
    },
    purpose,
    experiment: experimentPromptContext(parsed.data),
    templates: VOICE_CAMPAIGN_TEMPLATES.map(({ id, title, description, objective }) => ({ id, title, description, objective })),
  });

  try {
    const raw = await generateText({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      jsonSchema: { name: "voice_script_options", schema: ScriptSuggestionSchema, strict: true },
      model: (process.env.SUGGEST_MODEL || "gpt-4o-mini") as ModelId,
      datasetId,
      feature: "voice-campaigns.suggest-scripts",
      timeoutMs: 60_000,
      maxOutputTokens: 2000,
    });
    return Response.json(parseJsonResponse(raw));
  } catch {
    return Response.json({ options: fallbackScriptOptions(segment, purpose.name) });
  }
}
