export const FUNDSINDIA_LIFECYCLE_DATASET_ID = "fundsindia";
export const FUNDSINDIA_KYC_RECOVERY_PROFILE_ID = "fundsindia_kyc_recovery";
export const PROFILE_ONLY_SEGMENT_ID = "profile:fundsindia_kyc_recovery";
export const PILOT_MODE_LABEL = "Pilot mode: directional readout, not powered for statistical significance.";

export type LifecycleCampaignStatus = "draft" | "enrolling" | "running" | "completed" | "stopped";
export type CampaignExperimentStatus = "draft" | "running" | "completed" | "stopped";
export type ExperimentArmType = "control" | "treatment";
export type RandomizationUnit = "investor_id";
export type OecMetric = "account_activated" | "kyc_completed" | "bank_verified";
export type CampaignEventSource =
  | "segment_evaluator"
  | "assignment"
  | "voice_call"
  | "transcript_analysis"
  | "manual"
  | "simulator"
  | "system";
export type OfferInstanceStatus =
  | "assigned"
  | "pitched"
  | "accepted"
  | "rejected"
  | "pending"
  | "converted"
  | "expired";
export type TreatmentTaskStatus =
  | "queued"
  | "starting"
  | "calling"
  | "connected"
  | "completed"
  | "failed"
  | "no_answer"
  | "cancelled";
export type DecisionValue = "ship" | "kill" | "iterate";

export interface ContactPolicy {
  maxCallsPerInvestor: number;
  retriesEnabled: boolean;
  quietHours: {
    start: string;
    end: string;
    timezone: string;
  };
  suppressWrongNumber: boolean;
  suppressOptOut: boolean;
  suppressComplaint: boolean;
  maxCallDurationSeconds: number;
}

export interface LifecycleCampaign {
  id: string;
  userId: string;
  datasetId: string;
  name: string;
  status: LifecycleCampaignStatus;
  lifecycleProfileId: typeof FUNDSINDIA_KYC_RECOVERY_PROFILE_ID;
  segmentId: string;
  offerId: string;
  asOfDate: string;
  attributionWindowDays: number;
  contactPolicy: ContactPolicy;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignExperiment {
  id: string;
  campaignId: string;
  hypothesis: string;
  oecMetric: OecMetric;
  guardrailMetrics: string[];
  randomizationUnit: RandomizationUnit;
  salt: string;
  status: CampaignExperimentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ExperimentArmVoiceConfig {
  provider: "plivo-gemini";
  voice: string;
  voiceName?: string;
  language: string;
}

export interface ExperimentArmMetadata {
  systemPrompt?: string;
  firstMessage?: string;
  scriptSummary?: string;
}

export interface ExperimentArm {
  id: string;
  experimentId: string;
  type: ExperimentArmType;
  name: string;
  allocationPct: number;
  scriptVariantId?: string;
  voiceConfig?: ExperimentArmVoiceConfig;
  metadata?: ExperimentArmMetadata;
}

export interface LifecycleEnrollment {
  id: string;
  campaignId: string;
  experimentId: string;
  armId: string;
  investorId: string;
  segmentId: string;
  currentState: string;
  firstQualifiedAt: string;
  enrolledAt: string;
  assignedAt: string;
  attributionWindowEndsAt: string;
  offerInstanceId?: string;
  lastTouchAt?: string;
  cooldownUntil?: string;
  exitReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OfferInstance {
  id: string;
  campaignId: string;
  experimentId: string;
  armId: string;
  enrollmentId: string;
  investorId: string;
  offerId: string;
  skuId?: string;
  deeplink?: string;
  status: OfferInstanceStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignEvent {
  id: string;
  userId: string;
  datasetId: string;
  campaignId: string;
  experimentId?: string;
  armId?: string;
  enrollmentId?: string;
  offerInstanceId?: string;
  investorId: string;
  eventType: string;
  occurredAt: string;
  source: CampaignEventSource;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface ContactIdentity {
  id: string;
  userId: string;
  datasetId: string;
  entityId: string;
  phoneNumber: string;
  consent: boolean;
  name?: string;
  preferredLanguage?: string;
  source: "manual_csv" | "manual_entry";
  createdAt: string;
  updatedAt: string;
}

export interface TreatmentTask {
  id: string;
  campaignId: string;
  experimentId: string;
  armId: string;
  enrollmentId: string;
  offerInstanceId: string;
  investorId: string;
  channel: "voice";
  provider: "plivo-gemini";
  status: TreatmentTaskStatus;
  voiceCampaignId?: string;
  voiceCallId?: string;
  scheduledFor?: string;
  startedAt?: string;
  endedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DecisionRecord {
  id: string;
  campaignId: string;
  experimentId: string;
  decision: DecisionValue;
  notes: string;
  nextStep?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LifecycleCampaignBundle {
  campaign: LifecycleCampaign;
  experiment: CampaignExperiment;
  arms: ExperimentArm[];
}

export interface LifecycleCampaignListItem {
  id: string;
  name: string;
  datasetId: string;
  status: LifecycleCampaignStatus;
  lifecycleProfileId: string;
  segmentId: string;
  segmentName?: string;
  offerId: string;
  offerName?: string;
  asOfDate: string;
  enrolledCount: number;
  treatmentTaskCount: number;
  attemptedCount: number;
  conversionRate: number | null;
  guardrailCount: number;
  latestDecision?: DecisionValue;
  updatedAt: string;
  createdAt: string;
}

export interface EligibleInvestorPreview {
  investorId: string;
  name?: string;
  city?: string;
  state?: string;
  kycStatus?: string;
  bankVerifiedDate?: string;
  accountActivatedDate?: string;
  lastIntentAt?: string;
  lastIntentEvent?: string;
  intentEvents: number;
  targetFundName?: string;
  phoneNumber?: string;
  consent?: boolean;
  contactStatus: "contactable" | "missing_phone" | "no_consent";
}

export interface AudiencePreview {
  campaignId: string;
  asOfDate: string;
  eligibleCount: number;
  contactableCount: number;
  missingPhoneCount: number;
  noConsentCount: number;
  alreadyEnrolledCount: number;
  sample: EligibleInvestorPreview[];
  segmentColumn?: "investor_id" | "user_id";
  warnings: string[];
}

export interface EnrollmentSummary {
  campaignId: string;
  eligibleCount: number;
  contactableCount: number;
  enrolledCreated: number;
  enrolledExisting: number;
  controlCount: number;
  treatmentCount: number;
  taskCreated: number;
  taskExisting: number;
  excludedMissingPhone: number;
  excludedNoConsent: number;
  byArm: Array<{
    armId: string;
    armName: string;
    type: ExperimentArmType;
    count: number;
  }>;
}

export interface CampaignRunSummary {
  campaignId: string;
  status: LifecycleCampaignStatus;
  enrollmentCount: number;
  controlCount: number;
  treatmentCount: number;
  tasksByStatus: Record<TreatmentTaskStatus, number>;
  eventsByType: Record<string, number>;
  guardrailCount: number;
  tasks: TreatmentTask[];
}

export interface ArmResult {
  armId: string;
  armName: string;
  type: ExperimentArmType;
  assigned: number;
  attempted: number;
  connected: number;
  pitched: number;
  accepted: number;
  rejected: number;
  pending: number;
  noAnswer: number;
  failed: number;
  converted: number;
  conversionRate: number;
  acceptanceRate: number;
  liftVsControlPctPoints?: number;
}

export interface CampaignResults {
  campaignId: string;
  pilotModeLabel: typeof PILOT_MODE_LABEL;
  oecMetric: OecMetric;
  attributionWindowDays: number;
  arms: ArmResult[];
  totals: {
    assigned: number;
    attempted: number;
    connected: number;
    pitched: number;
    accepted: number;
    rejected: number;
    pending: number;
    converted: number;
    guardrails: number;
  };
  latestDecision?: DecisionRecord;
  sampleEvents: CampaignEvent[];
}
