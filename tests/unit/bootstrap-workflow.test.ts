import { describe, expect, it } from "vitest";
import {
  applyScriptToWorkflow,
  bootstrapWorkflowFromScript,
  workflowScriptFingerprint,
} from "@/lib/voice-campaign-studio-utils";

const STEP_SCRIPT = `STEP 1 — Call Connect

Say the opening line and wait for permission.

Note: Do not pitch before consent.

STEP 2 — Explain Offer

Describe the cashback offer briefly.

STEP 3 — Close Call

Thank them and end politely.`;

const NUMBERED_SCRIPT = `Conversation script:

1. Call Connect
Say: Hello, this is Asha from FreshLane.
Note: Wait for a response.

2. Ask About Order
Say: I wanted to check about your recent order.

3. Close Call
Say: Thank you for your time.

Routing notes:
- Call Connect -> Ask About Order
- Ask About Order -> Close Call when they respond`;

describe("bootstrapWorkflowFromScript", () => {
  it("returns null for empty or unstructured scripts", () => {
    expect(bootstrapWorkflowFromScript("")).toBeNull();
    expect(bootstrapWorkflowFromScript("Just be friendly and helpful on the call.")).toBeNull();
  });

  it("builds nodes and linear edges from a STEP-style script", () => {
    const result = bootstrapWorkflowFromScript(STEP_SCRIPT);
    expect(result).not.toBeNull();
    const { nodes, edges } = result!;
    expect(nodes).toHaveLength(3);
    expect(nodes[0]!.data.kind).toBe("start");
    expect(nodes[0]!.data.title).toBe("Call Connect");
    expect(nodes[0]!.data.helper).toBe("Do not pitch before consent.");
    expect(nodes[1]!.data.kind).toBe("prompt");
    expect(nodes[2]!.data.kind).toBe("end");
    expect(edges).toHaveLength(2);
    expect(edges.map((e) => [e.source, e.target])).toEqual([
      ["start", "script-step-2"],
      ["script-step-2", "script-step-3"],
    ]);
  });

  it("builds nodes from a canonical numbered script and honors routing notes", () => {
    const result = bootstrapWorkflowFromScript(NUMBERED_SCRIPT);
    expect(result).not.toBeNull();
    const { nodes, edges } = result!;
    expect(nodes.map((n) => n.data.title)).toEqual([
      "Call Connect",
      "Ask About Order",
      "Close Call",
    ]);
    const labeled = edges.find((e) => e.target === nodes[2]!.id);
    expect(labeled?.label).toBe("they respond");
  });

  it("round-trips with applyScriptToWorkflow so the sync does not clobber it", () => {
    for (const script of [STEP_SCRIPT, NUMBERED_SCRIPT]) {
      const { nodes, edges } = bootstrapWorkflowFromScript(script)!;
      const applied = applyScriptToWorkflow(script, nodes, edges);
      expect(workflowScriptFingerprint(applied.nodes, applied.edges)).toBe(
        workflowScriptFingerprint(nodes, edges),
      );
    }
  });
});
