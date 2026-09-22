import { REQUIRED_UNIVERSAL_ROUTE_KINDS } from "@/lib/voice-agent-generation-types";
import type { VoiceFlowNodeKind, VoiceUniversalRoute } from "@/lib/voice-campaign-flow";

export interface VoiceWorkflowValidationNode {
  id: string;
  kind: VoiceFlowNodeKind;
}

export interface VoiceWorkflowValidationEdge {
  source: string;
  target: string;
  label?: string | null;
}

export interface VoiceWorkflowValidationInput {
  nodes: VoiceWorkflowValidationNode[];
  edges: VoiceWorkflowValidationEdge[];
  universalRoutes: VoiceUniversalRoute[];
}

export interface VoiceWorkflowValidationResult {
  valid: boolean;
  issues: string[];
}

export function validateVoiceCampaignWorkflow({
  nodes,
  edges,
  universalRoutes,
}: VoiceWorkflowValidationInput): VoiceWorkflowValidationResult {
  const issues: string[] = [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const duplicateNodeIds = nodes
    .map((node) => node.id)
    .filter((id, index, ids) => ids.indexOf(id) !== index);
  if (duplicateNodeIds.length > 0) {
    issues.push(`Duplicate node IDs: ${[...new Set(duplicateNodeIds)].join(", ")}`);
  }

  const starts = nodes.filter((node) => node.kind === "start");
  if (starts.length !== 1) issues.push("Workflow must contain exactly one start node");
  if (!nodes.some((node) => node.kind === "end")) {
    issues.push("Workflow must contain at least one end node");
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.source)) issues.push(`Edge references missing source node: ${edge.source}`);
    if (!nodeIds.has(edge.target)) issues.push(`Edge references missing target node: ${edge.target}`);
    if (edge.source === edge.target) issues.push(`Self-referencing edge is not allowed: ${edge.source}`);
  }

  for (const node of nodes) {
    if (node.kind === "end") continue;
    const outgoing = edges.filter((edge) => edge.source === node.id && nodeIds.has(edge.target));
    if (outgoing.length === 0) issues.push(`Non-terminal node has no exit: ${node.id}`);
    if (node.kind === "condition") {
      if (outgoing.length < 2) issues.push(`Decision node needs at least two exits: ${node.id}`);
      if (outgoing.some((edge) => !edge.label?.trim())) {
        issues.push(`Every decision exit needs a label or condition: ${node.id}`);
      }
    }
  }

  const meaningfulBranches = nodes.filter((node) => {
    if (node.kind !== "condition") return false;
    const outgoing = edges.filter((edge) => edge.source === node.id);
    return outgoing.length >= 2 && outgoing.every((edge) => Boolean(edge.label?.trim()));
  });
  if (meaningfulBranches.length === 0) {
    issues.push("Workflow must contain at least one labeled decision branch");
  }

  const routeKinds = universalRoutes.map((route) => route.kind);
  for (const kind of REQUIRED_UNIVERSAL_ROUTE_KINDS) {
    const count = routeKinds.filter((candidate) => candidate === kind).length;
    if (count === 0) issues.push(`Missing universal route: ${kind}`);
    if (count > 1) issues.push(`Universal route must be unique: ${kind}`);
  }
  for (const route of universalRoutes) {
    if (!route.label.trim()) issues.push(`Universal route needs a label: ${route.kind}`);
    if (!route.trigger.trim()) issues.push(`Universal route needs a trigger: ${route.kind}`);
    if (!route.behavior.trim()) issues.push(`Universal route needs behavior: ${route.kind}`);
    if (route.targetNodeId && !nodeIds.has(route.targetNodeId)) {
      issues.push(`Universal route references missing target node: ${route.kind} -> ${route.targetNodeId}`);
    }
  }

  const escalation = universalRoutes.find((route) => route.kind === "escalation");
  const escalationTarget = escalation?.targetNodeId
    ? nodes.find((node) => node.id === escalation.targetNodeId)
    : undefined;
  if (!escalation?.targetNodeId || escalationTarget?.kind !== "transfer") {
    issues.push("Escalation universal route must target a transfer node");
  }

  if (starts.length === 1) {
    const reachable = new Set<string>();
    const queue = [starts[0].id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (reachable.has(current)) continue;
      reachable.add(current);
      for (const edge of edges) {
        if (edge.source === current && nodeIds.has(edge.target) && !reachable.has(edge.target)) {
          queue.push(edge.target);
        }
      }
      for (const route of universalRoutes) {
        if (route.targetNodeId && nodeIds.has(route.targetNodeId) && !reachable.has(route.targetNodeId)) {
          queue.push(route.targetNodeId);
        }
      }
    }
    const unreachable = nodes.filter((node) => !reachable.has(node.id)).map((node) => node.id);
    if (unreachable.length > 0) issues.push(`Unreachable nodes: ${unreachable.join(", ")}`);
  }

  return { valid: issues.length === 0, issues };
}
