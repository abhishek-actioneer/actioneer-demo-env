/**
 * Auto-refresh scheduler for board cards.
 *
 * Polls every 60 seconds and refreshes any cards whose `refreshCadence`
 * interval has elapsed since `lastRefreshed`. Uses `/api/canvas-refresh`
 * (batch endpoint) and writes results back via `saveBoardCard()`.
 */

import { getBoardCards, saveBoardCard } from "./board-store";
import { apiFetch } from "./api-client";

/* ── Cadence → seconds ── */
const CADENCE_SECONDS: Record<string, number> = {
  hourly: 3600,
  daily: 86400,
};

/* ── Interval between staleness checks ── */
const POLL_INTERVAL_MS = 60_000;

/**
 * Returns true if the card's data is stale relative to its cadence.
 */
function isStale(
  cadence: string,
  lastRefreshed: string | undefined
): boolean {
  const intervalSeconds = CADENCE_SECONDS[cadence];
  if (!intervalSeconds) return false; // "manual" or unknown

  if (!lastRefreshed) return true; // never refreshed → stale

  const lastMs = new Date(lastRefreshed).getTime();
  const nowMs = Date.now();
  return nowMs - lastMs >= intervalSeconds * 1000;
}

interface RefreshResult {
  cardId: string;
  data: Record<string, unknown>[];
  executionTimeMs: number;
  error?: string;
}

/**
 * Starts the auto-refresh scheduler for the given board.
 *
 * @returns A cleanup function that stops the scheduler.
 */
export function startRefreshScheduler(
  boardId: string,
  _datasetId: string
): () => void {
  let stopped = false;

  async function tick() {
    if (stopped) return;

    const cards = getBoardCards(boardId);

    // Collect stale cards that have SQL
    const batch = cards.filter(
      (card) =>
        card.sql &&
        card.refreshCadence !== "manual" &&
        isStale(card.refreshCadence, card.lastRefreshed)
    );

    if (batch.length === 0) return;

    try {
      const res = await apiFetch<{ results: RefreshResult[] }>(
        "/api/canvas-refresh",
        {
          method: "POST",
          body: {
            cards: batch.map((c) => ({ id: c.id, sql: c.sql! })),
          },
        }
      );

      for (const result of res.results) {
        const card = cards.find((c) => c.id === result.cardId);
        if (!card) continue;

        if (!result.error) {
          saveBoardCard({
            ...card,
            lastData: card.data,
            data: result.data,
            lastRefreshed: new Date().toISOString(),
          });
        }
      }
    } catch {
      // Silent failure — scheduler will retry on next tick
    }
  }

  const timer = setInterval(tick, POLL_INTERVAL_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

/**
 * Returns true if the card's data is currently stale based on its cadence
 * and lastRefreshed timestamp.
 *
 * Exported for use by UI components (e.g. StaleIndicator).
 */
export { isStale };
