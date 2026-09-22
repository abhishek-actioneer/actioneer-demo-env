/**
 * Single decision point for a customer utterance.
 *
 * Instead of racing control-intent + semantic-resolution instructions (each
 * with its own cut/drop policy), classify once and emit one plan: action, cut
 * policy, and at most one instruction.
 *
 * The runtime language checker was removed — the campaign's configured language
 * reaches Gemini once via the setup systemInstruction and is never re-derived,
 * re-asserted, or switched mid-call. Instructions emitted here deliberately do
 * not name a language; the system instruction governs delivery.
 */

import { normalizeTranscriptText, tokenizeWords } from "./plivo-gemini-live-text-utils";
import {
  DECISION_RESOLUTION_DEDUPE_MS,
  INTERRUPT_QUESTION_RE,
  rawModeEnabled,
} from "./plivo-gemini-live-config";
import {
  isOpeningPermissionQuestion,
  isRightPersonQuestion,
} from "./voice-semantic-traps";
import {
  detectRuntimeControlIntent,
  type RuntimeControlIntent,
} from "./plivo-gemini-live-transcript-guards";
import {
  buildSemanticResolutionInstruction,
  classifyDecisionUtterance,
  isBinaryDecisionContext,
  type ShortUtteranceClassification,
} from "./voice-semantic-traps";
import { buildControlIntentInstructionText } from "./plivo-gemini-live-user-turn";
import { languageFollowInstruction } from "./voice-language-policy";
import {
  buildInjectionDeflectionInstruction,
  detectPromptInjectionAttempt,
} from "./public-demo-injection";
import {
  applyPublicDemoRoute,
  buildPublicDemoMenuOverrideInstruction,
  buildPublicDemoRouteOverrideInstruction,
  resolvePublicDemoRouteIntent,
  publicDemoUseCaseCatalogSpoken,
  publicDemoWhatsAppAllowed,
} from "./public-demo-route";
import { getPublicDemoSwitchAmbientMulawBase64, PUBLIC_DEMO_SWITCH_AMBIENT_DURATION_MS } from "./public-demo-switch-ambient";
import type { PublicDemoPersonaId } from "./public-demo-personas";
import type { CallConfig } from "./voice-call-state";

/** Suppress racing direct_answer only — not menu/route/semantic — after soft swap. */
const PUBLIC_DEMO_ROUTE_COOLDOWN_MS = 5000;

/** Customer asked to receive details / link on WhatsApp. */
export function looksLikeWhatsAppSendRequest(text: string): boolean {
  const normalized = normalizeTranscriptText(text).toLowerCase();
  if (!normalized) return false;
  const hasWhatsApp =
    /\b(whatsapp|whats\s*app|wa)\b/i.test(normalized) ||
    /(व्हाट्सऐप|व्हाट्सएप|व्हाट्सऐप्प|व्हाट्सएप्प)/u.test(text);
  if (!hasWhatsApp) return false;
  return (
    /\b(send|share|message|details|link|brochure|info|information|forward|drop)\b/i.test(normalized) ||
    /(भेज|शेयर|डिटेल|लिंक|भेजो|भेजिए|भेज दो|भेज दीजिए)/u.test(text)
  );
}

function buildWhatsAppSendLinkInstruction(
  userText: string,
  hasLinkTool: boolean,
  opts?: { publicDemoUnrouted?: boolean },
): string {
  if (opts?.publicDemoUnrouted) {
    return [
      `The customer asked for WhatsApp details ("${userText}").`,
      "No destination campaign is active yet on this demo line, so you cannot send WhatsApp now.",
      "Briefly ask what they need help with first. Do not claim you sent anything.",
    ].join(" ");
  }
  if (hasLinkTool) {
    return [
      `The customer asked for WhatsApp details ("${userText}").`,
      "The host is already sending the trackable WhatsApp link now — do NOT call send_link yourself.",
      "Do not ask which number to use — use the number on this call.",
      "Do not promise a later advisor callback instead of sending.",
      "Do not claim the link was already delivered — wait for the system notice.",
      "Briefly acknowledge that you are sending the details on WhatsApp right now, then continue naturally.",
    ].join(" ");
  }
  return [
    `The customer asked for WhatsApp details ("${userText}").`,
    "This campaign has no WhatsApp link tool configured, so you cannot send a link mid-call.",
    "Briefly apologize and offer to arrange an advisor callback who can share details on WhatsApp after the call.",
    "Do not claim you already sent anything.",
  ].join(" ");
}

export type TurnCutPolicy =
  /** Stop audible playback only — do NOT arm drop-until-turn-complete. */
  | "clear_playback"
  /** Hard interrupt with drop guard (wait/stop only). */
  | "interrupt_drop"
  /** Leave current audio alone. */
  | "none";

export type TurnAction =
  | "control_slow_down"
  | "control_wait"
  | "control_stop"
  | "semantic_yes"
  | "semantic_no"
  | "whatsapp_send_link"
  | "injection_deflect"
  | "public_demo_route"
  | "public_demo_menu"
  | "direct_answer"
  | "none";

export interface CustomerTurnPlan {
  action: TurnAction;
  cutPolicy: TurnCutPolicy;
  /** At most one instruction for this utterance. Empty = let Gemini continue naturally. */
  instruction: string;
  instructionReason: string;
  /** Protect the next agent turn from Gemini serverContent.interrupted for this many ms. */
  protectAckMs: number;
  controlIntent?: RuntimeControlIntent;
  semantic?: ShortUtteranceClassification;
  /** Public-demo soft route target (set for public_demo_route). */
  publicDemoPersonaId?: PublicDemoPersonaId;
}

export interface PlanCustomerTurnInput {
  userText: string;
  lastAssistantText?: string;
  source: "live" | "flush";
  /** When true, the tenant has an approved WhatsApp template configured, so send_link is registered. */
  hasLinkTool?: boolean;
  /**
   * Sampled / recipient display name known at dial time. Injected into the
   * semantic resolution instruction so the model cannot skip the identity line
   * even when the Campaign script turn is interrupted mid-way.
   */
  customerName?: string;
  /**
   * The campaign's configured language, read straight from CallConfig. This is
   * a static setting, NOT a runtime detection — it only selects which
   * intra-language ambiguity table the semantic trap gate consults. Nothing
   * here inspects the customer's speech to decide what language it is.
   */
  campaignLanguage?: string;
  /**
   * When true, run the public-demo injection/extraction pre-filter.
   * Must stay false (or unset) for ordinary production campaigns.
   */
  isPublicDemo?: boolean;
  /** Current public-demo soft route (null while still in IVR). */
  activePersonaId?: PublicDemoPersonaId | null;
  /**
   * Live CallConfig for public-demo soft swaps. When present with callId,
   * route/menu plans mutate it in place before the OVERRIDE instruction is built.
   */
  callConfig?: CallConfig;
  callId?: string;
}

/**
 * Attach the language line to whatever instruction the plan carries.
 *
 * Done once, here, rather than inside each branch: the first version wired it
 * into direct_answer only, so a customer switching to English on a
 * whatsapp_send_link turn got no language guidance at all and the agent stayed
 * in Hindi (call fclle, final turn). Every branch that answers the customer
 * needs it, and a branch added later should get it without anyone remembering.
 */
function withLanguageFollow(
  plan: CustomerTurnPlan,
  input: PlanCustomerTurnInput,
): CustomerTurnPlan {
  const instruction = plan.instruction?.trim();
  if (!instruction) return plan;
  const line = languageFollowInstruction(
    input.userText,
    input.campaignLanguage,
    input.lastAssistantText,
  );
  if (instruction.includes(line)) return plan;
  return { ...plan, instruction: `${instruction} ${line}` };
}

export function planCustomerTurn(input: PlanCustomerTurnInput): CustomerTurnPlan {
  return withLanguageFollow(planCustomerTurnAction(input), input);
}

function planCustomerTurnAction(input: PlanCustomerTurnInput): CustomerTurnPlan {
  const userText = normalizeTranscriptText(input.userText);
  const wordCount = tokenizeWords(userText).length;
  const standaloneLoanRequest =
    /(?:\bloan\b|लोन)/iu.test(userText) &&
    /(?:चाहिए|chahiye|needed|need|want)/iu.test(userText) &&
    !/^(?:yes|yeah|yep|haan|han|हाँ|हां)\b/iu.test(userText);
  const control = detectRuntimeControlIntent(userText);
  const lastAssistant = input.lastAssistantText ?? "";
  const semantic =
    !control && isBinaryDecisionContext(input.lastAssistantText)
      ? classifyDecisionUtterance({
          text: userText,
          language: input.campaignLanguage,
          lastAssistantText: lastAssistant,
          atDecisionPoint: true,
        })
      : null;

  // Priority: control > public-demo injection deflect > clear yes/no > WhatsApp send > direct answer > none.
  if (control?.intent === "slow_down") {
    return {
      action: "control_slow_down",
      cutPolicy: "clear_playback",
      instruction: buildControlIntentInstructionText("slow_down"),
      instructionReason: "control_intent_slow_down",
      protectAckMs: 3000,
      controlIntent: "slow_down",
    };
  }

  if (control?.intent === "wait" || control?.intent === "stop") {
    return {
      action: control.intent === "wait" ? "control_wait" : "control_stop",
      cutPolicy: "interrupt_drop",
      instruction: buildControlIntentInstructionText(control.intent),
      instructionReason: `control_intent_${control.intent}`,
      protectAckMs: 3000,
      controlIntent: control.intent,
    };
  }

  if (input.isPublicDemo) {
    const injection = detectPromptInjectionAttempt(userText);
    if (injection) {
      return {
        action: "injection_deflect",
        cutPolicy: "clear_playback",
        instruction: buildInjectionDeflectionInstruction(injection),
        instructionReason: `injection_${injection.kind}_${injection.evidence}`,
        protectAckMs: 4000,
      };
    }

    const routeIntent = resolvePublicDemoRouteIntent(
      userText,
      input.activePersonaId,
      input.lastAssistantText,
    );
    if (routeIntent && input.callConfig) {
      // Prefer media-stream callId; fall back so a missing Plivo UUID cannot
      // skip routing (that left the IVR stuck in direct_answer → dead air).
      const routeCallId = input.callId?.trim() || `public-demo-ephemeral`;
      if (routeIntent.type === "menu") {
        applyPublicDemoRoute(routeCallId, input.callConfig, { kind: "router" });
        return {
          action: "public_demo_menu",
          cutPolicy: "clear_playback",
          instruction: buildPublicDemoMenuOverrideInstruction(),
          instructionReason: "public_demo_menu",
          protectAckMs: 4000,
        };
      }
      applyPublicDemoRoute(routeCallId, input.callConfig, {
        kind: "persona",
        personaId: routeIntent.personaId,
      });
      return {
        action: "public_demo_route",
        cutPolicy: "clear_playback",
        instruction: buildPublicDemoRouteOverrideInstruction(routeIntent.personaId),
        instructionReason: `public_demo_route_${routeIntent.personaId}`,
        protectAckMs: 5000,
        publicDemoPersonaId: routeIntent.personaId,
      };
    }

    // Broad cooldown removed: only racing direct_answer is suppressed below so
    // mid-call transfer / menu / semantic yes still work in the first seconds
    // after a soft route.
  }

  const clearSemanticDecision =
    Boolean(semantic) &&
    !semantic!.needsClarification &&
    (semantic!.intent === "yes" || semantic!.intent === "no") &&
    // Content questions must not become YES via interest cue "need".
    !INTERRUPT_QUESTION_RE.test(userText) &&
    // A standalone request such as "mere ko loan chahiye tha" is content, not
    // an affirmative answer merely because it contains an interest/need cue.
    !standaloneLoanRequest;

  if (clearSemanticDecision && semantic) {
    return {
      action: semantic.intent === "yes" ? "semantic_yes" : "semantic_no",
      cutPolicy: "clear_playback",
      instruction: buildSemanticResolutionInstruction(
        semantic,
        userText,
        input.campaignLanguage,
        input.lastAssistantText,
        input.customerName,
      ),
      instructionReason: "semantic_resolution",
      // Keep short — long ack windows blocked barge-in for the whole pitch.
      protectAckMs:
        semantic.intent === "yes" && isOpeningPermissionQuestion(input.lastAssistantText)
          ? 1400
          : semantic.intent === "yes" && isRightPersonQuestion(input.lastAssistantText)
            ? 800
            : 900,
      semantic,
    };
  }

  if (looksLikeWhatsAppSendRequest(userText)) {
    const publicDemoUnrouted =
      Boolean(input.isPublicDemo) &&
      Boolean(input.callConfig) &&
      !publicDemoWhatsAppAllowed(input.callConfig!);
    const hasLinkTool = Boolean(input.hasLinkTool) && !publicDemoUnrouted;
    return {
      action: "whatsapp_send_link",
      cutPolicy: "clear_playback",
      instruction: buildWhatsAppSendLinkInstruction(userText, hasLinkTool, {
        publicDemoUnrouted,
      }),
      instructionReason: publicDemoUnrouted
        ? "whatsapp_send_demo_unrouted"
        : hasLinkTool
          ? "whatsapp_send_link"
          : "whatsapp_send_unavailable",
      protectAckMs: 4000,
    };
  }

  // Mid-call questions / longer barge-ins with no clear yes/no must get a reply
  // plan — action=none left customer-speech-mute on and dropped free-wheel audio
  // (dead air after content questions).
  const wantsDirectAnswer =
    !control && (INTERRUPT_QUESTION_RE.test(userText) || wordCount >= 5);
  if (wantsDirectAnswer) {
    // Incremental transcripts right after a soft route used to fire a second
    // direct_answer that interrupted the OVERRIDE and helped trip Gemini 1007.
    const routedAt = input.callConfig?.publicDemoRouteAppliedAtMs;
    if (
      input.isPublicDemo &&
      typeof routedAt === "number" &&
      Date.now() - routedAt < PUBLIC_DEMO_ROUTE_COOLDOWN_MS
    ) {
      return {
        action: "none",
        cutPolicy: "none",
        instruction: "",
        instructionReason: "public_demo_route_cooldown",
        protectAckMs: 0,
      };
    }

    const publicDemoUnrouted =
      Boolean(input.isPublicDemo) && !input.activePersonaId;
    if (publicDemoUnrouted) {
      const catalog = publicDemoUseCaseCatalogSpoken();
      return {
        action: "direct_answer",
        cutPolicy: "clear_playback",
        instruction: [
          `The customer said: "${userText}".`,
          "You are still the IVR / welcome host — no destination campaign is active yet.",
          "Answer in one short sentence. Ask how you can help if needed.",
          `If they ask what is available / options / kya kya: briefly name these use cases only — ${catalog} — then ask which they want.`,
          "If they clearly pick one use case, acknowledge briefly and stop — do NOT say you are connecting or start that campaign yourself.",
          "Do NOT invent a product pitch, loan script, or campaign talk-track.",
          "Do NOT go silent. Do not dump a catalog unprompted.",
          "Do not repeat your previous sentence.",
        ].join(" "),
        instructionReason: "direct_customer_answer_demo_ivr",
        protectAckMs: 900,
      };
    }
    return {
      action: "direct_answer",
      cutPolicy: "clear_playback",
      instruction: [
        `The customer said: "${userText}".`,
        "Answer that directly now, briefly and naturally.",
        "Use only facts and actions present in the Campaign script. If the request is outside that script, say so briefly and return to the current campaign step.",
        "Never begin a new sales, loan qualification, or lead-capture flow, and never ask for details that the Campaign script does not request.",
        "Do not repeat your previous sentence.",
        "After answering, continue the Campaign workflow only if it still fits — do not ignore their question.",
      ].join(" "),
      instructionReason: "direct_customer_answer",
      protectAckMs: 900,
    };
  }

  return {
    action: "none",
    cutPolicy: "none",
    instruction: "",
    instructionReason: "none",
    protectAckMs: 0,
  };
}

/** Minimal session surface needed to apply a plan (live + flush share this). */
export interface TurnPlanApplierDeps {
  sessionDump: { event(name: string, payload?: Record<string, unknown>): void };
  tryClearAudiblePlayback(reason: string, details?: Record<string, unknown>): boolean;
  interruptCurrentModelAudio(reason: string, details?: Record<string, unknown>): void;
  /**
   * Release dropModelAudioUntilTurnComplete so this plan's reply is not
   * discarded. Optional — live/flush wire this from barge-in.
   */
  clearModelAudioDropGuard?: (reason: string) => void;
  clearCustomerSpeechMute?: (reason: string) => void;
  activateCustomerPause(): void;
  noteControlIntentSent(intent: RuntimeControlIntent): void;
  markDecisionResolutionApplied(
    userText: string,
    semantic: ShortUtteranceClassification,
    source: "live" | "flush",
  ): void;
  sendClientInstruction(
    text: string,
    reason?: string,
    options?: { deferUntilIdle?: boolean },
  ): void;
  protectAckUntil(untilMs: number): void;
  /** Host-driven WhatsApp send when plan is whatsapp_send_link and a template is configured. */
  onHostWhatsAppSend?: () => void;
  /** Queue μ-law base64 into the Plivo outbound pump (public-demo switch ambient). */
  queueOutboundMulaw?: (payloadBase64: string) => void;
  /**
   * Defer work (e.g. send OVERRIDE after filler ambient). Defaults to setTimeout.
   * Tests may run the callback synchronously.
   */
  scheduleDeferred?: (delayMs: number, run: () => void) => void;
}

export interface RedundantPlanContext {
  /** True when the agent is mid-utterance — the script can steamroll an answer. */
  agentAudioActive: boolean;
  /** True when the semantic trap gate is mid-clarification for this utterance. */
  awaitingSemanticClarification: boolean;
}

/**
 * Whether this plan's instruction can be skipped because Gemini would already do
 * the same thing unprompted.
 *
 * Injecting `realtimeInput.text` after `activityEnd` costs a full extra round
 * trip on the critical path: we wait for Gemini's inputTranscription, plan, then
 * send text that arrives mid-generation and restarts the turn. Measured at
 * ~850ms of added voice-to-voice latency per instrumented turn.
 *
 * That cost is worth paying when the instruction changes what the model does —
 * control intents, WhatsApp sends, trap resolution, or an answer that would
 * otherwise be buried by the pitch script. It is NOT worth paying to tell the
 * model "the customer said yes, continue" when the customer just answered the
 * model's own question and nothing is competing for the turn.
 *
 * Deliberately conservative: only plain affirm/decline, only while the agent is
 * silent and no trap gate is armed. Anything else keeps its instruction.
 */
export function isRedundantLiveTurnPlan(
  plan: CustomerTurnPlan,
  ctx: RedundantPlanContext,
): boolean {
  if (plan.action !== "semantic_yes" && plan.action !== "semantic_no") return false;
  // A control intent riding along changes behaviour — never suppress it.
  if (plan.controlIntent) return false;
  // Trap gate armed → the instruction is carrying consent correctness, not just
  // conversational momentum. Always send.
  if (ctx.awaitingSemanticClarification) return false;
  if (plan.semantic?.needsClarification) return false;
  // Agent still talking → without the instruction the script keeps rolling over
  // the customer's answer. Send it (and take the latency).
  if (ctx.agentAudioActive) return false;
  return true;
}

/**
 * Apply the parts of a plan that still must happen when its instruction is
 * suppressed as redundant.
 *
 * Sending the instruction is only half of what applyCustomerTurnPlan does. The
 * other half is UN-GATING playback: the live-speech-cut and barge-in paths arm
 * the model-audio drop guard and the customer-speech mute *before* a plan is
 * ever computed, and the plan is what releases them again. Skipping the plan
 * wholesale therefore left both gates armed — Gemini generated its reply
 * normally and every chunk was discarded on the way to the caller, until an
 * unrelated timeout (mute_timeout_empty / ambient_noise_drop_after_question)
 * rescued playback mid-sentence.
 *
 * Deliberately does NOT interrupt current model audio: skipping the
 * regeneration is the entire point of suppressing, so the in-flight turn must be
 * allowed to finish rather than be cut and restarted.
 */
export function applySuppressedTurnPlan(
  deps: TurnPlanApplierDeps,
  plan: CustomerTurnPlan,
  userText: string,
  source: "live" | "flush" = "live",
): void {
  deps.clearModelAudioDropGuard?.("turn_plan_suppressed_redundant");
  deps.clearCustomerSpeechMute?.("turn_plan_suppressed_redundant");

  if (plan.semantic && (plan.action === "semantic_yes" || plan.action === "semantic_no")) {
    deps.markDecisionResolutionApplied(userText, plan.semantic, source);
  }
  if (plan.protectAckMs > 0) {
    // The natural continuation still owns the next spoken turn — give it the
    // same protection from spurious echo interrupts an instructed reply gets.
    deps.protectAckUntil(Date.now() + plan.protectAckMs);
  }

  deps.sessionDump.event("gemini.turn_plan_suppressed_redundant", {
    action: plan.action,
    instructionReason: plan.instructionReason,
    protectAckMs: plan.protectAckMs,
    source,
    userText,
  });
  console.log(
    `[voice/gemini-live] turn plan suppressed as redundant action=${plan.action} src=${source}`,
  );
}

/**
 * Apply one CustomerTurnPlan: cut, then a single instruction. Dedupes identical
 * plans so live+flush do not double-fire (same window as decision-resolution
 * dedupe — short 4s windows were letting flush re-plan).
 */
export function applyCustomerTurnPlan(
  deps: TurnPlanApplierDeps,
  plan: CustomerTurnPlan,
  userText: string,
  dedupe: { fingerprint: string; atMs: number },
  source: "live" | "flush" = "live",
): { fingerprint: string; atMs: number } {
  if (plan.action === "none") return dedupe;

  // Raw-mode harness: no plan may steer the model. Route through the suppressed
  // path rather than returning early — it still clears the drop guard and speech
  // mute, which is what keeps a suppressed turn from going silent. Gated here
  // rather than at the live call site so the flush path is covered too.
  if (rawModeEnabled()) {
    deps.sessionDump.event("gemini.raw_mode_turn_plan_suppressed", {
      action: plan.action,
      cutPolicy: plan.cutPolicy,
      source,
    });
    applySuppressedTurnPlan(deps, plan, userText, source);
    return dedupe;
  }

  const userKey = normalizeTranscriptText(userText).toLowerCase().slice(-120);
  const fingerprint = `${plan.action}|${userKey}`;
  const now = Date.now();
  const prevUserKey = dedupe.fingerprint.includes("|")
    ? dedupe.fingerprint.slice(dedupe.fingerprint.indexOf("|") + 1)
    : "";
  const isSemanticDecision =
    plan.action === "semantic_yes" ||
    plan.action === "semantic_no" ||
    plan.action === "direct_answer" ||
    plan.action === "public_demo_route" ||
    plan.action === "public_demo_menu";
  const prevWasSemanticDecision =
    dedupe.fingerprint.startsWith("semantic_yes|") ||
    dedupe.fingerprint.startsWith("semantic_no|") ||
    dedupe.fingerprint.startsWith("direct_answer|") ||
    dedupe.fingerprint.startsWith("public_demo_route|") ||
    dedupe.fingerprint.startsWith("public_demo_menu|");

  if (fingerprint === dedupe.fingerprint && now - dedupe.atMs < DECISION_RESOLUTION_DEDUPE_MS) {
    deps.sessionDump.event("gemini.turn_plan_deduped", {
      action: plan.action,
      source,
      windowMs: DECISION_RESOLUTION_DEDUPE_MS,
    });
    console.log(
      `[voice/gemini-live] turn plan deduped action=${plan.action} src=${source} reason=timed_window`,
    );
    return dedupe;
  }
  // Sticky semantic/direct plans: flush often lands 15–30s after live (long agent
  // reply). Re-applying clears Plivo mid-sentence and Gemini regenerates the same
  // line. Same user utterance must not re-fire even after the timed window.
  if (
    isSemanticDecision &&
    (fingerprint === dedupe.fingerprint ||
      (prevWasSemanticDecision && prevUserKey === userKey && Boolean(userKey)))
  ) {
    deps.sessionDump.event("gemini.turn_plan_deduped", {
      action: plan.action,
      source,
      reason: "sticky_same_user_decision",
      ageMs: now - dedupe.atMs,
      prevFingerprint: dedupe.fingerprint,
    });
    console.log(
      `[voice/gemini-live] turn plan deduped action=${plan.action} src=${source} reason=sticky_same_user_decision ageMs=${now - dedupe.atMs}`,
    );
    return dedupe;
  }

  if (plan.cutPolicy === "clear_playback" || plan.cutPolicy === "interrupt_drop") {
    // Always hard-interrupt prior agent audio when the customer just spoke a
    // planned turn. tryClear alone left Gemini streaming (felt like no barge-in).
    deps.interruptCurrentModelAudio(`turn_plan_${plan.action}`, {
      action: plan.action,
      source,
    });
    // Soft-route keeps the drop guard up through the filler ambient so Gemini
    // cannot talk over the hold tone; released when the deferred OVERRIDE fires.
    const deferForSwitchAmbient =
      plan.action === "public_demo_route" || plan.action === "public_demo_menu";
    if (!deferForSwitchAmbient) {
      deps.clearModelAudioDropGuard?.("turn_plan_followup_immediate");
    }
  }

  if (plan.action === "control_wait" || plan.action === "control_stop") {
    deps.activateCustomerPause();
  }
  if (plan.controlIntent) {
    deps.noteControlIntentSent(plan.controlIntent);
  }
  if (plan.semantic && (plan.action === "semantic_yes" || plan.action === "semantic_no")) {
    deps.markDecisionResolutionApplied(userText, plan.semantic, source);
  }

  if (plan.action === "whatsapp_send_link" && plan.instructionReason === "whatsapp_send_link") {
    deps.onHostWhatsAppSend?.();
  }

  const switchAmbient =
    (plan.action === "public_demo_route" || plan.action === "public_demo_menu") &&
    Boolean(deps.queueOutboundMulaw);

  if (switchAmbient && deps.queueOutboundMulaw) {
    try {
      deps.queueOutboundMulaw(getPublicDemoSwitchAmbientMulawBase64());
      deps.sessionDump.event("public_demo.switch_ambient_queued", {
        action: plan.action,
        source,
        durationMs: PUBLIC_DEMO_SWITCH_AMBIENT_DURATION_MS,
      });
    } catch (err) {
      console.warn(
        `[voice/gemini-live] public demo switch ambient failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const instruction = plan.instruction;
    const instructionReason = plan.instructionReason;
    const schedule = deps.scheduleDeferred ?? ((delayMs, run) => setTimeout(run, delayMs));
    schedule(PUBLIC_DEMO_SWITCH_AMBIENT_DURATION_MS, () => {
      // Filler finished — allow Ananya (or Vani-on-menu) audio and inject OVERRIDE.
      deps.clearModelAudioDropGuard?.("public_demo_switch_ambient_done");
      if (instruction) {
        deps.clearCustomerSpeechMute?.("turn_plan_instruction");
        deps.sendClientInstruction(instruction, instructionReason);
      }
      deps.sessionDump.event("public_demo.switch_ambient_complete", {
        action: plan.action,
        source,
        instructionReason,
      });
    });
  } else if (plan.instruction) {
    // Planned reply owns the next spoken turn — lift barge-in mute so it can play.
    deps.clearCustomerSpeechMute?.("turn_plan_instruction");
    deps.sendClientInstruction(plan.instruction, plan.instructionReason);
  }

  const protectUntil =
    now +
    plan.protectAckMs +
    (switchAmbient ? PUBLIC_DEMO_SWITCH_AMBIENT_DURATION_MS : 0);
  if (protectUntil > now) {
    deps.protectAckUntil(protectUntil);
  }

  deps.sessionDump.event("gemini.turn_plan_applied", {
    action: plan.action,
    cutPolicy: plan.cutPolicy,
    instructionReason: plan.instructionReason,
    protectAckMs: plan.protectAckMs,
    switchAmbientDeferredMs: switchAmbient ? PUBLIC_DEMO_SWITCH_AMBIENT_DURATION_MS : 0,
    source,
  });
  console.log(
    `[voice/gemini-live] turn plan action=${plan.action} cut=${plan.cutPolicy} src=${source}` +
      (switchAmbient ? ` ambientDeferMs=${PUBLIC_DEMO_SWITCH_AMBIENT_DURATION_MS}` : ""),
  );
  return { fingerprint, atMs: now };
}
