import { callerIdlePromptMs } from "./plivo-gemini-live-config";

export interface CallerIdleControllerDeps {
  isClosed(): boolean;
  agentAudioLikelyActive(): boolean;
  estimatedRemainingPlaybackMs(): number;
  releaseAwaitingCustomerResponse(reason: string): void;
  sendClientInstruction(text: string, reason: string): void;
  emitEvent(event: string, payload?: Record<string, unknown>): void;
}

export interface CallerIdleController {
  /** Start a one-shot silence check after the current audio finishes playing. */
  armAfterAgentTurn(reason: string): void;
  /** Any verified caller activity or new model response cancels the check. */
  cancel(reason: string): void;
}

export function createCallerIdleController(
  deps: CallerIdleControllerDeps,
): CallerIdleController {
  let timer: NodeJS.Timeout | undefined;
  let generation = 0;

  function cancel(reason: string): void {
    generation += 1;
    if (!timer) return;
    clearTimeout(timer);
    timer = undefined;
    deps.emitEvent("gemini.caller_idle_cancelled", { reason });
  }

  function schedule(reason: string, expectedGeneration: number): void {
    const playbackDelayMs = Math.max(0, deps.estimatedRemainingPlaybackMs());
    const silenceMs = callerIdlePromptMs();
    timer = setTimeout(() => {
      timer = undefined;
      if (deps.isClosed() || generation !== expectedGeneration) return;

      // Playback can be extended after the turn-complete event (for example by
      // a short outbound hold). Restart from the new audible boundary instead
      // of speaking over the agent.
      if (deps.agentAudioLikelyActive()) {
        schedule("playback_extended", expectedGeneration);
        return;
      }

      deps.releaseAwaitingCustomerResponse("caller_idle_check");
      deps.sendClientInstruction(
        "The customer has been silent for five seconds. In one short sentence, " +
          "ask whether they are still on the line, using the current campaign language. " +
          "Do not continue the campaign script until they answer.",
        "caller_idle_check",
      );
      deps.emitEvent("gemini.caller_idle_prompted", { reason, silenceMs });
    }, playbackDelayMs + silenceMs);
    deps.emitEvent("gemini.caller_idle_armed", {
      reason,
      playbackDelayMs,
      silenceMs,
    });
  }

  function armAfterAgentTurn(reason: string): void {
    cancel("rearmed");
    const expectedGeneration = generation;
    schedule(reason, expectedGeneration);
  }

  return { armAfterAgentTurn, cancel };
}
