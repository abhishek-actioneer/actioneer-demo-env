import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { getDataset } from "@/lib/datasets";
import { DEFAULT_DATASET } from "@/lib/datasets/constants";
import { executeSQLPrepared } from "@/lib/sql-executor";
import {
  buildFraudOpeningLine,
  buildFraudVerificationPrompt,
  verificationContextFromDatasetRow,
  type VerificationCallContext,
} from "@/lib/prompts/fraud-verification";
import { registerFraudCall } from "@/lib/fraud-call-registry";
import { storeCallConfig } from "@/lib/voice-call-state";
import { saveCampaign, getCampaign, upsertCall } from "@/lib/voice-campaign-store";
import { activeVoiceCallProvider } from "@/features/voice/server/call-provider";
import { resolveVoiceDialerProvider } from "@/features/voice/server/dialer-provider";
import type { VoiceCallProvider, VoiceCampaign } from "@/lib/voice-campaign-types";
import type { VoiceCustomerContext } from "@/lib/voice-customer-context";

const ContextSchema = z.record(z.string(), z.unknown()).optional();

const VerificationSchema = z.object({
  datasetId: z.string().min(1).max(64).optional(),
  alertId: z.string().min(1).max(200).optional(),
  phone: z.string().min(1).max(32).optional(),
  customerId: z.string().min(1).max(200).optional(),
  subjectId: z.string().min(1).max(200).optional(),
  subjectName: z.string().min(1).max(200).optional(),
  gender: z.string().min(1).max(40).nullable().optional(),
  amountAtRisk: z.number().finite().nonnegative().optional(),
  verificationReason: z.string().min(1).max(500).optional(),
  riskSignals: z.array(z.string().min(1).max(500)).max(20).optional(),
  verificationItems: z.array(z.string().min(1).max(500)).max(20).optional(),
  transaction: ContextSchema,
  context: ContextSchema,
  callProvider: z.literal("plivo-gemini").optional(),
});

function normalizeDatasetId(raw: string | undefined): string {
  const value = raw || DEFAULT_DATASET;
  return /^[a-z0-9_-]+$/.test(value) && value.length <= 64 ? value : DEFAULT_DATASET;
}

function normalizePhone(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("+")) return `+${trimmed.slice(1).replace(/\D/g, "")}`;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length >= 11) return `+${digits}`;
  return digits;
}

function safeIdPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "verification";
}

function getString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getNumber(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key];
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function loadContextFromDataset(
  datasetId: string,
  alertId: string | undefined,
): Promise<Record<string, unknown> | undefined> {
  if (!alertId) return undefined;
  const result = await executeSQLPrepared(
    "SELECT * FROM fraud_call_context WHERE alert_id = ? LIMIT 1",
    [alertId],
    datasetId,
  );
  if (result.error || result.rows.length === 0) return undefined;
  return result.rows[0];
}

function mergeRequestContext(
  datasetId: string,
  body: z.infer<typeof VerificationSchema>,
  rowContext: Record<string, unknown> | undefined,
): VerificationCallContext {
  const dataset = getDataset(datasetId);
  const fromRow = rowContext ? verificationContextFromDatasetRow(dataset, rowContext) : undefined;
  const explicit = body.context;
  const subjectId = body.subjectId || body.customerId || getString(explicit, "subjectId") || getString(explicit, "customerId");
  const amountAtRisk = body.amountAtRisk ?? getNumber(explicit, "amountAtRisk");

  return {
    datasetId,
    datasetLabel: dataset.label,
    companyName: dataset.companyName,
    entityName: dataset.entityName,
    ...fromRow,
    alertId: body.alertId || fromRow?.alertId,
    subjectId: subjectId || fromRow?.subjectId,
    customerId: body.customerId || subjectId || fromRow?.customerId,
    subjectName: body.subjectName || getString(explicit, "subjectName") || fromRow?.subjectName,
    phone: body.phone || getString(explicit, "phone") || fromRow?.phone,
    gender: body.gender ?? getString(explicit, "gender") ?? fromRow?.gender,
    amountAtRisk: amountAtRisk ?? fromRow?.amountAtRisk,
    verificationReason: body.verificationReason || getString(explicit, "verificationReason") || fromRow?.verificationReason,
    riskSignals: body.riskSignals || fromRow?.riskSignals,
    verificationItems: body.verificationItems || fromRow?.verificationItems,
    transaction: {
      ...(fromRow?.transaction ?? {}),
      ...(body.transaction ?? {}),
    },
    raw: {
      ...(fromRow?.raw ?? {}),
      ...(rowContext ?? {}),
      ...(explicit ?? {}),
    },
  };
}

function customerContextFromVerification(ctx: VerificationCallContext): VoiceCustomerContext {
  const rawFields = Object.fromEntries(
    Object.entries(ctx.raw ?? {}).map(([key, value]) => [key, String(value ?? "")]),
  );
  return {
    source: "generic",
    datasetId: ctx.datasetId,
    investorId: ctx.customerId || ctx.subjectId,
    firstName: ctx.subjectName?.split(/\s+/)[0],
    displayName: ctx.subjectName,
    gender: ctx.gender?.toLowerCase() === "male"
      ? "male"
      : ctx.gender?.toLowerCase() === "female"
        ? "female"
        : "unknown",
    rawFields,
    conversationHooks: [
      "This is a risk-verification call. Verify the customer recognizes the activity before taking an outcome.",
    ],
    doNotSay: [
      "Do not reveal internal risk scores, SQL, dataset names, or backend logic.",
    ],
  };
}

function ensureVerificationCampaign(input: {
  userId: string;
  datasetId: string;
  systemPrompt: string;
  firstMessage: string;
  voice: string;
  voiceName: string;
  language: string;
  callProvider: VoiceCallProvider;
}): VoiceCampaign {
  const dataset = getDataset(input.datasetId);
  const id = `risk-verify-${safeIdPart(input.datasetId)}-${safeIdPart(input.userId.slice(-12))}`;
  const existing = getCampaign(id, { userId: input.userId, datasetId: input.datasetId });
  if (existing) return existing;

  const campaign: VoiceCampaign = {
    id,
    userId: input.userId,
    name: `${dataset.label} risk verification`,
    datasetId: input.datasetId,
    datasetLabel: dataset.label,
    companyName: dataset.companyName,
    entityName: dataset.entityName,
    segmentId: "risk-verification",
    segmentName: "Risk verification",
    purposeId: "risk-verification",
    purposeName: "Risk verification",
    systemPrompt: input.systemPrompt,
    firstMessage: input.firstMessage,
    scriptReasoning: "Verify risk-triggered activity with a live customer call.",
    agentId: "gemini-live",
    voice: input.voice,
    voiceName: input.voiceName,
    callProvider: input.callProvider,
    voiceProvider: "gemini-live",
    language: input.language,
    phoneNumbers: [],
    status: "in_progress",
    calls: [],
    createdAt: new Date().toISOString(),
  };
  saveCampaign(campaign);
  return campaign;
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const rawBody = await req.json().catch(() => null);
  const parsed = VerificationSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
  }

  const datasetId = normalizeDatasetId(parsed.data.datasetId || req.headers.get("x-dataset-id") || undefined);
  const dataset = getDataset(datasetId);
  const rowContext = await loadContextFromDataset(datasetId, parsed.data.alertId);
  const ctx = mergeRequestContext(datasetId, parsed.data, rowContext);
  const toNumber = ctx.phone ? normalizePhone(ctx.phone) : "";
  if (!toNumber || !/^\+\d{8,15}$/.test(toNumber)) {
    return Response.json(
      { error: "No valid phone number available. Pass phone, context.phone, or provide an alert row with demo_phone." },
      { status: 400 },
    );
  }

  const voice = process.env.GEMINI_LIVE_VOICE ?? "Charon";
  const voiceName = "Priya";
  const language = "Hinglish";
  const systemPrompt = buildFraudVerificationPrompt(ctx, dataset);
  const firstMessage = buildFraudOpeningLine(ctx, dataset);
  const callProvider = activeVoiceCallProvider(parsed.data.callProvider);
  const campaign = ensureVerificationCampaign({
    userId,
    datasetId,
    systemPrompt,
    firstMessage,
    voice,
    voiceName,
    language,
    callProvider,
  });
  const runtimeCampaign: VoiceCampaign = {
    ...campaign,
    systemPrompt,
    firstMessage,
    voice,
    voiceName,
    language,
    callProvider,
  };
  const callIdSeed = ctx.alertId || ctx.customerId || ctx.subjectId || "risk";
  const callId = `risk-${safeIdPart(datasetId)}-${safeIdPart(callIdSeed).slice(-12)}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const customerContext = customerContextFromVerification(ctx);

  storeCallConfig(callId, {
    campaignId: campaign.id,
    datasetId,
    systemPrompt,
    firstMessage,
    voice,
    voiceName,
    language,
    toNumber,
    userId: ctx.customerId || ctx.subjectId,
    customerContext,
    verificationId: ctx.alertId,
    verificationSubjectId: ctx.customerId || ctx.subjectId,
    verificationAmountAtRisk: ctx.amountAtRisk ?? undefined,
  });

  registerFraudCall(callId, {
    datasetId,
    campaignId: campaign.id,
    userId,
    alertId: ctx.alertId,
    customerId: ctx.customerId,
    subjectId: ctx.subjectId,
    subjectName: ctx.subjectName,
    phone: toNumber,
    amountAtRisk: ctx.amountAtRisk ?? undefined,
    cardholderGender: ctx.gender ?? undefined,
    verificationReason: ctx.verificationReason ?? undefined,
    transaction: ctx.transaction,
    context: ctx.raw,
  });

  upsertCall(campaign.id, {
    id: callId,
    callConfigId: callId,
    provider: "plivo",
    toNumber,
    recipientId: ctx.customerId || ctx.subjectId,
    recipientContext: customerContext,
    status: "calling",
    engaged: false,
    tags: ["risk-verification"],
    startedAt: new Date().toISOString(),
  });

  try {
    const dialer = resolveVoiceDialerProvider(callProvider);
    const result = await dialer.startCall({
      campaign: runtimeCampaign,
      callConfigId: callId,
      toNumber,
      customerContext,
      runtimeSystemPrompt: systemPrompt,
    });
    upsertCall(campaign.id, {
      id: callId,
      callConfigId: callId,
      providerRequestId: result.providerRequestId,
      provider: result.provider,
      toNumber,
      recipientId: ctx.customerId || ctx.subjectId,
      recipientContext: customerContext,
      status: "calling",
      engaged: false,
      summary: result.summary,
    });
    return Response.json({
      ok: true,
      callId,
      providerRequestId: result.providerRequestId,
      toNumber,
      datasetId,
      campaignId: campaign.id,
      status: "calling",
    });
  } catch (err) {
    upsertCall(campaign.id, {
      id: callId,
      callConfigId: callId,
      toNumber,
      status: "failed",
      engaged: false,
      summary: err instanceof Error ? err.message : "Call initiation failed",
      endedAt: new Date().toISOString(),
    });
    return Response.json(
      { error: err instanceof Error ? err.message : "Call initiation failed" },
      { status: 500 },
    );
  }
}
