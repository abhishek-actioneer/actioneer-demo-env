import { mulawToPcm16 } from "../telephony-audio";
import { identifyVoiceBiometric, verifyVoiceBiometric } from "./client";
import {
  activeVoiceBiometricSubjectIds,
  getVoiceBiometricEnrollmentByKey,
} from "./store";
import type { VoiceBiometricEnrollment } from "./types";

const IDENTIFY_AUDIO_MS = Number(process.env.VOICE_BIOMETRIC_IDENTIFY_AUDIO_MS || 6500);
const CHALLENGE_AUDIO_MS = Number(process.env.VOICE_BIOMETRIC_CHALLENGE_AUDIO_MS || 3500);

type Stage = "awaiting_consent" | "collecting" | "identifying" | "challenge" | "verifying" | "identified" | "rejected" | "closed";

export type VoiceBiometricLiveSession = {
  feed(payload: string): void;
  noteTranscript(text: string): void;
  close(): void;
  stage(): Stage;
};

export type VoiceBiometricLiveCallbacks = {
  onChallenge(challenge: string): void;
  onIdentified(enrollment: VoiceBiometricEnrollment, similarity: number): void;
  onRejected(reason: string): void;
  onStatus?(stage: Stage, detail?: Record<string, unknown>): void;
};

function wavFromMulaw(chunks: Buffer[]): string {
  const mulaw = Buffer.concat(chunks);
  const pcm = mulawToPcm16(mulaw);
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + pcm.length, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);
  return wav.toString("base64");
}

function hasSpeechEnergy(mulaw: Buffer): boolean {
  const pcm = mulawToPcm16(mulaw);
  const samples = Math.floor(pcm.length / 2);
  if (samples === 0) return false;
  let energy = 0;
  for (let index = 0; index < samples; index += 1) {
    const value = pcm.readInt16LE(index * 2);
    energy += value * value;
  }
  return Math.sqrt(energy / samples) >= 350;
}

function makeChallenge(): { spoken: string; token: string } {
  const digits: number[] = [];
  while (digits.length < 4) {
    const next = 2 + Math.floor(Math.random() * 8);
    if (digits.at(-1) !== next) digits.push(next);
  }
  return { spoken: `blue river, ${digits.join(", ")}`, token: digits.join("") };
}

const NUMBER_WORDS: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5",
  six: "6", seven: "7", eight: "8", nine: "9",
  shunya: "0", ek: "1", do: "2", teen: "3", char: "4", chaar: "4",
  paanch: "5", panch: "5", cheh: "6", chhe: "6", saat: "7", aath: "8", nau: "9",
  "शून्य": "0", "एक": "1", "दो": "2", "तीन": "3", "चार": "4",
  "पांच": "5", "पाँच": "5", "छह": "6", "सात": "7", "आठ": "8", "नौ": "9",
};

function transcriptDigits(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\u0900-\u097f]+/g, " ")
    .trim().split(/\s+/).map((part) => NUMBER_WORDS[part] ?? part.replace(/\D/g, ""))
    .join("").replace(/\D/g, "");
}

export function createVoiceBiometricLiveSession(input: {
  tenantUserId: string;
  datasetId: string;
  callbacks: VoiceBiometricLiveCallbacks;
}): VoiceBiometricLiveSession {
  let currentStage: Stage = "awaiting_consent";
  let initialChunks: Buffer[] = [];
  let initialBytes = 0;
  let challengeChunks: Buffer[] = [];
  let challengeBytes = 0;
  let candidateKey = "";
  let challenge = { spoken: "", token: "" };
  let challengeTranscriptPassed = false;

  function setStage(stage: Stage, detail?: Record<string, unknown>): void {
    currentStage = stage;
    input.callbacks.onStatus?.(stage, detail);
  }

  function reject(reason: string): void {
    if (currentStage === "closed" || currentStage === "identified" || currentStage === "rejected") return;
    setStage("rejected", { reason });
    input.callbacks.onRejected(reason);
  }

  async function identify(): Promise<void> {
    const candidateIds = activeVoiceBiometricSubjectIds(input.tenantUserId, input.datasetId);
    if (candidateIds.length === 0) return reject("empty_gallery");
    setStage("identifying");
    try {
      const result = await identifyVoiceBiometric({
        wavBase64: wavFromMulaw(initialChunks),
        candidateIds,
      });
      if (currentStage === "closed") return;
      const top = result.matches[0];
      if (result.status !== "candidate" || !top) return reject(result.status);
      candidateKey = top.customer_id;
      challenge = makeChallenge();
      challengeChunks = [];
      challengeBytes = 0;
      setStage("challenge", { candidateKey, similarity: top.similarity });
      input.callbacks.onChallenge(challenge.spoken);
    } catch (error) {
      reject(error instanceof Error ? error.message : "service_unavailable");
    }
  }

  async function maybeVerify(): Promise<void> {
    if (currentStage !== "challenge" || !challengeTranscriptPassed || challengeBytes < CHALLENGE_AUDIO_MS * 8) return;
    setStage("verifying");
    try {
      const result = await verifyVoiceBiometric({
        wavBase64: wavFromMulaw(challengeChunks),
        subjectId: candidateKey,
      });
      if (currentStage === "closed") return;
      if (!result.is_same_speaker || result.similarity == null) return reject("challenge_voice_mismatch");
      const enrollment = getVoiceBiometricEnrollmentByKey(input.tenantUserId, input.datasetId, candidateKey);
      if (!enrollment) return reject("enrollment_revoked");
      setStage("identified", { subjectId: enrollment.subjectId, similarity: result.similarity });
      input.callbacks.onIdentified(enrollment, result.similarity);
    } catch (error) {
      reject(error instanceof Error ? error.message : "service_unavailable");
    }
  }

  return {
    feed(payload: string): void {
      if (!payload || currentStage === "closed" || currentStage === "identified" || currentStage === "rejected") return;
      const chunk = Buffer.from(payload, "base64");
      if (chunk.length === 0 || !hasSpeechEnergy(chunk)) return;
      if (currentStage === "collecting") {
        initialChunks.push(chunk);
        initialBytes += chunk.length;
        if (initialBytes >= IDENTIFY_AUDIO_MS * 8) void identify();
      } else if (currentStage === "challenge") {
        challengeChunks.push(chunk);
        challengeBytes += chunk.length;
        void maybeVerify();
      }
    },
    noteTranscript(text: string): void {
      if (currentStage === "awaiting_consent") {
        const normalized = text.toLowerCase();
        if (/\b(no|nope|decline|do not|don't|nahi|nahin)\b/.test(normalized) || normalized.includes("नहीं")) {
          reject("consent_declined");
          return;
        }
        if (/\b(yes|yeah|yep|agree|consent|allow|okay|ok|haan|han|ha)\b/.test(normalized) || normalized.includes("हाँ") || normalized.includes("हां")) {
          initialChunks = [];
          initialBytes = 0;
          setStage("collecting", { consent: true });
        }
        return;
      }
      if (currentStage !== "challenge") return;
      const digits = transcriptDigits(text);
      challengeTranscriptPassed = digits.includes(challenge.token);
      if (challengeTranscriptPassed) void maybeVerify();
    },
    close(): void {
      initialChunks = [];
      challengeChunks = [];
      setStage("closed");
    },
    stage(): Stage { return currentStage; },
  };
}
