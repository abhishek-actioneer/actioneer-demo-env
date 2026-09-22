import { describe, expect, it } from "vitest";
import { ForensicSpeechGate } from "@/lib/voice-forensics";
import { pcm16ToMulaw } from "@/lib/telephony-audio";

function sinePayload(ms = 20, amplitude = 12_000, hz = 220): string {
  const sampleRate = 8000;
  const samples = Math.round(sampleRate * ms / 1000);
  const pcm = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) {
    const sample = Math.round(amplitude * Math.sin(2 * Math.PI * hz * index / sampleRate));
    pcm.writeInt16LE(sample, index * 2);
  }
  return pcm16ToMulaw(pcm).toString("base64");
}

function silencePayload(ms = 20): string {
  return pcm16ToMulaw(Buffer.alloc(Math.round(ms * 8) * 2)).toString("base64");
}

describe("ForensicSpeechGate", () => {
  it("does not accept silence as forensic user audio", () => {
    const gate = new ForensicSpeechGate();

    for (let index = 0; index < 250; index += 1) {
      expect(gate.accept(silencePayload(), { agentAudioAudible: false }).acceptedPayloads).toEqual([]);
    }

    expect(gate.stats().acceptedAudioMs).toBe(0);
    expect(gate.stats().acceptedMediaFrames).toBe(0);
  });

  it("replays the short speech prefix once a caller speech run is confirmed", () => {
    const gate = new ForensicSpeechGate();

    expect(gate.accept(sinePayload(), { agentAudioAudible: false }).acceptedPayloads).toHaveLength(0);
    expect(gate.accept(sinePayload(), { agentAudioAudible: false }).acceptedPayloads).toHaveLength(0);
    expect(gate.accept(sinePayload(), { agentAudioAudible: false }).acceptedPayloads).toHaveLength(0);
    expect(gate.accept(sinePayload(), { agentAudioAudible: false }).acceptedPayloads).toHaveLength(4);
    expect(gate.accept(sinePayload(), { agentAudioAudible: false }).acceptedPayloads).toHaveLength(1);

    expect(gate.stats().acceptedMediaFrames).toBe(5);
    expect(gate.stats().acceptedAudioMs).toBe(100);
  });

  it("rejects speech-like frames while assistant audio is audible", () => {
    const gate = new ForensicSpeechGate();

    for (let index = 0; index < 25; index += 1) {
      expect(gate.accept(sinePayload(20, 18_000), { agentAudioAudible: true }).acceptedPayloads).toHaveLength(0);
    }

    expect(gate.stats().acceptedMediaFrames).toBe(0);
    expect(gate.stats().acceptedWhileAgentAudible).toBe(0);
    expect(gate.stats().rejectedWhileAgentAudible).toBe(25);
  });

  it("counts accepted speech duration instead of call stream duration", () => {
    const gate = new ForensicSpeechGate();

    for (let index = 0; index < 150; index += 1) {
      gate.accept(silencePayload(), { agentAudioAudible: false });
    }
    for (let index = 0; index < 250; index += 1) {
      gate.accept(sinePayload(), { agentAudioAudible: false });
    }

    expect(gate.stats().mediaFramesSeen).toBe(400);
    expect(gate.stats().acceptedAudioMs).toBe(5000);
  });
});
