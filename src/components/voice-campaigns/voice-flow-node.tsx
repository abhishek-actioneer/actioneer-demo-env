"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  CheckCircle2,
  Flag,
  GitBranch,
  HelpCircle,
  MessageSquare,
  PhoneForwarded,
  Play,
} from "lucide-react";
import type { VoiceFlowNodeData, VoiceFlowNodeKind } from "@/lib/voice-campaign-flow";

const NODE_W = 360;

// Kind-tinted card accents — an explicit exception to the monochrome UI rule,
// requested to match the reference flow-editor design.
export const KIND_STYLE: Record<VoiceFlowNodeKind, { header: string; icon: string; label: string }> = {
  start: { header: "bg-violet-50", icon: "text-violet-600", label: "text-violet-700" },
  prompt: { header: "bg-sky-50", icon: "text-sky-600", label: "text-sky-700" },
  question: { header: "bg-orange-50", icon: "text-orange-500", label: "text-orange-600" },
  condition: { header: "bg-indigo-50", icon: "text-indigo-600", label: "text-indigo-700" },
  action: { header: "bg-emerald-50", icon: "text-emerald-600", label: "text-emerald-700" },
  transfer: { header: "bg-cyan-50", icon: "text-cyan-600", label: "text-cyan-700" },
  end: { header: "bg-rose-50", icon: "text-rose-600", label: "text-rose-700" },
};

export function KindIcon({ kind, className }: { kind: VoiceFlowNodeKind; className: string }) {
  if (kind === "start") return <Play className={className} />;
  if (kind === "question") return <HelpCircle className={className} />;
  if (kind === "condition") return <GitBranch className={className} />;
  if (kind === "transfer") return <PhoneForwarded className={className} />;
  if (kind === "action") return <CheckCircle2 className={className} />;
  if (kind === "end") return <Flag className={className} />;
  return <MessageSquare className={className} />;
}

type NodeCardData = VoiceFlowNodeData & {
  selected?: boolean;
  // Presentation-only fields injected by voice-flow-canvas — never persisted.
  stepIndex?: number;
  branchLabels?: string[];
};

function VoiceFlowNodeInner({ data }: NodeProps) {
  const nodeData = data as NodeCardData;
  const isEnd = nodeData.kind === "end";
  const kindStyle = KIND_STYLE[nodeData.kind] ?? KIND_STYLE.prompt;
  const branches = nodeData.branchLabels ?? [];
  const helper = nodeData.helper?.trim();
  const body = (nodeData.body ?? "").trim();
  const sayBody = body.startsWith("Say:") ? body.slice(4).trim() : null;

  return (
    <div className="relative" style={{ width: NODE_W }}>
      {helper ? (
        <div className="absolute bottom-full left-0 mb-1.5 max-w-full truncate rounded-md border border-amber-200/70 bg-amber-50 px-2.5 py-1 text-[9.9px] leading-snug text-amber-800">
          {helper}
        </div>
      ) : null}

      <div
        className={[
          "rounded-lg border bg-card shadow-sm transition-[border-color,box-shadow]",
          nodeData.selected ? "border-foreground ring-1 ring-foreground/15" : "border-border",
        ].join(" ")}
      >
        <Handle
          type="target"
          position={Position.Top}
          className="!size-2 !min-h-0 !min-w-0 !border !border-background !bg-muted-foreground"
        />

        <div
          className={`flex items-center gap-2 rounded-t-lg border-b border-border/60 px-3 py-2.5 ${kindStyle.header}`}
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-background/90 shadow-sm">
            <KindIcon kind={nodeData.kind} className={`size-3.5 ${kindStyle.icon}`} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{nodeData.title}</p>
            <p className={`text-[9px] font-semibold uppercase tracking-wider ${kindStyle.label}`}>
              {nodeData.kind}
            </p>
          </div>
          {typeof nodeData.stepIndex === "number" ? (
            <span className="flex size-5 shrink-0 items-center justify-center rounded-md border border-border bg-background text-[9.9px] font-medium text-muted-foreground">
              {nodeData.stepIndex + 1}
            </span>
          ) : null}
        </div>

        {/* Padding lives on the wrapper: line-clamp + padding on one element
            lets the clipped line bleed into the bottom padding. */}
        <div className="px-3.5 py-3">
          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {sayBody !== null ? (
              <>
                <span className="font-medium text-foreground">Say:</span> {sayBody}
              </>
            ) : (
              body
            )}
          </p>
        </div>

        {branches.length >= 2 ? (
          <div className="border-t border-border px-3.5 pb-1 pt-2">
            <p className="mb-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
              Branches
            </p>
            <div className="divide-y divide-border/60">
              {branches.map((branch, index) => (
                <div key={index} className="flex items-center gap-2 py-1.5">
                  <span className="w-4 shrink-0 text-center text-[9.9px] font-medium text-blue-600">
                    {index + 1}
                  </span>
                  <span className="truncate text-xs">{branch}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {isEnd && nodeData.required ? (
          <div className="border-t border-border px-3.5 py-2 text-right text-[9.9px] font-medium text-rose-600">
            Required
          </div>
        ) : null}

        {!isEnd && (
          <Handle
            type="source"
            position={Position.Bottom}
            className="!size-2 !min-h-0 !min-w-0 !border !border-background !bg-muted-foreground"
          />
        )}
      </div>
    </div>
  );
}

export const VoiceFlowNode = memo(VoiceFlowNodeInner);
