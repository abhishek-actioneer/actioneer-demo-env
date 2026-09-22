import {
  requiresHighStakesConfirm,
  type ShortUtteranceClassification,
} from "./voice-semantic-traps";

export const MAX_SEMANTIC_CLARIFICATION_ATTEMPTS = 2;

export const SEMANTIC_INSTRUCTION_REASONS = new Set([
  "semantic_clarification",
  "semantic_resolution",
  "semantic_fallback",
  "pitch_continuation",
]);

export type SemanticGateReleaseReason = "resolved" | "long_response" | "max_attempts";

export interface SemanticGateReleaseDecision {
  release: boolean;
  reason?: SemanticGateReleaseReason;
}

export type SemanticFlushAction =
  | { action: "clarification_sent" }
  | { action: "live_already_handled" }
  | { action: "block_awaiting_user" }
  | { action: "release_gate"; reason: SemanticGateReleaseReason }
  | { action: "release_gate_silent"; reason: string }
  | { action: "resolved_continue" }
  | { action: "continue" };

export function isSemanticInstructionReason(reason: string): boolean {
  return SEMANTIC_INSTRUCTION_REASONS.has(reason);
}

export function semanticTrapDedupeKey(trapId: string | undefined, userText: string): string {
  return `${trapId ?? "unknown"}:${userText.trim().toLowerCase()}`;
}

/** Snapshot high-stakes context when clarification is first requested. */
export function captureHighStakesDecisionAtClarify(
  trapId: string | undefined,
  assistantText: string | undefined,
  priorDecisionActive: boolean,
): boolean {
  if (priorDecisionActive) return true;
  return requiresHighStakesConfirm(assistantText);
}

export function isHighStakesSemanticTrapContext(input: {
  decisionActive?: boolean;
  trapId?: string;
  assistantText?: string;
}): boolean {
  return (
    input.decisionActive === true ||
    requiresHighStakesConfirm(input.assistantText)
  );
}

/** Block mid-call workflow after any fallback in a high-stakes decision context. */
export function shouldBlockWorkflowAfterSemanticFallback(highStakes: boolean): boolean {
  return highStakes;
}

/** Decide whether to exit awaiting-clarification without blocking the call forever. */
export function shouldReleaseSemanticGate(input: {
  awaiting: boolean;
  classification: ShortUtteranceClassification | null;
  userText: string;
  clarificationAttempts: number;
  maxAttempts?: number;
}): SemanticGateReleaseDecision {
  if (!input.awaiting) return { release: false };

  if (input.classification && !input.classification.needsClarification) {
    return { release: true, reason: "resolved" };
  }

  const words = input.userText.trim().split(/\s+/).filter(Boolean);
  if (!input.classification && (words.length > 3 || input.userText.trim().length > 32)) {
    return { release: true, reason: "long_response" };
  }

  const maxAttempts = input.maxAttempts ?? MAX_SEMANTIC_CLARIFICATION_ATTEMPTS;
  if (input.clarificationAttempts >= maxAttempts) {
    return { release: true, reason: "max_attempts" };
  }

  return { release: false };
}

/** Pure flush-path state machine — used by bridge and integration tests. */
export function evaluateSemanticTrapFlush(input: {
  classification: ShortUtteranceClassification | null;
  userText: string;
  liveClarificationKey: string;
  trapDedupeKey: string;
  awaitingClarification: boolean;
  clarificationAttempts: number;
  clarificationSent: boolean;
  maxAttempts?: number;
  /** When set, control intents preempt the clarification gate (no fallback instruction). */
  controlIntent?: string | null;
}): SemanticFlushAction {
  if (input.classification?.needsClarification) {
    if (input.clarificationSent) {
      return { action: "clarification_sent" };
    }
    if (input.liveClarificationKey === input.trapDedupeKey) {
      return { action: "live_already_handled" };
    }
  }

  if (!input.awaitingClarification) {
    return { action: "continue" };
  }

  // Slow-down / wait / stop must not race a high-stakes long_response fallback.
  if (input.controlIntent) {
    return { action: "release_gate_silent", reason: `control_${input.controlIntent}` };
  }

  if (input.classification && !input.classification.needsClarification) {
    return { action: "resolved_continue" };
  }

  const releaseDecision = shouldReleaseSemanticGate({
    awaiting: true,
    classification: input.classification,
    userText: input.userText,
    clarificationAttempts: input.clarificationAttempts,
    maxAttempts: input.maxAttempts,
  });

  if (releaseDecision.release && releaseDecision.reason && releaseDecision.reason !== "resolved") {
    return { action: "release_gate", reason: releaseDecision.reason };
  }

  if (!releaseDecision.release) {
    return { action: "block_awaiting_user" };
  }

  return { action: "continue" };
}

export function buildSemanticFallbackInstruction(
  language: string | undefined,
  reason: SemanticGateReleaseReason,
  userText: string,
  highStakes = false,
): string {
  const lang = language?.trim() || "the active language";
  if (reason === "long_response") {
    if (highStakes) {
      return [
        "Semantic gate fallback (high-stakes): customer gave a longer reply after confirmation attempts.",
        `Customer said: "${userText}".`,
        `Interpret in ${lang}. Do NOT treat as consent for callback, transfer, or link send unless they clearly agree.`,
        "Do not ask the same clarification again.",
      ].join(" ");
    }
    return [
      "Semantic gate fallback: customer gave a longer reply after clarification.",
      `Customer said: "${userText}".`,
      `Interpret their meaning in ${lang} and continue naturally.`,
      "Do not ask the same clarification again.",
    ].join(" ");
  }

  if (highStakes) {
    return [
      "Semantic gate fallback (high-stakes): clarification attempts exhausted without clear consent.",
      `Latest customer reply: "${userText}".`,
      `In ${lang}, treat this as NOT consented. Do NOT schedule callbacks, send links, or transfer.`,
      "Continue politely — offer to call back later or end the call if they are not interested.",
      "Do not loop on the same clarification question.",
    ].join(" ");
  }

  return [
    "Semantic gate fallback: clarification attempts exhausted.",
    `Latest customer reply: "${userText}".`,
    `In ${lang}, make one best-effort interpretation for a low-stakes question only.`,
    "Do not schedule callbacks, send links, or transfer without explicit clear consent.",
    "Do not loop on the same clarification question.",
  ].join(" ");
}
