"use client";

import { useMemo, useCallback, useEffect } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  type Node,
  type NodeTypes,
  type EdgeTypes,
  type ReactFlowInstance,
  useNodesState,
  useEdgesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Metric } from "@/lib/metric-types";

import { buildTreeLayout } from "./metric-tree-layout";
import { MetricTreeNode } from "./metric-tree-node";
import { AnimatedEdge } from "./animated-edge";

const nodeTypes: NodeTypes = {
  metricCard: MetricTreeNode,
};

const edgeTypes: EdgeTypes = {
  animatedArrow: AnimatedEdge,
};

interface MetricTreeCanvasProps {
  metrics: Metric[];
  selectedMetricId: string | null;
  onSelectMetric: (id: string | null) => void;
  rootMetricId?: string | null;
}

export function MetricTreeCanvas({
  metrics,
  selectedMetricId,
  onSelectMetric,
  rootMetricId,
}: MetricTreeCanvasProps) {
  const { nodes: layoutNodes, edges: layoutEdges } = useMemo(
    () => buildTreeLayout(metrics, rootMetricId ?? undefined),
    [metrics, rootMetricId]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges);

  // Sync nodes/edges when the layout changes (e.g. after relationship backfill)
  useEffect(() => {
    setNodes(layoutNodes);
    setEdges(layoutEdges);
  }, [layoutNodes, layoutEdges, setNodes, setEdges]);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onSelectMetric(node.id);
    },
    [onSelectMetric]
  );

  const handlePaneClick = useCallback(() => {
    onSelectMetric(null);
  }, [onSelectMetric]);

  // Call fitView imperatively on init so the viewport is calculated after
  // the container has been fully measured (more reliable than the fitView prop alone).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleInit = useCallback((instance: any) => {
    instance.fitView({ padding: 0.2, duration: 200 });
  }, []);

  // Merge selection state into nodes
  const styledNodes = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        data: {
          ...n.data,
          selected: n.id === selectedMetricId,
        },
      })),
    [nodes, selectedMetricId]
  );

  return (
    <div className="flex-1 min-h-0 bg-muted/30">
      <ReactFlow
        nodes={styledNodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        onInit={handleInit}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={16}
          size={1.5}
          color="color-mix(in srgb, var(--color-muted-foreground) 20%, transparent)"
        />
        <Controls
          showInteractive={false}
          className="!bg-background !border-border !rounded-lg !shadow-none [&>button]:!bg-background [&>button]:!border-border [&>button]:!text-muted-foreground [&>button:hover]:!bg-muted"
        />
      </ReactFlow>
    </div>
  );
}
