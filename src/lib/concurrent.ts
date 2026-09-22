/**
 * Run an array of async factory functions with a concurrency ceiling.
 * Prevents memory spikes from firing all LLM calls simultaneously.
 */
export async function runConcurrent<T>(
  factories: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(factories.length);
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < factories.length) {
      const idx = nextIdx++;
      results[idx] = await factories[idx]();
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, factories.length) }, worker));
  return results;
}
