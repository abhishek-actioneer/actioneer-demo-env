import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { createHash } from "crypto";
import { getVoiceStorageRoot } from "../voice-storage";
import type { VoiceBiometricEnrollment, VoiceBiometricProfile } from "./types";

type StoreFile = { enrollments: VoiceBiometricEnrollment[] };

function storePath(): string {
  return join(getVoiceStorageRoot(), "voice-biometric-enrollments.json");
}

function readStore(): StoreFile {
  const path = storePath();
  if (!existsSync(path)) return { enrollments: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as StoreFile;
    return Array.isArray(parsed.enrollments) ? parsed : { enrollments: [] };
  } catch {
    return { enrollments: [] };
  }
}

function writeStore(value: StoreFile): void {
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(temp, path);
}

export function listVoiceBiometricEnrollments(
  tenantUserId: string,
  datasetId: string,
): VoiceBiometricEnrollment[] {
  return readStore().enrollments.filter(
    (row) => row.tenantUserId === tenantUserId && row.datasetId === datasetId,
  );
}

export function activeVoiceBiometricSubjectIds(
  tenantUserId: string,
  datasetId: string,
): string[] {
  return listVoiceBiometricEnrollments(tenantUserId, datasetId)
    .filter((row) => row.active)
    .map((row) => row.biometricKey);
}

export function voiceBiometricKey(tenantUserId: string, datasetId: string, subjectId: string): string {
  const digest = createHash("sha256")
    .update(`${tenantUserId}\u0000${datasetId}\u0000${subjectId}`)
    .digest("hex")
    .slice(0, 24);
  return `vb_${digest}`;
}

export function getVoiceBiometricEnrollment(
  tenantUserId: string,
  datasetId: string,
  subjectId: string,
): VoiceBiometricEnrollment | undefined {
  return listVoiceBiometricEnrollments(tenantUserId, datasetId).find(
    (row) => row.subjectId === subjectId && row.active,
  );
}

export function getVoiceBiometricEnrollmentByKey(
  tenantUserId: string,
  datasetId: string,
  biometricKey: string,
): VoiceBiometricEnrollment | undefined {
  return listVoiceBiometricEnrollments(tenantUserId, datasetId).find(
    (row) => row.biometricKey === biometricKey && row.active,
  );
}

export function upsertVoiceBiometricEnrollment(input: {
  tenantUserId: string;
  datasetId: string;
  subjectId: string;
  displayName: string;
  consentedAt: string;
  profile?: Partial<VoiceBiometricProfile>;
}): VoiceBiometricEnrollment {
  const store = readStore();
  const now = new Date().toISOString();
  const profile: VoiceBiometricProfile = {
    subjectId: input.subjectId,
    displayName: input.displayName,
    accountNumberMasked: input.profile?.accountNumberMasked || `•••• ${input.subjectId.slice(-4).padStart(4, "0")}`,
    balanceInr: input.profile?.balanceInr ?? 125_000,
    recentTransactions: input.profile?.recentTransactions ?? [
      { label: "UPI grocery payment", amountInr: -1840 },
      { label: "Salary credit", amountInr: 85000 },
      { label: "Electricity bill", amountInr: -3260 },
    ],
  };
  const row: VoiceBiometricEnrollment = {
    tenantUserId: input.tenantUserId,
    datasetId: input.datasetId,
    subjectId: input.subjectId,
    biometricKey: voiceBiometricKey(input.tenantUserId, input.datasetId, input.subjectId),
    displayName: input.displayName,
    consentedAt: input.consentedAt,
    active: true,
    modelVersion: "speechbrain/spkrec-ecapa-voxceleb",
    profile,
    updatedAt: now,
  };
  const index = store.enrollments.findIndex(
    (item) => item.tenantUserId === input.tenantUserId &&
      item.datasetId === input.datasetId && item.subjectId === input.subjectId,
  );
  if (index >= 0) store.enrollments[index] = row;
  else store.enrollments.push(row);
  writeStore(store);
  return row;
}

export function revokeVoiceBiometricEnrollment(
  tenantUserId: string,
  datasetId: string,
  subjectId: string,
): boolean {
  const store = readStore();
  const row = store.enrollments.find(
    (item) => item.tenantUserId === tenantUserId &&
      item.datasetId === datasetId && item.subjectId === subjectId,
  );
  if (!row) return false;
  row.active = false;
  row.updatedAt = new Date().toISOString();
  writeStore(store);
  return true;
}
