/**
 * Seeded RNG for deterministic synthesis.
 *
 * mulberry32 is a fast, decent-quality 32-bit PRNG. Seeding from
 * (datasetId, tickNumber) makes ticks reproducible — useful for debugging
 * and for verifying reset returns the dataset to a known state.
 */

export interface Rng {
  next(): number;
  int(min: number, max: number): number;
  float(min: number, max: number, precision?: number): number;
  bool(probability: number): boolean;
  choice<T>(items: readonly T[]): T;
  weighted<T>(items: readonly { value: T; weight: number }[]): T;
}

export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int(min: number, max: number) {
      return Math.floor(next() * (max - min + 1)) + min;
    },
    float(min: number, max: number, precision = 2) {
      const v = next() * (max - min) + min;
      const p = Math.pow(10, precision);
      return Math.round(v * p) / p;
    },
    bool(probability: number) {
      return next() < probability;
    },
    choice<T>(items: readonly T[]): T {
      return items[Math.floor(next() * items.length)];
    },
    weighted<T>(items: readonly { value: T; weight: number }[]): T {
      const total = items.reduce((a, b) => a + b.weight, 0);
      let r = next() * total;
      for (const item of items) {
        r -= item.weight;
        if (r <= 0) return item.value;
      }
      return items[items.length - 1].value;
    },
  };
}

/** Hash a string to a 32-bit unsigned integer. Used for deterministic seeding. */
export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
