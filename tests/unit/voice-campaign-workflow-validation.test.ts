import { describe, expect, it } from "vitest";
import type { VoiceUniversalRoute } from "@/lib/voice-campaign-flow";
import { REQUIRED_UNIVERSAL_ROUTE_KINDS } from "@/lib/voice-agent-generation-types";
import { validateVoiceCampaignWorkflow } from "@/lib/voice-campaign-workflow-validation";

function universalRoutes(): VoiceUniversalRoute[] {
  return REQUIRED_UNIVERSAL_ROUTE_KINDS.map((kind) => ({
    kind,
    label: kind.replace(/_/g, " "),
    trigger: `Customer signals ${kind}`,
    behavior: "Acknowledge and follow the route safely",
    targetNodeId: kind === "escalation" ? "transfer" : kind === "question_confusion" ? "decision" : "end",
    terminal: !["question_confusion", "escalation", "change_language", "silence_unclear"].includes(kind),
  }));
}

describe("validateVoiceCampaignWorkflow", () => {
  const validWorkflow = {
    nodes: [
      { id: "start", kind: "start" as const },
      { id: "decision", kind: "condition" as const },
      { id: "help", kind: "prompt" as const },
      { id: "transfer", kind: "transfer" as const },
      { id: "end", kind: "end" as const },
    ],
    edges: [
      { source: "start", target: "decision", label: "customer responds" },
      { source: "decision", target: "help", label: "needs help" },
      { source: "decision", target: "end", label: "goal complete" },
      { source: "help", target: "end", label: "resolved" },
      { source: "transfer", target: "end", label: "handoff complete" },
    ],
    universalRoutes: universalRoutes(),
  };

  it("accepts a branched workflow with all universal routes", () => {
    expect(validateVoiceCampaignWorkflow(validWorkflow)).toEqual({ valid: true, issues: [] });
  });

  it("rejects missing routes, unlabeled decisions, and missing exits", () => {
    const result = validateVoiceCampaignWorkflow({
      ...validWorkflow,
      edges: [{ source: "start", target: "decision" }, { source: "decision", target: "end" }],
      universalRoutes: universalRoutes().filter((route) => route.kind !== "do_not_call"),
    });
    expect(result.valid).toBe(false);
    expect(result.issues).toContain("Missing universal route: do_not_call");
    expect(result.issues).toContain("Decision node needs at least two exits: decision");
    expect(result.issues).toContain("Non-terminal node has no exit: help");
  });

  it("requires escalation to target a transfer node", () => {
    const routes = universalRoutes().map((route) =>
      route.kind === "escalation" ? { ...route, targetNodeId: "end" } : route,
    );
    const result = validateVoiceCampaignWorkflow({ ...validWorkflow, universalRoutes: routes });
    expect(result.issues).toContain("Escalation universal route must target a transfer node");
  });
});
