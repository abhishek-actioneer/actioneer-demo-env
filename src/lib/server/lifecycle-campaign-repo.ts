import "server-only";

import { randomUUID } from "crypto";
import { getDb } from "@/lib/meta-db";
import type {
  CampaignEvent,
  CampaignExperiment,
  ContactIdentity,
  DecisionRecord,
  ExperimentArm,
  LifecycleCampaign,
  LifecycleCampaignBundle,
  LifecycleCampaignListItem,
  LifecycleEnrollment,
  OfferInstance,
  TreatmentTask,
  TreatmentTaskStatus,
} from "@/lib/lifecycle-campaign-types";

type Row = Record<string, unknown>;

export function lifecycleId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 18)}`;
}

function text(row: Row, key: string): string | undefined {
  const value = row[key];
  if (value === null || value === undefined) return undefined;
  const trimmed = String(value).trim();
  return trimmed || undefined;
}

function requiredText(row: Row, key: string): string {
  return text(row, key) ?? "";
}

function numberValue(row: Row, key: string): number {
  const value = row[key];
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function campaignFromRow(row: Row): LifecycleCampaign {
  return {
    id: requiredText(row, "id"),
    userId: requiredText(row, "user_id"),
    datasetId: requiredText(row, "dataset_id"),
    name: requiredText(row, "name"),
    status: requiredText(row, "status") as LifecycleCampaign["status"],
    lifecycleProfileId: requiredText(row, "lifecycle_profile_id") as LifecycleCampaign["lifecycleProfileId"],
    segmentId: requiredText(row, "segment_id"),
    offerId: requiredText(row, "offer_id"),
    asOfDate: requiredText(row, "as_of_date"),
    attributionWindowDays: numberValue(row, "attribution_window_days"),
    contactPolicy: parseJson(row.contact_policy_json, {
      maxCallsPerInvestor: 1,
      retriesEnabled: false,
      quietHours: { start: "10:00", end: "18:30", timezone: "Asia/Kolkata" },
      suppressWrongNumber: true,
      suppressOptOut: true,
      suppressComplaint: true,
      maxCallDurationSeconds: 240,
    }),
    createdAt: requiredText(row, "created_at"),
    updatedAt: requiredText(row, "updated_at"),
  };
}

function experimentFromRow(row: Row): CampaignExperiment {
  return {
    id: requiredText(row, "id"),
    campaignId: requiredText(row, "campaign_id"),
    hypothesis: requiredText(row, "hypothesis"),
    oecMetric: requiredText(row, "oec_metric") as CampaignExperiment["oecMetric"],
    guardrailMetrics: parseJson<string[]>(row.guardrail_metrics_json, []),
    randomizationUnit: requiredText(row, "randomization_unit") as CampaignExperiment["randomizationUnit"],
    salt: requiredText(row, "salt"),
    status: requiredText(row, "status") as CampaignExperiment["status"],
    createdAt: requiredText(row, "created_at"),
    updatedAt: requiredText(row, "updated_at"),
  };
}

function armFromRow(row: Row): ExperimentArm {
  return {
    id: requiredText(row, "id"),
    experimentId: requiredText(row, "experiment_id"),
    type: requiredText(row, "type") as ExperimentArm["type"],
    name: requiredText(row, "name"),
    allocationPct: numberValue(row, "allocation_pct"),
    scriptVariantId: text(row, "script_variant_id"),
    voiceConfig: parseJson(row.voice_config_json, undefined as ExperimentArm["voiceConfig"] | undefined),
    metadata: parseJson(row.metadata_json, undefined as ExperimentArm["metadata"] | undefined),
  };
}

function enrollmentFromRow(row: Row): LifecycleEnrollment {
  return {
    id: requiredText(row, "id"),
    campaignId: requiredText(row, "campaign_id"),
    experimentId: requiredText(row, "experiment_id"),
    armId: requiredText(row, "arm_id"),
    investorId: requiredText(row, "investor_id"),
    segmentId: requiredText(row, "segment_id"),
    currentState: requiredText(row, "current_state"),
    firstQualifiedAt: requiredText(row, "first_qualified_at"),
    enrolledAt: requiredText(row, "enrolled_at"),
    assignedAt: requiredText(row, "assigned_at"),
    attributionWindowEndsAt: requiredText(row, "attribution_window_ends_at"),
    offerInstanceId: text(row, "offer_instance_id"),
    lastTouchAt: text(row, "last_touch_at"),
    cooldownUntil: text(row, "cooldown_until"),
    exitReason: text(row, "exit_reason"),
    createdAt: requiredText(row, "created_at"),
    updatedAt: requiredText(row, "updated_at"),
  };
}

function offerInstanceFromRow(row: Row): OfferInstance {
  return {
    id: requiredText(row, "id"),
    campaignId: requiredText(row, "campaign_id"),
    experimentId: requiredText(row, "experiment_id"),
    armId: requiredText(row, "arm_id"),
    enrollmentId: requiredText(row, "enrollment_id"),
    investorId: requiredText(row, "investor_id"),
    offerId: requiredText(row, "offer_id"),
    skuId: text(row, "sku_id"),
    deeplink: text(row, "deeplink"),
    status: requiredText(row, "status") as OfferInstance["status"],
    createdAt: requiredText(row, "created_at"),
    updatedAt: requiredText(row, "updated_at"),
  };
}

function eventFromRow(row: Row): CampaignEvent {
  return {
    id: requiredText(row, "id"),
    userId: requiredText(row, "user_id"),
    datasetId: requiredText(row, "dataset_id"),
    campaignId: requiredText(row, "campaign_id"),
    experimentId: text(row, "experiment_id"),
    armId: text(row, "arm_id"),
    enrollmentId: text(row, "enrollment_id"),
    offerInstanceId: text(row, "offer_instance_id"),
    investorId: requiredText(row, "investor_id"),
    eventType: requiredText(row, "event_type"),
    occurredAt: requiredText(row, "occurred_at"),
    source: requiredText(row, "source") as CampaignEvent["source"],
    metadata: parseJson(row.metadata_json, undefined as Record<string, unknown> | undefined),
    createdAt: requiredText(row, "created_at"),
  };
}

function contactFromRow(row: Row): ContactIdentity {
  return {
    id: requiredText(row, "id"),
    userId: requiredText(row, "user_id"),
    datasetId: requiredText(row, "dataset_id"),
    entityId: requiredText(row, "entity_id"),
    phoneNumber: requiredText(row, "phone_number"),
    consent: Number(row.consent) === 1,
    name: text(row, "name"),
    preferredLanguage: text(row, "preferred_language"),
    source: requiredText(row, "source") as ContactIdentity["source"],
    createdAt: requiredText(row, "created_at"),
    updatedAt: requiredText(row, "updated_at"),
  };
}

function taskFromRow(row: Row): TreatmentTask {
  return {
    id: requiredText(row, "id"),
    campaignId: requiredText(row, "campaign_id"),
    experimentId: requiredText(row, "experiment_id"),
    armId: requiredText(row, "arm_id"),
    enrollmentId: requiredText(row, "enrollment_id"),
    offerInstanceId: requiredText(row, "offer_instance_id"),
    investorId: requiredText(row, "investor_id"),
    channel: "voice",
    provider: "plivo-gemini",
    status: requiredText(row, "status") as TreatmentTaskStatus,
    voiceCampaignId: text(row, "voice_campaign_id"),
    voiceCallId: text(row, "voice_call_id"),
    scheduledFor: text(row, "scheduled_for"),
    startedAt: text(row, "started_at"),
    endedAt: text(row, "ended_at"),
    lastError: text(row, "last_error"),
    createdAt: requiredText(row, "created_at"),
    updatedAt: requiredText(row, "updated_at"),
  };
}

function decisionFromRow(row: Row): DecisionRecord {
  return {
    id: requiredText(row, "id"),
    campaignId: requiredText(row, "campaign_id"),
    experimentId: requiredText(row, "experiment_id"),
    decision: requiredText(row, "decision") as DecisionRecord["decision"],
    notes: requiredText(row, "notes"),
    nextStep: text(row, "next_step"),
    createdAt: requiredText(row, "created_at"),
    updatedAt: requiredText(row, "updated_at"),
  };
}

export function upsertLifecycleCampaignBundle(input: {
  campaign: LifecycleCampaign;
  experiment: CampaignExperiment;
  arms: ExperimentArm[];
}): LifecycleCampaignBundle {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO lifecycle_campaigns (
        id, user_id, dataset_id, name, status, lifecycle_profile_id, segment_id, offer_id,
        as_of_date, attribution_window_days, contact_policy_json, created_at, updated_at
      ) VALUES (
        @id, @user_id, @dataset_id, @name, @status, @lifecycle_profile_id, @segment_id, @offer_id,
        @as_of_date, @attribution_window_days, @contact_policy_json, @created_at, @updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        status = excluded.status,
        segment_id = excluded.segment_id,
        offer_id = excluded.offer_id,
        as_of_date = excluded.as_of_date,
        attribution_window_days = excluded.attribution_window_days,
        contact_policy_json = excluded.contact_policy_json,
        updated_at = excluded.updated_at
    `).run({
      id: input.campaign.id,
      user_id: input.campaign.userId,
      dataset_id: input.campaign.datasetId,
      name: input.campaign.name,
      status: input.campaign.status,
      lifecycle_profile_id: input.campaign.lifecycleProfileId,
      segment_id: input.campaign.segmentId,
      offer_id: input.campaign.offerId,
      as_of_date: input.campaign.asOfDate,
      attribution_window_days: input.campaign.attributionWindowDays,
      contact_policy_json: json(input.campaign.contactPolicy),
      created_at: input.campaign.createdAt,
      updated_at: input.campaign.updatedAt,
    });

    db.prepare(`
      INSERT INTO campaign_experiments (
        id, campaign_id, hypothesis, oec_metric, guardrail_metrics_json,
        randomization_unit, salt, status, created_at, updated_at
      ) VALUES (
        @id, @campaign_id, @hypothesis, @oec_metric, @guardrail_metrics_json,
        @randomization_unit, @salt, @status, @created_at, @updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        hypothesis = excluded.hypothesis,
        oec_metric = excluded.oec_metric,
        guardrail_metrics_json = excluded.guardrail_metrics_json,
        randomization_unit = excluded.randomization_unit,
        status = excluded.status,
        updated_at = excluded.updated_at
    `).run({
      id: input.experiment.id,
      campaign_id: input.experiment.campaignId,
      hypothesis: input.experiment.hypothesis,
      oec_metric: input.experiment.oecMetric,
      guardrail_metrics_json: json(input.experiment.guardrailMetrics),
      randomization_unit: input.experiment.randomizationUnit,
      salt: input.experiment.salt,
      status: input.experiment.status,
      created_at: input.experiment.createdAt,
      updated_at: input.experiment.updatedAt,
    });

    db.prepare(`DELETE FROM experiment_arms WHERE experiment_id = ?`).run(input.experiment.id);
    const insertArm = db.prepare(`
      INSERT INTO experiment_arms (
        id, experiment_id, type, name, allocation_pct, script_variant_id, voice_config_json, metadata_json
      ) VALUES (
        @id, @experiment_id, @type, @name, @allocation_pct, @script_variant_id, @voice_config_json, @metadata_json
      )
    `);
    for (const arm of input.arms) {
      insertArm.run({
        id: arm.id,
        experiment_id: arm.experimentId,
        type: arm.type,
        name: arm.name,
        allocation_pct: arm.allocationPct,
        script_variant_id: arm.scriptVariantId ?? null,
        voice_config_json: arm.voiceConfig ? json(arm.voiceConfig) : null,
        metadata_json: arm.metadata ? json(arm.metadata) : null,
      });
    }
  });
  tx();
  return input;
}

export function listLifecycleCampaigns(userId: string, datasetId: string): LifecycleCampaignListItem[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      c.*,
      e.id AS experiment_id,
      e.oec_metric,
      (SELECT COUNT(*) FROM lifecycle_enrollments le WHERE le.campaign_id = c.id) AS enrolled_count,
      (SELECT COUNT(*) FROM treatment_tasks tt WHERE tt.campaign_id = c.id) AS treatment_task_count,
      (SELECT COUNT(*) FROM treatment_tasks tt
        WHERE tt.campaign_id = c.id AND tt.status IN ('calling', 'connected', 'completed', 'failed', 'no_answer')) AS attempted_count,
      (SELECT COUNT(*) FROM campaign_events ce
        WHERE ce.campaign_id = c.id AND ce.event_type IN (e.oec_metric, 'converted')) AS converted_count,
      (SELECT COUNT(*) FROM campaign_events ce
        WHERE ce.campaign_id = c.id AND ce.event_type IN ('wrong_number', 'complaint', 'conduct_flag', 'opted_out')) AS guardrail_count,
      (SELECT dr.decision FROM decision_records dr
        WHERE dr.campaign_id = c.id ORDER BY dr.updated_at DESC LIMIT 1) AS latest_decision
    FROM lifecycle_campaigns c
    LEFT JOIN campaign_experiments e ON e.campaign_id = c.id
    WHERE c.user_id = ? AND c.dataset_id = ?
    ORDER BY c.updated_at DESC
  `).all(userId, datasetId) as Row[];

  return rows.map((row) => {
    const enrolledCount = numberValue(row, "enrolled_count");
    const convertedCount = numberValue(row, "converted_count");
    return {
      id: requiredText(row, "id"),
      name: requiredText(row, "name"),
      datasetId: requiredText(row, "dataset_id"),
      status: requiredText(row, "status") as LifecycleCampaignListItem["status"],
      lifecycleProfileId: requiredText(row, "lifecycle_profile_id"),
      segmentId: requiredText(row, "segment_id"),
      offerId: requiredText(row, "offer_id"),
      asOfDate: requiredText(row, "as_of_date"),
      enrolledCount,
      treatmentTaskCount: numberValue(row, "treatment_task_count"),
      attemptedCount: numberValue(row, "attempted_count"),
      conversionRate: enrolledCount > 0 ? convertedCount / enrolledCount : null,
      guardrailCount: numberValue(row, "guardrail_count"),
      latestDecision: text(row, "latest_decision") as LifecycleCampaignListItem["latestDecision"],
      updatedAt: requiredText(row, "updated_at"),
      createdAt: requiredText(row, "created_at"),
    };
  });
}

export function getLifecycleCampaignBundle(
  userId: string,
  campaignId: string,
  datasetId?: string,
): LifecycleCampaignBundle | null {
  const db = getDb();
  const campaignRow = db.prepare(`
    SELECT * FROM lifecycle_campaigns
    WHERE user_id = ? AND id = ? ${datasetId ? "AND dataset_id = ?" : ""}
    LIMIT 1
  `).get(...(datasetId ? [userId, campaignId, datasetId] : [userId, campaignId])) as Row | undefined;
  if (!campaignRow) return null;

  const experimentRow = db.prepare(`
    SELECT * FROM campaign_experiments WHERE campaign_id = ? LIMIT 1
  `).get(campaignId) as Row | undefined;
  if (!experimentRow) return null;

  const armRows = db.prepare(`
    SELECT * FROM experiment_arms
    WHERE experiment_id = ?
    ORDER BY CASE type WHEN 'control' THEN 0 ELSE 1 END, name ASC
  `).all(requiredText(experimentRow, "id")) as Row[];

  return {
    campaign: campaignFromRow(campaignRow),
    experiment: experimentFromRow(experimentRow),
    arms: armRows.map(armFromRow),
  };
}

export function updateLifecycleCampaignStatus(campaignId: string, status: LifecycleCampaign["status"]): void {
  getDb().prepare(`
    UPDATE lifecycle_campaigns SET status = ?, updated_at = ? WHERE id = ?
  `).run(status, new Date().toISOString(), campaignId);
}

export function upsertContactIdentity(contact: ContactIdentity): void {
  getDb().prepare(`
    INSERT INTO contact_identities (
      id, user_id, dataset_id, entity_id, phone_number, consent, name,
      preferred_language, source, created_at, updated_at
    ) VALUES (
      @id, @user_id, @dataset_id, @entity_id, @phone_number, @consent, @name,
      @preferred_language, @source, @created_at, @updated_at
    )
    ON CONFLICT(user_id, dataset_id, entity_id) DO UPDATE SET
      phone_number = excluded.phone_number,
      consent = excluded.consent,
      name = excluded.name,
      preferred_language = excluded.preferred_language,
      source = excluded.source,
      updated_at = excluded.updated_at
  `).run({
    id: contact.id,
    user_id: contact.userId,
    dataset_id: contact.datasetId,
    entity_id: contact.entityId,
    phone_number: contact.phoneNumber,
    consent: contact.consent ? 1 : 0,
    name: contact.name ?? null,
    preferred_language: contact.preferredLanguage ?? null,
    source: contact.source,
    created_at: contact.createdAt,
    updated_at: contact.updatedAt,
  });
}

export function listContactIdentities(userId: string, datasetId: string): ContactIdentity[] {
  const rows = getDb().prepare(`
    SELECT * FROM contact_identities
    WHERE user_id = ? AND dataset_id = ?
    ORDER BY updated_at DESC
  `).all(userId, datasetId) as Row[];
  return rows.map(contactFromRow);
}

export function contactMap(userId: string, datasetId: string): Map<string, ContactIdentity> {
  return new Map(listContactIdentities(userId, datasetId).map((contact) => [contact.entityId, contact]));
}

export function listEnrollments(campaignId: string): LifecycleEnrollment[] {
  const rows = getDb().prepare(`
    SELECT * FROM lifecycle_enrollments
    WHERE campaign_id = ?
    ORDER BY enrolled_at ASC
  `).all(campaignId) as Row[];
  return rows.map(enrollmentFromRow);
}

export function enrollmentMap(campaignId: string): Map<string, LifecycleEnrollment> {
  return new Map(listEnrollments(campaignId).map((enrollment) => [enrollment.investorId, enrollment]));
}

export function upsertEnrollment(enrollment: LifecycleEnrollment): { created: boolean; enrollment: LifecycleEnrollment } {
  const db = getDb();
  const before = db.prepare(`
    SELECT * FROM lifecycle_enrollments WHERE campaign_id = ? AND investor_id = ? LIMIT 1
  `).get(enrollment.campaignId, enrollment.investorId) as Row | undefined;

  db.prepare(`
    INSERT INTO lifecycle_enrollments (
      id, campaign_id, experiment_id, arm_id, investor_id, segment_id, current_state,
      first_qualified_at, enrolled_at, assigned_at, attribution_window_ends_at,
      offer_instance_id, last_touch_at, cooldown_until, exit_reason, created_at, updated_at
    ) VALUES (
      @id, @campaign_id, @experiment_id, @arm_id, @investor_id, @segment_id, @current_state,
      @first_qualified_at, @enrolled_at, @assigned_at, @attribution_window_ends_at,
      @offer_instance_id, @last_touch_at, @cooldown_until, @exit_reason, @created_at, @updated_at
    )
    ON CONFLICT(campaign_id, investor_id) DO UPDATE SET
      offer_instance_id = COALESCE(lifecycle_enrollments.offer_instance_id, excluded.offer_instance_id),
      updated_at = excluded.updated_at
  `).run({
    id: enrollment.id,
    campaign_id: enrollment.campaignId,
    experiment_id: enrollment.experimentId,
    arm_id: enrollment.armId,
    investor_id: enrollment.investorId,
    segment_id: enrollment.segmentId,
    current_state: enrollment.currentState,
    first_qualified_at: enrollment.firstQualifiedAt,
    enrolled_at: enrollment.enrolledAt,
    assigned_at: enrollment.assignedAt,
    attribution_window_ends_at: enrollment.attributionWindowEndsAt,
    offer_instance_id: enrollment.offerInstanceId ?? null,
    last_touch_at: enrollment.lastTouchAt ?? null,
    cooldown_until: enrollment.cooldownUntil ?? null,
    exit_reason: enrollment.exitReason ?? null,
    created_at: enrollment.createdAt,
    updated_at: enrollment.updatedAt,
  });

  const row = db.prepare(`
    SELECT * FROM lifecycle_enrollments WHERE campaign_id = ? AND investor_id = ? LIMIT 1
  `).get(enrollment.campaignId, enrollment.investorId) as Row;
  return { created: !before, enrollment: enrollmentFromRow(row) };
}

export function setEnrollmentOfferInstance(enrollmentId: string, offerInstanceId: string): void {
  getDb().prepare(`
    UPDATE lifecycle_enrollments
    SET offer_instance_id = COALESCE(offer_instance_id, ?), updated_at = ?
    WHERE id = ?
  `).run(offerInstanceId, new Date().toISOString(), enrollmentId);
}

export function upsertOfferInstance(instance: OfferInstance): { created: boolean; instance: OfferInstance } {
  const db = getDb();
  const before = db.prepare(`
    SELECT * FROM offer_instances WHERE enrollment_id = ? LIMIT 1
  `).get(instance.enrollmentId) as Row | undefined;

  db.prepare(`
    INSERT INTO offer_instances (
      id, campaign_id, experiment_id, arm_id, enrollment_id, investor_id, offer_id,
      sku_id, deeplink, status, created_at, updated_at
    ) VALUES (
      @id, @campaign_id, @experiment_id, @arm_id, @enrollment_id, @investor_id, @offer_id,
      @sku_id, @deeplink, @status, @created_at, @updated_at
    )
    ON CONFLICT(enrollment_id) DO UPDATE SET
      status = offer_instances.status,
      updated_at = excluded.updated_at
  `).run({
    id: instance.id,
    campaign_id: instance.campaignId,
    experiment_id: instance.experimentId,
    arm_id: instance.armId,
    enrollment_id: instance.enrollmentId,
    investor_id: instance.investorId,
    offer_id: instance.offerId,
    sku_id: instance.skuId ?? null,
    deeplink: instance.deeplink ?? null,
    status: instance.status,
    created_at: instance.createdAt,
    updated_at: instance.updatedAt,
  });

  const row = db.prepare(`SELECT * FROM offer_instances WHERE enrollment_id = ? LIMIT 1`)
    .get(instance.enrollmentId) as Row;
  return { created: !before, instance: offerInstanceFromRow(row) };
}

export function listOfferInstances(campaignId: string): OfferInstance[] {
  const rows = getDb().prepare(`
    SELECT * FROM offer_instances WHERE campaign_id = ? ORDER BY created_at ASC
  `).all(campaignId) as Row[];
  return rows.map(offerInstanceFromRow);
}

export function upsertTreatmentTask(task: TreatmentTask): { created: boolean; task: TreatmentTask } {
  const db = getDb();
  const before = db.prepare(`SELECT * FROM treatment_tasks WHERE enrollment_id = ? LIMIT 1`)
    .get(task.enrollmentId) as Row | undefined;

  db.prepare(`
    INSERT INTO treatment_tasks (
      id, campaign_id, experiment_id, arm_id, enrollment_id, offer_instance_id, investor_id,
      channel, provider, status, voice_campaign_id, voice_call_id, scheduled_for,
      started_at, ended_at, last_error, created_at, updated_at
    ) VALUES (
      @id, @campaign_id, @experiment_id, @arm_id, @enrollment_id, @offer_instance_id, @investor_id,
      @channel, @provider, @status, @voice_campaign_id, @voice_call_id, @scheduled_for,
      @started_at, @ended_at, @last_error, @created_at, @updated_at
    )
    ON CONFLICT(enrollment_id) DO UPDATE SET
      status = treatment_tasks.status,
      updated_at = excluded.updated_at
  `).run({
    id: task.id,
    campaign_id: task.campaignId,
    experiment_id: task.experimentId,
    arm_id: task.armId,
    enrollment_id: task.enrollmentId,
    offer_instance_id: task.offerInstanceId,
    investor_id: task.investorId,
    channel: task.channel,
    provider: task.provider,
    status: task.status,
    voice_campaign_id: task.voiceCampaignId ?? null,
    voice_call_id: task.voiceCallId ?? null,
    scheduled_for: task.scheduledFor ?? null,
    started_at: task.startedAt ?? null,
    ended_at: task.endedAt ?? null,
    last_error: task.lastError ?? null,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
  });

  const row = db.prepare(`SELECT * FROM treatment_tasks WHERE enrollment_id = ? LIMIT 1`)
    .get(task.enrollmentId) as Row;
  return { created: !before, task: taskFromRow(row) };
}

export function listTreatmentTasks(campaignId: string): TreatmentTask[] {
  const rows = getDb().prepare(`
    SELECT * FROM treatment_tasks WHERE campaign_id = ? ORDER BY created_at ASC
  `).all(campaignId) as Row[];
  return rows.map(taskFromRow);
}

export function patchTreatmentTask(
  taskId: string,
  patch: Partial<Pick<TreatmentTask, "status" | "voiceCampaignId" | "voiceCallId" | "startedAt" | "endedAt" | "lastError">>,
): void {
  const existing = getDb().prepare(`SELECT * FROM treatment_tasks WHERE id = ? LIMIT 1`).get(taskId) as Row | undefined;
  if (!existing) return;
  const task = taskFromRow(existing);
  getDb().prepare(`
    UPDATE treatment_tasks
    SET status = @status,
        voice_campaign_id = @voice_campaign_id,
        voice_call_id = @voice_call_id,
        started_at = @started_at,
        ended_at = @ended_at,
        last_error = @last_error,
        updated_at = @updated_at
    WHERE id = @id
  `).run({
    id: taskId,
    status: patch.status ?? task.status,
    voice_campaign_id: patch.voiceCampaignId ?? task.voiceCampaignId ?? null,
    voice_call_id: patch.voiceCallId ?? task.voiceCallId ?? null,
    started_at: patch.startedAt ?? task.startedAt ?? null,
    ended_at: patch.endedAt ?? task.endedAt ?? null,
    last_error: patch.lastError ?? task.lastError ?? null,
    updated_at: new Date().toISOString(),
  });
}

export function upsertCampaignEvent(event: CampaignEvent): void {
  getDb().prepare(`
    INSERT INTO campaign_events (
      id, user_id, dataset_id, campaign_id, experiment_id, arm_id, enrollment_id,
      offer_instance_id, investor_id, event_type, occurred_at, source, metadata_json, created_at
    ) VALUES (
      @id, @user_id, @dataset_id, @campaign_id, @experiment_id, @arm_id, @enrollment_id,
      @offer_instance_id, @investor_id, @event_type, @occurred_at, @source, @metadata_json, @created_at
    )
    ON CONFLICT(id) DO UPDATE SET
      metadata_json = excluded.metadata_json
  `).run({
    id: event.id,
    user_id: event.userId,
    dataset_id: event.datasetId,
    campaign_id: event.campaignId,
    experiment_id: event.experimentId ?? null,
    arm_id: event.armId ?? null,
    enrollment_id: event.enrollmentId ?? null,
    offer_instance_id: event.offerInstanceId ?? null,
    investor_id: event.investorId,
    event_type: event.eventType,
    occurred_at: event.occurredAt,
    source: event.source,
    metadata_json: event.metadata ? json(event.metadata) : null,
    created_at: event.createdAt,
  });
}

export function listCampaignEvents(campaignId: string): CampaignEvent[] {
  const rows = getDb().prepare(`
    SELECT * FROM campaign_events
    WHERE campaign_id = ?
    ORDER BY occurred_at DESC, created_at DESC
  `).all(campaignId) as Row[];
  return rows.map(eventFromRow);
}

export function upsertDecisionRecord(decision: DecisionRecord): DecisionRecord {
  getDb().prepare(`
    INSERT INTO decision_records (
      id, campaign_id, experiment_id, decision, notes, next_step, created_at, updated_at
    ) VALUES (
      @id, @campaign_id, @experiment_id, @decision, @notes, @next_step, @created_at, @updated_at
    )
    ON CONFLICT(campaign_id, experiment_id) DO UPDATE SET
      decision = excluded.decision,
      notes = excluded.notes,
      next_step = excluded.next_step,
      updated_at = excluded.updated_at
  `).run({
    id: decision.id,
    campaign_id: decision.campaignId,
    experiment_id: decision.experimentId,
    decision: decision.decision,
    notes: decision.notes,
    next_step: decision.nextStep ?? null,
    created_at: decision.createdAt,
    updated_at: decision.updatedAt,
  });
  return getDecisionRecord(decision.campaignId, decision.experimentId) ?? decision;
}

export function getDecisionRecord(campaignId: string, experimentId: string): DecisionRecord | null {
  const row = getDb().prepare(`
    SELECT * FROM decision_records
    WHERE campaign_id = ? AND experiment_id = ?
    LIMIT 1
  `).get(campaignId, experimentId) as Row | undefined;
  return row ? decisionFromRow(row) : null;
}
