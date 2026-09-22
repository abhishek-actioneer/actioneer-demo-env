"use client";

import { useState } from "react";
import { Check, ChevronDown, ChevronUp, Plus, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
  VoiceFlowNode,
  VoiceFlowNodeData,
  VoiceFlowNodeKind,
} from "@/lib/voice-campaign-flow";
import { KIND_STYLE, KindIcon } from "./voice-flow-node";

interface ReadinessItem {
  label: string;
  complete: boolean;
}

interface VoiceFlowInspectorProps {
  selectedNode: VoiceFlowNode | null;
  nodes: VoiceFlowNode[];
  readiness: ReadinessItem[];
  /** Launch checks only make sense before launch — hide the strip once the campaign is launching/running/completed. */
  showReadiness?: boolean;
  onUpdateNode: (nodeId: string, patch: Partial<VoiceFlowNodeData>) => void;
  onSelectNode: (id: string) => void;
  onDeselect: () => void;
  /** Insert a new step after the given node (null → append before the close). */
  onInsertNode: (afterNodeId: string | null, kind: VoiceFlowNodeKind) => void;
  onRemoveNode: (nodeId: string) => void;
}

function AddStepMenu({
  label,
  className,
  onPick,
}: {
  label: string;
  className?: string;
  onPick: (kind: VoiceFlowNodeKind) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button type="button" variant="outline" size="sm" className={className} />}
      >
        <Plus className="size-4" />
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {SELECTABLE_KINDS.map((kind) => {
          const kindStyle = KIND_STYLE[kind];
          return (
            <DropdownMenuItem key={kind} className="gap-2.5" onClick={() => onPick(kind)}>
              <span
                className={`flex size-6 shrink-0 items-center justify-center rounded-md ${kindStyle.header}`}
              >
                <KindIcon kind={kind} className={`size-3.5 ${kindStyle.icon}`} />
              </span>
              <span className="capitalize">{kind}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// The start node is special-cased by the compiler (opening line extraction,
// private-setup body) — retyping it would silently break that contract.
const SELECTABLE_KINDS: VoiceFlowNodeKind[] = [
  "prompt",
  "question",
  "condition",
  "action",
  "transfer",
  "end",
];

export function VoiceFlowInspector({
  selectedNode,
  nodes,
  readiness,
  showReadiness = true,
  onUpdateNode,
  onSelectNode,
  onDeselect,
  onInsertNode,
  onRemoveNode,
}: VoiceFlowInspectorProps) {
  const [nameSectionOpen, setNameSectionOpen] = useState(true);
  const [readinessOpen, setReadinessOpen] = useState(false);
  const [stepQuery, setStepQuery] = useState("");

  // No selection: the panel is an outline of the workflow itself — every step
  // in call order with its branches, clickable to jump to that node on the
  // canvas. Launch readiness collapses to a strip at the top (drafts only).
  if (!selectedNode) {
    const readyCount = readiness.filter((item) => item.complete).length;
    const query = stepQuery.trim().toLowerCase();
    const visibleSteps = nodes
      .map((node, index) => ({ node, index }))
      .filter(({ node }) => !query || node.data.title.toLowerCase().includes(query));
    return (
      <aside className="flex h-full w-[340px] shrink-0 flex-col border-l border-border bg-background">
        <div className="px-5 pb-3 pt-4">
          <h2 className="text-lg font-semibold tracking-[-0.01em]">Workflow</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {nodes.length} steps · click a step to edit it
          </p>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={stepQuery}
              onChange={(e) => setStepQuery(e.target.value)}
              placeholder="Search steps"
              className="h-9 pl-9"
            />
          </div>
        </div>

        {showReadiness ? (
          <div className="mx-5 mb-3 rounded-lg border border-border bg-muted/25">
            <button
              type="button"
              className="flex w-full items-center gap-2.5 px-3 py-2.5"
              onClick={() => setReadinessOpen((open) => !open)}
            >
              <span className="text-xs font-medium">Launch readiness</span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {readyCount}/{readiness.length}
              </span>
              <span className="ml-auto flex items-center gap-2">
                <span className="flex gap-1">
                  {readiness.map((item) => (
                    <span
                      key={item.label}
                      className={[
                        "h-1 w-4 rounded-full",
                        item.complete ? "bg-foreground" : "bg-muted-foreground/25",
                      ].join(" ")}
                    />
                  ))}
                </span>
                {readinessOpen ? (
                  <ChevronUp className="size-3.5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                )}
              </span>
            </button>
            {readinessOpen ? (
              <div className="px-3 pb-3">
                {readiness.map((item) => (
                  <div key={item.label} className="flex items-center gap-2.5 py-1">
                    {item.complete ? (
                      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-foreground">
                        <Check className="size-2.5 text-background" strokeWidth={3} />
                      </span>
                    ) : (
                      <span className="size-4 shrink-0 rounded-full border border-muted-foreground/40" />
                    )}
                    <span
                      className={
                        item.complete ? "text-xs text-muted-foreground" : "text-xs font-medium"
                      }
                    >
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 pb-4 pt-1">
          {visibleSteps.map(({ node, index }) => {
            const kindStyle = KIND_STYLE[node.data.kind] ?? KIND_STYLE.prompt;
            return (
              <button
                key={node.id}
                type="button"
                className="flex w-full items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5 text-left shadow-xs transition-colors hover:border-foreground/25 hover:bg-muted/40"
                onClick={() => onSelectNode(node.id)}
              >
                <span
                  className={`flex size-8 shrink-0 items-center justify-center rounded-md ${kindStyle.header}`}
                >
                  <KindIcon kind={node.data.kind} className={`size-4 ${kindStyle.icon}`} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{node.data.title}</span>
                  <span
                    className={`block text-[9px] font-semibold uppercase tracking-wider ${kindStyle.label}`}
                  >
                    {node.data.kind}
                  </span>
                </span>
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-muted/30 text-[9.9px] font-medium tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
              </button>
            );
          })}
          {visibleSteps.length === 0 ? (
            <p className="px-1 py-3 text-xs text-muted-foreground">
              No steps match &ldquo;{stepQuery.trim()}&rdquo;.
            </p>
          ) : null}
        </div>

        <div className="shrink-0 border-t border-border px-5 py-3">
          <AddStepMenu
            label="Add step"
            className="w-full"
            onPick={(kind) => onInsertNode(null, kind)}
          />
        </div>
      </aside>
    );
  }

  const data = selectedNode.data;
  const kindStyle = KIND_STYLE[data.kind] ?? KIND_STYLE.prompt;
  const isStart = data.kind === "start";
  const isVerbatim = data.provenance === "verbatim";

  return (
    <aside className="flex h-full w-[35vw] min-w-[420px] shrink-0 flex-col border-l border-border bg-background">
      <div className="flex items-center gap-3 border-b border-border px-5 py-3.5">
        <span
          className={`flex size-9 shrink-0 items-center justify-center rounded-lg border border-border ${kindStyle.header}`}
        >
          <KindIcon kind={data.kind} className={`size-4 ${kindStyle.icon}`} />
        </span>
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{data.title}</h2>
        <span className="shrink-0 rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[9.9px] font-medium text-muted-foreground">
          Draft
        </span>
        <Button variant="ghost" size="icon-xs" onClick={onDeselect} aria-label="Close inspector">
          <X className="size-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="border-b border-border px-5 py-4">
          <button
            type="button"
            className="flex w-full items-center justify-between"
            onClick={() => setNameSectionOpen((open) => !open)}
          >
            <h3 className="text-sm font-semibold">Node name and type</h3>
            {nameSectionOpen ? (
              <ChevronUp className="size-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="size-4 text-muted-foreground" />
            )}
          </button>

          {nameSectionOpen ? (
            <>
              <div className="mt-4 grid grid-cols-[1fr_170px] gap-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Title
                  </label>
                  <Input
                    value={data.title}
                    onChange={(e) => onUpdateNode(selectedNode.id, { title: e.target.value })}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Type
                  </label>
                  {isStart ? (
                    <div className="flex h-9 items-center rounded-md border border-border bg-muted/25 px-3 text-sm capitalize">
                      start
                    </div>
                  ) : (
                    <Select
                      value={data.kind}
                      onValueChange={(value) =>
                        onUpdateNode(selectedNode.id, { kind: value as VoiceFlowNodeKind })
                      }
                    >
                      <SelectTrigger className="w-full capitalize">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SELECTABLE_KINDS.map((kind) => (
                          <SelectItem key={kind} value={kind} className="capitalize">
                            {kind}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between gap-4 rounded-lg bg-muted/40 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">Static text</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Write an exact dialogue for the agent to recite
                  </p>
                </div>
                <Switch
                  checked={isVerbatim}
                  onCheckedChange={(checked) =>
                    onUpdateNode(selectedNode.id, {
                      provenance: checked ? "verbatim" : "operator",
                    })
                  }
                />
              </div>
            </>
          ) : null}
        </section>

        <section className="border-b border-border px-5 py-4">
          <h3 className="text-sm font-semibold">Dialogue prompt</h3>
          <Textarea
            value={data.body}
            onChange={(e) => onUpdateNode(selectedNode.id, { body: e.target.value })}
            className="mt-3 min-h-[280px] resize-none text-sm leading-relaxed"
          />
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Write what the voice agent should do at this point in the conversation.
          </p>
        </section>

        <section className="px-5 py-4">
          <h3 className="text-sm font-semibold">Helper note</h3>
          <Textarea
            value={data.helper ?? ""}
            rows={4}
            onChange={(e) => onUpdateNode(selectedNode.id, { helper: e.target.value })}
            placeholder="Optional note for this node"
            className="mt-3 resize-none bg-muted/25 text-sm leading-relaxed"
          />
        </section>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3">
        <AddStepMenu
          label="Add step below"
          className="flex-1"
          onPick={(kind) => onInsertNode(selectedNode.id, kind)}
        />
        {!isStart ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                aria-label="Delete step"
              >
                <Trash2 className="size-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete &ldquo;{data.title}&rdquo;?</AlertDialogTitle>
                <AlertDialogDescription>
                  The steps before it will be reconnected to the steps after it, and the Script
                  tab will update to match. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => onRemoveNode(selectedNode.id)}>
                  Delete step
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </div>
    </aside>
  );
}
