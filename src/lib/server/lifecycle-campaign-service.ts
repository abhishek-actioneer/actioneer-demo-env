import { createHash, randomUUID } from "crypto";
import { parse as parseCsv } from "csv-parse/sync";
import { getPurpose } from "@/lib/purpose-store";
import { getCampaign as getVoiceCampaign, saveCampaign, updateCampaign as updateVoiceCampaign } from "@/lib/voice-campaign-store";
import { ensureCampaignCallConfig, seedPlannedVoiceCalls, startPlannedVoiceCalls } from "@/lib/voice-campaign-runner";
import type { VoiceCampaign, VoiceCallStatus } from "@/lib/voice-campaign-types";
import { buildFundsIndiaVoiceCustomerContext } from "@/lib/server/voice-customer-context-repo";
import { listSegments } from "@/lib/server/segment-repo";
import { assignExperimentArm } from "@/lib/lifecycle/assignment";
import { extractLifecycleTranscriptEvents } from "@/lib/lifecycle/transcript-events";
import {
  evaluateFundsIndiaKycRecoveryEligibility,
  FUNDSINDIA_CAMPAIGN_AS_OF_DATE,
  loadFundsIndiaConversions,
  lifecycleSegmentLabel,
} from "@/lib/lifecycle/profiles/fundsindia-kyc-recovery";
import {
  contactMap,
  enrollmentMap,
  getDecisionRecord,
  getLifecycleCampaignBundle,
  listCampaignEvents,
  listEnrollments,
  listTreatmentTasks,
  patchTreatmentTask,
  setEnrollmentOfferInstance,
  updateLifecycleCampaignStatus,
  upsertCampaignEvent,
  upsertContactIdentity,
  upsertEnrollment,
  upsertOfferInstance,
  upsertTreatmentTask,
} from "@/lib/server/lifecycle-campaign-repo";
import {
  PILOT_MODE_LABEL,
  PROFILE_ONLY_SEGMENT_ID,
  type AudiencePreview,
  type CampaignEvent,
  type CampaignResults,
  type CampaignRunSummary,
  type ContactIdentity,
  type EligibleInvestorPreview,
  type EnrollmentSummary,
  type LifecycleCampaignBundle,
  type LifecycleEnrollment,
  type OfferInstance,
  type TreatmentTaskStatus,
} from "@/lib/lifecycle-campaign-types";
import { getDb } from "@/lib/meta-db";

const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-mini";
const TASK_STATUSES: TreatmentTaskStatus[] = [
  "queued",
  "starting",
  "calling",
  "connected",
  "completed",
  "failed",
  "no_answer",
  "cancelled",
];

function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${createHash("sha1").update(parts.join(":")).digest("hex").slice(0, 18)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function normalizePhoneNumber(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return null;
}

function parseConsent(value: unknown): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "y", "consent", "consented", "opted_in", "opt-in"].includes(normalized);
}

function eventId(
  campaignId: string,
  investorId: string,
  eventType: string,
  source: string,
  extra = "",
): string {
  return stableId("evt", campaignId, investorId, eventType, source, extra);
}

function segmentForCampaign(userId: string, bundle: LifecycleCampaignBundle) {
  if (bundle.campaign.segmentId === PROFILE_ONLY_SEGMENT_ID) return undefined;
  return listSegments(userId, bundle.campaign.datasetId).find((segment) => segment.id === bundle.campaign.segmentId);
}

async function evaluateAudience(userId: string, bundle: LifecycleCampaignBundle, limit = 10_000) {
  const segment = segmentForCampaign(userId, bundle);
  return evaluateFundsIndiaKycRecoveryEligibility({
    datasetId: bundle.campaign.datasetId,
    segmentSql: segment?.sql,
    asOfDate: bundle.campaign.asOfDate || FUNDSINDIA_CAMPAIGN_AS_OF_DATE,
    limit,
  });
}

export interface ContactImportResult {
  imported: number;
  skipped: number;
  duplicateEntityRows: number;
  duplicatePhoneRows: number;
  noConsentRows: number;
  invalidRows: number;
  errors: string[];
}

export function importCampaignContacts({
  userId,
  datasetId,
  csvText,
}: {
  userId: string;
  datasetId: string;
  csvText: string;
}): ContactImportResult {
  const errors: string[] = [];
  const rows = parseCsv(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Array<Record<string, unknown>>;

  if (rows.length === 0) {
    return {
      imported: 0,
      skipped: 0,
      duplicateEntityRows: 0,
      duplicatePhoneRows: 0,
      noConsentRows: 0,
      invalidRows: 0,
      errors: ["CSV must contain at least one data row."],
    };
  }

  const first = rows[0] ?? {};
  const headers = new Set(Object.keys(first).map((key) => key.toLowerCase()));
  if (!headers.has("investor_id") || !headers.has("phone_number")) {
    return {
      imported: 0,
      skipped: rows.length,
      duplicateEntityRows: 0,
      duplicatePhoneRows: 0,
      noConsentRows: 0,
      invalidRows: rows.length,
      errors: ["CSV must include investor_id and phone_number columns. consent is strongly recommended."],
    };
  }

  const seenEntities = new Set<string>();
  const seenPhones = new Set<string>();
  let imported = 0;
  let skipped = 0;
  let duplicateEntityRows = 0;
  let duplicatePhoneRows = 0;
  let noConsentRows = 0;
  let invalidRows = 0;
  const insertedByEntity = new Map<string, ContactIdentity>();
  const current = nowIso();

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const investorId = String(row.investor_id ?? row.investorId ?? "").trim();
    const phoneNumber = normalizePhoneNumber(String(row.phone_number ?? row.phoneNumber ?? ""));
    const consent = parseConsent(row.consent ?? row.has_consent ?? row.opted_in);

    if (!investorId || !phoneNumber) {
      invalidRows += 1;
      skipped += 1;
      errors.push(`Row ${rowNumber}: missing investor_id or invalid phone_number.`);
      return;
    }
    if (seenEntities.has(investorId)) duplicateEntityRows += 1;
    if (seenPhones.has(phoneNumber)) duplicatePhoneRows += 1;
    if (!consent) noConsentRows += 1;

    seenEntities.add(investorId);
    seenPhones.add(phoneNumber);
    insertedByEntity.set(investorId, {
      id: stableId("ct", userId, datasetId, investorId),
      userId,
      datasetId,
      entityId: investorId,
      phoneNumber,
      consent,
      name: String(row.name ?? "").trim() || undefined,
      preferredLanguage: String(row.preferred_language ?? row.preferredLanguage ?? "").trim() || undefined,
      source: "manual_csv",
      createdAt: current,
      updatedAt: current,
    });
  });

  const tx = getDb().transaction((contacts: ContactIdentity[]) => {
    for (const contact of contacts) upsertContactIdentity(contact);
  });
  const contacts = Array.from(insertedByEntity.values());
  tx(contacts);
  imported = contacts.length;

  return {
    imported,
    skipped,
    duplicateEntityRows,
    duplicatePhoneRows,
    noConsentRows,
    invalidRows,
    errors: errors.slice(0, 20),
  };
}

function contactStatus(contact: ContactIdentity | undefined): EligibleInvestorPreview["contactStatus"] {
  if (!contact) return "missing_phone";
  if (!contact.consent) return "no_consent";
  return "contactable";
}

export async function previewCampaignAudience(userId: string, campaignId: string): Promise<AudiencePreview> {
  const bundle = getLifecycleCampaignBundle(userId, campaignId);
  if (!bundle) throw new Error("Campaign not found");

  const [eligible, contacts, existingEnrollments] = await Promise.all([
    evaluateAudience(userId, bundle, 500),
    Promise.resolve(contactMap(userId, bundle.campaign.datasetId)),
    Promise.resolve(enrollmentMap(bundle.campaign.id)),
  ]);

  let contactableCount = 0;
  let missingPhoneCount = 0;
  let noConsentCount = 0;
  const sample = eligible.rows.slice(0, 50).map((row): EligibleInvestorPreview => {
    const contact = contacts.get(row.investorId);
    const status = contactStatus(contact);
    if (status === "contactable") contactableCount += 1;
    if (status === "missing_phone") missingPhoneCount += 1;
    if (status === "no_consent") noConsentCount += 1;
    return {
      investorId: row.investorId,
      name: row.name,
      city: row.city,
      state: row.state,
      kycStatus: row.kycStatus,
      bankVerifiedDate: row.bankVerifiedDate,
      accountActivatedDate: row.accountActivatedDate,
      lastIntentAt: row.lastIntentAt,
      lastIntentEvent: row.lastIntentEvent,
      intentEvents: row.intentEvents,
      targetFundName: row.targetFundName,
      phoneNumber: contact?.phoneNumber,
      consent: contact?.consent,
      contactStatus: status,
    };
  });

  for (const row of eligible.rows.slice(50)) {
    const status = contactStatus(contacts.get(row.investorId));
    if (status === "contactable") contactableCount += 1;
    if (status === "missing_phone") missingPhoneCount += 1;
    if (status === "no_consent") noConsentCount += 1;
  }

  const warnings: string[] = [];
  if (eligible.eligibleCount > eligible.rows.length) {
    warnings.push(`Preview evaluated the first ${eligible.rows.length.toLocaleString()} eligible investors for contactability.`);
  }
  if (missingPhoneCount > 0) warnings.push(`${missingPhoneCount.toLocaleString()} eligible investors have no imported phone mapping.`);
  if (noConsentCount > 0) warnings.push(`${noConsentCount.toLocaleString()} eligible investors have phone mappings without consent.`);

  return {
    campaignId,
    asOfDate: bundle.campaign.asOfDate,
    eligibleCount: eligible.eligibleCount,
    contactableCount,
    missingPhoneCount,
    noConsentCount,
    alreadyEnrolledCount: existingEnrollments.size,
    sample,
    segmentColumn: eligible.segmentColumn,
    warnings,
  };
}

export async function enrollCampaignAudience(userId: string, campaignId: string): Promise<EnrollmentSummary> {
  const bundle = getLifecycleCampaignBundle(userId, campaignId);
  if (!bundle) throw new Error("Campaign not found");
  const eligible = await evaluateAudience(userId, bundle, 10_000);
  const contacts = contactMap(userId, bundle.campaign.datasetId);
  const existing = enrollmentMap(bundle.campaign.id);
  const current = nowIso();
  const attributionWindowEndsAt = addDays(bundle.campaign.asOfDate, bundle.campaign.attributionWindowDays);
  const byArm = new Map(bundle.arms.map((arm) => [arm.id, {
    armId: arm.id,
    armName: arm.name,
    type: arm.type,
    count: 0,
  }]));

  let enrolledCreated = 0;
  let enrolledExisting = 0;
  let controlCount = 0;
  let treatmentCount = 0;
  let taskCreated = 0;
  let taskExisting = 0;
  let excludedMissingPhone = 0;
  let excludedNoConsent = 0;

  const tx = getDb().transaction(() => {
    updateLifecycleCampaignStatus(bundle.campaign.id, "enrolling");

    for (const row of eligible.rows) {
      const contact = contacts.get(row.investorId);
      if (!contact) {
        excludedMissingPhone += 1;
        continue;
      }
      if (!contact.consent) {
        excludedNoConsent += 1;
        continue;
      }

      const prior = existing.get(row.investorId);
      let enrollment: LifecycleEnrollment;
      if (prior) {
        enrolledExisting += 1;
        enrollment = prior;
      } else {
        const decision = assignExperimentArm(
          bundle.experiment.id,
          row.investorId,
          bundle.experiment.salt,
          bundle.arms,
        );
        const enrollmentId = stableId("enr", bundle.campaign.id, row.investorId);
        enrollment = {
          id: enrollmentId,
          campaignId: bundle.campaign.id,
          experimentId: bundle.experiment.id,
          armId: decision.arm.id,
          investorId: row.investorId,
          segmentId: bundle.campaign.segmentId,
          currentState: decision.arm.type === "control" ? "assigned_control" : "queued",
          firstQualifiedAt: row.lastIntentAt ?? `${bundle.campaign.asOfDate}T00:00:00.000Z`,
          enrolledAt: current,
          assignedAt: current,
          attributionWindowEndsAt,
          createdAt: current,
          updatedAt: current,
        };
        const result = upsertEnrollment(enrollment);
        enrollment = result.enrollment;
        enrolledCreated += result.created ? 1 : 0;

        upsertCampaignEvent({
          id: eventId(bundle.campaign.id, row.investorId, "assigned", "assignment"),
          userId,
          datasetId: bundle.campaign.datasetId,
          campaignId: bundle.campaign.id,
          experimentId: bundle.experiment.id,
          armId: decision.arm.id,
          enrollmentId: enrollment.id,
          investorId: row.investorId,
          eventType: "assigned",
          occurredAt: current,
          source: "assignment",
          metadata: {
            bucket: decision.bucket,
            hash: decision.hash.slice(0, 12),
            armName: decision.arm.name,
          },
          createdAt: current,
        });
      }

      const arm = bundle.arms.find((item) => item.id === enrollment.armId);
      if (!arm) continue;
      const count = byArm.get(arm.id);
      if (count) count.count += 1;
      if (arm.type === "control") {
        controlCount += 1;
        continue;
      }

      treatmentCount += 1;
      const offerInstance: OfferInstance = {
        id: stableId("ofi", enrollment.id),
        campaignId: bundle.campaign.id,
        experimentId: bundle.experiment.id,
        armId: arm.id,
        enrollmentId: enrollment.id,
        investorId: row.investorId,
        offerId: bundle.campaign.offerId,
        skuId: getPurpose(bundle.campaign.offerId, bundle.campaign.datasetId, bundle.campaign.userId)?.sku,
        deeplink: `/activate/fundsindia?campaign=${encodeURIComponent(bundle.campaign.id)}&offerInstance=${encodeURIComponent(stableId("ofi", enrollment.id))}`,
        status: "assigned",
        createdAt: current,
        updatedAt: current,
      };
      const offerResult = upsertOfferInstance(offerInstance);
      setEnrollmentOfferInstance(enrollment.id, offerResult.instance.id);

      const task = upsertTreatmentTask({
        id: stableId("tt", enrollment.id),
        campaignId: bundle.campaign.id,
        experimentId: bundle.experiment.id,
        armId: arm.id,
        enrollmentId: enrollment.id,
        offerInstanceId: offerResult.instance.id,
        investorId: row.investorId,
        channel: "voice",
        provider: "plivo-gemini",
        status: "queued",
        createdAt: current,
        updatedAt: current,
      });
      if (task.created) taskCreated += 1;
      else taskExisting += 1;
    }

    updateLifecycleCampaignStatus(bundle.campaign.id, "draft");
  });

  tx();

  return {
    campaignId,
    eligibleCount: eligible.eligibleCount,
    contactableCount: eligible.rows.length - excludedMissingPhone - excludedNoConsent,
    enrolledCreated,
    enrolledExisting,
    controlCount,
    treatmentCount,
    taskCreated,
    taskExisting,
    excludedMissingPhone,
    excludedNoConsent,
    byArm: Array.from(byArm.values()),
  };
}

function mapVoiceStatus(status: VoiceCallStatus): TreatmentTaskStatus {
  if (status === "queued") return "queued";
  if (status === "calling") return "calling";
  if (status === "connected") return "connected";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "no_answer";
}

export function syncTreatmentTasksFromVoiceCalls(campaignId: string): void {
  const tasks = listTreatmentTasks(campaignId);
  for (const task of tasks) {
    if (!task.voiceCampaignId || !task.voiceCallId) continue;
    const voiceCampaign = getVoiceCampaign(task.voiceCampaignId);
    const call = voiceCampaign?.calls.find((item) =>
      item.id === task.voiceCallId || item.callConfigId === task.voiceCallId
    );
    if (!call) continue;
    const nextStatus = mapVoiceStatus(call.status);
    if (nextStatus !== task.status || call.endedAt !== task.endedAt) {
      patchTreatmentTask(task.id, {
        status: nextStatus,
        endedAt: call.endedAt,
        lastError: call.status === "failed" ? call.summary : task.lastError,
      });
    }
  }
}

export async function launchQueuedTreatmentTasks(userId: string, campaignId: string): Promise<CampaignRunSummary> {
  const bundle = getLifecycleCampaignBundle(userId, campaignId);
  if (!bundle) throw new Error("Campaign not found");

  syncTreatmentTasksFromVoiceCalls(campaignId);
  const tasks = listTreatmentTasks(campaignId).filter((task) => task.status === "queued");
  if (tasks.length === 0) return campaignRunSummary(userId, campaignId);

  ensureCampaignCallConfig("plivo-gemini");
  updateLifecycleCampaignStatus(campaignId, "running");
  const contacts = contactMap(userId, bundle.campaign.datasetId);
  const segmentName = lifecycleSegmentLabel(
    bundle.campaign.segmentId,
    segmentForCampaign(userId, bundle)?.name,
  );
  const offer = getPurpose(bundle.campaign.offerId, bundle.campaign.datasetId, bundle.campaign.userId);

  for (const arm of bundle.arms.filter((item) => item.type === "treatment")) {
    const armTasks = tasks.filter((task) => task.armId === arm.id);
    if (armTasks.length === 0) continue;
    const voiceCampaignId = stableId("vc_lc", campaignId, arm.id);
    const voiceConfig = arm.voiceConfig ?? {
      provider: "plivo-gemini" as const,
      voice: "Aoede",
      voiceName: "Aanya",
      language: "English",
    };
    const existing = getVoiceCampaign(voiceCampaignId);
    const phoneNumbers = armTasks
      .map((task) => contacts.get(task.investorId)?.phoneNumber)
      .filter((phone): phone is string => Boolean(phone));
    const voiceCampaign: VoiceCampaign = existing ?? {
      id: voiceCampaignId,
      userId,
      name: `${bundle.campaign.name} · ${arm.name}`,
      datasetId: bundle.campaign.datasetId,
      datasetLabel: "Mutual Fund Platform",
      companyName: "FundsIndia",
      entityName: "investors",
      segmentId: bundle.campaign.segmentId,
      segmentName,
      purposeId: bundle.campaign.offerId,
      purposeName: offer?.name ?? bundle.campaign.offerId,
      systemPrompt: arm.metadata?.systemPrompt ?? "",
      firstMessage: arm.metadata?.firstMessage ?? "Hi, this is Aanya from FundsIndia. Do you have a minute to talk?",
      scriptReasoning: arm.metadata?.scriptSummary ?? "Lifecycle campaign experiment script.",
      editableScript: arm.metadata?.systemPrompt,
      agentId: REALTIME_MODEL,
      voice: voiceConfig.voice,
      voiceName: voiceConfig.voiceName,
      callProvider: "plivo-gemini",
      voiceProvider: "gemini-live",
      language: voiceConfig.language,
      phoneNumbers,
      status: "in_progress",
      calls: [],
      createdAt: nowIso(),
      launchedAt: nowIso(),
    };

    if (existing) {
      updateVoiceCampaign(voiceCampaignId, {
        phoneNumbers,
        status: "in_progress",
      }, { userId, datasetId: bundle.campaign.datasetId });
    } else {
      saveCampaign(voiceCampaign);
    }

    const plannedCalls = [];
    for (const task of armTasks) {
      const phoneNumber = contacts.get(task.investorId)?.phoneNumber;
      if (!phoneNumber) continue;
      patchTreatmentTask(task.id, {
        status: "starting",
        voiceCampaignId,
        voiceCallId: task.id,
        startedAt: nowIso(),
      });
      plannedCalls.push({
        num: phoneNumber,
        callConfigId: task.id,
        customerContext: await buildFundsIndiaVoiceCustomerContext(bundle.campaign.datasetId, task.investorId),
      });
      upsertCampaignEvent({
        id: eventId(campaignId, task.investorId, "call_attempted", "voice_call", task.id),
        userId,
        datasetId: bundle.campaign.datasetId,
        campaignId,
        experimentId: task.experimentId,
        armId: task.armId,
        enrollmentId: task.enrollmentId,
        offerInstanceId: task.offerInstanceId,
        investorId: task.investorId,
        eventType: "call_attempted",
        occurredAt: nowIso(),
        source: "voice_call",
        metadata: { voiceCampaignId, voiceCallId: task.id },
        createdAt: nowIso(),
      });
    }

    seedPlannedVoiceCalls(voiceCampaign, plannedCalls, { route: "/api/campaigns/[id]/launch" });
    for (const call of plannedCalls) {
      patchTreatmentTask(call.callConfigId, { status: "calling" });
    }
    void startPlannedVoiceCalls(voiceCampaign, plannedCalls, { route: "/api/campaigns/[id]/launch" });
  }

  return campaignRunSummary(userId, campaignId);
}

export function campaignRunSummary(userId: string, campaignId: string): CampaignRunSummary {
  const bundle = getLifecycleCampaignBundle(userId, campaignId);
  if (!bundle) throw new Error("Campaign not found");
  syncTreatmentTasksFromVoiceCalls(campaignId);
  const enrollments = listEnrollments(campaignId);
  const tasks = listTreatmentTasks(campaignId);
  const events = listCampaignEvents(campaignId);
  const tasksByStatus = Object.fromEntries(TASK_STATUSES.map((status) => [status, 0])) as Record<TreatmentTaskStatus, number>;
  for (const task of tasks) tasksByStatus[task.status] += 1;
  const eventsByType: Record<string, number> = {};
  for (const event of events) eventsByType[event.eventType] = (eventsByType[event.eventType] ?? 0) + 1;
  const controlArmIds = new Set(bundle.arms.filter((arm) => arm.type === "control").map((arm) => arm.id));

  return {
    campaignId,
    status: bundle.campaign.status,
    enrollmentCount: enrollments.length,
    controlCount: enrollments.filter((enrollment) => controlArmIds.has(enrollment.armId)).length,
    treatmentCount: enrollments.filter((enrollment) => !controlArmIds.has(enrollment.armId)).length,
    tasksByStatus,
    eventsByType,
    guardrailCount: events.filter((event) =>
      ["wrong_number", "complaint", "conduct_flag", "opted_out"].includes(event.eventType)
    ).length,
    tasks,
  };
}

export async function analyzeCampaignTranscripts(userId: string, campaignId: string): Promise<{ analyzed: number; eventsCreated: number }> {
  const bundle = getLifecycleCampaignBundle(userId, campaignId);
  if (!bundle) throw new Error("Campaign not found");
  syncTreatmentTasksFromVoiceCalls(campaignId);
  const tasks = listTreatmentTasks(campaignId);
  let analyzed = 0;
  let eventsCreated = 0;

  for (const task of tasks) {
    if (!task.voiceCampaignId || !task.voiceCallId) continue;
    const voiceCampaign = getVoiceCampaign(task.voiceCampaignId);
    const call = voiceCampaign?.calls.find((item) =>
      item.id === task.voiceCallId || item.callConfigId === task.voiceCallId
    );
    if (!call) continue;
    const extracted = extractLifecycleTranscriptEvents(call);
    if (extracted.eventTypes.length === 0) continue;
    analyzed += 1;
    for (const eventType of extracted.eventTypes) {
      upsertCampaignEvent({
        id: eventId(campaignId, task.investorId, eventType, "transcript_analysis", task.id),
        userId,
        datasetId: bundle.campaign.datasetId,
        campaignId,
        experimentId: task.experimentId,
        armId: task.armId,
        enrollmentId: task.enrollmentId,
        offerInstanceId: task.offerInstanceId,
        investorId: task.investorId,
        eventType,
        occurredAt: call.endedAt ?? nowIso(),
        source: "transcript_analysis",
        metadata: {
          ...extracted.metadata,
          summary: extracted.summary,
          confidence: extracted.confidence,
          voiceCampaignId: task.voiceCampaignId,
          voiceCallId: task.voiceCallId,
        },
        createdAt: nowIso(),
      });
      eventsCreated += 1;
    }
  }

  return { analyzed, eventsCreated };
}

export async function campaignResults(userId: string, campaignId: string): Promise<CampaignResults> {
  const bundle = getLifecycleCampaignBundle(userId, campaignId);
  if (!bundle) throw new Error("Campaign not found");
  syncTreatmentTasksFromVoiceCalls(campaignId);
  const enrollments = listEnrollments(campaignId);
  const tasks = listTreatmentTasks(campaignId);
  const events = listCampaignEvents(campaignId);
  const eventsByInvestor = new Map<string, CampaignEvent[]>();
  for (const event of events) {
    const current = eventsByInvestor.get(event.investorId) ?? [];
    current.push(event);
    eventsByInvestor.set(event.investorId, current);
  }

  const conversionDates = await loadFundsIndiaConversions({
    datasetId: bundle.campaign.datasetId,
    investorIds: enrollments.map((enrollment) => enrollment.investorId),
    oecMetric: bundle.experiment.oecMetric,
    startDate: bundle.campaign.asOfDate,
    endDate: addDays(bundle.campaign.asOfDate, bundle.campaign.attributionWindowDays),
  });
  const convertedInvestors = new Set(conversionDates.keys());
  for (const event of events) {
    if (event.eventType === bundle.experiment.oecMetric || event.eventType === "converted") {
      convertedInvestors.add(event.investorId);
    }
  }

  const taskByEnrollment = new Map(tasks.map((task) => [task.enrollmentId, task]));
  const control = bundle.arms.find((arm) => arm.type === "control");
  let controlRate = 0;

  const arms = bundle.arms.map((arm) => {
    const armEnrollments = enrollments.filter((enrollment) => enrollment.armId === arm.id);
    const eventCount = (type: string) => armEnrollments.filter((enrollment) =>
      (eventsByInvestor.get(enrollment.investorId) ?? []).some((event) => event.eventType === type)
    ).length;
    const assigned = armEnrollments.length;
    const converted = armEnrollments.filter((enrollment) => convertedInvestors.has(enrollment.investorId)).length;
    const attempted = armEnrollments.filter((enrollment) => {
      const task = taskByEnrollment.get(enrollment.id);
      return task && !["queued", "starting", "cancelled"].includes(task.status);
    }).length;
    const connected = eventCount("call_connected") || armEnrollments.filter((enrollment) => {
      const status = taskByEnrollment.get(enrollment.id)?.status;
      return status === "connected" || status === "completed";
    }).length;
    const accepted = eventCount("offer_accepted");
    const conversionRate = assigned > 0 ? converted / assigned : 0;
    const result = {
      armId: arm.id,
      armName: arm.name,
      type: arm.type,
      assigned,
      attempted,
      connected,
      pitched: eventCount("sku_pitched"),
      accepted,
      rejected: eventCount("offer_rejected"),
      pending: eventCount("offer_pending"),
      noAnswer: eventCount("call_no_answer"),
      failed: eventCount("call_failed"),
      converted,
      conversionRate,
      acceptanceRate: assigned > 0 ? accepted / assigned : 0,
    };
    if (control && arm.id === control.id) controlRate = conversionRate;
    return result;
  }).map((arm) => ({
    ...arm,
    liftVsControlPctPoints: arm.type === "control" ? undefined : (arm.conversionRate - controlRate) * 100,
  }));

  return {
    campaignId,
    pilotModeLabel: PILOT_MODE_LABEL,
    oecMetric: bundle.experiment.oecMetric,
    attributionWindowDays: bundle.campaign.attributionWindowDays,
    arms,
    totals: {
      assigned: arms.reduce((sum, arm) => sum + arm.assigned, 0),
      attempted: arms.reduce((sum, arm) => sum + arm.attempted, 0),
      connected: arms.reduce((sum, arm) => sum + arm.connected, 0),
      pitched: arms.reduce((sum, arm) => sum + arm.pitched, 0),
      accepted: arms.reduce((sum, arm) => sum + arm.accepted, 0),
      rejected: arms.reduce((sum, arm) => sum + arm.rejected, 0),
      pending: arms.reduce((sum, arm) => sum + arm.pending, 0),
      converted: arms.reduce((sum, arm) => sum + arm.converted, 0),
      guardrails: events.filter((event) =>
        ["wrong_number", "complaint", "conduct_flag", "opted_out"].includes(event.eventType)
      ).length,
    },
    latestDecision: getDecisionRecord(campaignId, bundle.experiment.id) ?? undefined,
    sampleEvents: events.slice(0, 20),
  };
}

export function createManualCampaignEvent(input: {
  userId: string;
  bundle: LifecycleCampaignBundle;
  investorId: string;
  eventType: string;
  source?: CampaignEvent["source"];
  occurredAt?: string;
  metadata?: Record<string, unknown>;
}): CampaignEvent {
  const enrollment = enrollmentMap(input.bundle.campaign.id).get(input.investorId);
  const event: CampaignEvent = {
    id: input.metadata?.eventId && typeof input.metadata.eventId === "string"
      ? input.metadata.eventId
      : eventId(input.bundle.campaign.id, input.investorId, input.eventType, input.source ?? "manual", randomUUID()),
    userId: input.userId,
    datasetId: input.bundle.campaign.datasetId,
    campaignId: input.bundle.campaign.id,
    experimentId: input.bundle.experiment.id,
    armId: enrollment?.armId,
    enrollmentId: enrollment?.id,
    offerInstanceId: enrollment?.offerInstanceId,
    investorId: input.investorId,
    eventType: input.eventType,
    occurredAt: input.occurredAt ?? nowIso(),
    source: input.source ?? "manual",
    metadata: input.metadata,
    createdAt: nowIso(),
  };
  upsertCampaignEvent(event);
  return event;
}
