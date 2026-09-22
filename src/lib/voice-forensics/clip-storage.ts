import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve, sep } from "path";
import { getVoiceStorageRoot } from "../voice-storage";

/**
 * On-disk store for the exact user-only audio clip fed to the forensics models
 * at each QA horizon (0.5s / 1s / 2s / 5s). Lets the UI play back precisely what
 * the model received, so audio-leakage / echo issues can be heard directly.
 *
 * Clips are the μ-law prefix decoded to 8kHz mono PCM16 wrapped in a WAV header
 * — the caller-side signal before any 16kHz resample, i.e. the raw thing.
 */

function safePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function clipsRoot(): string {
  return resolve(getVoiceStorageRoot(), "voice-forensics-clips");
}

/**
 * Clip keys: the four horizon prefixes (by ms) plus the two full-track variants.
 * `full-raw` = entire caller audio at wall-clock time; `full-processed` = after
 * VAD silence removal.
 */
export const FORENSIC_CLIP_KEYS = ["500", "1000", "2000", "5000", "full-raw", "full-processed"] as const;
export type ForensicClipKey = (typeof FORENSIC_CLIP_KEYS)[number];

export function isForensicClipKey(value: string): value is ForensicClipKey {
  return (FORENSIC_CLIP_KEYS as readonly string[]).includes(value);
}

/** Absolute path for a call's clip, guarded against traversal. */
export function forensicClipPath(callId: string, key: string): string {
  const root = clipsRoot();
  const filePath = resolve(root, safePart(callId), `${safePart(key)}.wav`);
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    throw new Error("Invalid forensic clip key");
  }
  return filePath;
}

/** Wrap 8kHz mono PCM16 bytes in a canonical 44-byte WAV header. */
function wavFromPcm16Mono(pcm16: Buffer, sampleRate = 8000): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm16.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate (mono, 16-bit)
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcm16.length, 40);
  return Buffer.concat([header, pcm16]);
}

/** Persist a clip (8kHz mono PCM16) as a WAV under `key`. Never throws. */
export function saveForensicClip(callId: string, key: string, pcm16Mono8k: Buffer): void {
  if (!callId || pcm16Mono8k.length === 0) return;
  const path = forensicClipPath(callId, key);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, wavFromPcm16Mono(pcm16Mono8k, 8000));
}

export function forensicClipExists(callId: string, key: string): boolean {
  try {
    return existsSync(forensicClipPath(callId, key));
  } catch {
    return false;
  }
}

export function readForensicClip(callId: string, key: string): Buffer | null {
  try {
    const path = forensicClipPath(callId, key);
    return existsSync(path) ? readFileSync(path) : null;
  } catch {
    return null;
  }
}
