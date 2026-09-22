"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowRight, Loader2, Plus, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  VOICE_CAMPAIGN_TEMPLATES,
  type VoiceCampaignTemplate,
} from "@/lib/voice-campaign-flow";
import { VoiceFlowNode } from "./voice-flow-node";

const nodeTypes: NodeTypes = {
  voiceNode: VoiceFlowNode,
};

interface TemplatePickerProps {
  onUseTemplate: (template: VoiceCampaignTemplate, campaignName: string) => void;
  onClose?: () => void;
  campaignBrief?: string;
  onCampaignBriefChange?: (value: string) => void;
  onGenerateFromBrief?: () => void;
  generatingFromBrief?: boolean;
  canGenerateFromBrief?: boolean;
  generationHint?: string;
}

export function VoiceCampaignTemplatePicker({
  onUseTemplate,
  onClose,
  campaignBrief,
  onCampaignBriefChange,
  onGenerateFromBrief,
  generatingFromBrief = false,
  canGenerateFromBrief = false,
  generationHint,
}: TemplatePickerProps) {
  const [selectedId, setSelectedId] = useState(VOICE_CAMPAIGN_TEMPLATES[0].id);
  const selected = useMemo(
    () => VOICE_CAMPAIGN_TEMPLATES.find((t) => t.id === selectedId) ?? VOICE_CAMPAIGN_TEMPLATES[0],
    [selectedId]
  );
  const [campaignName, setCampaignName] = useState(selected.defaultCampaignName);

  useEffect(() => {
    if (!onClose) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  function handleSelect(template: VoiceCampaignTemplate) {
    setSelectedId(template.id);
    setCampaignName(template.defaultCampaignName);
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/75 p-6 backdrop-blur-md" onClick={onClose}>
      <div className="grid h-[min(780px,calc(100dvh-48px))] w-full max-w-6xl grid-cols-[390px_minmax(0,1fr)] overflow-hidden rounded-lg border border-border bg-background shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex min-h-0 flex-col border-r border-border">
          <div className="px-5 pb-4 pt-5">
            <div className="flex items-start justify-between gap-2">
              <h1 className="text-lg font-semibold">Create Voice Campaign</h1>
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="mt-0.5 shrink-0 rounded-md p-1 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground transition-colors"
                  aria-label="Close"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Start from a reusable outbound workflow, then tune the call logic before launch.
            </p>
            {onGenerateFromBrief && onCampaignBriefChange && (
              <div className="mt-4 border-t border-border pt-4">
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Campaign brief
                </label>
                <Textarea
                  value={campaignBrief ?? ""}
                  onChange={(event) => onCampaignBriefChange(event.target.value)}
                  rows={4}
                  placeholder="Call recent drop-offs, understand what stopped them, explain the offer only if interested, and route warm leads to callback."
                  className="resize-none text-sm leading-relaxed"
                />
                <Button
                  className="mt-3 w-full"
                  variant="outline"
                  disabled={!canGenerateFromBrief || generatingFromBrief}
                  onClick={onGenerateFromBrief}
                >
                  {generatingFromBrief ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  {generatingFromBrief ? "Generating" : "Generate script + workflow"}
                </Button>
                {generationHint && (
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    {generationHint}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5">
            <div className="space-y-2.5 pb-5">
              {VOICE_CAMPAIGN_TEMPLATES.map((template) => {
                const active = template.id === selected.id;
                return (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => handleSelect(template)}
                    className={[
                      "group w-full rounded-lg border px-4 py-3 text-left transition-[background-color,border-color,transform]",
                      "active:scale-[0.99]",
                      active ? "border-foreground bg-muted/40" : "border-border hover:bg-muted/30",
                    ].join(" ")}
                  >
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                        {template.id === "blank" ? (
                          <Plus className="size-3.5 text-muted-foreground" />
                        ) : (
                          <ArrowRight className="size-3.5 text-muted-foreground" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">{template.title}</span>
                        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                          {template.description}
                        </span>
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-border p-5">
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Campaign name
            </label>
            <Input
              value={campaignName}
              onChange={(e) => setCampaignName(e.target.value)}
              placeholder="Enter campaign name"
            />
            <Button
              className="mt-4 w-full"
              disabled={!campaignName.trim()}
              onClick={() => onUseTemplate(selected, campaignName.trim())}
            >
              Use template
            </Button>
          </div>
        </div>

        <div className="relative min-h-0 bg-muted/25">
          <div className="absolute left-5 top-5 z-10 max-w-md">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Preview
            </p>
            <h2 className="mt-1 text-base font-semibold">{selected.title}</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {selected.audienceHint}
            </p>
          </div>

          <ReactFlow
            nodes={selected.nodes}
            edges={selected.edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.32 }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            panOnDrag={false}
            zoomOnScroll={false}
            zoomOnPinch={false}
            zoomOnDoubleClick={false}
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{
              type: "smoothstep",
              style: {
                stroke: "color-mix(in srgb, var(--color-muted-foreground) 55%, transparent)",
                strokeWidth: 1.4,
              },
              labelStyle: {
                fill: "var(--color-foreground)",
                fontSize: 9.9,
                fontWeight: 500,
              },
              labelBgStyle: {
                fill: "var(--color-background)",
                fillOpacity: 0.92,
              },
              labelBgPadding: [8, 4],
              labelBgBorderRadius: 6,
            }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={16}
              size={1.4}
              color="color-mix(in srgb, var(--color-muted-foreground) 18%, transparent)"
            />
          </ReactFlow>
        </div>
      </div>
    </div>
  );
}
