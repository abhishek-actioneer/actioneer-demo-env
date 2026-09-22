import { describe, expect, it } from "vitest";
import type { VoiceFlowEdge, VoiceFlowNode } from "@/lib/voice-campaign-flow";
import {
  applyScriptToWorkflow,
  applyWorkflowToScript,
  areScriptAndWorkflowInSync,
  buildEditableCallScript,
  buildStepCallScript,
  parseStepScriptSections,
  workflowScriptFingerprint,
} from "@/lib/voice-campaign-studio-utils";

function node(
  id: string,
  title: string,
  body: string,
  y: number,
  kind: VoiceFlowNode["data"]["kind"] = "prompt",
): VoiceFlowNode {
  return {
    id,
    type: "voiceNode",
    position: { x: 0, y },
    data: { kind, title, body, required: kind === "start" || kind === "end" },
  };
}

describe("script ↔ workflow sync", () => {
  const nodes: VoiceFlowNode[] = [
    node("n1", "Greeting", "Say hello", 0, "start"),
    node("n2", "Discovery", "Ask one question", 200),
    node("n3", "Close", "Thank them", 400, "end"),
  ];
  const edges: VoiceFlowEdge[] = [
    { id: "e1", source: "n1", target: "n2", type: "smoothstep", label: "if they can talk" },
    { id: "e2", source: "n2", target: "n3", type: "smoothstep" },
  ];

  it("round-trips canonical script into matching node bodies/titles", () => {
    const script = buildEditableCallScript({ nodes, edges });
    const applied = applyScriptToWorkflow(script, nodes, edges);
    expect(workflowScriptFingerprint(applied.nodes, applied.edges)).toBe(
      workflowScriptFingerprint(nodes, edges),
    );
    expect(areScriptAndWorkflowInSync(script, applied.nodes, applied.edges)).toBe(true);
  });

  it("parses STEP scripts into workflow nodes", () => {
    const script = `
STEP 1 — GREETING & LANGUAGE PREFERENCE

VIDYA: नमस्कार! आप किस भाषा में बात करना पसंद करेंगे?

STEP 2 — TRANSPARENCY CHECK

VIDYA: Has anyone asked you to pay cash?

STEP 3 — CLOSING

VIDYA: Thank you for your time.
`;
    const steps = parseStepScriptSections(script);
    expect(steps).toHaveLength(3);
    expect(steps[0]?.title).toContain("GREETING");
    expect(steps[1]?.body).toContain("pay cash");

    const applied = applyScriptToWorkflow(script, nodes, edges);
    expect(applied.nodes.find((n) => n.id === "n1")?.data.title).toContain("GREETING");
    expect(applied.nodes.find((n) => n.id === "n2")?.data.body).toContain("pay cash");
    expect(applied.nodes.find((n) => n.id === "n3")?.data.body).toContain("Thank you");
  });

  it("rebuilds STEP script from workflow when current script is STEP-styled", () => {
    const current = "STEP 1 — Old title\n\nOld body";
    const next = applyWorkflowToScript(current, nodes, edges);
    expect(next).toContain("STEP 1 — Greeting");
    expect(next).toContain("STEP 2 — Discovery");
    expect(next).toContain("Say hello");
    expect(buildStepCallScript({ nodes, edges })).toContain("Routing notes:");
  });

  it("applies script body edits onto existing nodes", () => {
    const script = buildEditableCallScript({ nodes, edges }).replace(
      "Ask one question",
      "Ask about login fees",
    );
    const applied = applyScriptToWorkflow(script, nodes, edges);
    expect(applied.nodes.find((n) => n.id === "n2")?.data.body).toContain("login fees");
  });

  it("pushes workflow body edits into the script text", () => {
    const current = buildEditableCallScript({ nodes, edges });
    const editedNodes = nodes.map((n) =>
      n.id === "n2"
        ? { ...n, data: { ...n.data, body: "Say: Confirm disbursement happened yesterday." } }
        : n,
    );
    const next = applyWorkflowToScript(current, editedNodes, edges);
    expect(next).toContain("Confirm disbursement happened yesterday");
    expect(areScriptAndWorkflowInSync(next, editedNodes, edges)).toBe(true);
  });

  it("pushes workflow body edits into STEP-styled scripts", () => {
    const current = buildStepCallScript({ nodes, edges });
    const editedNodes = nodes.map((n) =>
      n.id === "n1"
        ? { ...n, data: { ...n.data, body: "Say: Vanakkam, this is Ananya." } }
        : n,
    );
    const next = applyWorkflowToScript(current, editedNodes, edges);
    expect(next).toContain("STEP 1 — Greeting");
    expect(next).toContain("Vanakkam, this is Ananya");
    expect(areScriptAndWorkflowInSync(next, editedNodes, edges)).toBe(true);
  });
});
