/**
 * Short hold/ring ambient played into Plivo during public-demo soft transfers.
 * Generated as 8kHz μ-law so it matches the media stream contentType.
 */

import { pcm16ToMulaw } from "./telephony-audio";

/** Must match the generated PCM length below (seconds * 1000). */
export const PUBLIC_DEMO_SWITCH_AMBIENT_DURATION_MS = 1050;

/** Soft dual-tone ringback-ish pattern (~1.05s). */
export function buildPublicDemoSwitchAmbientMulawBase64(): string {
  const sampleRate = 8000;
  const n = Math.floor(sampleRate * (PUBLIC_DEMO_SWITCH_AMBIENT_DURATION_MS / 1000));
  const pcm = Buffer.alloc(n * 2);
  const amp = 2600;

  for (let i = 0; i < n; i += 1) {
    const t = i / sampleRate;
    const inBurst = t < 0.35 || (t >= 0.5 && t < 0.85);
    let sample = 0;
    if (inBurst) {
      const local = t < 0.5 ? t : t - 0.5;
      const rise = Math.min(1, local * 25);
      const fall = Math.min(1, (0.35 - local) * 25);
      const env = Math.max(0, Math.min(1, rise * fall));
      sample =
        (Math.sin(2 * Math.PI * 440 * t) * 0.55 +
          Math.sin(2 * Math.PI * 480 * t) * 0.45) *
        amp *
        env;
    }
    pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(sample))), i * 2);
  }

  return pcm16ToMulaw(pcm).toString("base64");
}

let cached: string | undefined;

export function getPublicDemoSwitchAmbientMulawBase64(): string {
  return (cached ??= buildPublicDemoSwitchAmbientMulawBase64());
}
