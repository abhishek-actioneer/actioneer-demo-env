import { describe, expect, it } from "vitest";
import { layoutVoiceWorkflow } from "@/lib/voice-campaign-layout";
import type { VoiceFlowEdge, VoiceFlowNode, VoiceFlowNodeKind } from "@/lib/voice-campaign-flow";

const CARD_WIDTH = 360;
// Approximate card height for overlap checks: header band + clamped body +
// optional branches section (see estimateNodeHeight in voice-campaign-layout.ts).
const MAX_CARD_HEIGHT = 200;

function node(id: string, kind: VoiceFlowNodeKind = "prompt"): VoiceFlowNode {
  return {
    id,
    type: "voiceNode",
    position: { x: 0, y: 0 },
    data: { kind, title: id, body: `${id} body` },
  };
}

function edge(source: string, target: string, label?: string): VoiceFlowEdge {
  return { id: `${source}-${target}-${label ?? "next"}`, source, target, label };
}

function expectNoCardOverlap(nodes: VoiceFlowNode[]) {
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const left = nodes[leftIndex]!;
      const right = nodes[rightIndex]!;
      const separatedHorizontally = left.position.x + CARD_WIDTH <= right.position.x ||
        right.position.x + CARD_WIDTH <= left.position.x;
      const separatedVertically = left.position.y + MAX_CARD_HEIGHT <= right.position.y ||
        right.position.y + MAX_CARD_HEIGHT <= left.position.y;
      expect(
        separatedHorizontally || separatedVertically,
        `${left.id} overlaps ${right.id}`,
      ).toBe(true);
    }
  }
}

describe("layoutVoiceWorkflow", () => {
  it("keeps a dense branching workflow in non-overlapping rows and columns", () => {
    const nodes = [
      node("start", "start"),
      node("intro"),
      node("decision", "condition"),
      node("yes", "question"),
      node("later", "action"),
      node("no", "end"),
      node("qualified", "transfer"),
      node("unqualified", "end"),
      node("shared-end", "end"),
    ];
    const edges = [
      edge("start", "intro"),
      edge("intro", "decision"),
      edge("decision", "yes", "interested"),
      edge("decision", "later", "maybe later"),
      edge("decision", "no", "not interested"),
      edge("yes", "qualified", "ready"),
      edge("yes", "unqualified", "not ready"),
      edge("qualified", "shared-end"),
      edge("later", "shared-end"),
      edge("unqualified", "shared-end"),
    ];

    const result = layoutVoiceWorkflow(nodes, edges);
    const byId = new Map(result.map((item) => [item.id, item]));

    expectNoCardOverlap(result);
    for (const connection of edges) {
      expect(byId.get(connection.target)!.position.y).toBeGreaterThan(byId.get(connection.source)!.position.y);
    }
    // Off-spine outcomes land right of their row's spine card.
    expect(byId.get("later")!.position.x).toBeGreaterThan(byId.get("yes")!.position.x);
    expect(byId.get("no")!.position.x).toBeGreaterThan(byId.get("yes")!.position.x);
    expect(byId.get("unqualified")!.position.x).toBeGreaterThan(byId.get("qualified")!.position.x);
  });

  it("cascades the primary conversation path diagonally with a constant step", () => {
    const nodes = [
      node("start", "start"),
      node("question", "question"),
      node("continue"),
      node("transfer", "transfer"),
      node("declined", "end"),
    ];
    const edges = [
      edge("start", "question"),
      edge("question", "continue", "yes interested"),
      edge("question", "declined", "no not interested"),
      edge("continue", "transfer", "ready"),
    ];

    const result = layoutVoiceWorkflow(nodes, edges);
    const byId = new Map(result.map((item) => [item.id, item]));
    const spine = ["start", "question", "continue", "transfer"].map((id) => byId.get(id)!.position.x);

    const step = spine[1]! - spine[0]!;
    expect(step).toBeLessThan(0);
    expect(spine[2]! - spine[1]!).toBe(step);
    expect(spine[3]! - spine[2]!).toBe(step);
    // Branches always sit to the right of the spine's lane at their rank.
    expect(byId.get("declined")!.position.x).toBeGreaterThan(byId.get("continue")!.position.x);
    expectNoCardOverlap(result);
  });

  it("gives content-heavy cards proportionally more vertical room", () => {
    const longBody = "Say: ".concat("word ".repeat(80)).trim();
    const shortChain = [node("start", "start"), node("mid"), node("finish", "end")];
    const tallChain = [
      node("start", "start"),
      {
        ...node("mid"),
        data: { kind: "prompt" as VoiceFlowNodeKind, title: "mid", body: longBody },
      },
      node("finish", "end"),
    ];
    const edges = [edge("start", "mid"), edge("mid", "finish")];

    const shortResult = new Map(layoutVoiceWorkflow(shortChain, edges).map((item) => [item.id, item]));
    const tallResult = new Map(layoutVoiceWorkflow(tallChain, edges).map((item) => [item.id, item]));

    const shortPitch = shortResult.get("finish")!.position.y - shortResult.get("mid")!.position.y;
    const tallPitch = tallResult.get("finish")!.position.y - tallResult.get("mid")!.position.y;
    expect(tallPitch).toBeGreaterThan(shortPitch);
    // The gap above the tall card is unaffected — only the row containing it grows.
    expect(tallResult.get("mid")!.position.y).toBe(shortResult.get("mid")!.position.y);
  });

  it("is deterministic and does not mutate saved node positions", () => {
    const nodes = [node("start", "start"), node("a"), node("b", "end")];
    nodes[0]!.position = { x: 91, y: 42 };
    const edges = [edge("start", "a"), edge("a", "b")];
    const originalPosition = { ...nodes[0]!.position };

    const first = layoutVoiceWorkflow(nodes, edges);
    const second = layoutVoiceWorkflow(nodes, edges);

    expect(first.map((item) => item.position)).toEqual(second.map((item) => item.position));
    expect(nodes[0]!.position).toEqual(originalPosition);
  });
});
