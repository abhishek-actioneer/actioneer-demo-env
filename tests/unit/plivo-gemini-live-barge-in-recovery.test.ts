import { describe, expect, it, vi } from "vitest";
import { createUserTurnFlusher, type UserTurnFlusherDeps } from "@/lib/plivo-gemini-live-user-turn";

function baseDeps(overrides: Partial<UserTurnFlusherDeps> & Record<string, unknown>): UserTurnFlusherDeps {
  let pending = "um";
  return {
    sessionDump: { event: vi.fn() },
    semantic: {
      getLastAssistantTurnText: () => "समझ आ गया?",
    },
    getPendingUserTranscript: () => pending,
    setPendingUserTranscript: (value: string) => {
      pending = value;
    },
    getScreeningReplyQueued: () => false,
    interruptCurrentModelAudio: vi.fn(),
    isAwaitingLanguagePreference: () => false,
    isCustomerSpeechMuteActive: () => false,
    isBargeInRecoveryProtected: () => false,
    getAwaitingCustomerResponse: () => true,
    getLastMeaningfulUserSpeechAtMs: () => 0,
    recoverFromEmptyBargeIn: vi.fn(),
    ...overrides,
    // keep pending setter tied to local unless overridden
    ...(overrides.setPendingUserTranscript
      ? {}
      : {
          getPendingUserTranscript: () => pending,
          setPendingUserTranscript: (value: string) => {
            pending = value;
          },
        }),
  } as unknown as UserTurnFlusherDeps;
}

describe("barge-in / ambient drop dry-call prevention", () => {
  it("clears noise without dropping audio while awaiting a question answer", () => {
    const interruptCurrentModelAudio = vi.fn();
    const deps = baseDeps({ interruptCurrentModelAudio });
    const { flushPendingUserTranscript } = createUserTurnFlusher(deps);
    flushPendingUserTranscript();
    expect(interruptCurrentModelAudio).not.toHaveBeenCalled();
  });

  it("clears noise without dropping audio during recovery protect", () => {
    const interruptCurrentModelAudio = vi.fn();
    const deps = baseDeps({
      interruptCurrentModelAudio,
      getAwaitingCustomerResponse: () => false,
      semantic: {
        getLastAssistantTurnText: () => "Okay noted.",
      } as unknown as UserTurnFlusherDeps["semantic"],
      isBargeInRecoveryProtected: () => true,
    });
    const { flushPendingUserTranscript } = createUserTurnFlusher(deps);
    flushPendingUserTranscript();
    expect(interruptCurrentModelAudio).not.toHaveBeenCalled();
  });

  it("still drops ambient noise when idle and not awaiting an answer", () => {
    const interruptCurrentModelAudio = vi.fn();
    const deps = baseDeps({
      interruptCurrentModelAudio,
      getAwaitingCustomerResponse: () => false,
      semantic: {
        getLastAssistantTurnText: () => "Okay noted.",
      } as unknown as UserTurnFlusherDeps["semantic"],
      getLastMeaningfulUserSpeechAtMs: () => Date.now() - 60_000,
    });
    const { flushPendingUserTranscript } = createUserTurnFlusher(deps);
    flushPendingUserTranscript();
    expect(interruptCurrentModelAudio).toHaveBeenCalled();
  });

  it("keeps a short reply when local VAD verified real caller speech", () => {
    let pending = "um";
    let customerTurns = 0;
    let verified = true;
    const recordTranscriptTurn = vi.fn();
    const interruptCurrentModelAudio = vi.fn();
    const semantic = {
      getLastAssistantTurnText: () => "Can you tell me what happened?",
      classify: () => null,
      getLiveClarificationKey: () => "",
      isAwaitingClarification: () => false,
      getClarificationAttempts: () => 0,
      bumpClarificationAttempts: vi.fn(),
      requestClarification: () => false,
      maybeResolve: () => false,
      releaseGate: vi.fn(),
      releaseGateSilently: vi.fn(),
      wasDecisionResolutionAppliedFor: () => false,
      shouldSendPostClosingThanks: () => false,
      sendPostClosingThanksInstruction: vi.fn(),
      isHighStakesWorkflowBlocked: () => false,
    } as unknown as UserTurnFlusherDeps["semantic"];
    const deps = {
      sessionDump: { event: vi.fn() },
      semantic,
      getCallConfig: () => undefined,
      getCurrentCallUuid: () => undefined,
      getCallConfigId: () => undefined,
      getPendingUserTranscript: () => pending,
      setPendingUserTranscript: (value: string) => {
        pending = value;
        if (!value) verified = false;
      },
      getPendingUserTranscriptAcousticallyVerified: () => verified,
      setPendingUserTranscriptAcousticallyVerified: (value: boolean) => {
        verified = value;
      },
      getScreeningReplyQueued: () => false,
      getCustomerTurnCount: () => customerTurns,
      setCustomerTurnCount: (value: number) => {
        customerTurns = value;
      },
      getUserTurnStartMs: () => 100,
      setUserTurnStartMs: vi.fn(),
      getCustomerPauseActive: () => false,
      setCustomerPauseActive: vi.fn(),
      setCustomerPauseAckPending: vi.fn(),
      getOutputTranscriptBuffer: () => "",
      getLastUserBargeInAtMs: () => 0,
      getTurnPlanDedupe: () => ({ fingerprint: "", atMs: 0 }),
      setTurnPlanDedupe: vi.fn(),
      mediaStreamOffsetMs: () => 200,
      tryClearAudiblePlayback: () => false,
      interruptCurrentModelAudio,
      clearModelAudioDropGuard: vi.fn(),
      clearCustomerSpeechMute: vi.fn(),
      isCustomerSpeechMuteActive: () => false,
      recoverFromEmptyBargeIn: vi.fn(),
      isBargeInRecoveryProtected: () => false,
      getAwaitingCustomerResponse: () => false,
      getLastMeaningfulUserSpeechAtMs: () => Date.now(),
      activateCustomerPause: vi.fn(),
      noteControlIntentSent: vi.fn(),
      markDecisionResolutionApplied: vi.fn(),
      sendClientInstruction: vi.fn(),
      protectAckUntil: vi.fn(),
      sendResumeFromPauseInstruction: vi.fn(),
      recordTranscriptTurn,
      releaseAwaitingCustomerResponse: vi.fn(),
      schedulePostBargeInNudge: vi.fn(),
      clearPostBargeInNudge: vi.fn(),
      sendPostInterruptAnswerNudge: vi.fn(),
      isSubstantiveUserInterrupt: () => false,
      scheduleAgentDisconnect: vi.fn(),
    } as unknown as UserTurnFlusherDeps;

    createUserTurnFlusher(deps).flushPendingUserTranscript();

    expect(customerTurns).toBe(1);
    expect(recordTranscriptTurn).toHaveBeenCalledWith(
      "user",
      "um",
      expect.objectContaining({ startMs: 100, endMs: 200 }),
    );
    expect(interruptCurrentModelAudio).not.toHaveBeenCalled();
    expect(pending).toBe("");
  });
});
