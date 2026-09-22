import {
  requestModalVoiceForensics,
  voiceForensicsModalConfig,
} from "./modal-client";
import type {
  ForensicAudio,
  ForensicContext,
  VoiceForensicsBiomarkerMatch,
  VoiceForensicsHorizonResult,
  VoiceForensicsModelRow,
  VoiceForensicsTaskRows,
  VoiceForensicsTaskStatus,
} from "./types";

const THRESHOLD = 0.5;

export const EXPECTED_VOICE_FORENSICS_MODELS = {
  gender: [
    { modelId: "titanet-gender-dec-pooling", modelName: "TitaNet gender head (dec_pooling)" },
    { modelId: "titanet-age-gender-independent-fusion", modelName: "TitaNet age+gender independent heads (fusion)" },
    { modelId: "titanet-age-gender-mmoe", modelName: "TitaNet age+gender MMoE head" },
  ],
  la: [
    { modelId: "aasist-la-base", modelName: "AASIST LA base" },
    { modelId: "aasist-la-phone-vendor", modelName: "AASIST LA phone+vendor fine-tuned" },
    { modelId: "titanet-la-dec-pooling", modelName: "TitaNet LA head (dec_pooling)" },
    { modelId: "titanet-la-enc-block4-stats", modelName: "TitaNet LA head (enc_block4_stats)" },
    { modelId: "titanet-la-fusion", modelName: "TitaNet LA head (fusion)" },
  ],
  pa: [
    { modelId: "titanet-pa-dec-pooling", modelName: "TitaNet PA head (dec_pooling)" },
    { modelId: "titanet-pa-enc-block4-stats", modelName: "TitaNet PA head (enc_block4_stats)" },
    { modelId: "titanet-pa-fusion", modelName: "TitaNet PA head (fusion)" },
    { modelId: "rawnet2-pa-base", modelName: "RawNet2 PA base" },
    { modelId: "rawnet2-pa-finetuned", modelName: "RawNet2 PA fine-tuned" },
  ],
} as const;

/**
 * Runs the Modal GPU voice-forensics endpoint for one user-audio horizon. The
 * Python side owns all PyTorch/CUDA/model weights; this boundary sends only a
 * mono WAV and call metadata, then coerces the returned JSON into the UI/API
 * contract. Missing configuration returns unavailable rows, not fake scores.
 */
export async function runVoiceForensics(
  audio: ForensicAudio,
  context: ForensicContext,
  cumulativeMs: number,
): Promise<VoiceForensicsHorizonResult> {
  const config = voiceForensicsModalConfig();
  if (!config.configured) return unavailableHorizon(audio, cumulativeMs, config.detail);

  try {
    const output = await requestModalVoiceForensics({
      wavBase64: wavFromPcm16(audio.pcm16, audio.sampleRate).toString("base64"),
      sampleRate: audio.sampleRate,
      horizonMs: audio.horizonMs,
      userAudioMs: cumulativeMs,
      context,
    });
    return coerceHorizonResult(output, audio, cumulativeMs);
  } catch (err) {
    return errorHorizon(audio, cumulativeMs, message(err));
  }
}

function unavailableHorizon(
  audio: ForensicAudio,
  cumulativeMs: number,
  detail: string,
): VoiceForensicsHorizonResult {
  return {
    status: "unavailable",
    horizonMs: audio.horizonMs,
    userAudioMs: cumulativeMs,
    analyzedAudioMs: audio.durationMs,
    gender: unavailableRows("gender", detail),
    la: unavailableRows("la", detail),
    pa: unavailableRows("pa", detail),
    biomarker: {
      embeddingSaved: false,
      matches: [],
      modelId: "titanet-large",
      detail,
    },
  };
}

function errorHorizon(
  audio: ForensicAudio,
  cumulativeMs: number,
  detail: string,
): VoiceForensicsHorizonResult {
  return {
    status: "error",
    horizonMs: audio.horizonMs,
    userAudioMs: cumulativeMs,
    analyzedAudioMs: audio.durationMs,
    gender: unavailableRows("gender", detail, "error"),
    la: unavailableRows("la", detail, "error"),
    pa: unavailableRows("pa", detail, "error"),
    biomarker: {
      embeddingSaved: false,
      matches: [],
      modelId: "titanet-large",
      detail,
    },
    error: detail,
  };
}

function unavailableRows(
  task: keyof typeof EXPECTED_VOICE_FORENSICS_MODELS,
  detail: string,
  status: VoiceForensicsTaskStatus = "unavailable",
): VoiceForensicsTaskRows {
  return {
    rows: EXPECTED_VOICE_FORENSICS_MODELS[task].map((model) => ({
      ...model,
      score: null,
      verdict: null,
      threshold: THRESHOLD,
      status,
      detail,
    })),
  };
}

function coerceHorizonResult(
  output: unknown,
  audio: ForensicAudio,
  cumulativeMs: number,
): VoiceForensicsHorizonResult {
  const raw = record(output);
  const gender = coerceRows("gender", raw.gender);
  const la = coerceRows("la", raw.la);
  const pa = coerceRows("pa", raw.pa);
  const biomarker = coerceBiomarker(raw.biomarker);
  const status = coerceHorizonStatus(raw.status, gender, la, pa, biomarker.embeddingSaved);

  return {
    status,
    horizonMs: finiteNumber(raw.horizonMs ?? raw.horizon_ms, audio.horizonMs),
    userAudioMs: finiteNumber(raw.userAudioMs ?? raw.user_audio_ms, cumulativeMs),
    analyzedAudioMs: finiteNumber(raw.analyzedAudioMs ?? raw.analyzed_audio_ms, audio.durationMs),
    gender,
    la,
    pa,
    biomarker,
    error: typeof raw.error === "string" ? raw.error : undefined,
  };
}

function coerceRows(
  task: keyof typeof EXPECTED_VOICE_FORENSICS_MODELS,
  rawTask: unknown,
): VoiceForensicsTaskRows {
  const rawRows = Array.isArray(record(rawTask).rows) ? record(rawTask).rows as unknown[] : [];
  const byId = new Map<string, VoiceForensicsModelRow>();
  const extras: VoiceForensicsModelRow[] = [];

  for (const rawRow of rawRows) {
    const row = coerceRow(rawRow);
    if (EXPECTED_VOICE_FORENSICS_MODELS[task].some((model) => model.modelId === row.modelId)) {
      byId.set(row.modelId, row);
    } else if (row.modelId) {
      extras.push(row);
    }
  }

  return {
    rows: [
      ...EXPECTED_VOICE_FORENSICS_MODELS[task].map((model) => byId.get(model.modelId) ?? {
        ...model,
        score: null,
        verdict: null,
        threshold: THRESHOLD,
        status: "unavailable" as const,
        detail: "model did not return a row",
      }),
      ...extras,
    ],
  };
}

function coerceRow(raw: unknown): VoiceForensicsModelRow {
  const row = record(raw);
  const score = finiteOptionalNumber(row.score);
  const status = coerceTaskStatus(row.status, score == null ? "unavailable" : "ready");
  return {
    modelId: stringValue(row.modelId ?? row.model_id),
    modelName: stringValue(row.modelName ?? row.model_name),
    score,
    verdict: typeof row.verdict === "string" ? row.verdict : null,
    threshold: finiteNumber(row.threshold, THRESHOLD),
    nativeThreshold: finiteOptionalNumber(row.nativeThreshold ?? row.native_threshold),
    nativeVerdict: typeof row.nativeVerdict === "string"
      ? row.nativeVerdict
      : typeof row.native_verdict === "string" ? row.native_verdict : null,
    age: coerceAge(row.age),
    status,
    detail: typeof row.detail === "string" ? row.detail : undefined,
  };
}

function coerceAge(rawValue: unknown): VoiceForensicsModelRow["age"] {
  if (rawValue == null) return null;
  const age = record(rawValue);
  const score = finiteOptionalNumber(age.score);
  if (score == null) return null;
  return {
    score,
    verdict: typeof age.verdict === "string" ? age.verdict : "",
    threshold: finiteNumber(age.threshold, THRESHOLD),
    nativeThreshold: finiteOptionalNumber(age.nativeThreshold ?? age.native_threshold),
    nativeVerdict: typeof age.nativeVerdict === "string"
      ? age.nativeVerdict
      : typeof age.native_verdict === "string" ? age.native_verdict : null,
  };
}

function coerceBiomarker(rawValue: unknown): VoiceForensicsHorizonResult["biomarker"] {
  const raw = record(rawValue);
  const rawMatches = Array.isArray(raw.matches) ? raw.matches : [];
  return {
    embeddingSaved: Boolean(raw.embeddingSaved ?? raw.embedding_saved),
    modelId: typeof raw.modelId === "string"
      ? raw.modelId
      : typeof raw.model_id === "string"
        ? raw.model_id
        : "titanet-large",
    detail: typeof raw.detail === "string" ? raw.detail : undefined,
    matches: rawMatches.slice(0, 5).map(coerceMatch).filter((match): match is VoiceForensicsBiomarkerMatch => match !== null),
    // Raw embedding from the (now stateless) model. Local matching in
    // session.ts uses this and overwrites `matches` from the DuckDB gallery.
    embedding: Array.isArray(raw.embedding)
      ? raw.embedding.map(Number).filter((n) => Number.isFinite(n))
      : undefined,
  };
}

function coerceMatch(rawValue: unknown): VoiceForensicsBiomarkerMatch | null {
  const raw = record(rawValue);
  const score = finiteOptionalNumber(raw.score);
  if (score == null) return null;
  return {
    rank: Math.max(1, Math.round(finiteNumber(raw.rank, 1))),
    score,
    phone: nullableString(raw.phone),
    name: nullableString(raw.name),
    userId: nullableString(raw.userId ?? raw.user_id),
  };
}

function coerceHorizonStatus(
  rawStatus: unknown,
  gender: VoiceForensicsTaskRows,
  la: VoiceForensicsTaskRows,
  pa: VoiceForensicsTaskRows,
  embeddingSaved: boolean,
): VoiceForensicsHorizonResult["status"] {
  if (rawStatus === "ready" || rawStatus === "unavailable" || rawStatus === "error" || rawStatus === "pending") {
    return rawStatus;
  }
  const rows = [...gender.rows, ...la.rows, ...pa.rows];
  if (rows.some((row) => row.status === "ready") || embeddingSaved) return "ready";
  if (rows.some((row) => row.status === "error")) return "error";
  return "unavailable";
}

function coerceTaskStatus(rawStatus: unknown, fallback: VoiceForensicsTaskStatus): VoiceForensicsTaskStatus {
  return rawStatus === "ready" || rawStatus === "unavailable" || rawStatus === "error"
    ? rawStatus
    : fallback;
}

function wavFromPcm16(pcm16: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm16.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm16.length, 40);
  return Buffer.concat([header, pcm16]);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finiteOptionalNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null;
}

function finiteNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
