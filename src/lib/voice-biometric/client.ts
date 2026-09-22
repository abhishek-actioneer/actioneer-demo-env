import type {
  VoiceBiometricIdentifyResult,
  VoiceBiometricVerificationResult,
} from "./types";

function serviceUrl(): string {
  return (process.env.FRAUD_ANALYSIS_SERVICE_URL || process.env.ANALYSIS_SERVICE_URL || "http://localhost:8000")
    .replace(/\/$/, "");
}

async function post<T>(path: string, body: unknown, timeoutMs = 12_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${serviceUrl()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = await response.json().catch(() => null) as T | { detail?: string } | null;
    if (!response.ok) {
      const detail = json && typeof json === "object" && "detail" in json ? json.detail : response.statusText;
      throw new Error(`Voice biometric service failed (${response.status}): ${detail || "unknown error"}`);
    }
    return json as T;
  } finally {
    clearTimeout(timer);
  }
}

export function enrollVoiceBiometric(input: {
  subjectId: string;
  wavBase64List: string[];
}): Promise<{ customer_id: string; enrolled: boolean; n_calls: number; within_speaker_similarity: unknown }> {
  return post("/enroll-multi", {
    customer_id: input.subjectId,
    wav_base64_list: input.wavBase64List,
  }, 60_000);
}

export function identifyVoiceBiometric(input: {
  wavBase64: string;
  candidateIds: string[];
  threshold?: number;
  margin?: number;
}): Promise<VoiceBiometricIdentifyResult> {
  return post("/identify", {
    wav_base64: input.wavBase64,
    candidate_ids: input.candidateIds,
    threshold: input.threshold ?? Number(process.env.VOICE_BIOMETRIC_IDENTIFY_THRESHOLD || 0.75),
    margin: input.margin ?? Number(process.env.VOICE_BIOMETRIC_MARGIN_THRESHOLD || 0.08),
  });
}

export function verifyVoiceBiometric(input: {
  wavBase64: string;
  subjectId: string;
}): Promise<VoiceBiometricVerificationResult> {
  return post("/verify", {
    wav_base64: input.wavBase64,
    customer_id: input.subjectId,
    enroll_if_missing: false,
  });
}

export async function deleteVoiceBiometricReference(biometricKey: string): Promise<void> {
  const response = await fetch(`${serviceUrl()}/bioprint/${encodeURIComponent(biometricKey)}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(`Voice biometric deletion failed (${response.status})`);
}
