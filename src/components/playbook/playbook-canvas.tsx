"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeProps,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Sparkles, MessageSquare, X, Layers, LayoutList } from "lucide-react";
import { CellTypeIcon, StatusDot } from "@/components/playbook/shared-icons";
import type {
  PlaybookCellV2,
  PlaybookAnnotation,
  CellStatus,
  CellRole,
  PlaybookExecutionStateV2,
} from "@/lib/playbook-types";

// ── Layout constants ──

const NODE_W = 480;
const NODE_H_SINGLE = 90;
const CHILD_CARD_H = 72; // height per child card row (2 cols per row)
const V_GAP = 44;
const H_GAP_EXPANDED = 24; // horizontal gap between sibling cells in expanded view

// ── Step: a visual group of cells with the same role at the same level ──

interface Step {
  id: string; // first cell's id (used as node id + click target)
  role: CellRole;
  type: "sql" | "llm" | "mixed";
  label: string;
  description: string;
  cells: PlaybookCellV2[];
  level: number;
}

// ── Props ──

interface PlaybookCanvasProps {
  cells: PlaybookCellV2[];
  onNodeClick?: (cellId: string) => void;
  onDeselect?: () => void;
  selectedNodeId?: string | null;
  selectedCellId?: string | null;
  executionState?: PlaybookExecutionStateV2;
  isGenerating?: boolean;
  filledCellIds?: Set<string>;
  editMode?: boolean;
  annotations?: PlaybookAnnotation[];
  onAnnotate?: (cellId: string | null, text: string) => void;
  onRemoveAnnotation?: (id: string) => void;
  onRequestEditMode?: () => void;
  applyingCellIds?: Set<string>;
  onApplyAnnotations?: () => void;
  onDiscardAnnotations?: () => void;
  isApplying?: boolean;
  /** Cell IDs with pending uncommitted diffs (shows yellow indicator) */
  pendingDiffCellIds?: Set<string>;
  /** Called when the user toggles between grouped / expanded view */
  onExpandedViewChange?: (expanded: boolean) => void;
  /** Validation results from dry run — shows pass/fail status on cells */
  validationResults?: Array<{ cellId: string; valid: boolean; error?: string }> | null;
}

export function PlaybookCanvas({
  cells,
  onNodeClick,
  onDeselect,
  selectedNodeId,
  selectedCellId,
  executionState,
  isGenerating: _isGenerating,
  filledCellIds: _filledCellIds,
  editMode,
  annotations,
  onAnnotate,
  onRemoveAnnotation,
  onRequestEditMode,
  applyingCellIds,
  onApplyAnnotations,
  onDiscardAnnotations,
  isApplying,
  pendingDiffCellIds,
  onExpandedViewChange,
  validationResults,
}: PlaybookCanvasProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rfRef = useRef<any>(null);
  const prevStepCount = useRef(0);

  const [expandedView, setExpandedView] = useState(false);

  const toggleExpandedView = useCallback(() => {
    setExpandedView((v) => {
      const next = !v;
      onExpandedViewChange?.(next);
      return next;
    });
  }, [onExpandedViewChange]);

  const steps = useMemo(() => buildSteps(cells), [cells]);

  const { initialNodes, initialEdges, newStepIds } = useMemo(
    () => buildGraph(steps, prevStepCount.current),
    [steps]
  );

  const { expandedNodes, expandedEdges } = useMemo(
    () => buildExpandedGraph(cells),
    [cells]
  );

  useEffect(() => {
    prevStepCount.current = steps.length;
  }, [steps.length]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Sync when cells change or view mode changes
  useEffect(() => {
    if (expandedView) {
      setNodes(expandedNodes);
      setEdges(expandedEdges);
    } else {
      setNodes(initialNodes);
      setEdges(initialEdges);
    }
  }, [initialNodes, initialEdges, expandedNodes, expandedEdges, expandedView, setNodes, setEdges]);

  // Auto-fit
  useEffect(() => {
    if (rfRef.current) {
      setTimeout(() => rfRef.current?.fitView({ padding: 0.3, duration: 300 }), 100);
    }
  }, [steps.length, expandedView]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onInit = useCallback((instance: any) => {
    rfRef.current = instance;
    setTimeout(() => instance.fitView(), 50);
  }, []);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onNodeClick?.(node.id);
      // Zoom to the clicked node for better focus
      if (rfRef.current) {
        setTimeout(() => {
          rfRef.current?.fitView({
            nodes: [{ id: node.id }],
            padding: 0.5,
            duration: 300,
            maxZoom: 1.2,
          });
        }, 50);
      }
    },
    [onNodeClick]
  );

  const handlePaneClick = useCallback(() => {
    onDeselect?.();
    // Zoom back to fit all nodes
    if (rfRef.current) {
      setTimeout(() => rfRef.current?.fitView({ padding: 0.3, duration: 300 }), 50);
    }
  }, [onDeselect]);

  // Build a map from validation results for quick lookup
  const validationMap = useMemo(() => {
    if (!validationResults) return null;
    const map = new Map<string, { valid: boolean; error?: string }>();
    for (const r of validationResults) map.set(r.cellId, r);
    return map;
  }, [validationResults]);

  // Resolve cell status: execution state > validation results > default
  function resolveCellStatus(cellId: string, fallback: CellStatus): CellStatus {
    const execStatus = executionState?.cellStatuses[cellId];
    if (execStatus) return execStatus;
    if (validationMap) {
      const vr = validationMap.get(cellId);
      if (vr) return vr.valid ? "done" : "error";
    }
    return fallback;
  }

  // Merge execution state into node data
  const styledNodes = useMemo(() => {
    if (expandedView) {
      // Expanded: each node represents one cell
      return nodes.map((n) => {
        const cell = cells.find((c) => c.id === n.id);
        if (!cell) return n;

        const cellStatus: CellStatus = resolveCellStatus(cell.id, cell.status ?? "idle");
        const cr = executionState?.cellResults[cell.id];
        const vr = validationMap?.get(cell.id);
        let footer: string | undefined;
        if (cr?.rowCount != null) footer = `${cr.rowCount} rows · ${cr.timeMs}ms`;
        if (cr?.error) footer = `Error: ${cr.error.slice(0, 50)}`;
        if (cr?.footer) footer = cr.footer;
        if (!footer && vr && !vr.valid && vr.error) footer = `Error: ${vr.error.slice(0, 50)}`;

        const nodeAnnotations = (annotations ?? []).filter((a) => a.cellId === cell.id);
        const applyingChildIds = applyingCellIds?.has(cell.id) ? [cell.id] : [];

        return {
          ...n,
          data: {
            ...n.data,
            children: [{ id: cell.id, label: cell.label, description: cell.description, status: cellStatus }],
            selected: n.id === selectedNodeId || n.id === selectedCellId,
            selectedCellId: n.id === selectedCellId ? selectedCellId : null,
            onCellClick: onNodeClick,
            isNew: false,
            isSkeleton: cell.skeleton === true,
            status: cellStatus,
            editMode: editMode ?? false,
            annotations: nodeAnnotations,
            onAnnotate,
            onRemoveAnnotation,
            onRequestEditMode,
            applyingChildIds,
            hasPendingDiff: pendingDiffCellIds?.has(cell.id) ?? false,
            ...(footer ? { footer } : {}),
          },
        };
      });
    }

    // Grouped (default): each node represents a step (may contain multiple cells)
    return nodes.map((n) => {
      const step = steps.find((s) => s.id === n.id);
      if (!step) return n;

      // Compute aggregate status for group — using resolved status (exec > validation > default)
      const cellStatuses = step.cells.map(
        (c) => resolveCellStatus(c.id, c.status ?? "idle")
      );
      let aggStatus: CellStatus = "idle";
      if (cellStatuses.some((s) => s === "running")) aggStatus = "running";
      else if (cellStatuses.every((s) => s === "done")) aggStatus = "done";
      else if (cellStatuses.some((s) => s === "error")) aggStatus = "error";
      else if (cellStatuses.some((s) => s === "done")) aggStatus = "running"; // partial

      // Aggregate footer for SQL groups
      let footer: string | undefined;
      if (step.cells.length > 1 && step.type === "sql") {
        const doneCount = cellStatuses.filter((s) => s === "done").length;
        const errorCount = cellStatuses.filter((s) => s === "error").length;
        if (aggStatus === "error" && errorCount > 0) {
          footer = `${errorCount}/${step.cells.length} failed validation`;
        } else if (aggStatus === "running" || aggStatus === "done") {
          footer = `${doneCount}/${step.cells.length} queries complete`;
        }
      } else if (step.cells.length === 1) {
        const cr = executionState?.cellResults[step.cells[0].id];
        const vr = validationMap?.get(step.cells[0].id);
        if (cr?.rowCount != null) footer = `${cr.rowCount} rows · ${cr.timeMs}ms`;
        if (cr?.error) footer = `Error: ${cr.error.slice(0, 50)}`;
        if (cr?.footer) footer = cr.footer;
        if (!footer && vr && !vr.valid && vr.error) footer = `Error: ${vr.error.slice(0, 50)}`;
        if (!footer && vr?.valid) footer = "Validation passed";
      }

      const isNew = newStepIds.has(n.id);

      // Collect annotations for this step's cells + step-level annotations
      const stepCellIds = new Set(step.cells.map((c) => c.id));
      const stepKey = `step:${n.id}`;
      const nodeAnnotations = (annotations ?? []).filter(
        (a) => (a.cellId && stepCellIds.has(a.cellId)) || a.cellId === stepKey
      );

      // Check if any cells in this step are being applied
      const applyingChildIds = applyingCellIds?.size
        ? step.cells.filter((c) => applyingCellIds.has(c.id)).map((c) => c.id)
        : [];

      // Build children with per-cell execution status
      const childrenWithStatus: ChildCard[] = step.cells.map((c, idx) => ({
        id: c.id,
        label: c.label,
        description: c.description,
        status: cellStatuses[idx],
        type: c.type as "sql" | "llm" | "python",
      }));

      // Skeleton detection: all cells in this step are still skeleton
      const isSkeleton = step.cells.every((c) => c.skeleton === true);

      return {
        ...n,
        data: {
          ...n.data,
          children: childrenWithStatus,
          selected: n.id === selectedNodeId || step.cells.some((c) => c.id === selectedNodeId),
          selectedCellId: step.cells.some((c) => c.id === selectedCellId) ? selectedCellId : null,
          onCellClick: onNodeClick,
          isNew,
          isSkeleton,
          status: aggStatus,
          editMode: editMode ?? false,
          annotations: nodeAnnotations,
          onAnnotate,
          onRemoveAnnotation,
          onRequestEditMode,
          applyingChildIds,
          hasPendingDiff: (pendingDiffCellIds?.size ?? 0) > 0 && step.cells.some((c) => pendingDiffCellIds!.has(c.id)),
          ...(footer ? { footer } : {}),
        },
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedView, nodes, cells, selectedNodeId, selectedCellId, executionState, newStepIds, steps, onNodeClick, editMode, annotations, onAnnotate, onRemoveAnnotation, onRequestEditMode, applyingCellIds, validationMap]);

  const annoCount = annotations?.length ?? 0;

  return (
    <div className="h-full flex-1 min-h-0 bg-muted/30 relative">
      <ReactFlow
        nodes={styledNodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        onInit={onInit}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.3}
        maxZoom={1.5}
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

      {/* Expand / Collapse toggle — floating top-left */}
      {cells.length > 0 && (
        <div className="absolute top-3 left-3 z-10">
          <button
            onClick={toggleExpandedView}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-background border border-border rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shadow-sm"
            title={expandedView ? "Collapse to grouped view" : "Expand to individual cells"}
          >
            {expandedView ? (
              <>
                <Layers className="w-3.5 h-3.5" />
                Grouped
              </>
            ) : (
              <>
                <LayoutList className="w-3.5 h-3.5" />
                Expanded
              </>
            )}
          </button>
        </div>
      )}

      {/* Apply / Discard — floating top-right, only when annotations exist */}
      {annoCount > 0 && (
        <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
          <button
            onClick={onApplyAnnotations}
            disabled={isApplying}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-foreground text-background rounded-md hover:bg-foreground/80 disabled:opacity-50 transition-colors shadow-sm"
          >
            {isApplying ? (
              <>
                <svg className="w-3 h-3 animate-spin" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" className="text-background/30" />
                  <path d="M14.5 8a6.5 6.5 0 0 0-6.5-6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-background" />
                </svg>
                Applying...
              </>
            ) : (
              <>
                <Sparkles className="w-3 h-3" />
                Apply {annoCount} change{annoCount > 1 ? "s" : ""}
              </>
            )}
          </button>
          <button
            onClick={onDiscardAnnotations}
            className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted bg-background border border-border transition-colors shadow-sm"
            title="Discard annotations"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Role config ──

const ROLE_LABEL: Record<CellRole, string> = {
  guardrail: "Guardrail",
  parameter: "Parameters",
  query: "Queries",
  analysis: "Analysis",
  summary: "Summary",
};

// ── Step Node ──

interface ChildCard {
  id: string;
  label: string;
  description: string;
  status: CellStatus;
  type: "sql" | "llm" | "python";
}

function AnnotationTooltip({
  targetId,
  onAnnotate,
  onClose,
  placeholder,
}: {
  targetId: string;
  onAnnotate: (cellId: string | null, text: string) => void;
  onClose: () => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  function handleSubmit(e: React.MouseEvent | React.KeyboardEvent) {
    e.stopPropagation();
    if (!draft.trim()) return;
    onAnnotate(targetId, draft.trim());
    setDraft("");
    onClose();
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="absolute left-full bottom-0 ml-2 z-50 w-64 bg-popover border border-border rounded-lg shadow-lg p-3"
    >
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            handleSubmit(e);
          }
          if (e.key === "Escape") onClose();
        }}
        placeholder={placeholder ?? "Leave a comment"}
        className="w-full px-3 py-2 text-xs bg-muted border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-foreground/20 placeholder:text-muted-foreground/50"
      />
      <div className="flex justify-end gap-3 mt-2.5">
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!draft.trim()}
          className="text-xs font-medium text-foreground hover:text-foreground/80 disabled:text-muted-foreground/40 transition-colors"
        >
          Add Comment
        </button>
      </div>
    </div>
  );
}

function StepNode({ data, id: nodeId }: NodeProps) {
  const {
    label,
    description,
    stepType,
    status,
    footer,
    cellCount,
    children: childCards,
    selected,
    selectedCellId,
    onCellClick,
    isNew,
    isSkeleton,
    annotations: nodeAnnotations,
    onAnnotate,
    onRemoveAnnotation,
    onRequestEditMode,
    applyingChildIds,
    hasPendingDiff,
  } = data as {
    label: string;
    description: string;
    stepType: "sql" | "llm" | "mixed";
    role: CellRole;
    status: CellStatus;
    footer?: string;
    cellCount: number;
    children: ChildCard[];
    selected?: boolean;
    selectedCellId?: string | null;
    onCellClick?: (cellId: string) => void;
    isNew?: boolean;
    isSkeleton?: boolean;
    editMode?: boolean;
    annotations?: PlaybookAnnotation[];
    onAnnotate?: (cellId: string | null, text: string) => void;
    onRemoveAnnotation?: (id: string) => void;
    onRequestEditMode?: () => void;
    applyingChildIds?: string[];
    hasPendingDiff?: boolean;
  };

  // Which cell's annotation input is open (null = step-level, undefined = closed)
  const [annotatingCellId, setAnnotatingCellId] = useState<string | null | undefined>(undefined);

  const isGroup = cellCount > 1;
  const annoCount = nodeAnnotations?.length ?? 0;
  const applyingSet = useMemo(() => new Set(applyingChildIds ?? []), [applyingChildIds]);

  // Track skeleton → filled transition for brief animation via DOM class toggle
  const stepRef = useRef<HTMLDivElement>(null);
  const prevSkeletonRef = useRef(isSkeleton);
  useEffect(() => {
    if (prevSkeletonRef.current && !isSkeleton && stepRef.current) {
      stepRef.current.classList.add("animate-skeleton-fill");
      const t = setTimeout(() => stepRef.current?.classList.remove("animate-skeleton-fill"), 350);
      return () => clearTimeout(t);
    }
    prevSkeletonRef.current = isSkeleton;
  }, [isSkeleton]);
  const isStepApplying = applyingSet.size > 0;

  // Group annotations by cellId for child-level display
  const annotationsByCell = useMemo(() => {
    const map = new Map<string, PlaybookAnnotation[]>();
    for (const a of nodeAnnotations ?? []) {
      const key = a.cellId ?? nodeId;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    return map;
  }, [nodeAnnotations, nodeId]);

  function handleStepAnnotateClick(e: React.MouseEvent) {
    e.stopPropagation();
    onRequestEditMode?.();
    setAnnotatingCellId(isGroup ? null : nodeId);
  }

  return (
    <div
      ref={stepRef}
      className={`
        group/step pointer-events-auto relative border rounded-lg bg-card cursor-pointer transition-[border-color,box-shadow]
        ${selected ? "border-foreground ring-1 ring-foreground/20" : "border-border"}
        ${isNew ? "animate-fade-in-up" : ""}
        ${isSkeleton ? "animate-skeleton-pulse" : ""}
      `}
      style={{ width: NODE_W }}
    >
      <Handle type="target" position={Position.Top} className="!bg-border !w-2 !h-2" />

      {/* Header */}
      <div className="flex items-center gap-2 px-3.5 py-2.5">
        <StatusDot status={status} />
        <CellTypeIcon type={stepType === "mixed" ? "sql" : stepType} size={13} />
        <span className="text-sm font-semibold truncate">{label}</span>
        {hasPendingDiff && (
          <span
            title="Pending changes. Review in Changelog tab"
            className="w-2.5 h-2.5 rounded-full bg-foreground shrink-0 ml-0.5"
          />
        )}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {annoCount > 0 && (
            <span className="text-[9px] font-medium bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
              <MessageSquare className="w-2.5 h-2.5" />
              {annoCount}
            </span>
          )}
          <div className="relative">
            <button
              onClick={handleStepAnnotateClick}
              className="p-0.5 rounded hover:bg-muted transition-colors opacity-0 group-hover/step:opacity-100"
            >
              <MessageSquare className="w-3 h-3 text-muted-foreground/40 hover:text-foreground" />
            </button>
            {(annotatingCellId === null || (!isGroup && annotatingCellId === nodeId)) && onAnnotate && (
              <AnnotationTooltip
                targetId={isGroup ? `step:${nodeId}` : nodeId}
                onAnnotate={onAnnotate}
                onClose={() => setAnnotatingCellId(undefined)}
                placeholder={isGroup ? `Comment on all ${cellCount} queries...` : undefined}
              />
            )}
          </div>
        </div>
      </div>

      {/* Separator + description for single-cell steps */}
      {!isGroup && (
        <>
          <div className="mx-3.5 border-b border-border" />
          {isStepApplying ? (
            <div className="flex items-center gap-2 px-3.5 py-2.5">
              <svg className="w-3.5 h-3.5 animate-spin text-muted-foreground" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" className="text-border" />
                <path d="M14.5 8a6.5 6.5 0 0 0-6.5-6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-muted-foreground" />
              </svg>
              <span className="text-[9.9px] text-muted-foreground">Regenerating...</span>
            </div>
          ) : isSkeleton ? (
            <div className="px-3.5 py-2.5 space-y-1.5">
              <div className="h-2.5 w-3/4 rounded bg-muted animate-pulse" />
              <div className="h-2.5 w-1/2 rounded bg-muted animate-pulse" />
            </div>
          ) : (
            <p className="text-[9.9px] text-muted-foreground leading-relaxed px-3.5 py-2.5 line-clamp-2">
              {description}
            </p>
          )}
        </>
      )}

      {/* Separator + child grid for groups */}
      {isGroup && childCards.length > 0 && (
        <>
          <div className="mx-3.5 border-b border-border" />
          <div className="px-3.5 py-3 grid grid-cols-2 gap-2">
            {childCards.map((child) => {
              const childAnnos = annotationsByCell.get(child.id) ?? [];
              const isAnnotating = annotatingCellId === child.id;
              const isChildApplying = applyingSet.has(child.id);
              return (
                <div
                  key={child.id}
                  className={`border rounded-md transition-colors ${
                    isChildApplying
                      ? "border-border bg-muted/30"
                      : selectedCellId === child.id
                        ? "border-foreground/50 bg-muted/30"
                        : "border-border bg-background/50"
                  } ${!isChildApplying && childAnnos.length > 0 ? "border-foreground/20" : ""}`}
                >
                  {isChildApplying ? (
                    <div className="px-3 py-4 flex items-center justify-center gap-2">
                      <svg className="w-3.5 h-3.5 animate-spin text-muted-foreground" viewBox="0 0 16 16" fill="none">
                        <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" className="text-border" />
                        <path d="M14.5 8a6.5 6.5 0 0 0-6.5-6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-muted-foreground" />
                      </svg>
                      <span className="text-[9px] text-muted-foreground">Regenerating...</span>
                    </div>
                  ) : isSkeleton ? (
                    <div className="px-3 py-4">
                      <div className="h-2.5 w-2/3 rounded bg-muted animate-pulse mb-2" />
                      <div className="h-2 w-full rounded bg-muted animate-pulse" />
                    </div>
                  ) : (
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      onCellClick?.(child.id);
                    }}
                    className="group/child px-3 py-2.5 cursor-pointer hover:bg-muted/40"
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <StatusDot status={child.status} />
                      <CellTypeIcon type={child.type} size={11} />
                      <span className="text-xs font-medium truncate flex-1">{child.label}</span>
                      {childAnnos.length > 0 && (
                        <span className="text-[8.1px] font-medium bg-muted text-muted-foreground px-1 py-0.5 rounded-full">
                          {childAnnos.length}
                        </span>
                      )}
                      <div className="relative shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onRequestEditMode?.();
                            setAnnotatingCellId(isAnnotating ? undefined : child.id);
                          }}
                          className="p-0.5 rounded hover:bg-muted transition-colors opacity-0 group-hover/child:opacity-100"
                        >
                          <MessageSquare className={`w-2.5 h-2.5 ${childAnnos.length > 0 ? "text-muted-foreground" : "text-muted-foreground/40 hover:text-foreground"}`} />
                        </button>
                        {isAnnotating && onAnnotate && (
                          <AnnotationTooltip
                            targetId={child.id}
                            onAnnotate={onAnnotate}
                            onClose={() => setAnnotatingCellId(undefined)}
                            placeholder={`Comment on "${child.label}"...`}
                          />
                        )}
                      </div>
                    </div>
                    <p className="text-[9px] text-muted-foreground leading-snug line-clamp-2">
                      {child.description}
                    </p>
                  </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Floating annotations — positioned to the right of the card */}
      {annoCount > 0 && !isStepApplying && (
        <div className="absolute left-full top-0 ml-3 w-56 space-y-1.5" onClick={(e) => e.stopPropagation()}>
          {(nodeAnnotations ?? []).map((a) => {
            const isStepLevel = !a.cellId || a.cellId.startsWith("step:");
            const targetCell = !isStepLevel ? childCards.find((c) => c.id === a.cellId) : undefined;
            const label = targetCell ? targetCell.label : undefined;
            return (
              <div
                key={a.id}
                className="flex items-start gap-2 px-3 py-2 bg-popover border border-border rounded-lg shadow-sm"
              >
                <span className="text-[9.9px] text-foreground/80 leading-snug flex-1">
                  {label && (
                    <span className="text-muted-foreground text-[9px]">{label} · </span>
                  )}
                  {a.text}
                </span>
                {onRemoveAnnotation && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onRemoveAnnotation(a.id); }}
                    className="p-0.5 rounded hover:bg-muted shrink-0 mt-0.5"
                  >
                    <X className="w-3 h-3 text-muted-foreground" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Footer */}
      {footer && (
        <div className="px-3.5 pb-2">
          <span className="text-[9px] text-muted-foreground/70">{footer}</span>
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="!bg-border !w-2 !h-2" />
    </div>
  );
}

// ── Node types ──

const nodeTypes: NodeTypes = {
  stepNode: StepNode,
};

// ── Build steps: group cells by role at the same dependency level ──

function computeLevels(cells: PlaybookCellV2[]): Map<string, number> {
  const levels = new Map<string, number>();
  const cellMap = new Map(cells.map((c) => [c.id, c]));

  function getLevel(id: string): number {
    if (levels.has(id)) return levels.get(id)!;
    const cell = cellMap.get(id);
    if (!cell || cell.dependsOn.length === 0) {
      levels.set(id, 0);
      return 0;
    }
    const maxDep = Math.max(
      ...cell.dependsOn
        .filter((dep) => cellMap.has(dep))
        .map((dep) => getLevel(dep))
    );
    const level = maxDep + 1;
    levels.set(id, level);
    return level;
  }

  for (const cell of cells) getLevel(cell.id);
  return levels;
}

function buildSteps(cells: PlaybookCellV2[]): Step[] {
  if (cells.length === 0) return [];

  const levels = computeLevels(cells);

  // Group by (level, role)
  const groups = new Map<string, PlaybookCellV2[]>();
  for (const cell of cells) {
    const lvl = levels.get(cell.id) ?? 0;
    const key = `${lvl}:${cell.role}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(cell);
  }

  // Convert groups to steps, sorted by level then role order
  const roleOrder: CellRole[] = ["guardrail", "parameter", "query", "analysis", "summary"];
  const steps: Step[] = [];

  const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
    const [la, ra] = a.split(":");
    const [lb, rb] = b.split(":");
    const levelDiff = Number(la) - Number(lb);
    if (levelDiff !== 0) return levelDiff;
    return roleOrder.indexOf(ra as CellRole) - roleOrder.indexOf(rb as CellRole);
  });

  for (const key of sortedKeys) {
    const groupCells = groups.get(key)!;
    const [levelStr, role] = key.split(":");
    const first = groupCells[0];
    const types = new Set(groupCells.map((c) => c.type));
    const stepType = types.size > 1 ? "mixed" : (first.type as "sql" | "llm");

    steps.push({
      id: first.id,
      role: role as CellRole,
      type: stepType,
      label: groupCells.length === 1
        ? first.label
        : `${ROLE_LABEL[role as CellRole] ?? role} · ${groupCells.length} ${stepType === "sql" ? "Queries" : "Steps"}`,
      description: groupCells.length === 1
        ? first.description
        : `Runs ${groupCells.length} ${stepType} operations in parallel.`,
      cells: groupCells,
      level: Number(levelStr),
    });
  }

  return steps;
}

// ── Build expanded graph: one node per cell, level-to-level edges ──

function buildExpandedGraph(cells: PlaybookCellV2[]): {
  expandedNodes: Node[];
  expandedEdges: Edge[];
} {
  if (cells.length === 0) return { expandedNodes: [], expandedEdges: [] };

  const levels = computeLevels(cells);

  // Group cells by level
  const cellsByLevel = new Map<number, PlaybookCellV2[]>();
  for (const cell of cells) {
    const lvl = levels.get(cell.id) ?? 0;
    if (!cellsByLevel.has(lvl)) cellsByLevel.set(lvl, []);
    cellsByLevel.get(lvl)!.push(cell);
  }

  const sortedLevels = Array.from(cellsByLevel.keys()).sort((a, b) => a - b);

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  let y = 0;

  for (const level of sortedLevels) {
    const levelCells = cellsByLevel.get(level)!;
    const count = levelCells.length;
    const totalWidth = count * NODE_W + (count - 1) * H_GAP_EXPANDED;
    const startX = -totalWidth / 2;

    for (let i = 0; i < count; i++) {
      const cell = levelCells[i];
      nodes.push({
        id: cell.id,
        type: "stepNode",
        position: { x: startX + i * (NODE_W + H_GAP_EXPANDED), y },
        data: {
          label: cell.label,
          description: cell.description,
          stepType: cell.type,
          role: cell.role,
          status: (cell.status ?? "idle") as CellStatus,
          cellCount: 1,
          children: [{
            id: cell.id,
            label: cell.label,
            description: cell.description,
            status: (cell.status ?? "idle") as CellStatus,
          }],
        },
        draggable: true,
      });
    }

    y += NODE_H_SINGLE + V_GAP;
  }

  // Level-to-level edges: every cell at level N → every cell at level N+1
  for (let li = 0; li < sortedLevels.length - 1; li++) {
    const fromCells = cellsByLevel.get(sortedLevels[li])!;
    const toCells = cellsByLevel.get(sortedLevels[li + 1])!;

    for (const from of fromCells) {
      for (const to of toCells) {
        edges.push({
          id: `ee-${from.id}-${to.id}`,
          source: from.id,
          target: to.id,
          type: "smoothstep",
          animated: false,
          style: { stroke: "var(--color-border)", strokeWidth: 1.5 },
        });
      }
    }
  }

  return { expandedNodes: nodes, expandedEdges: edges };
}

// ── Build graph from steps ──

function estimateNodeHeight(step: Step): number {
  if (step.cells.length <= 1) return NODE_H_SINGLE;
  // Header (~40) + description (~20) + grid rows (2 cols per row, ~72 per row) + padding
  const rows = Math.ceil(step.cells.length / 2);
  return 60 + rows * CHILD_CARD_H + 14;
}

function buildGraph(
  steps: Step[],
  prevCount: number
): {
  initialNodes: Node[];
  initialEdges: Edge[];
  newStepIds: Set<string>;
} {
  if (steps.length === 0) {
    return { initialNodes: [], initialEdges: [], newStepIds: new Set() };
  }

  const newStepIds = new Set<string>();
  if (steps.length > prevCount) {
    for (let i = prevCount; i < steps.length; i++) {
      newStepIds.add(steps[i].id);
    }
  }

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  let y = 0;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const h = estimateNodeHeight(step);

    nodes.push({
      id: step.id,
      type: "stepNode",
      position: { x: 0, y },
      data: {
        label: step.label,
        description: step.description,
        stepType: step.type,
        role: step.role,
        status: "idle" as CellStatus,
        cellCount: step.cells.length,
        children: step.cells.map((c) => ({ id: c.id, label: c.label, description: c.description, status: c.status ?? "idle" as CellStatus })),
      },
      draggable: true,
    });

    // Connect to previous step
    if (i > 0) {
      edges.push({
        id: `e-${steps[i - 1].id}-${step.id}`,
        source: steps[i - 1].id,
        target: step.id,
        type: "smoothstep",
        animated: false,
        style: { stroke: "var(--color-border)", strokeWidth: 1.5 },
      });
    }

    y += h + V_GAP;
  }

  return { initialNodes: nodes, initialEdges: edges, newStepIds };
}
