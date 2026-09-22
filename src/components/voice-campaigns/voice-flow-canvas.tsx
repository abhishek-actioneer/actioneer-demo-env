"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  type EdgeTypes,
  type NodeTypes,
  type OnEdgesChange,
  type OnNodesChange,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { VoiceFlowEdge, VoiceFlowNode as VoiceFlowNodeType } from "@/lib/voice-campaign-flow";
import { VoiceStepEdge } from "./voice-step-edge";
import { VoiceFlowNode } from "./voice-flow-node";

const nodeTypes: NodeTypes = {
  voiceNode: VoiceFlowNode,
};

const edgeTypes: EdgeTypes = {
  voiceEdge: VoiceStepEdge,
};

const EDGE_STROKE = {
  stroke: "color-mix(in srgb, var(--color-muted-foreground) 55%, transparent)",
  strokeWidth: 1.2,
  strokeDasharray: "4 4",
};

interface VoiceFlowCanvasProps {
  nodes: VoiceFlowNodeType[];
  edges: VoiceFlowEdge[];
  selectedNodeId: string | null;
  onNodesChange: OnNodesChange<VoiceFlowNodeType>;
  onEdgesChange: OnEdgesChange<VoiceFlowEdge>;
  onSelectNode: (id: string | null) => void;
  readOnly?: boolean;
}

export function VoiceFlowCanvas({
  nodes,
  edges,
  selectedNodeId,
  onNodesChange,
  onEdgesChange,
  onSelectNode,
  readOnly = false,
}: VoiceFlowCanvasProps) {
  const styledNodes = useMemo<VoiceFlowNodeType[]>(
    () =>
      nodes.map((n, index) => {
        const branchLabels = edges
          .filter((edge) => edge.source === n.id)
          .map((edge) => (typeof edge.label === "string" ? edge.label.trim() : ""))
          .filter(Boolean);
        return {
          ...n,
          data: {
            ...n.data,
            selected: n.id === selectedNodeId,
            stepIndex: index,
            branchLabels: branchLabels.length >= 2 ? branchLabels : undefined,
          },
        };
      }) as VoiceFlowNodeType[],
    [nodes, edges, selectedNodeId]
  );
  const styledEdges = useMemo<VoiceFlowEdge[]>(
    () =>
      edges.map((edge) => ({
        ...edge,
        type: "voiceEdge",
        style: { ...EDGE_STROKE, ...edge.style },
      })),
    [edges],
  );

  const instanceRef = useRef<ReactFlowInstance<VoiceFlowNodeType, VoiceFlowEdge> | null>(null);

  // Open focused on the top of the flow at a readable zoom instead of fitting
  // the entire cascade (which shrinks long imported scripts to thumbnails).
  const handleInit = useCallback(
    (instance: ReactFlowInstance<VoiceFlowNodeType, VoiceFlowEdge>) => {
      instanceRef.current = instance;
      window.setTimeout(() => {
        const topNodes = [...nodes]
          .sort((a, b) => a.position.y - b.position.y)
          .slice(0, 3)
          .map((n) => ({ id: n.id }));
        if (topNodes.length === 0) {
          instance.fitView({ padding: 0.28, duration: 240 });
          return;
        }
        instance.fitView({ nodes: topNodes, padding: 0.1, maxZoom: 0.9, duration: 240 });
      }, 50);
    },
    [nodes],
  );

  // Selecting a node opens the wide inspector over the right of the screen —
  // center the node in the canvas area that remains. The delay lets the panel
  // width change land and ReactFlow's resize observer pick up the new bounds
  // before fitting.
  useEffect(() => {
    if (!selectedNodeId) return;
    const timer = window.setTimeout(() => {
      instanceRef.current?.fitView({
        nodes: [{ id: selectedNodeId }],
        padding: 0.35,
        maxZoom: 0.9,
        duration: 280,
      });
    }, 100);
    return () => window.clearTimeout(timer);
  }, [selectedNodeId]);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: VoiceFlowNodeType) => {
      onSelectNode(node.id);
    },
    [onSelectNode]
  );

  const handlePaneClick = useCallback(() => {
    onSelectNode(null);
  }, [onSelectNode]);

  return (
    <div className="relative min-h-0 flex-1 bg-muted/25">
      <ReactFlow
        nodes={styledNodes}
        edges={styledEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onPaneClick={readOnly ? undefined : handlePaneClick}
        onInit={handleInit}
        nodesDraggable={!readOnly}
        nodesConnectable={false}
        minZoom={0.25}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          type: "voiceEdge",
          style: EDGE_STROKE,
        }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={16}
          size={1.4}
          color="color-mix(in srgb, var(--color-muted-foreground) 18%, transparent)"
        />
        <Controls
          showInteractive={false}
          className="!bg-background !border-border !rounded-lg !shadow-none [&>button]:!bg-background [&>button]:!border-border [&>button]:!text-muted-foreground [&>button:hover]:!bg-muted"
        />
      </ReactFlow>
    </div>
  );
}
