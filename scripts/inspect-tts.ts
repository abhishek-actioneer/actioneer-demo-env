import { config } from "dotenv";
config({ path: ".env.local" });

async function sarvamRaw(text: string, pace: number): Promise<Buffer> {
  const res = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: {
      "api-subscription-key": process.env.SARVAM_API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      target_language_code: "hi-IN",
      model: "bulbul:v3",
      speaker: "priya",
      pace,
      temperature: 0.7,
      speech_sample_rate: 8000,
      output_audio_codec: "mulaw",
    }),
  });
  const json = await res.json() as { audios?: string[] };
  return Buffer.from(json.audios![0], "base64");
}

async function main() {
  // Pace range test
  console.log("=== PACE RANGE TEST: 'Haan, samjha.' ===");
  for (const pace of [0.5, 0.75, 1.0, 1.25, 1.5, 2.0]) {
    const buf = await sarvamRaw("Haan, samjha.", pace);
    console.log(`  pace=${pace} → ${buf.length} bytes = ${(buf.length / 8000).toFixed(2)}s`);
  }
  console.log();

  // Silence analysis on one phrase
  console.log("=== SILENCE ANALYSIS: 'Haan.' at pace=1.0 ===");
  const res = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: {
      "api-subscription-key": process.env.SARVAM_API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: "Haan.",
      target_language_code: "hi-IN",
      model: "bulbul:v3",
      speaker: "priya",
      pace: 1.0,
      temperature: 0.7,
      speech_sample_rate: 8000,
      output_audio_codec: "mulaw",
    }),
  });

  const json = await res.json() as { audios?: string[] };
  const buf = Buffer.from(json.audios![0], "base64");

  // Check for WAV header — "RIFF" at offset 0
  const hasWavHeader = buf.slice(0, 4).toString("ascii") === "RIFF";
  console.log(`has WAV header: ${hasWavHeader}`);

  if (hasWavHeader) {
    const wavSampleRate = buf.readUInt32LE(24);
    const wavBitsPerSample = buf.readUInt16LE(34);
    const wavChannels = buf.readUInt16LE(22);
    const wavFormat = buf.readUInt16LE(20); // 1=PCM, 7=MULAW
    console.log(`WAV header → sample_rate=${wavSampleRate} bits=${wavBitsPerSample} channels=${wavChannels} format=${wavFormat} (1=PCM, 7=mulaw)`);
    const dataSize = buf.readUInt32LE(40);
    const bytesPerSec = wavSampleRate * wavChannels * (wavBitsPerSample / 8);
    console.log(`actual duration: ${(dataSize / bytesPerSec).toFixed(2)}s`);
  } else {
    console.log(`raw bytes: ${buf.length} → ${(buf.length / 8000).toFixed(2)}s @ 8kHz | ${(buf.length / 16000).toFixed(2)}s @ 16kHz | ${(buf.length / 22050).toFixed(2)}s @ 22kHz`);
    const silenceBytes = [...buf].filter((b) => b >= 0xf0).length;
    console.log(`silence bytes (>=0xf0): ${silenceBytes}/${buf.length} = ${((silenceBytes / buf.length) * 100).toFixed(1)}%`);
  }

  console.log(`first 8 bytes: ${[...buf.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join(" ")} | ascii: "${buf.slice(0, 4).toString("ascii").replace(/[^\x20-\x7e]/g, ".")}"`);
  console.log(`last  8 bytes: ${[...buf.slice(-8)].map((b) => b.toString(16).padStart(2, "0")).join(" ")}`);
}

main().catch(console.error);
