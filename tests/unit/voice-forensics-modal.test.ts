import { afterEach, describe, expect, it, vi } from "vitest";
import {
  requestModalVoiceForensics,
  voiceForensicsModalConfig,
} from "@/lib/voice-forensics/modal-client";

const ENV_KEYS = [
  "VOICE_FORENSICS_MODAL_URL",
  "VOICE_FORENSICS_MODAL_TOKEN",
  "VOICE_FORENSICS_MODAL_TIMEOUT_MS",
] as const;

const ORIGINAL_ENV = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof ENV_KEYS)[number], string | undefined>;

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllGlobals();
});

describe("voiceForensicsModalConfig", () => {
  it("reports unavailable when endpoint config is missing", () => {
    delete process.env.VOICE_FORENSICS_MODAL_URL;

    expect(voiceForensicsModalConfig()).toEqual({
      configured: false,
      detail: "VOICE_FORENSICS_MODAL_URL is not configured",
    });
  });
});

describe("requestModalVoiceForensics", () => {
  it("posts base64 WAV and call metadata to the Modal endpoint", async () => {
    process.env.VOICE_FORENSICS_MODAL_URL = "https://workspace--baby-sentinel-voice-forensics.modal.run/infer/";
    process.env.VOICE_FORENSICS_MODAL_TOKEN = "modal-token";

    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      status: "ready",
      ok: true,
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const output = await requestModalVoiceForensics({
      wavBase64: "wav-base64",
      sampleRate: 8000,
      horizonMs: 500,
      userAudioMs: 740,
      context: {
        callId: "call-1",
        datasetId: "hdfc-creditfraud",
        campaignId: "campaign-1",
        phone: "+15551234567",
        name: "Asha",
        userId: "user-1",
        biomarkerId: "bio-1",
      },
    });

    expect(output).toEqual({ status: "ready", ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://workspace--baby-sentinel-voice-forensics.modal.run/infer");
    expect(init?.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer modal-token",
    });
    const body = JSON.parse(String(init!.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      wav_base64: "wav-base64",
      sample_rate: 8000,
      horizon_ms: 500,
      user_audio_ms: 740,
      call_id: "call-1",
      phone: "+15551234567",
      name: "Asha",
      user_id: "user-1",
      biomarker_id: "bio-1",
      _auth_token: "modal-token",
    });
  });
});
