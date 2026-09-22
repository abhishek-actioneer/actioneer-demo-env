export type ActivationAudienceSourceType =
  | "actioneer_cdp"
  | "file_upload"
  | "dataset_segment"
  | "manual";

export interface ActivationSourceRef {
  type: ActivationAudienceSourceType;
  sourceId?: string;
  audienceId?: string;
  memberId?: string;
}

export interface ActivationSuppression {
  deleted?: boolean;
  optedOut?: boolean;
  dnd?: boolean;
  callConsent?: boolean;
  smsConsent?: boolean;
  whatsappConsent?: boolean;
  reasons?: string[];
}

export interface ActivationProfile {
  personId: string;
  externalUserId?: string;
  name?: string;
  firstName?: string;
  phone?: string;
  phoneRaw?: string;
  email?: string;
  preferredLanguage?: string;
  timezone?: string;
  role?: string;
  platform?: string;
  suppression: ActivationSuppression;
  attributes: Record<string, unknown>;
  source: ActivationSourceRef;
}

export type ActivationReadinessStatus =
  | "ready"
  | "missing_phone"
  | "invalid_phone"
  | "suppressed"
  | "no_consent";

export interface ActivationProfileReadiness {
  profile: ActivationProfile;
  status: ActivationReadinessStatus;
  voiceReady: boolean;
  reasons: string[];
}

export interface ActivationFieldMapping {
  entityId?: string;
  name?: string;
  phone?: string;
  countryCode?: string;
  email?: string;
  consent?: string;
  optedOut?: string;
  dnd?: string;
  deleted?: string;
  language?: string;
  timezone?: string;
  role?: string;
  platform?: string;
}

export interface ActivationAudienceReadiness {
  audienceId: string;
  audienceName: string;
  sourceType: ActivationAudienceSourceType;
  sourceId?: string;
  totalMembers: number;
  evaluatedMembers: number;
  readyCount: number;
  missingPhoneCount: number;
  invalidPhoneCount: number;
  suppressedCount: number;
  noConsentCount: number;
  phoneNumbers: string[];
  fieldMapping: ActivationFieldMapping;
  profiles: ActivationProfileReadiness[];
  generatedAt: string;
}

export interface ActivationDataProvider {
  listAudiences(): Promise<Array<{
    id: string;
    name: string;
    description?: string;
    memberCount?: number;
    source: ActivationSourceRef;
  }>>;
  getAudienceMembers(audienceId: string): Promise<string[]>;
  getActivationProfiles(personIds: string[]): Promise<ActivationProfile[]>;
  getAudienceReadiness(audienceId: string): Promise<ActivationAudienceReadiness>;
  writeVoiceOutcomeEvent(event: {
    personId: string;
    campaignId: string;
    callId: string;
    outcome: string;
    occurredAt: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}
