import type { ForensicContext } from "./types";

export interface ModalVoiceForensicsInput {
  wavBase64: string;
  sampleRate: number;
  horizonMs: number;
  userAudioMs: number;
  context: ForensicContext;
}

export function voiceForensicsModalConfig(): { configured: boolean; detail: string } {
  const url = process.env.VOICE_FORENSICS_MODAL_URL?.trim();
  if (!url) return { configured: false, detail: "VOICE_FORENSICS_MODAL_URL is not configured" };
  return { configured: true, detail: "configured" };
}

export async function requestModalVoiceForensics(input: ModalVoiceForensicsInput): Promise<unknown> {
  const url = modalUrl();
  if (!url) throw new Error("VOICE_FORENSICS_MODAL_URL is not configured");

  const timeoutMs = Number(process.env.VOICE_FORENSICS_MODAL_TIMEOUT_MS) || 120_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: modalHeaders(),
      body: JSON.stringify({
        wav_base64: input.wavBase64,
        sample_rate: input.sampleRate,
        horizon_ms: input.horizonMs,
        user_audio_ms: input.userAudioMs,
        call_id: input.context.callId,
        dataset_id: input.context.datasetId,
        campaign_id: input.context.campaignId ?? "",
        phone: input.context.phone ?? "",
        name: input.context.name ?? "",
        user_id: input.context.userId ?? "",
        biomarker_id: input.context.biomarkerId ?? input.context.userId ?? input.context.phone ?? input.context.callId,
        ...modalBodyAuth(),
      }),
      signal: controller.signal,
    });
    const json = await readJson(res);
    if (!res.ok) throw new Error(`Modal voice-forensics request failed (${res.status}): ${stringifyError(json)}`);
    return json;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Modal voice-forensics request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function modalUrl(): string {
  return (process.env.VOICE_FORENSICS_MODAL_URL?.trim() || "").replace(/\/+$/, "");
}

function modalHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const token = process.env.VOICE_FORENSICS_MODAL_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function modalBodyAuth(): Record<string, string> {
  const token = process.env.VOICE_FORENSICS_MODAL_TOKEN?.trim();
  return token ? { _auth_token: token } : {};
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function stringifyError(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
