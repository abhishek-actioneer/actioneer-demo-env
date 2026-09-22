export type VoiceBiometricProfile = {
  subjectId: string;
  displayName: string;
  accountNumberMasked: string;
  balanceInr: number;
  recentTransactions: Array<{ label: string; amountInr: number }>;
};

export type VoiceBiometricEnrollment = {
  tenantUserId: string;
  datasetId: string;
  subjectId: string;
  biometricKey: string;
  displayName: string;
  consentedAt: string;
  active: boolean;
  modelVersion: "speechbrain/spkrec-ecapa-voxceleb";
  profile: VoiceBiometricProfile;
  updatedAt: string;
};

export type VoiceBiometricMatch = {
  customer_id: string;
  similarity: number;
};

export type VoiceBiometricIdentifyResult = {
  status: "candidate" | "unknown" | "ambiguous" | "insufficient_audio" | "empty_gallery";
  duration_s: number;
  rms?: number;
  threshold?: number;
  margin?: number;
  model_version?: string;
  gallery_size?: number;
  matches: VoiceBiometricMatch[];
};

export type VoiceBiometricVerificationResult = {
  customer_id: string;
  status: "verified" | "not_enrolled";
  similarity: number | null;
  is_same_speaker: boolean | null;
  confidence: string | null;
};
