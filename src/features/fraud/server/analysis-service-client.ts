export interface TranscriptFeatures {
  voice_onset_ms: number | null;
  elaboration_ratio: number | null;
  echo_score: number | null;
}

export interface FraudTransactionContext {
  deviation_factor?: number | null;
  device_risk_score?: number | null;
  geo_mismatch?: boolean | null;
  rule_fp_rate?: number | null;
}

export interface AcousticAnalysisResult {
  recommendation?: string;
  fraud_score?: number;
  duress_score?: number;
  stress_class?: number;
  stress_score?: number;
  background_voice?: boolean;
  reasons?: string[];
  detected_gender?: string | null;
  gender_confidence?: number | null;
  gender_female_prob?: number | null;
  gender_male_prob?: number | null;
  gender_mismatch?: boolean | null;
  jitter?: number | null;
  shimmer?: number | null;
  hnr?: number | null;
  mean_f0?: number | null;
  f0_variance?: number | null;
  speaker?: unknown;
  longitudinal?: unknown;
  score_breakdown?: unknown;
}

export interface AnalyzeCallInput {
  wavBase64: string;
  transcriptFeatures?: Partial<TranscriptFeatures>;
  customerId?: string;
  transaction?: FraudTransactionContext;
}

export interface EnrollInput {
  wavBase64: string;
  customerId: string;
}

export interface VerifyInput extends EnrollInput {
  enrollIfMissing?: boolean;
}

export class FraudAnalysisServiceError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "FraudAnalysisServiceError";
  }
}

function analysisServiceUrl(): string {
  return (process.env.FRAUD_ANALYSIS_SERVICE_URL || process.env.ANALYSIS_SERVICE_URL || "http://localhost:8000").replace(/\/$/, "");
}

async function postJson<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
  const res = await fetch(`${analysisServiceUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new FraudAnalysisServiceError(
      `Fraud analysis service ${res.status}: ${text.slice(0, 200) || res.statusText}`,
      res.status,
      text,
    );
  }
  return res.json() as Promise<T>;
}

export async function analyzeCall(input: AnalyzeCallInput): Promise<AcousticAnalysisResult> {
  return postJson<AcousticAnalysisResult>("/analyze-call", {
    wav_base64: input.wavBase64,
    transcript_features: input.transcriptFeatures,
    customer_id: input.customerId,
    transaction: input.transaction,
  }, 300_000);
}

export async function enrollCustomerVoice(input: EnrollInput): Promise<unknown> {
  return postJson<unknown>("/enroll", {
    wav_base64: input.wavBase64,
    customer_id: input.customerId,
  }, 180_000);
}

export async function verifyCustomerVoice(input: VerifyInput): Promise<unknown> {
  return postJson<unknown>("/verify", {
    wav_base64: input.wavBase64,
    customer_id: input.customerId,
    enroll_if_missing: input.enrollIfMissing ?? false,
  }, 180_000);
}

export async function fetchRecordingBytes(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Failed to fetch recording (${res.status}): ${url}`);
  return Buffer.from(await res.arrayBuffer());
}
