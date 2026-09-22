/**
 * Transcript text helpers shared by the live-call guards.
 *
 * These were previously exported from plivo-gemini-live-language.ts. They are
 * plain string utilities with no language-detection semantics, so they outlived
 * the removal of the runtime language checker.
 */

export function normalizeTranscriptText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function extractLastSentence(text: string): string {
  const normalized = normalizeTranscriptText(text);
  if (!normalized) return "";
  const parts = normalized
    .split(/[.!?।]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

export function tokenizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    // À-ɏ keeps Latin-1 Supplement / Latin Extended-A intact so European
    // words survive tokenization (español, prêt, möchte) instead of being stripped.
    .map((word) => word.replace(/^[^a-zÀ-ɏऀ-ॿ଀-୿஀-௿ఀ-౿ಀ-೿]+|[^a-zÀ-ɏऀ-ॿ଀-୿஀-௿ఀ-౿ಀ-೿]+$/g, ""))
    .filter(Boolean);
}
