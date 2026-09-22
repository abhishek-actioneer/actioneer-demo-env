import { existsSync, readFileSync, writeFileSync } from "fs";

// Shared embedding + clustering helpers for the voice-campaign analysis pipeline.
// Used by scripts/analyze-voice-campaign-logs.ts (primary clusters) and
// scripts/embed-voice-campaign-calls.ts (zones + UMAP projections) so both
// stages operate on identical vectors and identical k-means behavior.

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 256;
const EMBEDDING_BATCH_SIZE = 256;
const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";

export interface SignalTextSource {
  primarySignal?: string;
  observableSummary?: string;
  customerPosition?: string;
}

/** Canonical embedding text for a call signal — keep both pipeline stages in sync. */
export function signalEmbeddingText(record: SignalTextSource): string {
  return [record.primarySignal, record.observableSummary, record.customerPosition]
    .filter(Boolean)
    .join(". ");
}

export async function embedTexts(
  texts: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(start, start + EMBEDDING_BATCH_SIZE);
    const response = await fetch(OPENAI_EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: batch,
        dimensions: EMBEDDING_DIMENSIONS,
      }),
    });
    if (!response.ok) {
      throw new Error(`OpenAI embeddings API error ${response.status}: ${await response.text()}`);
    }
    const data = (await response.json()) as { data: Array<{ embedding: number[] }> };
    for (const item of data.data) vectors.push(item.embedding);
    onProgress?.(Math.min(start + EMBEDDING_BATCH_SIZE, texts.length), texts.length);
  }
  return vectors;
}

interface EmbeddingsFile {
  model: string;
  dimensions: number;
  callIds: string[];
  vectors: number[][];
}

/** Returns cached vectors only if model, dimensions, and callId order all match. */
export function loadCachedEmbeddings(path: string, callIds: string[]): number[][] | null {
  if (!existsSync(path)) return null;
  try {
    const file = JSON.parse(readFileSync(path, "utf8")) as EmbeddingsFile;
    if (file.model !== EMBEDDING_MODEL || file.dimensions !== EMBEDDING_DIMENSIONS) return null;
    if (file.callIds.length !== callIds.length) return null;
    if (!file.callIds.every((callId, index) => callId === callIds[index])) return null;
    return file.vectors;
  } catch {
    return null;
  }
}

export function saveEmbeddings(path: string, callIds: string[], vectors: number[][]): void {
  const file: EmbeddingsFile = {
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
    callIds,
    vectors,
  };
  writeFileSync(path, JSON.stringify(file));
}

/** Deterministic PRNG so clustering and layouts are stable across re-runs. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function squaredDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return sum;
}

/** Seeded k-means++ — deterministic so cluster assignments are stable across re-runs. */
export function kMeans(vectors: number[][], k: number, random: () => number): number[] {
  const centroids: number[][] = [vectors[Math.floor(random() * vectors.length)]];
  while (centroids.length < k) {
    const distances = vectors.map((vector) =>
      Math.min(...centroids.map((centroid) => squaredDistance(vector, centroid))),
    );
    const total = distances.reduce((sum, distance) => sum + distance, 0);
    let pick = random() * total;
    let chosen = 0;
    for (let i = 0; i < distances.length; i += 1) {
      pick -= distances[i];
      if (pick <= 0) {
        chosen = i;
        break;
      }
    }
    centroids.push(vectors[chosen]);
  }

  let assignment = new Array<number>(vectors.length).fill(0);
  for (let iteration = 0; iteration < 50; iteration += 1) {
    const next = vectors.map((vector) => {
      let best = 0;
      let bestDistance = Infinity;
      centroids.forEach((centroid, index) => {
        const distance = squaredDistance(vector, centroid);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      });
      return best;
    });
    if (next.every((value, index) => value === assignment[index]) && iteration > 0) break;
    assignment = next;
    for (let cluster = 0; cluster < k; cluster += 1) {
      const members = vectors.filter((_, index) => assignment[index] === cluster);
      if (members.length === 0) continue;
      const centroid = new Array<number>(vectors[0].length).fill(0);
      for (const member of members) {
        for (let dim = 0; dim < member.length; dim += 1) centroid[dim] += member[dim];
      }
      centroids[cluster] = centroid.map((value) => value / members.length);
    }
  }
  return assignment;
}

export function meanSilhouette(vectors: number[][], assignment: number[], k: number): number {
  const n = vectors.length;
  const distances: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const distance = Math.sqrt(squaredDistance(vectors[i], vectors[j]));
      distances[i][j] = distance;
      distances[j][i] = distance;
    }
  }
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    const own = assignment[i];
    const byCluster = new Map<number, number[]>();
    for (let j = 0; j < n; j += 1) {
      if (j === i) continue;
      const list = byCluster.get(assignment[j]) ?? [];
      list.push(distances[i][j]);
      byCluster.set(assignment[j], list);
    }
    const ownDistances = byCluster.get(own) ?? [];
    if (ownDistances.length === 0) continue;
    const a = ownDistances.reduce((sum, d) => sum + d, 0) / ownDistances.length;
    let b = Infinity;
    for (let cluster = 0; cluster < k; cluster += 1) {
      if (cluster === own) continue;
      const other = byCluster.get(cluster);
      if (!other || other.length === 0) continue;
      b = Math.min(b, other.reduce((sum, d) => sum + d, 0) / other.length);
    }
    if (!Number.isFinite(b)) continue;
    total += (b - a) / Math.max(a, b);
  }
  return total / n;
}
