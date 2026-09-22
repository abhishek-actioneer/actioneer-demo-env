import { describe, expect, it, vi } from "vitest";
import { createInstructionQueue } from "@/lib/plivo-gemini-live-instructions";

describe("createInstructionQueue ownership", () => {
  function makeQueue(overrides?: {
    isDropModelAudioActive?: () => boolean;
    agentAudioLikelyActive?: () => boolean;
  }) {
    const events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    const queue = createInstructionQueue({
      isClosed: () => false,
      getGeminiWs: () => undefined,
      getSetupComplete: () => true,
      isDropModelAudioActive: overrides?.isDropModelAudioActive ?? (() => false),
      getAwaitingCustomerResponse: () => false,
      agentAudioLikelyActive: overrides?.agentAudioLikelyActive ?? (() => false),
      sessionDump: {
        event: (type: string, payload?: Record<string, unknown>) => {
          events.push({ type, payload });
        },
      } as never,
    });
    return { queue, events };
  }

  it("preserves ownership on semantic_trap / control / language drops", () => {
    const { queue } = makeQueue();
    queue.sendClientInstruction("Say the confirm line", "semantic_clarification");
    expect(queue.getLastInstructionReason()).toBe("semantic_clarification");
    expect(queue.shouldPreserveOwnershipOnDrop("semantic_trap")).toBe(true);
    expect(queue.shouldPreserveOwnershipOnDrop("control_intent")).toBe(true);
    expect(queue.shouldPreserveOwnershipOnDrop("language_switch")).toBe(true);
    expect(queue.shouldPreserveOwnershipOnDrop("interrupt")).toBe(false);
  });

  it("force-flushes deferred language_update after interrupt drop even if agent turn flag is sticky", () => {
    let dropActive = true;
    const agentActive = () => true;
    const { queue, events } = makeQueue({
      isDropModelAudioActive: () => dropActive,
      agentAudioLikelyActive: agentActive,
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    queue.sendClientInstruction("Speak in Tamil now.", "language_update", {
      deferUntilIdle: true,
    });
    expect(events.some((e) => e.type === "gemini.realtime_instruction_queued")).toBe(true);
    expect(queue.getLastInstructionReason()).toBe("none");

    dropActive = false;
    // Sticky assistantTurnStartMs would keep agentAudioLikelyActive true — must still flush.
    queue.flushPendingRealtimeInstructions("turn_dropped_after_interrupt:language_switch");
    expect(queue.getLastInstructionReason()).toBe(
      "queued:turn_dropped_after_interrupt:language_switch:language_update",
    );
    expect(queue.getLastInstruction()).toContain("Speak in Tamil now.");

    logSpy.mockRestore();
  });

  it("clears ownership only when not preserved", () => {
    const { queue } = makeQueue();
    const sendSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    queue.sendClientInstruction("Slow down in English", "control_intent_slow_down");
    if (!queue.shouldPreserveOwnershipOnDrop("control_intent")) {
      queue.clearLastInstructionOwnership("turn_dropped:control_intent");
    }
    expect(queue.getLastInstructionReason()).toBe("control_intent_slow_down");
    queue.clearLastInstructionOwnership("assistant_turn_complete");
    expect(queue.getLastInstructionReason()).toBe("none");
    sendSpy.mockRestore();
  });
});
