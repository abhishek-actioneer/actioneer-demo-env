import type { VoiceTranscriptTurn } from "./voice-campaign-types";

const EPOCH_MS_THRESHOLD = 1_000_000_000_000;
const MAX_RELATIVE_STREAM_MS = 24 * 60 * 60 * 1000;

function timeMs(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isEpochMillis(ms: number): boolean {
  return ms >= EPOCH_MS_THRESHOLD;
}

function isRelativeStreamMs(ms: number): boolean {
  return ms >= 0 && ms < MAX_RELATIVE_STREAM_MS;
}

export interface TranscriptSortContext {
  callStartedAt?: string;
}

interface ResolvedSortContext {
  anchorEpochMs?: number;
  normalizeEpoch: boolean;
}

function minEpochStartMs(turns: VoiceTranscriptTurn[]): number | undefined {
  let min: number | undefined;
  for (const turn of turns) {
    const startMs = turn.startMs;
    const endMs = turn.endMs;
    for (const candidate of [startMs, endMs]) {
      if (candidate === undefined || !isEpochMillis(candidate)) continue;
      min = min === undefined ? candidate : Math.min(min, candidate);
    }
  }
  return min;
}

function hasMixedTranscriptClocks(turns: VoiceTranscriptTurn[]): boolean {
  let hasRelative = false;
  let hasEpoch = false;
  for (const turn of turns) {
    for (const candidate of [turn.startMs, turn.endMs]) {
      if (candidate === undefined) continue;
      if (isEpochMillis(candidate)) hasEpoch = true;
      else if (isRelativeStreamMs(candidate)) hasRelative = true;
      if (hasRelative && hasEpoch) return true;
    }
  }
  return false;
}

function buildResolvedSortContext(
  turns: VoiceTranscriptTurn[],
  context?: TranscriptSortContext,
): ResolvedSortContext {
  const normalizeEpoch = hasMixedTranscriptClocks(turns);
  if (!normalizeEpoch) return { normalizeEpoch: false };

  const anchorEpochMs = timeMs(context?.callStartedAt) ?? minEpochStartMs(turns);
  return { normalizeEpoch: true, anchorEpochMs };
}

function resolveTurnMs(
  rawMs: number | undefined,
  fallbackMs: number | undefined,
  sortContext: ResolvedSortContext,
): number {
  const raw = rawMs ?? fallbackMs ?? 0;
  if (!sortContext.normalizeEpoch || !isEpochMillis(raw) || sortContext.anchorEpochMs === undefined) {
    return raw;
  }
  return Math.max(0, raw - sortContext.anchorEpochMs);
}

function resolveTurnStartMs(
  turn: VoiceTranscriptTurn,
  sortContext: ResolvedSortContext,
): number {
  const fallback = timeMs(turn.at) ?? turn.sequence ?? 0;
  return resolveTurnMs(turn.startMs, fallback, sortContext);
}

function resolveTurnEndMs(
  turn: VoiceTranscriptTurn,
  startMs: number,
  sortContext: ResolvedSortContext,
): number {
  return resolveTurnMs(turn.endMs, startMs, sortContext);
}

/** Canonical stream-relative timing for export (S3) and display. */
export function canonicalTurnTimingMs(
  turn: VoiceTranscriptTurn,
  context?: TranscriptSortContext,
): { startMs?: number; endMs?: number; durationMs?: number } {
  const anchorEpochMs = timeMs(context?.callStartedAt);

  const normalize = (raw: number | undefined): number | undefined => {
    if (raw === undefined) return undefined;
    if (isEpochMillis(raw) && anchorEpochMs !== undefined) {
      return Math.max(0, raw - anchorEpochMs);
    }
    return raw;
  };

  const startFromAt = anchorEpochMs !== undefined
    ? Math.max(0, (timeMs(turn.at) ?? anchorEpochMs) - anchorEpochMs)
    : undefined;

  const startMs = turn.startMs !== undefined ? normalize(turn.startMs) : startFromAt;
  if (startMs === undefined) return {};

  const endMs = turn.endMs !== undefined ? (normalize(turn.endMs) ?? startMs) : startMs;
  return {
    startMs,
    endMs,
    durationMs: Math.max(0, endMs - startMs),
  };
}

export function compareTranscriptTurns(
  a: VoiceTranscriptTurn,
  b: VoiceTranscriptTurn,
  context?: ResolvedSortContext,
): number {
  const sortContext = context ?? { normalizeEpoch: false };
  const aStart = resolveTurnStartMs(a, sortContext);
  const bStart = resolveTurnStartMs(b, sortContext);
  if (aStart !== bStart) return aStart - bStart;

  const aEnd = resolveTurnEndMs(a, aStart, sortContext);
  const bEnd = resolveTurnEndMs(b, bStart, sortContext);
  if (aEnd !== bEnd) return aEnd - bEnd;

  return (a.sequence ?? 0) - (b.sequence ?? 0);
}

export function sortTranscriptTurns(
  turns: VoiceTranscriptTurn[],
  context?: TranscriptSortContext,
): VoiceTranscriptTurn[] {
  const resolvedContext = buildResolvedSortContext(turns, context);
  return [...turns].sort((a, b) => compareTranscriptTurns(a, b, resolvedContext));
}

export function isGeminiRealtimeTurn(turn: VoiceTranscriptTurn): boolean {
  return (turn.role === "assistant" || turn.role === "user") &&
    typeof turn.itemId === "string" &&
    turn.itemId.startsWith("live-");
}

export function hasGeminiRealtimeTranscript(turns: VoiceTranscriptTurn[] | undefined): boolean {
  return (turns ?? []).some(isGeminiRealtimeTurn);
}
