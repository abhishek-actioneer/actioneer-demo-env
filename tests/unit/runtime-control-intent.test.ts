import { describe, expect, it } from "vitest";
import { detectResumeIntent, detectRuntimeControlIntent } from "@/lib/runtime-control-intent";

describe("runtime-control-intent", () => {
  it("detects wait for filler + duration romanized phrase", () => {
    const result = detectRuntimeControlIntent("Ah, ah. Ma 2 minuti");
    expect(result?.intent).toBe("wait");
    expect(result?.evidence).toMatch(/wait_/);
  });

  it("detects wait when direct wait cue exists", () => {
    const result = detectRuntimeControlIntent("hold on for 2 minutes please");
    expect(result).toEqual({
      intent: "wait",
      confidence: 3,
      evidence: "wait_phrase",
    });
  });

  it("does not treat mixed wait+continue utterance as wait", () => {
    const result = detectRuntimeControlIntent("wait wait continue");
    expect(result).toBeUndefined();
  });

  it("detects stop intent with high confidence", () => {
    const result = detectRuntimeControlIntent("बस, बंद करो");
    expect(result).toEqual({
      intent: "stop",
      confidence: 3,
      evidence: "stop_phrase",
    });
  });

  it("detects resume intent in Hindi", () => {
    expect(detectResumeIntent("ठीक है, आगे बोलिए")).toBe(true);
  });

  it("ignores normal domain question as control intent", () => {
    const result = detectRuntimeControlIntent("aapko mera number kaha se mila");
    expect(result).toBeUndefined();
  });

  it("detects wait for just a minute / stick around", () => {
    expect(detectRuntimeControlIntent("Just a minute")?.intent).toBe("wait");
    expect(detectRuntimeControlIntent("Stick around")?.intent).toBe("wait");
  });

  it("requires speak/pace cue for slow_down (rejects bare slowly / Romance ASR)", () => {
    // "Stick around slowly" is hold/wait, not pace control or language switch.
    expect(detectRuntimeControlIntent("Thank you. Stick around slowly.")?.intent).toBe("wait");
    expect(detectRuntimeControlIntent("Você pode falar um pouquinho mais slow?")).toBeUndefined();
    expect(detectRuntimeControlIntent("Please speak slowly")?.intent).toBe("slow_down");
    expect(detectRuntimeControlIntent("Ma'am, can you please speak a bit slowly?")?.intent).toBe(
      "slow_down",
    );
  });
});
