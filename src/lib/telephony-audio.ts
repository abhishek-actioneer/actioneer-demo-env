const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

export function mulawToPcm16(mulaw: Buffer): Buffer {
  const pcm = Buffer.alloc(mulaw.length * 2);
  for (let i = 0; i < mulaw.length; i += 1) {
    const value = (~mulaw[i]) & 0xff;
    let sample = ((value & 0x0f) << 3) + MULAW_BIAS;
    sample <<= (value & 0x70) >> 4;
    sample = (value & 0x80) ? MULAW_BIAS - sample : sample - MULAW_BIAS;
    pcm.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), i * 2);
  }
  return pcm;
}

export function pcm16ToMulaw(pcm: Buffer): Buffer {
  const samples = Math.floor(pcm.length / 2);
  const mulaw = Buffer.alloc(samples);
  for (let i = 0; i < samples; i += 1) {
    mulaw[i] = linearSampleToMulaw(pcm.readInt16LE(i * 2));
  }
  return mulaw;
}

function linearSampleToMulaw(sample: number): number {
  let sign = 0;
  let magnitude = sample;
  if (magnitude < 0) {
    magnitude = -magnitude;
    sign = 0x80;
  }
  magnitude = Math.min(magnitude, MULAW_CLIP) + MULAW_BIAS;

  let exponent = 7;
  for (let mask = 0x4000; (magnitude & mask) === 0 && exponent > 0; mask >>= 1) {
    exponent -= 1;
  }
  const mantissa = (magnitude >> (exponent + 3)) & 0x0f;
  return (~(sign | (exponent << 4) | mantissa)) & 0xff;
}

export function resamplePcm16Mono(input: Buffer, inputRate: number, outputRate: number): Buffer {
  if (inputRate === outputRate) return input;
  const inputSamples = Math.floor(input.length / 2);
  if (inputSamples === 0) return Buffer.alloc(0);
  const outputSamples = Math.max(1, Math.round(inputSamples * outputRate / inputRate));
  const output = Buffer.alloc(outputSamples * 2);

  for (let outIndex = 0; outIndex < outputSamples; outIndex += 1) {
    const sourceIndex = outIndex * (inputRate / outputRate);
    const leftIndex = Math.floor(sourceIndex);
    const rightIndex = Math.min(inputSamples - 1, leftIndex + 1);
    const fraction = sourceIndex - leftIndex;
    const left = input.readInt16LE(leftIndex * 2);
    const right = input.readInt16LE(rightIndex * 2);
    const sample = Math.round(left + (right - left) * fraction);
    output.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), outIndex * 2);
  }

  return output;
}

export function plivoMulawToGeminiPcm16(payload: string): string {
  const mulaw = Buffer.from(payload, "base64");
  const pcm8k = mulawToPcm16(mulaw);
  return resamplePcm16Mono(pcm8k, 8000, 16000).toString("base64");
}

export function geminiPcm16ToPlivoMulaw(data: string, inputRate = 24000): string {
  const pcm = Buffer.from(data, "base64");
  const pcm8k = resamplePcm16Mono(pcm, inputRate, 8000);
  return pcm16ToMulaw(pcm8k).toString("base64");
}
